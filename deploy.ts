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
Deno.serve((req) => {
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

  return serveStatic(url);
});
