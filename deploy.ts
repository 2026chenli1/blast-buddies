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
        rooms.set(m.room, { host: m.host, guests: [], created: m.created, cap: m.cap || 0, mode: m.mode || 'public', gm: m.gm || 'coop' });
      }
      break;
    }
    case 'joined': {
      let r = rooms.get(m.room);
      if (!r) {
        rooms.set(m.room, { host: m.host, guests: [], created: m.created, cap: m.cap || 0, mode: m.mode || 'public', gm: m.gm || 'coop' });
        r = rooms.get(m.room);
      }
      if (!r.guests.some(g => g.id === m.guest)) {
        r.guests.push({ slot: m.slot, id: m.guest, name: m.name || '', skin: m.skin || '' });
      }
      // 通知 host：某 slot 的玩家加入（带昵称/皮肤，开局即显示）
      const h = m.host ? conns.get(m.host) : null;
      if (h && h.role === 'host' && h.room === m.room) {
        send(h.ws, { t: 'peer', state: 'connected', slot: m.slot, name: m.name || '', skin: m.skin || '' });
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

// ---------- 房间管理（KV 持久化注册表 + 内存镜像） ----------
// Deno Deploy 的 isolate 会被回收/重建：仅靠进程内 rooms Map 时，新 isolate 里
// 看不到已存在的公开房间、也加不进跨 isolate 的房间（表现为「公开房间列表为空」
// 「不限人数也最多进 2 人」）。方案：KV ['room', code] 存房间注册表（跨 isolate
// 持久可见），内存 rooms 仅作同 isolate 快速转发与 host 查找的镜像。
const KV_ROOM_TTL = 30 * 60 * 1000; // 房间 30 分钟无活动视为废弃
const roomLastTouch = new Map();    // room -> 上次活跃时间（限频 KV 写）

async function roomReg(room: string) {
  const r = await kv.get(['room', room]);
  return (r.value as any) || null;
}
async function setRoomReg(reg: any) {
  await kv.set(['room', reg.room], reg);
}
async function delRoomReg(room: string) {
  await kv.delete(['room', room]);
}

// 活跃房间防过期：有输入/快照流转时调用（每分钟最多写一次 KV）
async function touchRoom(room: string) {
  const now = Date.now();
  if (now - (roomLastTouch.get(room) || 0) < 60 * 1000) return;
  roomLastTouch.set(room, now);
  const reg = await roomReg(room);
  if (reg) {
    reg.ts = now;
    await setRoomReg(reg);
  }
}

function genRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function createRoom(connId: string, cap: number, mode: string, gm: string) {
  let room = genRoomCode();
  let tries = 0;
  while ((rooms.has(room) || await roomReg(room)) && tries < 50) {
    room = genRoomCode();
    tries++;
  }
  const now = Date.now();
  await setRoomReg({ room, host: connId, cap, mode, gm: gm || 'coop', created: now, ts: now, guests: [] });
  rooms.set(room, { host: connId, guests: [], created: now, cap, mode, gm: gm || 'coop' });
  const c = conns.get(connId);
  if (c) {
    c.room = room;
    c.role = 'host';
    c.slot = 1;
  }
  broadcast({ type: 'room', action: 'created', room, host: connId, created: now, cap, mode, gm: gm || 'coop' });
  return room;
}

async function joinRoom(connId: string, room: string, name: string, skin: string) {
  const reg = await roomReg(room);
  if (!reg) return { ok: false, msg: '房间不存在，请检查房间号' };
  if (Date.now() - reg.ts > KV_ROOM_TTL) {
    await delRoomReg(room);
    rooms.delete(room);
    return { ok: false, msg: '房间已过期，请房主重新创建' };
  }
  if (reg.cap > 0 && reg.guests.length >= reg.cap - 1) {
    return { ok: false, msg: `房间已满（${reg.guests.length + 1}/${reg.cap} 人）` };
  }
  // 分配最小可用玩家位（P2 起）
  const used = new Set(reg.guests.map((g: any) => g.slot));
  let slot = 2;
  while (used.has(slot)) slot++;
  reg.guests.push({ slot, id: connId, name: name || '', skin: skin || '' });
  reg.ts = Date.now();
  await setRoomReg(reg);
  // 本 isolate 同步内存镜像（保证消息转发与 host 查询一致）
  let lr = rooms.get(room);
  if (!lr) {
    lr = { host: reg.host, guests: [], created: reg.created, cap: reg.cap, mode: reg.mode };
    rooms.set(room, lr);
  }
  if (!lr.guests.some((g: any) => g.id === connId)) {
    lr.guests.push({ slot, id: connId, name: name || '', skin: skin || '' });
  }
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
    host: reg.host,
    guest: connId,
    slot,
    name: name || '',
    skin: skin || '',
    created: reg.created,
    cap: reg.cap,
    mode: reg.mode,
    gm: reg.gm || 'coop',
  });
  return { ok: true, slot, gm: reg.gm || 'coop' };
}

async function leaveRoom(connId: string) {
  const c = conns.get(connId);
  if (!c || !c.room) return;
  const room = c.room;
  const wasHost = c.role === 'host';
  const slot = c.slot;
  const lr = rooms.get(room);
  const reg = await roomReg(room);

  if (wasHost) {
    rooms.delete(room);
    await delRoomReg(room);
    broadcast({ type: 'room', action: 'destroyed', room });
  } else {
    if (lr) lr.guests = lr.guests.filter((g: any) => g.id !== connId);
    if (reg) {
      reg.guests = reg.guests.filter((g: any) => g.id !== connId);
      reg.ts = Date.now();
      await setRoomReg(reg);
    }
    const host = lr ? lr.host : (reg ? reg.host : '');
    const created = lr ? lr.created : (reg ? reg.created : Date.now());
    const cap = lr ? lr.cap : (reg ? reg.cap : 0);
    const mode = lr ? lr.mode : (reg ? reg.mode : 'public');
    broadcast({ type: 'room', action: 'left', room, host, guest: connId, slot, created, cap, mode });
  }
  c.room = null;
  c.role = null;
  c.slot = null;
}

// ---------- 消息处理 ----------
async function handleWsMessage(ws: WebSocket, connId: string, raw: string) {
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
      const gm = ['coop', 'stronghold', 'tdm'].includes(msg.gm) ? msg.gm : 'coop';
      const room = await createRoom(connId, cap, mode, gm);
      send(ws, { t: 'created', room, cap, mode, gm });
      break;
    }
    case 'join': {
      if (c && c.room) {
        send(ws, { t: 'error', msg: '你已经在房间里了' });
        return;
      }
      const room = String(msg.room || '').trim();
      const res = await joinRoom(
        connId,
        room,
        String(msg.name || '').slice(0, 12),
        String(msg.skin || ''),
      );
      if (!res.ok) {
        send(ws, { t: 'error', msg: res.msg });
        return;
      }
      send(ws, { t: 'joined', room, slot: res.slot, gm: res.gm || 'coop' });
      break;
    }
    case 'list': {
      // 房间大厅：遍历 KV 注册表（跨 isolate 持久），返回公开且未满员的房间
      const list = [];
      const now = Date.now();
      const iter = kv.list({ prefix: ['room'] });
      for await (const e of iter) {
        const reg = e.value as any;
        if (!reg || reg.mode !== 'public') continue;
        if (reg.cap > 0 && reg.guests.length >= reg.cap - 1) continue; // 满员不再展示
        if (now - reg.ts > KV_ROOM_TTL) {
          await kv.delete(e.key);
          rooms.delete(reg.room);
          continue;
        }
        list.push({ room: reg.room, n: reg.guests.length + 1, cap: reg.cap });
      }
      list.sort((a, b) => (a.room < b.room ? -1 : 1));
      send(ws, { t: 'rooms', d: list });
      break;
    }
    case 'input': {
      if (c && c.role === 'guest' && c.room) {
        void touchRoom(c.room);
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
        void touchRoom(c.room);
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

function setupSocket(ws: WebSocket) {
  const connId = 'c' + (++connSeq) + '-' + Math.random().toString(36).slice(2, 8);
  conns.set(connId, { ws, room: null, role: null, slot: null });

  ws.onmessage = (ev: MessageEvent) => {
    handleWsMessage(ws, connId, String(ev.data)).catch((e) => console.error('ws msg err', e));
  };
  ws.onclose = () => {
    void leaveRoom(connId);
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

// 商城目录：皮肤 + 枪（价格单位：金币；price=0 为初始赠送；lv 为枪械解锁等级）
const SHOP_ITEMS: Record<string, { type: 'skin' | 'gun'; name: string; price: number; lv?: number }> = {
  skin_default: { type: 'skin', name: '蓝色战士', price: 0 },
  skin_green:   { type: 'skin', name: '翠绿战士', price: 200 },
  skin_pink:    { type: 'skin', name: '樱花甜心', price: 200 },
  skin_gold:    { type: 'skin', name: '黄金武士', price: 500 },
  skin_purple:  { type: 'skin', name: '紫电幻影', price: 500 },
  skin_dark:    { type: 'skin', name: '暗夜行者', price: 1000 },
  skin_fire:    { type: 'skin', name: '烈焰战神', price: 1500 },
  skin_ice:     { type: 'skin', name: '寒冰射手', price: 1500 },
  skin_mecha:   { type: 'skin', name: '机甲武装', price: 3000 },
  skin_rainbow: { type: 'skin', name: '彩虹独角兽', price: 5000 },
  gun_pistol:   { type: 'gun', name: '标准手枪', price: 0,   lv: 1 },
  gun_rapid:    { type: 'gun', name: '冲锋枪',   price: 300, lv: 2 },
  gun_shotgun:  { type: 'gun', name: '散弹枪',   price: 600, lv: 4 },
  gun_sniper:   { type: 'gun', name: '狙击枪',   price: 800, lv: 6 },
  gun_laser:    { type: 'gun', name: '激光枪',   price: 1200, lv: 8 },
  gun_cannon:   { type: 'gun', name: '榴弹炮',   price: 1800, lv: 10 },
  gun_dual:     { type: 'gun', name: '双管机枪', price: 2500, lv: 12 },
  gun_plasma:   { type: 'gun', name: '等离子炮', price: 4000, lv: 15 },
};

// 可升级物品（武器/皮肤技能/手榴弹），每项最高 5 级；升级花费经验（不影响等级/排行）
const UPGRADE_MAX_LV = 5;
function upgCost(lv: number) { return 100 + lv * 100; } // 0→1 级花 100，递增
const UPGRADE_ITEMS: Record<string, { type: 'gun' | 'skin' | 'grenade'; name: string }> = {
  gun_pistol:  { type: 'gun', name: '标准手枪' },
  gun_rapid:   { type: 'gun', name: '冲锋枪' },
  gun_shotgun: { type: 'gun', name: '散弹枪' },
  gun_sniper:  { type: 'gun', name: '狙击枪' },
  gun_laser:   { type: 'gun', name: '激光枪' },
  gun_cannon:  { type: 'gun', name: '榴弹炮' },
  gun_dual:    { type: 'gun', name: '双管机枪' },
  gun_plasma:  { type: 'gun', name: '等离子炮' },
  skin_default: { type: 'skin', name: '战术冲刺' },
  skin_green:   { type: 'skin', name: '生命绽放' },
  skin_pink:    { type: 'skin', name: '樱花弹幕' },
  skin_gold:    { type: 'skin', name: '点石成金' },
  skin_purple:  { type: 'skin', name: '闪电链' },
  skin_dark:    { type: 'skin', name: '暗影突袭' },
  skin_fire:    { type: 'skin', name: '烈焰新星' },
  skin_ice:     { type: 'skin', name: '冰霜新星' },
  skin_mecha:   { type: 'skin', name: '能量护盾' },
  skin_rainbow: { type: 'skin', name: '彩虹狂暴' },
  grenade_frag:       { type: 'grenade', name: '破片雷' },
  grenade_freeze:     { type: 'grenade', name: '冰冻雷' },
  grenade_incendiary: { type: 'grenade', name: '燃烧雷' },
  grenade_cluster:    { type: 'grenade', name: '集束雷' },
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

// 下发给前端的用户数据（不含手机号）；等级由经验实时计算（升级曲线放缓：180 经验/级）
function pubUser(u: Record<string, any>) {
  return {
    name: u.name,
    coins: u.coins,
    exp: u.exp,
    level: 1 + Math.floor((u.exp || 0) / 180),
    ownedSkins: u.ownedSkins,
    ownedGuns: u.ownedGuns,
    skin: u.skin,
    gun: u.gun,
    upgrades: u.upgrades || {},
    expSpent: u.expSpent || 0,
    spendableExp: Math.max(0, (u.exp || 0) - (u.expSpent || 0)),
  };
}

// ======================= 腾讯云短信（可选，未配置环境变量时回退测试模式） =======================
// 需要在 Deno Deploy 项目设置里配置 5 个环境变量：
//   TENCENT_SECRET_ID / TENCENT_SECRET_KEY / SMS_SDK_APPID / SMS_SIGN_NAME / SMS_TEMPLATE_ID
const SMS_CFG = {
  secretId: Deno.env.get('TENCENT_SECRET_ID') || '',
  secretKey: Deno.env.get('TENCENT_SECRET_KEY') || '',
  sdkAppId: Deno.env.get('SMS_SDK_APPID') || '',
  signName: Deno.env.get('SMS_SIGN_NAME') || '',
  templateId: Deno.env.get('SMS_TEMPLATE_ID') || '',
};
const smsEnabled = !!(SMS_CFG.secretId && SMS_CFG.secretKey && SMS_CFG.sdkAppId && SMS_CFG.signName && SMS_CFG.templateId);

const _enc = new TextEncoder();
const _hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b: number) => b.toString(16).padStart(2, '0')).join('');
async function _sha256Hex(data: string): Promise<string> {
  return _hex(await crypto.subtle.digest('SHA-256', _enc.encode(data)));
}
async function _hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = key instanceof Uint8Array ? key : new Uint8Array(key);
  const ck = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', ck, _enc.encode(msg));
}

// 调用腾讯云 SendSms 发送验证码（TC3-HMAC-SHA256 签名）
// 模板正文需为单参数：如「您的登录验证码为{1}，5分钟内有效，请勿泄露。」
async function sendSmsCode(phone: string, code: string): Promise<{ ok: boolean; msg?: string }> {
  const host = 'sms.tencentcloudapi.com';
  const service = 'sms';
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({
    PhoneNumberSet: ['+86' + phone],
    SmsSdkAppId: SMS_CFG.sdkAppId,
    SignName: SMS_CFG.signName,
    TemplateId: SMS_CFG.templateId,
    TemplateParamSet: [code],
  });
  const canonicalRequest =
    'POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:' + host +
    '\n\ncontent-type;host\n' + (await _sha256Hex(payload));
  const credentialScope = date + '/' + service + '/tc3_request';
  const stringToSign =
    'TC3-HMAC-SHA256\n' + ts + '\n' + credentialScope + '\n' + (await _sha256Hex(canonicalRequest));
  const kDate = await _hmac(_enc.encode('TC3' + SMS_CFG.secretKey), date);
  const kService = await _hmac(kDate, service);
  const kCred = await _hmac(kService, 'tc3_request');
  const signature = _hex(await _hmac(kCred, stringToSign));
  const authorization =
    'TC3-HMAC-SHA256 Credential=' + SMS_CFG.secretId + '/' + credentialScope +
    ', SignedHeaders=content-type;host, Signature=' + signature;
  let data: any = null;
  try {
    const resp = await fetch('https://' + host + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-TC-Action': 'SendSms',
        'X-TC-Timestamp': String(ts),
        'X-TC-Version': '2021-01-11',
        'X-TC-Region': 'ap-guangzhou',
        'Authorization': authorization,
      },
      body: payload,
    });
    data = await resp.json();
  } catch (_e) {
    return { ok: false, msg: '网络错误' };
  }
  if (data?.Response?.Error) {
    return { ok: false, msg: data.Response.Error.Message || data.Response.Error.Code };
  }
  const st = data?.Response?.SendStatusSet?.[0];
  if (st && st.Code === 'Ok') return { ok: true };
  return { ok: false, msg: st?.Message || '未知错误' };
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname;

  // POST /api/auth/send-code { phone } —— 生成 10 位验证码并（可选）发送短信
  if (path === '/api/auth/send-code' && req.method === 'POST') {
    const { phone } = await readBody(req);
    const p = String(phone || '').trim();
    if (!/^1\d{10}$/.test(p)) return jsonResp({ ok: false, msg: '请输入正确的 11 位手机号' }, 400);
    // 频率限制：同一手机号 60 秒内只能发一次（真短信按条计费）
    const cd = await kv.get(['codeCd', p]);
    if (cd.value) return jsonResp({ ok: false, msg: '发送太频繁，请 1 分钟后再试' }, 429);
    const code = String(Math.floor(1e9 + Math.random() * 9e9)); // 10 位数字
    await kv.set(['code', p], code, { expireIn: 5 * 60 * 1000 }); // 5 分钟有效
    if (smsEnabled) {
      const r = await sendSmsCode(p, code);
      if (!r.ok) return jsonResp({ ok: false, msg: '短信发送失败：' + (r.msg || '请稍后重试') }, 502);
      await kv.set(['codeCd', p], 1, { expireIn: 60 * 1000 });
      return jsonResp({ ok: true, sms: true });
    }
    // 未配置短信渠道：测试模式，验证码直接返回页面显示
    await kv.set(['codeCd', p], 1, { expireIn: 60 * 1000 });
    return jsonResp({ ok: true, sms: false, code });
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

  // ---------- 微信扫码登录（网站应用 snsapi_login，需在微信开放平台创建网站应用）----------
  const WX_CFG = {
    appid: Deno.env.get('WX_APPID') || '',
    secret: Deno.env.get('WX_SECRET') || '',
  };

  // GET /api/auth/wechat/url —— 返回微信扫码授权页地址（redirect_uri 自动用当前域名）
  if (path === '/api/auth/wechat/url' && req.method === 'GET') {
    if (!WX_CFG.appid || !WX_CFG.secret) {
      return jsonResp({ ok: false, msg: '微信登录未配置（请在 Deno Deploy 环境变量设置 WX_APPID / WX_SECRET）' }, 503);
    }
    const redirect = 'https://' + url.host + '/api/auth/wechat';
    const q = 'appid=' + WX_CFG.appid +
      '&redirect_uri=' + encodeURIComponent(redirect) +
      '&response_type=code&scope=snsapi_login' +
      '&state=' + crypto.randomUUID().replace(/-/g, '').slice(0, 10) +
      '#wechat_redirect';
    return jsonResp({ ok: true, url: 'https://open.weixin.qq.com/connect/qrconnect?' + q });
  }

  // GET /api/auth/wechat?code=xx&state=xx —— 微信扫码后的回调：换 token、找/建用户、签发会话、跳回首页
  if (path === '/api/auth/wechat' && req.method === 'GET') {
    const back = (msg: string) => new Response(null, {
      status: 302,
      headers: { location: '/?wxerr=' + encodeURIComponent(msg) },
    });
    const code = url.searchParams.get('code') || '';
    if (!code) return back('未获取到授权码（' + (url.searchParams.get('errmsg') || '用户取消或参数错误') + '）');
    if (!WX_CFG.appid || !WX_CFG.secret) return back('微信登录未配置');
    // 第一步：code 换 access_token + openid
    let tk: any = null;
    try {
      tk = await (await fetch(
        'https://api.weixin.qq.com/sns/oauth2/access_token?appid=' + WX_CFG.appid +
        '&secret=' + WX_CFG.secret + '&code=' + encodeURIComponent(code) + '&grant_type=authorization_code'
      )).json();
    } catch (e) { /* 网络错误 */ }
    if (!tk || tk.errcode || !tk.openid) {
      return back('微信授权失败：' + ((tk && tk.errmsg) || 'code 无效或已过期'));
    }
    const openid = String(tk.openid);
    // 第二步：拉取昵称（可选，失败不阻塞登录）
    let nickname = '';
    try {
      const ui = await (await fetch(
        'https://api.weixin.qq.com/sns/userinfo?access_token=' + tk.access_token + '&openid=' + openid
      )).json();
      if (ui && !ui.errcode && ui.nickname) nickname = String(ui.nickname).slice(0, 12);
    } catch (e) { /* 拿不到昵称就用默认名 */ }
    // 第三步：找/建用户（账号键：wx_<openid>，与手机号账号共存）
    const key = 'wx_' + openid;
    let u = await kv.get(['user', key]);
    if (!u.value) {
      u.value = {
        name: nickname || ('玩家' + String(Math.floor(1000 + Math.random() * 9000))),
        coins: 0,
        exp: 0,
        level: 1,
        ownedSkins: ['skin_default'],
        ownedGuns: ['gun_pistol'],
        skin: 'skin_default',
        gun: 'gun_pistol',
        created: Date.now(),
      };
      await kv.set(['user', key], u.value);
    } else if (nickname && /^玩家\d{4}$/.test(String((u.value as any).name || ''))) {
      // 用户名还是系统随机名时，同步微信昵称；用户改过名则不动
      (u.value as any).name = nickname;
      await kv.set(['user', key], u.value);
    }
    // 第四步：签发会话并跳回首页（token 附在 URL，前端存 localStorage 后立即清除）
    const token = crypto.randomUUID();
    await kv.set(['session', token], key, { expireIn: 365 * 24 * 3600 * 1000 });
    return new Response(null, { status: 302, headers: { location: '/?wxtoken=' + token } });
  }

  // GET /api/rank —— 线上排行（公开，按经验值降序，Top 50）
  if (path === '/api/rank' && req.method === 'GET') {
    const list = [];
    for await (const e of kv.list({ prefix: ['user'] })) {
      const u = e.value as Record<string, any>;
      if (!u) continue;
      list.push({
        name: u.name || '玩家',
        level: 1 + Math.floor((u.exp || 0) / 180),
        exp: u.exp || 0,
        coins: u.coins || 0,
      });
    }
    list.sort((a, b) => (b.exp || 0) - (a.exp || 0) || (b.coins || 0) - (a.coins || 0));
    return jsonResp({ ok: true, list: list.slice(0, 50) });
  }

  // 以下接口均需登录
  const auth = await authUser(req);
  if (!auth) return jsonResp({ ok: false, msg: '请先登录' }, 401);
  const u = auth.user;

  // POST /api/auth/logout —— 退出登录（仅删除服务端会话，保留账号数据）
  if (path === '/api/auth/logout' && req.method === 'POST') {
    const h = req.headers.get('authorization') || '';
    const token = h.replace(/^Bearer\s+/i, '').trim();
    if (token) await kv.delete(['session', token]);
    return jsonResp({ ok: true });
  }

  // POST /api/user/delete —— 注销账号（删除用户数据 + 会话，不可恢复）
  if (path === '/api/user/delete' && req.method === 'POST') {
    await kv.delete(['user', auth.phone]);
    const h = req.headers.get('authorization') || '';
    const token = h.replace(/^Bearer\s+/i, '').trim();
    if (token) await kv.delete(['session', token]);
    return jsonResp({ ok: true });
  }

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

  // POST /api/user/buy { item } —— 购买皮肤/枪（枪械需达到解锁等级）
  if (path === '/api/user/buy' && req.method === 'POST') {
    const { item } = await readBody(req);
    const def = SHOP_ITEMS[String(item || '')];
    if (!def) return jsonResp({ ok: false, msg: '商品不存在' }, 400);
    if ((def.lv || 1) > (u.level as number)) {
      return jsonResp({ ok: false, msg: `需要 Lv.${def.lv} 才能解锁该武器` }, 400);
    }
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

  // POST /api/user/upgrade { item } —— 花经验升级武器/皮肤技能/手榴弹
  // 经验只是「消耗品」：等级与排行仍按累计 exp 计算，不受 expSpent 影响
  if (path === '/api/user/upgrade' && req.method === 'POST') {
    const { item } = await readBody(req);
    const def = UPGRADE_ITEMS[String(item || '')];
    if (!def) return jsonResp({ ok: false, msg: '升级项不存在' }, 400);
    // 只有已拥有的物品才能升级
    if (def.type === 'gun' && !(u.ownedGuns as string[]).includes(item as string))
      return jsonResp({ ok: false, msg: '尚未拥有该武器' }, 400);
    if (def.type === 'skin' && !(u.ownedSkins as string[]).includes(item as string))
      return jsonResp({ ok: false, msg: '尚未拥有该皮肤' }, 400);
    const ups: Record<string, number> = u.upgrades || {};
    const lv = ups[item as string] || 0;
    if (lv >= UPGRADE_MAX_LV) return jsonResp({ ok: false, msg: '已满级' }, 400);
    const cost = upgCost(lv);
    const spendable = Math.max(0, (u.exp as number) - ((u.expSpent as number) || 0));
    if (spendable < cost) return jsonResp({ ok: false, msg: `经验不足（可花 ${spendable}，需 ${cost}）` }, 400);
    u.expSpent = ((u.expSpent as number) || 0) + cost;
    ups[item as string] = lv + 1;
    u.upgrades = ups;
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
    u.level = 1 + Math.floor((u.exp as number) / 180); // 升级放缓：180 经验/级
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
