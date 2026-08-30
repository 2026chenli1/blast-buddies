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

// 在线人数统计：ip -> 最近活跃时间（大厅轮询 /api/online 时更新，70 秒未活跃剔除）
const lastSeen = new Map<string, number>();

// 大厅玩家：connId -> { x, y, angle, name, skin, lastSeen, ip }
// 所有未进入房间的 WebSocket 连接默认都在大厅，可在大厅里自由移动、看见彼此
const lobbyPlayers = new Map<string, Record<string, any>>();
const LOBBY_BROADCAST_MS = 150; // 大厅位置广播间隔（ms）。过大：位置滞后；过小：流量爆炸（免费额度 20GB/月）

// ---------- 排位赛匹配 ----------
const MATCH_PLAYERS = 16; // 16 人陆续匹配，凑齐即开局
const matchLocal = new Set<string>(); // 本 isolate 正在匹配的连接（跨 isolate 队列存 KV）

async function getMatchQueue(): Promise<any[]> {
  const e = await kv.get(['matchqueue']);
  const q = (e?.value as any[]) || [];
  return Array.isArray(q) ? q.filter((x) => x && x.id && Date.now() - x.ts < 90000) : [];
}

async function saveMatchQueue(q: any[]) {
  await kv.set(['matchqueue'], q);
}

async function removeFromMatchQueue(id: string) {
  try {
    const q = await getMatchQueue();
    const nq = q.filter((x) => x.id !== id);
    if (nq.length !== q.length) {
      await saveMatchQueue(nq);
      broadcast({ type: 'match', action: 'count', n: nq.length });
    }
  } catch (_) {}
}

// 匹配队列互斥锁：并发 'match' 消息同时读改写 KV 会互相覆盖（15 人同时排队只留 1 人）
let matchLock: Promise<unknown> = Promise.resolve();
function withMatchLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = matchLock.then(fn, fn);
  matchLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const bc = new BroadcastChannel('blast-relay');

// ---------- 战斗通行证 ----------
const PASS_KILLS = 10; // 累计击杀 10 个敌人获得战斗通行证
const PASS_GUNS = new Set(['gun_laser', 'gun_dual', 'gun_plasma']); // 通行证专属武器

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (_) {}
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
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

  if (m.type === 'lobby') {
    if (m.action === 'pos') {
      // 同步其他 isolate 的大厅玩家位置
      const lp = lobbyPlayers.get(m.id);
      if (lp) {
        lp.x = m.x; lp.y = m.y; lp.angle = m.angle; lp.lastSeen = Date.now();
      }
    } else if (m.action === 'join') {
      lobbyPlayers.set(m.id, {
        x: m.x, y: m.y, angle: m.angle, name: m.name, skin: m.skin, lastSeen: Date.now(), ip: m.ip,
      });
    } else if (m.action === 'leave') {
      lobbyPlayers.delete(m.id);
    } else if (m.action === 'list') {
      // 全量同步：用发送方 isolate 的玩家覆盖本 isolate（用于启动/定时对齐）
      for (const [id, data] of Object.entries(m.players || {})) {
        lobbyPlayers.set(id, { ...data, lastSeen: Date.now() });
      }
    }
    return;
  }

  // 排位匹配事件：count（队列人数变化）/ found（凑齐 16 人，各 isolate 通知本地连接）
  if (m.type === 'match') {
    if (m.action === 'count') {
      for (const id of matchLocal) {
        const c = conns.get(id);
        if (c && !c.room && c.ws && c.ws.readyState === 1) send(c.ws, { t: 'match_status', n: m.n });
      }
    } else if (m.action === 'found') {
      for (const p of m.players || []) {
        const c = conns.get(p.id);
        // 房主的 c.room 已由 createRoom 设置（且值相同），其余玩家此时才设置
        if (c && (!c.room || c.room === m.room)) {
          if (!c.room) {
            c.room = m.room;
            c.role = p.slot === 1 ? 'host' : 'guest';
            c.slot = p.slot;
          }
          matchLocal.delete(p.id);
          lobbyPlayers.delete(p.id);
          send(c.ws, { t: 'matched', room: m.room, slot: p.slot });
        }
      }
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

// 大厅广播：把本 isolate 所有大厅玩家快照发给每个大厅连接（含跨 isolate 同步）
function broadcastLobbyList() {
  const now = Date.now();
  // 省流量：没有大厅玩家或没有任何大厅连接时完全跳过（避免空转广播耗尽免费额度）
  let hasLobbyConn = false;
  for (const [, c] of conns) {
    if (c.ws && !c.room && c.ws.readyState === 1) { hasLobbyConn = true; break; }
  }
  if (!hasLobbyConn || lobbyPlayers.size === 0) return;
  const players: Record<string, any> = {};
  for (const [id, p] of lobbyPlayers) {
    players[id] = { x: p.x, y: p.y, angle: p.angle, name: p.name, skin: p.skin };
  }
  for (const [id, c] of conns) {
    if (c.ws && !c.room && c.ws.readyState === 1) {
      // me：告知该连接自己的 id，前端据此过滤自己（自己位置以本地为准）
      send(c.ws, { t: 'lobby_list', me: id, d: players });
    }
  }
  // 同步给其他 isolate：每 5 秒广播一次全量，保持 isolate 间大厅玩家一致
  if (Math.floor(now / 5000) % 2 === 0) {
    broadcast({ type: 'lobby', action: 'list', players });
  }
}

// 清理超过 10 秒未更新位置的大厅玩家（视为断线/离开）
function cleanLobby() {
  const now = Date.now();
  const stale: string[] = [];
  for (const [id, p] of lobbyPlayers) {
    if (!conns.has(id) || now - p.lastSeen > 10000) stale.push(id);
  }
  for (const id of stale) {
    lobbyPlayers.delete(id);
    broadcast({ type: 'lobby', action: 'leave', id });
  }
}

bc.onmessage = (ev) => dispatch(ev.data);

// 大厅定时广播 + 清理
setInterval(() => {
  cleanLobby();
  broadcastLobbyList();
}, LOBBY_BROADCAST_MS);

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
  // 离开房间后从大厅移除（客户端回主界面时会重新走 lobby_join）
  lobbyPlayers.delete(connId);
  broadcast({ type: 'lobby', action: 'leave', id: connId });
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
    case 'lobby_join': {
      if (!c) return;
      // 条目可能不存在（首次加入 / 被超时清理后重新加入），先补建
      const lp = lobbyPlayers.get(connId) || {
        x: 0.45 + Math.random() * 0.1,
        y: 0.5 + Math.random() * 0.1,
        angle: 0,
        name: '',
        skin: '',
        lastSeen: 0,
        ip: c.ip,
      };
      lp.name = String(msg.name || '').slice(0, 12);
      lp.skin = String(msg.skin || '');
      lp.lastSeen = Date.now();
      lobbyPlayers.set(connId, lp);
      // 立即广播一次大厅全量玩家
      const players: Record<string, any> = {};
      for (const [id, p] of lobbyPlayers) {
        players[id] = { x: p.x, y: p.y, angle: p.angle, name: p.name, skin: p.skin };
      }
      send(ws, { t: 'lobby_list', me: connId, d: players });
      broadcast({ type: 'lobby', action: 'join', id: connId, x: lp?.x, y: lp?.y, angle: lp?.angle, name: lp?.name, skin: lp?.skin, ip: c.ip });
      break;
    }
    case 'lobby_pos': {
      if (!c || c.room) return;
      const lp = lobbyPlayers.get(connId);
      if (!lp) return;
      const nx = Number(msg.x);
      const ny = Number(msg.y);
      const na = Number(msg.angle);
      if (isFinite(nx) && isFinite(ny) && isFinite(na)) {
        lp.x = clamp(nx, 0, 1);
        lp.y = clamp(ny, 0, 1);
        lp.angle = na;
        lp.lastSeen = Date.now();
        broadcast({ type: 'lobby', action: 'pos', id: connId, x: lp.x, y: lp.y, angle: lp.angle });
      }
      break;
    }
    case 'create': {
      if (c && c.room) {
        send(ws, { t: 'error', msg: '你已经在房间里了' });
        return;
      }
      // 进入房间后离开大厅
      lobbyPlayers.delete(connId);
      broadcast({ type: 'lobby', action: 'leave', id: connId });
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
      // 进入房间后离开大厅
      lobbyPlayers.delete(connId);
      broadcast({ type: 'lobby', action: 'leave', id: connId });
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
    case 'match': {
      // 排位赛：加入匹配队列；凑齐 MATCH_PLAYERS 人后自动建房开局
      if (c && c.room) {
        send(ws, { t: 'error', msg: '你已经在房间里了' });
        return;
      }
      if (matchLocal.has(connId)) return;
      await withMatchLock(async () => {
        matchLocal.add(connId);
        lobbyPlayers.delete(connId);
        broadcast({ type: 'lobby', action: 'leave', id: connId });
        const q = await getMatchQueue();
        if (q.some((x) => x.id === connId)) {
          matchLocal.delete(connId);
          return;
        }
        q.push({ id: connId, name: String(msg.name || '').slice(0, 12), skin: String(msg.skin || ''), ts: Date.now() });
        if (q.length >= MATCH_PLAYERS) {
          // 凑齐：前 16 人成团，其余留在队列
          const batch = q.slice(0, MATCH_PLAYERS);
          const rest = q.slice(MATCH_PLAYERS);
          await saveMatchQueue(rest);
          const room = await createRoom(batch[0].id, MATCH_PLAYERS, 'public', 'tdm');
          // KV 注册表补上其余 15 人（guest），并广播 joined 让各 isolate 的 rooms 镜像同步、房主收到 peer
          const reg = await roomReg(room);
          for (let i = 1; i < batch.length; i++) {
            if (reg && !reg.guests.some((g: any) => g.id === batch[i].id)) {
              reg.guests.push({ slot: i + 1, id: batch[i].id, name: batch[i].name, skin: batch[i].skin });
            }
            broadcast({
              type: 'room',
              action: 'joined',
              room,
              host: batch[0].id,
              guest: batch[i].id,
              slot: i + 1,
              name: batch[i].name,
              skin: batch[i].skin,
              created: Date.now(),
              cap: MATCH_PLAYERS,
              mode: 'public',
            });
          }
          if (reg) await setRoomReg(reg);
          // 通知所有成团玩家（本 isolate 直接发 + 跨 isolate 广播）
          broadcast({ type: 'match', action: 'found', room, players: batch.map((b: any, i: number) => ({ id: b.id, slot: i + 1 })) });
        } else {
          await saveMatchQueue(q);
          broadcast({ type: 'match', action: 'count', n: q.length });
        }
      });
      break;
    }
    case 'match_cancel': {
      await withMatchLock(async () => {
        matchLocal.delete(connId);
        const q = await getMatchQueue();
        const nq = q.filter((x) => x.id !== connId);
        await saveMatchQueue(nq);
        send(ws, { t: 'match_cancelled' });
        broadcast({ type: 'match', action: 'count', n: nq.length });
      });
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

function getClientIp(req?: Request, connInfo?: Deno.ServeHandlerInfo): string {
  let ip = (connInfo && connInfo.remoteAddr && (connInfo.remoteAddr as any).hostname) || '';
  if (!ip && req) ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '';
  return String(ip).replace(/^::ffff:/, '');
}

function setupSocket(ws: WebSocket, ip: string) {
  const connId = 'c' + (++connSeq) + '-' + Math.random().toString(36).slice(2, 8);
  conns.set(connId, { ws, room: null, role: null, slot: null, ip });

  ws.onmessage = (ev: MessageEvent) => {
    handleWsMessage(ws, connId, String(ev.data)).catch((e) => console.error('ws msg err', e));
  };
  ws.onclose = () => {
    void leaveRoom(connId);
    lobbyPlayers.delete(connId);
    conns.delete(connId);
    broadcast({ type: 'lobby', action: 'leave', id: connId });
    // 匹配中断开：从排位队列移除
    if (matchLocal.has(connId)) {
      matchLocal.delete(connId);
      void removeFromMatchQueue(connId);
    }
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

// 系统默认名（还没起名的账号）：形如 玩家1234
function isDefaultName(n: string) {
  return /^玩家\d{4}$/.test(n || '');
}

// 用户名全局唯一检查（排除自己）
async function nameTaken(name: string, excludeKey: string): Promise<boolean> {
  for await (const e of kv.list({ prefix: ['user'] })) {
    const u = e.value as Record<string, any>;
    if (u && u.name === name && String(e.key[1]) !== excludeKey) return true;
  }
  return false;
}

// 下发给前端的用户数据（不含手机号）；等级由经验实时计算（升级曲线放缓：180 经验/级）
function pubUser(u: Record<string, any>) {
  return {
    name: u.name,
    role: u.role || 'player',
    coins: u.coins,
    exp: u.exp,
    level: 1 + Math.floor((u.exp || 0) / 180),
    ownedSkins: u.ownedSkins,
    ownedGuns: u.ownedGuns,
    skin: u.skin,
    gun: u.gun,
    kills: (u.kills as number) || 0,
    pass: u.pass ? 1 : 0,
    upgrades: u.upgrades || {},
    expSpent: u.expSpent || 0,
    spendableExp: Math.max(0, (u.exp || 0) - (u.expSpent || 0)),
    mapPlays: (u.mapPlays as number) || 0, // 自己的地图被别人玩过的次数
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

async function handleApi(req: Request, url: URL, connInfo?: Deno.ServeHandlerInfo): Promise<Response> {
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
    // ---------- 管理员模式：手机号和验证码都输管理员口令，直接登录管理员账号 ----------
    const ADMIN_KEY = '1@3$';
    if (p === ADMIN_KEY && c === ADMIN_KEY) {
      const akey = '__admin__';
      let au = await kv.get(['user', akey]);
      if (!au.value) {
        const allSkins = Object.keys(SHOP_ITEMS).filter((k) => SHOP_ITEMS[k].type === 'skin');
        const allGuns = Object.keys(SHOP_ITEMS).filter((k) => SHOP_ITEMS[k].type === 'gun');
        au.value = {
          name: '管理员',
          role: 'admin',
          coins: 999999,
          exp: 0,
          level: 1,
          ownedSkins: allSkins,
          ownedGuns: allGuns,
          skin: 'skin_rainbow',
          gun: 'gun_plasma',
          created: Date.now(),
        };
        await kv.set(['user', akey], au.value);
      }
      const atoken = crypto.randomUUID();
      await kv.set(['session', atoken], akey, { expireIn: 365 * 24 * 3600 * 1000 });
      return jsonResp({ ok: true, token: atoken, user: pubUser(au.value as Record<string, any>) });
    }
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

  // ---------- 自建扫码登录（免资质）：电脑出码 → 手机扫 → 手机确认 → 电脑自动登录 ----------
  // 票据流：PC POST /api/auth/qr 拿 ticket+secret（secret 只留在电脑，防止旁人拍码抢登）
  //        → 手机打开 /qr/<ticket>（已登录则直接确认，未登录先手机号登录）
  //        → PC 轮询 /api/auth/qr/status 拿到会话 token，一次性消费

  // POST /api/auth/qr —— 电脑生成扫码票据（5 分钟有效）
  if (path === '/api/auth/qr' && req.method === 'POST') {
    const ticket = crypto.randomUUID().replace(/-/g, '');
    const secret = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    await kv.set(['qrt', ticket], { s: secret, state: 0, t: Date.now() }, { expireIn: 5 * 60 * 1000 });
    return jsonResp({ ok: true, ticket, secret, url: 'https://' + url.host + '/qr/' + ticket });
  }

  // GET /api/auth/qr/status?ticket=&s= —— 电脑轮询：state 0=等待 1=已确认(返回 token)
  if (path === '/api/auth/qr/status' && req.method === 'GET') {
    const ticket = String(url.searchParams.get('ticket') || '');
    const s = String(url.searchParams.get('s') || '');
    if (!ticket || !s) return jsonResp({ ok: false, msg: '参数错误' }, 400);
    const q = await kv.get(['qrt', ticket]);
    if (!q.value) return jsonResp({ ok: false, state: -1, msg: '二维码已过期，请刷新' });
    const rec = q.value as any;
    if (rec.s !== s) return jsonResp({ ok: false, msg: '校验失败' }, 403); // 防拍码抢登
    if (rec.state === 1) {
      await kv.delete(['qrt', ticket]); // 一次性，防止重复领取
      return jsonResp({ ok: true, state: 1, token: rec.token });
    }
    return jsonResp({ ok: true, state: 0 });
  }

  // POST /api/auth/captcha —— 防AI验证码：数学题（2 分钟有效，一次性）
  if (path === '/api/auth/captcha' && req.method === 'POST') {
    const a = 3 + Math.floor(Math.random() * 8);
    const b = 1 + Math.floor(Math.random() * 9);
    const op = Math.random() < 0.5 ? '+' : '\u00d7';
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const ans = op === '+' ? a + b : a * b;
    await kv.set(['cap', id], String(ans), { expireIn: 2 * 60 * 1000 });
    return jsonResp({ ok: true, id, q: `${a} ${op} ${b} = ?` });
  }

  // GET /api/online —— 真实在线人数（最近 70 秒活跃的独立访客数）
  if (path === '/api/online' && req.method === 'GET') {
    const now = Date.now();
    // 优先取 TCP 连接的真实客户端 IP（Deno 边缘注入），x-forwarded-for 兜底
    let ip = (connInfo && connInfo.remoteAddr && (connInfo.remoteAddr as any).hostname) || '';
    if (!ip) ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '';
    ip = String(ip).replace(/^::ffff:/, '');
    if (ip) lastSeen.set(ip, now);
    let stale: string[] = [];
    for (const [k, v] of lastSeen) if (now - v > 70000) stale.push(k);
    for (const k of stale) lastSeen.delete(k);
    return jsonResp({ ok: true, online: lastSeen.size });
  }

  // GET /api/rank —— 线上排行（公开，按经验值降序，Top 50；管理员不出现在榜单）
  if (path === '/api/rank' && req.method === 'GET') {
    const list = [];
    for await (const e of kv.list({ prefix: ['user'] })) {
      const u = e.value as Record<string, any>;
      if (!u) continue;
      if (u.role === 'admin' || String(e.key[1]) === '__admin__') continue; // 管理员不参与排行
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

  // GET /api/maps/daily —— 今日地图：按日期确定性随机挑选一张玩家分享的地图（每天更换）
  // ?author=xxx —— 优先挑选「别人」的地图（排除该作者自己的），池子里只有自己的地图时才回退
  // 下发前用 pubMap() 剔除 authorId（作者身份属于内部字段，不能暴露给客户端）
  function pubMap(m: any) {
    if (!m) return m;
    const { authorId, ...rest } = m;
    return rest;
  }
  if (path === '/api/maps/daily' && req.method === 'GET') {
    const e = await kv.get(['maps']);
    const list = (e.value as any[]) || [];
    const date = new Date().toISOString().slice(0, 10);
    if (!list.length) return jsonResp({ ok: true, map: null, date });
    const u = new URL(req.url);
    const author = (u.searchParams.get('author') || '').trim();
    let pool = list;
    if (author) {
      const others = list.filter((m: any) => m && m.author !== author);
      if (others.length) pool = others; // 有别人的地图就优先展示别人的
    }
    let h = 0;
    for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0;
    const map = pool[h % pool.length];
    return jsonResp({ ok: true, map: pubMap(map), date });
  }

  // GET /api/maps/list —— 分享地图池列表（游玩别人的地图）
  if (path === '/api/maps/list' && req.method === 'GET') {
    const e = await kv.get(['maps']);
    const list = ((e.value as any[]) || [])
      .filter((m: any) => m && Array.isArray(m.cells))
      .sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 100);
    return jsonResp({ ok: true, list: list.map(pubMap), total: list.length });
  }

  // POST /api/maps/publish —— 分享自定义地图进「每日地图池」
  if (path === '/api/maps/publish' && req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 12) || '未命名地图';
    const author = String(body.author || '').trim().slice(0, 12) || '玩家';
    const cols = Math.max(4, Math.min(40, body.cols | 0));
    const rows = Math.max(4, Math.min(40, body.rows | 0));
    const cells = body.cells;
    if (!Array.isArray(cells) || cells.length !== rows) {
      return jsonResp({ ok: false, msg: '地图数据错误' }, 400);
    }
    for (const row of cells) {
      if (!Array.isArray(row) || row.length !== cols) {
        return jsonResp({ ok: false, msg: '地图数据错误' }, 400);
      }
      for (const v of row) {
        if (![0, 1, 2, 3].includes(v)) return jsonResp({ ok: false, msg: '地图数据错误' }, 400);
      }
    }
    const filled = (cells as number[][]).flat().filter((v) => v > 0).length;
    if (filled < 1) return jsonResp({ ok: false, msg: '先画点东西再分享吧' }, 400);
    // 生命数（可选）：1~10 的有限值，不接受无限
    const livesRaw = body.lives | 0;
    const lives = (livesRaw >= 1 && livesRaw <= 10) ? livesRaw : 1;
    const e = await kv.get(['maps']);
    const list = (e.value as any[]) || [];
    // 同作者同名地图覆盖，防止刷屏
    const idx = list.findIndex((m: any) => m && m.author === author && m.name === name);
    // 作者身份（登录时记录）：用于「别人玩你的地图 → 给你加钱加经验」。内部字段，不下发客户端
    const am = await authUser(req);
    const rec = { id: crypto.randomUUID(), name, author, cols, rows, cells, lives, ts: Date.now(), authorId: am ? am.phone : null };
    if (idx >= 0) list[idx] = rec; else list.push(rec);
    while (list.length > 200) list.shift(); // 池子上限 200 张，超出淘汰最旧的
    await kv.set(['maps'], list);
    return jsonResp({ ok: true, total: list.length });
  }

  // 以下接口均需登录
  const auth = await authUser(req);
  if (!auth) return jsonResp({ ok: false, msg: '请先登录' }, 401);
  const u = auth.user;

  // POST /api/auth/qr/confirm { ticket, name?, captcha?, captchaId? } —— 手机确认登录
  // 新账号（还是默认名 玩家XXXX）必须先创建全局唯一的用户名，并过数学验证码（防AI刷号）
  if (path === '/api/auth/qr/confirm' && req.method === 'POST') {
    const body = await readBody(req);
    const ticket = String(body.ticket || '');
    if (!ticket) return jsonResp({ ok: false, msg: '参数错误' }, 400);
    const q = await kv.get(['qrt', ticket]);
    if (!q.value) return jsonResp({ ok: false, msg: '二维码已过期，请刷新重试' }, 410);
    const rec = q.value as any;
    if (isDefaultName(String(u.name || ''))) {
      // 首次起名：必须过验证码（防AI）
      const capId = String(body.captchaId || '');
      const capAns = String(body.captcha || '').trim();
      const saved = await kv.get(['cap', capId]);
      if (!saved.value || String(saved.value) !== capAns) {
        return jsonResp({ ok: false, msg: '验证码错误，请重试' }, 400);
      }
      await kv.delete(['cap', capId]);
      const n = String(body.name || '').trim().slice(0, 12);
      if (!/^[\u4e00-\u9fa5A-Za-z0-9_]{2,12}$/.test(n)) {
        return jsonResp({ ok: false, msg: '用户名需 2-12 位中文/字母/数字/下划线' }, 400);
      }
      if (await nameTaken(n, auth.phone)) {
        return jsonResp({ ok: false, msg: '该用户名已被使用，换一个吧' }, 409);
      }
      u.name = n;
      await kv.set(['user', auth.phone], u);
    }
    // 确认：把手机端会话 token 交给电脑（同一账号，token 复用，一年有效）
    const h = req.headers.get('authorization') || '';
    const token = h.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResp({ ok: false, msg: '会话异常' }, 401);
    rec.state = 1;
    rec.token = token;
    await kv.set(['qrt', ticket], rec);
    return jsonResp({ ok: true });
  }

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

  // POST /api/user/name { name } —— 修改用户名（全局唯一，重名拒绝）
  if (path === '/api/user/name' && req.method === 'POST') {
    const { name } = await readBody(req);
    const n = String(name || '').trim().slice(0, 12);
    if (!n) return jsonResp({ ok: false, msg: '名字不能为空' }, 400);
    if (/^玩家\d{4}$/.test(n)) return jsonResp({ ok: false, msg: '这个名字不能使用' }, 400);
    if (await nameTaken(n, auth.phone)) {
      return jsonResp({ ok: false, msg: '该用户名已被使用，换一个吧' }, 409);
    }
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
    // 通行证专属武器：未获得战斗通行证不可购买
    if (def.type === 'gun' && PASS_GUNS.has(String(item)) && !u.pass) {
      return jsonResp({ ok: false, msg: `需要战斗通行证（累计击杀 ${PASS_KILLS} 个敌人）才能解锁` }, 400);
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
    if (u.role === 'admin') {
      // 管理员：免费升级，不消耗经验
      ups[item as string] = lv + 1;
      u.upgrades = ups;
      await kv.set(['user', auth.phone], u);
      return jsonResp({ ok: true, user: pubUser(u) });
    }
    const cost = upgCost(lv);
    const spendable = Math.max(0, (u.exp as number) - ((u.expSpent as number) || 0));
    if (spendable < cost) return jsonResp({ ok: false, msg: `经验不足（可花 ${spendable}，需 ${cost}）` }, 400);
    u.expSpent = ((u.expSpent as number) || 0) + cost;
    ups[item as string] = lv + 1;
    u.upgrades = ups;
    await kv.set(['user', auth.phone], u);
    return jsonResp({ ok: true, user: pubUser(u) });
  }

  // POST /api/user/result { score, kills, wave } —— 局后结算金币/经验/击杀（累计击杀达标发战斗通行证）
  if (path === '/api/user/result' && req.method === 'POST') {
    const b = await readBody(req);
    const { score, wave, kills } = b;
    const s = Math.max(0, Math.min(1000000, Math.floor(Number(score) || 0)));
    const w = Math.max(0, Math.min(999, Math.floor(Number(wave) || 0)));
    const k = Math.max(0, Math.min(9999, Math.floor(Number(kills) || 0)));
    let gainedCoins = Math.floor(s / 10) + w * 5;
    let gainedExp = Math.floor(s / 2);
    // ---------- 地图收益规则 ----------
    // 1) 玩自己创造的地图：收益降为 1/3（防止自己刷自己的图刷分）
    // 2) 玩别人分享的地图：给该地图作者分成（作者被动增收）
    const mapId = String(b.mapId || '').slice(0, 64);
    let ownMap = !!b.ownMap;
    let authorBonus: { coins: number; exp: number } | null = null;
    if (mapId) {
      const me = await kv.get(['maps']);
      const list = (me.value as any[]) || [];
      const map = list.find((m: any) => m && m.id === mapId);
      if (map) {
        if (map.authorId && map.authorId === auth.phone) {
          ownMap = true;
        } else if (map.authorId && map.authorId !== auth.phone) {
          const ab = {
            coins: Math.max(1, Math.floor(gainedCoins / 4)),
            exp: Math.max(1, Math.floor(gainedExp / 5)),
          };
          const ae = await kv.get(['user', map.authorId as string]);
          const au = ae.value as Record<string, any> | null;
          if (au) {
            au.coins = ((au.coins as number) || 0) + ab.coins;
            au.exp = ((au.exp as number) || 0) + ab.exp;
            au.level = 1 + Math.floor(((au.exp as number) || 0) / 180);
            au.mapPlays = ((au.mapPlays as number) || 0) + 1;
            await kv.set(['user', map.authorId as string], au);
            authorBonus = ab;
          }
        }
      }
    }
    if (ownMap) {
      gainedCoins = Math.floor(gainedCoins / 3);
      gainedExp = Math.floor(gainedExp / 3);
    }
    u.coins = (u.coins as number) + gainedCoins;
    u.exp = (u.exp as number) + gainedExp;
    u.kills = ((u.kills as number) || 0) + k;
    u.level = 1 + Math.floor((u.exp as number) / 180); // 升级放缓：180 经验/级
    let passGained = false;
    if (!u.pass && (u.kills as number) >= PASS_KILLS) {
      u.pass = 1;
      passGained = true;
    }
    await kv.set(['user', auth.phone], u);
    return jsonResp({ ok: true, user: pubUser(u), gainedCoins, gainedExp, passGained, ownMap, authorBonus });
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

// ---------- 扫码登录手机确认页（/qr/<ticket>） ----------
function qrPage(ticket: string): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>确认登录 Blast Buddies</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:linear-gradient(180deg,#14263c,#0d1b2a); min-height:100vh; color:#eef4ff;
         font-family:'Segoe UI','Microsoft YaHei',sans-serif; display:flex; flex-direction:column; align-items:center; padding:32px 20px; }
  .card { width:min(92vw,420px); background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14);
          border-radius:16px; padding:24px; text-align:center; }
  h1 { font-size:20px; font-weight:900; letter-spacing:1px; margin-bottom:6px; }
  .sub { font-size:13px; color:#9fb3c8; margin-bottom:18px; }
  input { width:100%; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.18);
          border-radius:10px; color:#fff; font-size:16px; padding:11px 12px; outline:none; text-align:center; margin-bottom:10px; }
  input:focus { border-color:#ffb703; }
  .row { display:flex; gap:8px; }
  .row input { flex:1; }
  button { width:100%; background:#ffb703; border:none; border-radius:10px; color:#14263c; font-size:16px;
           font-weight:800; padding:12px; cursor:pointer; }
  button:disabled { opacity:.5; }
  .small { font-size:12.5px; color:#9fb3c8; line-height:1.7; margin-bottom:10px; }
  .err { color:#ff6b6b; font-size:13px; min-height:18px; margin-bottom:8px; }
  .ok { color:#7ce38b; font-size:16px; font-weight:800; margin:14px 0; }
  .code-hint { font-size:13px; color:#9fb3c8; margin-bottom:10px; }
  .code-hint b { color:#ffd166; font-size:17px; letter-spacing:2px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Blast Buddies</h1>
    <div class="sub">确认在电脑上登录</div>
    <div id="view"></div>
  </div>
<script>
const TICKET = ${JSON.stringify(ticket)};
const $ = (id) => document.getElementById(id);
const API = (p, body) => fetch(p, { method: body ? 'POST' : 'GET', headers: { 'content-type':'application/json', ...(localStorage.getItem('bb_token') ? { authorization: 'Bearer ' + localStorage.getItem('bb_token') } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
let CAP = null; // {id, q}
let phone = '';

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function getCap() {
  const r = await API('/api/auth/captcha', {});
  if (r.ok) { CAP = r; return r.q; }
  return '验证码服务暂不可用';
}

function isDefault(n){ return /^玩家\\d{4}$/.test(n || ''); }

// 已登录：展示用户名 + 确认（新账号需先起名）
async function showConfirm(u) {
  const capQ = await getCap();
  if (isDefault(u.name)) {
    $('view').innerHTML = '<div class="small">首次登录，请创建你的用户名（全局唯一）：</div>' +
      '<input id="name" maxlength="12" placeholder="2-12 位中文/字母/数字/下划线">' +
      '<div class="err" id="err"></div>' +
      '<div class="small">防AI验证：<b>' + esc(capQ) + '</b></div>' +
      '<input id="cap" inputmode="numeric" maxlength="4" placeholder="输入答案">' +
      '<button id="ok">创建并确认登录</button>';
    $('ok').onclick = async () => {
      $('ok').disabled = true;
      const r = await API('/api/auth/qr/confirm', { ticket: TICKET, name: $('name').value, captcha: $('cap').value, captchaId: CAP.id });
      if (!r.ok) { $('err').textContent = r.msg || '失败'; $('ok').disabled = false; return; }
      done();
    };
  } else {
    $('view').innerHTML = '<div class="small">将登录账号</div><div style="font-size:20px;font-weight:900;color:#ffd166;margin-bottom:14px;">' + esc(u.name) + '</div>' +
      '<button id="ok">确认登录</button><div class="err" id="err"></div>';
    $('ok').onclick = async () => {
      $('ok').disabled = true;
      const r = await API('/api/auth/qr/confirm', { ticket: TICKET });
      if (!r.ok) { $('err').textContent = r.msg || '失败'; $('ok').disabled = false; return; }
      done();
    };
  }
}

function done() {
  $('view').innerHTML = '<div class="ok">已确认！</div><div class="small">请回到电脑查看，页面将自动登录。</div>';
}

// 未登录：先手机号登录
function showLogin() {
  $('view').innerHTML =
    '<input id="ph" maxlength="11" inputmode="numeric" placeholder="输入 11 位手机号">' +
    '<div class="err" id="err"></div>' +
    '<div class="row"><input id="code" maxlength="10" inputmode="numeric" placeholder="验证码"><button id="send" style="flex:0 0 120px;font-size:14px;">发验证码</button></div>' +
    '<div class="code-hint" id="hint"></div>' +
    '<button id="login">登录并确认</button>';
  $('send').onclick = async () => {
    phone = $('ph').value.trim();
    if (!/^1\\d{10}$/.test(phone)) { $('err').textContent = '请输入正确的手机号'; return; }
    $('send').disabled = true;
    const r = await API('/api/auth/send-code', { phone });
    if (!r.ok) { $('err').textContent = r.msg || '发送失败'; $('send').disabled = false; return; }
    $('hint').innerHTML = r.sms ? ('验证码已发送至 <b>' + esc(phone) + '</b>') : ('测试模式验证码：<b>' + esc(r.code || '') + '</b>');
    $('send').disabled = false;
  };
  $('login').onclick = async () => {
    const code = $('code').value.trim();
    if (!phone) phone = $('ph').value.trim();
    if (!code) { $('err').textContent = '请输入验证码'; return; }
    $('login').disabled = true;
    const r = await API('/api/auth/verify', { phone, code });
    if (!r.ok) { $('err').textContent = r.msg || '登录失败'; $('login').disabled = false; return; }
    localStorage.setItem('bb_token', r.token);
    await showConfirm(r.user);
  };
}

(async () => {
  const tok = localStorage.getItem('bb_token');
  if (tok) {
    const r = await API('/api/user/me');
    if (r.ok) { await showConfirm(r.user); return; }
    localStorage.removeItem('bb_token');
  }
  showLogin();
})();
</script>
</body>
</html>`;
}

// ---------- 入口 ----------
Deno.serve(async (req, connInfo) => {
  const url = new URL(req.url);
  const upgrade = (req.headers.get('upgrade') || '').toLowerCase();

  if (upgrade === 'websocket') {
    try {
      // 注意：必须在 upgradeWebSocket 之前读取 remoteAddr ——
      // 升级后 Request 已关闭，再访问 connInfo.remoteAddr 会抛 "Request closed"
      const ip = getClientIp(req, connInfo);
      const { socket, response } = Deno.upgradeWebSocket(req);
      setupSocket(socket, ip);
      return response;
    } catch (err) {
      console.error('WS setup error:', err);
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
  }

  // 用户系统 API（登录/商城/结算）
  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, url, connInfo);
  }

  // 扫码登录手机确认页（/qr/<ticket>）
  if (url.pathname.startsWith('/qr/')) {
    const ticket = decodeURIComponent(url.pathname.replace(/^\/qr\//, ''));
    if (!/^[a-f0-9]{32}$/.test(ticket)) return new Response('Not Found', { status: 404 });
    return new Response(qrPage(ticket), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    });
  }

  return serveStatic(url);
});
