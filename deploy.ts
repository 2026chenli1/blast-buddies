// ============================================================
// Blast Buddies 联机服务器（Deno Deploy 版）
// 作用：静态文件 + WebSocket 房间转发（host-authoritative）
// 协议与 Cloudflare 版一致：
//   create           -> { t:'created', room }
//   join             -> { t:'joined', room } / { t:'error', msg }
//   input (guest->host) { t:'input', d }
//   state (host->guest) { t:'state', d }
//   peer (在线状态)      { t:'peer', state:'connected'|'disconnected' }
// 免费额度：1M 请求/月 + 20GB 流量，双人游戏绰绰有余
// ============================================================

// ---------- 全局状态 ----------
// 每个 isolate 维护自己的连接表；跨 isolate 用 BroadcastChannel 转发
let connSeq = 0;
const conns = new Map(); // connId -> { ws, room, role, slot }
const rooms = new Map(); // room -> { host, guests: [{slot, id}], created, cap, mode }
// cap: 0 = 不限人数；mode: 'public'（房间列表可见）| 'private'（凭房间号加入）

const bc = new BroadcastChannel('blast-relay');

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (_) {}
}

// ---------- 跨 isolate 消息 ----------
// 注意：Deno 的 BroadcastChannel 不会把消息投递给发送者自己，
// 所以每次 postMessage 后要同步调用 dispatch() 处理本 isolate 的连接，
// BC 仅负责把消息投递给其他 isolate。
// 事件类型：
//   relay     -> 转发游戏消息 { type:'relay', room, from, payload }
//   created   -> 房间创建   { type:'room', action:'created', room, host, created }
//   joined    -> guest 加入 { type:'room', action:'joined', room, host, guest, slot, created, cap, mode }
//   left      -> guest 离开 { type:'room', action:'left',   room, host, guest, slot, created, cap, mode }
//   destroyed -> host 断开  { type:'room', action:'destroyed', room }
function dispatch(m) {
  if (!m) return;

  if (m.type === 'relay') {
    // 转发给本 isolate 中同房间、非来源的连接
    for (const [id, c] of conns) {
      if (id !== m.from && c.room === m.room) send(c.ws, m.payload);
    }
    return;
  }
  if (m.type !== 'room') return;

  switch (m.action) {
    case 'created': {
      if (!rooms.has(m.room)) {
        rooms.set(m.room, { host: m.host, guests: [], created: m.created, cap: m.cap || 0, mode: m.mode || 'public' });
      }
      break;
    }
    case 'joined': {
      let r = rooms.get(m.room);
      if (!r) {
        rooms.set(m.room, { host: m.host, guests: [], created: m.created, cap: m.cap || 0, mode: m.mode || 'public' });
        r = rooms.get(m.room);
      }
      if (!r.guests.some(g => g.id === m.guest)) r.guests.push({ slot: m.slot, id: m.guest });
      // 通知 host：某 slot 的玩家加入
      const h = m.host ? conns.get(m.host) : null;
      if (h && h.role === 'host' && h.room === m.room) {
        send(h.ws, { t: 'peer', state: 'connected', slot: m.slot });
      }
      break;
    }
    case 'left': {
      const r = rooms.get(m.room);
      if (r) {
        r.guests = r.guests.filter(g => g.id !== m.guest);
        // 通知 host：某 slot 的玩家离开
        const h = m.host ? conns.get(m.host) : null;
        if (h && h.role === 'host' && h.room === m.room) {
          send(h.ws, { t: 'peer', state: 'disconnected', slot: m.slot });
        }
      }
      break;
    }
    case 'destroyed': {
      rooms.delete(m.room);
      // host 断开解散房间：通知本 isolate 中该房间的所有 guest
      for (const [id, c] of conns) {
        if (c.role === 'guest' && c.room === m.room) {
          send(c.ws, { t: 'peer', state: 'disconnected' });
          c.room = null;
          c.role = null;
          c.slot = null;
        }
      }
      break;
    }
    default:
      break;
  }
}

function broadcast(m) {
  bc.postMessage(m);
  dispatch(m); // 本 isolate 立即处理（BC 不投给自己）
}

bc.onmessage = (ev) => dispatch(ev.data);

// ---------- 房间管理 ----------
function genRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function createRoom(connId, cap, mode) {
  let room = genRoomCode();
  let tries = 0;
  while (rooms.has(room) && tries < 50) {
    room = genRoomCode();
    tries++;
  }
  const created = Date.now();
  rooms.set(room, { host: connId, guests: [], created, cap, mode });
  const c = conns.get(connId);
  if (c) {
    c.room = room;
    c.role = 'host';
    c.slot = 1;
  }
  broadcast({ type: 'room', action: 'created', room, host: connId, created, cap, mode });
  return room;
}

function joinRoom(connId, room) {
  const r = rooms.get(room);
  if (!r) return { ok: false, msg: '房间不存在，请检查房间号' };
  if (r.cap > 0 && r.guests.length >= r.cap - 1) {
    return { ok: false, msg: `房间已满（${r.guests.length + 1}/${r.cap} 人）` };
  }
  // 分配最小可用玩家位（P2 起）
  const used = new Set(r.guests.map(g => g.slot));
  let slot = 2;
  while (used.has(slot)) slot++;
  r.guests.push({ slot, id: connId });
  const c = conns.get(connId);
  if (c) {
    c.room = room;
    c.role = 'guest';
    c.slot = slot;
  }
  broadcast({
    type: 'room',
    action: 'joined',
    room,
    host: r.host,
    guest: connId,
    slot,
    created: r.created,
    cap: r.cap,
    mode: r.mode,
  });
  return { ok: true, slot };
}

function leaveRoom(connId) {
  const c = conns.get(connId);
  if (!c || !c.room) return;
  const room = c.room;
  const r = rooms.get(room);
  const wasHost = c.role === 'host';
  const slot = c.slot;

  if (r) {
    if (wasHost) {
      rooms.delete(room);
      broadcast({ type: 'room', action: 'destroyed', room });
    } else {
      r.guests = r.guests.filter(g => g.id !== connId);
      broadcast({
        type: 'room',
        action: 'left',
        room,
        host: r.host,
        guest: connId,
        slot,
        created: r.created,
        cap: r.cap,
        mode: r.mode,
      });
    }
  }
  c.room = null;
  c.role = null;
  c.slot = null;
}

// ---------- 消息处理 ----------
function handleWsMessage(ws, connId, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (_) {
    send(ws, { t: 'error', msg: '消息格式错误' });
    return;
  }

  const c = conns.get(connId);
  switch (msg.t) {
    case 'create': {
      if (c && c.room) {
        send(ws, { t: 'error', msg: '你已经在房间里了' });
        return;
      }
      // 最多人数：不填/非法 = 0（不限）；模式：public 公开 / private 私有
      let cap = Math.floor(Number(msg.max));
      if (!isFinite(cap) || cap < 0) cap = 0;
      if (cap > 99) cap = 99;
      const mode = msg.mode === 'private' ? 'private' : 'public';
      const room = createRoom(connId, cap, mode);
      send(ws, { t: 'created', room, cap, mode });
      break;
    }
    case 'join': {
      if (c && c.room) {
        send(ws, { t: 'error', msg: '你已经在房间里了' });
        return;
      }
      const room = String(msg.room || '').trim();
      const res = joinRoom(connId, room);
      if (!res.ok) {
        send(ws, { t: 'error', msg: res.msg });
        return;
      }
      send(ws, { t: 'joined', room, slot: res.slot });
      break;
    }
    case 'list': {
      // 房间大厅：返回所有公开且未满员的房间
      const list = [];
      for (const [room, r] of rooms) {
        if (r.mode !== 'public') continue;
        if (r.cap > 0 && r.guests.length >= r.cap - 1) continue; // 满员不再展示
        list.push({ room, n: r.guests.length + 1, cap: r.cap });
      }
      list.sort((a, b) => (a.room < b.room ? -1 : 1));
      send(ws, { t: 'rooms', d: list });
      break;
    }
    case 'input': {
      if (c && c.role === 'guest' && c.room) {
        broadcast({
          type: 'relay',
          room: c.room,
          from: connId,
          payload: { t: 'input', d: msg.d || {}, slot: c.slot },
        });
      }
      break;
    }
    case 'state': {
      if (c && c.role === 'host' && c.room) {
        broadcast({
          type: 'relay',
          room: c.room,
          from: connId,
          payload: { t: 'state', d: msg.d || null },
        });
      }
      break;
    }
    case 'ping': {
      // 服务器直接回 pong 给发送者：测的是 客户端↔服务器 的真实网络 RTT。
      // 旧方案绕经对方浏览器（ping→guest→pong→host），对方标签页一旦被
      // 后台节流（Chrome 最低降到每分钟 1 次回调），RTT 就飙到几万毫秒。
      send(ws, { t: 'pong', d: msg.d });
      break;
    }
    // 'pong' 不再需要转发（客户端不回 pong 了），收到直接忽略
    default:
      break;
  }
}

function setupSocket(ws) {
  const connId = 'c' + (++connSeq) + '-' + Math.random().toString(36).slice(2, 8);
  conns.set(connId, { ws, room: null, role: null, slot: null });

  ws.onmessage = (ev) => handleWsMessage(ws, connId, ev.data);
  ws.onclose = () => {
    leaveRoom(connId);
    conns.delete(connId);
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch (_) {}
  };
}

// ---------- 用户系统（Deno KV 持久化） ----------
const kv = await Deno.openKv();

// 商城目录：皮肤 + 枪（价格单位：金币；price=0 为初始赠送）
const SHOP_ITEMS: Record<string, { type: 'skin' | 'gun'; name: string; price: number }> = {
  skin_default: { type: 'skin', name: '蓝色战士', price: 0 },
  skin_green:   { type: 'skin', name: '翠绿战士', price: 200 },
  skin_pink:    { type: 'skin', name: '樱花甜心', price: 200 },
  skin_gold:    { type: 'skin', name: '黄金武士', price: 500 },
  skin_purple:  { type: 'skin', name: '紫电幻影', price: 500 },
  skin_dark:    { type: 'skin', name: '暗夜行者', price: 1000 },
  gun_pistol:   { type: 'gun', name: '标准手枪', price: 0 },
  gun_rapid:    { type: 'gun', name: '冲锋枪', price: 300 },
  gun_shotgun:  { type: 'gun', name: '散弹枪', price: 600 },
  gun_sniper:   { type: 'gun', name: '狙击枪', price: 800 },
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) || {};
  } catch (_) {
    return {};
  }
}

// 从 Authorization: Bearer <token> 解析用户
async function authUser(req: Request) {
  const h = req.headers.get('authorization') || '';
  const token = h.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const phone = await kv.get(['session', token]);
  if (!phone.value) return null;
  const u = await kv.get(['user', phone.value as string]);
  return u.value ? { phone: phone.value as string, user: u.value as Record<string, any> } : null;
}

// 下发给前端的用户数据（不含手机号）
function pubUser(u: Record<string, any>) {
  return {
    name: u.name,
    coins: u.coins,
    exp: u.exp,
    level: u.level,
    ownedSkins: u.ownedSkins,
    ownedGuns: u.ownedGuns,
    skin: u.skin,
    gun: u.gun,
  };
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;

  // POST /api/auth/send-code { phone } —— 生成 10 位验证码
  if (path === '/api/auth/send-code' && req.method === 'POST') {
    const { phone } = await readBody(req);
    const p = String(phone || '').trim();
    if (!/^1\d{10}$/.test(p)) return jsonResp({ ok: false, msg: '请输入正确的 11 位手机号' }, 400);
    const code = String(Math.floor(1e9 + Math.random() * 9e9)); // 10 位数字
    await kv.set(['code', p], code, { expireIn: 5 * 60 * 1000 }); // 5 分钟有效
    // 没有短信通道：验证码直接返回页面显示（玩具级鉴权，够用）
    return jsonResp({ ok: true, code });
  }

  // POST /api/auth/verify { phone, code } —— 校验并登录/注册
  if (path === '/api/auth/verify' && req.method === 'POST') {
    const { phone, code } = await readBody(req);
    const p = String(phone || '').trim();
    const c = String(code || '').trim();
    const saved = await kv.get(['code', p]);
    if (!saved.value || saved.value !== c) {
      return jsonResp({ ok: false, msg: '验证码错误或已过期' }, 400);
    }
    await kv.delete(['code', p]);
    let u = await kv.get(['user', p]);
    if (!u.value) {
      u.value = {
        name: '玩家' + String(Math.floor(1000 + Math.random() * 9000)),
        coins: 0,
        exp: 0,
        level: 1,
        ownedSkins: ['skin_default'],
        ownedGuns: ['gun_pistol'],
        skin: 'skin_default',
        gun: 'gun_pistol',
        created: Date.now(),
      };
      await kv.set(['user', p], u.value);
    }
    const token = crypto.randomUUID();
    await kv.set(['session', token], p, { expireIn: 365 * 24 * 3600 * 1000 });
    return jsonResp({ ok: true, token, user: pubUser(u.value as Record<string, any>) });
  }

  // 以下接口均需登录
  const auth = await authUser(req);
  if (!auth) return jsonResp({ ok: false, msg: '请先登录' }, 401);
  const u = auth.user;

  // GET /api/user/me
  if (path === '/api/user/me' && req.method === 'GET') {
    return jsonResp({ ok: true, user: pubUser(u) });
  }

  // POST /api/user/name { name } —— 修改用户名
  if (path === '/api/user/name' && req.method === 'POST') {
    const { name } = await readBody(req);
    const n = String(name || '').trim().slice(0, 12);
    if (!n) return jsonResp({ ok: false, msg: '名字不能为空' }, 400);
    u.name = n;
    await kv.set(['user', auth.phone], u);
    return jsonResp({ ok: true, user: pubUser(u) });
  }

  // POST /api/user/buy { item } —— 购买皮肤/枪
  if (path === '/api/user/buy' && req.method === 'POST') {
    const { item } = await readBody(req);
    const def = SHOP_ITEMS[String(item || '')];
    if (!def) return jsonResp({ ok: false, msg: '商品不存在' }, 400);
    const owned: string[] = def.type === 'skin' ? u.ownedSkins : u.ownedGuns;
    if (owned.includes(item as string)) return jsonResp({ ok: false, msg: '已拥有该物品' }, 400);
    if ((u.coins as number) < def.price) return jsonResp({ ok: false, msg: '金币不足' }, 400);
    u.coins = (u.coins as number) - def.price;
    owned.push(item as string);
    await kv.set(['user', auth.phone], u);
    return jsonResp({ ok: true, user: pubUser(u) });
  }

  // POST /api/user/equip { item } —— 装备
  if (path === '/api/user/equip' && req.method === 'POST') {
    const { item } = await readBody(req);
    const def = SHOP_ITEMS[String(item || '')];
    if (!def) return jsonResp({ ok: false, msg: '物品不存在' }, 400);
    const owned: string[] = def.type === 'skin' ? u.ownedSkins : u.ownedGuns;
    if (!owned.includes(item as string)) return jsonResp({ ok: false, msg: '尚未拥有' }, 400);
    if (def.type === 'skin') u.skin = item;
    else u.gun = item;
    await kv.set(['user', auth.phone], u);
    return jsonResp({ ok: true, user: pubUser(u) });
  }

  // POST /api/user/result { score, kills, wave } —— 局后结算金币/经验
  if (path === '/api/user/result' && req.method === 'POST') {
    const { score, wave } = await readBody(req);
    const s = Math.max(0, Math.min(1000000, Math.floor(Number(score) || 0)));
    const w = Math.max(0, Math.min(999, Math.floor(Number(wave) || 0)));
    const gainedCoins = Math.floor(s / 10) + w * 5;
    const gainedExp = Math.floor(s / 2);
    u.coins = (u.coins as number) + gainedCoins;
    u.exp = (u.exp as number) + gainedExp;
    u.level = 1 + Math.floor((u.exp as number) / 100);
    await kv.set(['user', auth.phone], u);
    return jsonResp({ ok: true, user: pubUser(u), gainedCoins, gainedExp });
  }

  return jsonResp({ ok: false, msg: 'Not Found' }, 404);
}

// ---------- 静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveStatic(url) {
  let p = url.pathname;
  if (p === '/' || p === '') p = '/index.html';
  const rel = p.replace(/^\/+/, '');
  const fileUrl = new URL('./' + rel, import.meta.url);
  try {
    const data = await Deno.readFile(fileUrl);
    const ext = (p.match(/\.\w+$/) || [''])[0].toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    return new Response(data, {
      headers: {
        'content-type': type,
        'cache-control': 'no-cache',
      },
    });
  } catch (_) {
    return new Response('Not Found', { status: 404 });
  }
}

// ---------- 入口 ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const upgrade = (req.headers.get('upgrade') || '').toLowerCase();

  if (upgrade === 'websocket') {
    try {
      const { socket, response } = Deno.upgradeWebSocket(req);
      setupSocket(socket);
      return response;
    } catch (_) {
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
  }

  // 用户系统 API（登录/商城/结算）
  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, url);
  }

  return serveStatic(url);
});
