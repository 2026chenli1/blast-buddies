// ============================================================
// Blast Buddies 联机服务器（零依赖）
// 同时提供：静态文件服务 + WebSocket 联机通道（房间管理）
// 用法：node server.js [端口]   （默认 8899，被占用自动 +1）
// ============================================================
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

// ---------------- WebSocket 帧编解码 ----------------
// 服务端 -> 客户端（不掩码）
function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

// 解析客户端帧（必须带掩码）。数据不足返回 null。
function parseFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2)); off = 10;
  }
  let mask = null;
  if (masked) {
    if (buf.length < off + 4) return null;
    mask = buf.slice(off, off + 4); off += 4;
  }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.slice(off, off + len));
  if (mask) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload, consumed: off + len };
}

// ---------------- 房间管理 ----------------
// rooms: room号 -> { host: conn, guest: conn|null }
const rooms = new Map();

function genRoom() {
  let room;
  do { room = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(room));
  return room;
}

// ---------------- 连接处理 ----------------
// 注意：Node 的 http server 对 WebSocket 升级请求触发的是 'upgrade' 事件，
// 而不是 'request' 事件，因此必须通过 server.on('upgrade') 处理。
function handleUpgrade(req, sock) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  sock.setNoDelay(true);
  const conn = { sock, room: null, role: null, alive: true };
  let buf = Buffer.alloc(0);

  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const frame = parseFrame(buf);
      if (!frame) break;
      buf = buf.slice(frame.consumed);
      if (!handleFrame(conn, frame)) return;
    }
  });
  sock.on('error', () => {});
  // 对方直接断开 TCP（未发 close 帧）时：先触发 'end'（半开），需显式收尾
  sock.on('end', () => {
    onDisconnect(conn);
    try { sock.end(); } catch (e) {}
  });
  sock.on('close', () => onDisconnect(conn));
}

function handleFrame(conn, frame) {
  if (frame.opcode === 0x8) { // close
    try { conn.sock.end(Buffer.from([0x88, 0])); } catch (e) {}
    onDisconnect(conn);
    return false;
  }
  if (frame.opcode === 0x9) { // ping -> pong
    const pl = frame.payload;
    try { conn.sock.write(Buffer.concat([Buffer.from([0x8A, pl.length]), pl])); } catch (e) {}
    return true;
  }
  if (frame.opcode === 0xA) return true; // pong
  if (frame.opcode !== 0x1) return true; // 忽略其他类型
  try {
    const msg = JSON.parse(frame.payload.toString('utf8'));
    handleMsg(conn, msg);
  } catch (e) {
    sendErr(conn, '消息格式错误');
  }
  return true;
}

function send(conn, obj) {
  if (!conn || !conn.alive) return;
  if (obj.t !== 'state') console.log(`[ws] -> ${conn.role || 'anon'} ${conn.room || ''}: ${obj.t}${obj.room ? ' ' + obj.room : ''}${obj.msg ? ' (' + obj.msg + ')' : ''}`);
  try { conn.sock.write(encodeFrame(JSON.stringify(obj))); } catch (e) {}
}
function sendErr(conn, msg) { send(conn, { t: 'error', msg }); }

function handleMsg(conn, msg) {
  switch (msg.t) {
    case 'create': {
      console.log(`[ws] <- create from ${conn.sock.remoteAddress}`);
      if (conn.room) return sendErr(conn, '你已经在房间里了');
      const room = genRoom();
      rooms.set(room, { host: conn, guest: null });
      conn.room = room; conn.role = 'host';
      send(conn, { t: 'created', room });
      break;
    }
    case 'join': {
      console.log(`[ws] <- join ${msg.room} from ${conn.sock.remoteAddress}`);
      if (conn.room) return sendErr(conn, '你已经在房间里了');
      const room = String(msg.room || '').trim();
      const r = rooms.get(room);
      if (!r) return sendErr(conn, '房间不存在，请检查房间号');
      if (r.guest) return sendErr(conn, '房间已满（已有 2 名玩家）');
      r.guest = conn; conn.room = room; conn.role = 'guest';
      send(conn, { t: 'joined', room });
      send(r.host, { t: 'peer', state: 'connected' });
      break;
    }
    case 'input': { // guest -> host
      if (conn.role === 'guest' && conn.room) {
        const r = rooms.get(conn.room);
        if (r && r.host && r.host.alive) send(r.host, { t: 'input', d: msg.d || {} });
      }
      break;
    }
    case 'state': { // host -> guest
      if (conn.role === 'host' && conn.room) {
        const r = rooms.get(conn.room);
        if (r && r.guest && r.guest.alive) send(r.guest, { t: 'state', d: msg.d || null });
      }
      break;
    }
    default: break;
  }
}

function onDisconnect(conn) {
  if (!conn.alive) return;
  conn.alive = false;
  if (!conn.room) return;
  const r = rooms.get(conn.room);
  if (!r) return;
  if (conn.role === 'host') {
    // 房主离开：房间解散，通知 guest
    if (r.guest && r.guest.alive) {
      send(r.guest, { t: 'peer', state: 'disconnected' });
      r.guest.room = null; r.guest.role = null;
    }
    rooms.delete(conn.room);
  } else {
    // guest 离开：房间保留，通知 host
    r.guest = null;
    if (r.host && r.host.alive) send(r.host, { t: 'peer', state: 'disconnected' });
  }
  conn.room = null; conn.role = null;
}

// ---------------- HTTP 服务器 ----------------
function createServer(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(dir, p);
    if (!file.startsWith(dir)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('404 Not Found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  server.on('upgrade', (req, sock) => handleUpgrade(req, sock));
  return server;
}

// ---------------- 启动 ----------------
const dir = __dirname;
const wantPort = parseInt(process.argv[2] || process.env.PORT || '8899', 10);
const server = createServer(dir);
let port = wantPort;

function tryListen() {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < wantPort + 10) {
      port++;
      tryListen();
    } else {
      console.error('启动失败:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, () => {
    const os = require('os');
    const ifaces = os.networkInterfaces();
    let lan = '';
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) { lan = iface.address; break; }
      }
      if (lan) break;
    }
    console.log('==============================================');
    console.log(' Blast Buddies 联机服务器已启动');
    console.log(` 本机玩:      http://localhost:${port}/`);
    if (lan) console.log(` 局域网好友:  http://${lan}:${port}/`);
    console.log(' 玩法：房主点「联机模式 → 创建房间」，把房间号发给好友；');
    console.log('       好友在另一台设备打开上面的网址，「加入房间」输入房间号即可。');
    console.log('==============================================');
  });
}
tryListen();
