import { PAGE_HTML } from './werewolf_page.ts';

// ============================================================
// 狼人杀联机服务端（Deno Deploy / 本地 deno run 均可）
// 与 Blast Buddies 同一套基建：单文件 HTML + Deno KV + WebSocket + GitHub 自动部署
// 路由：
//   GET  /werewolf            页面
//   GET  /werewolf/state      玩家视角状态
//   POST /werewolf/action     动作（建房/加入/夜间/发言/投票/计时推进）
//   GET  /werewolf/rooms      未满房间列表
//   WS   /werewolf/ws         状态推送 + 实时语音转发
// ============================================================

type Role = 'wolf' | 'seer' | 'witch' | 'hunter' | 'villager';
type Phase = 'lobby' | 'reveal' | 'night' | 'day' | 'speech' | 'vote' | 'verdict' | 'hunter' | 'over';

interface Player {
  id: string;
  name: string;
  seat: number;
  role: Role;
  alive: boolean;
  host: boolean;
  connected: boolean;
  lastSeen: number;
}

interface SpeechLine { id: string; name: string; seat: number; text: string; ts: number; voice: boolean }
interface LogLine { text: string; ts: number; kind: string }

interface Room {
  code: string;
  created: number;
  phase: Phase;
  phaseId: number;
  phaseEndsAt: number;
  serverNow: number;
  round: number;
  config: { slots: number; speechSec: number; voteSec: number };
  players: Player[];
  night: {
    wolfVotes: Record<string, string>;
    seerTarget: string;
    witchSave: boolean;
    witchPoison: string;
    witchActed: boolean;
    killed: string;
  };
  seerResults: { round: number; target: string; name: string; wolf: boolean }[];
  witchSaveLeft: number;
  witchPoisonLeft: number;
  votes: Record<string, string>;
  speech: { order: string[]; idx: number; speakerId: string; lines: SpeechLine[] };
  log: LogLine[];
  lastDeaths: string[];
  executed: string;
  hunterPending: string;
  winners: '' | 'good' | 'wolf';
  revealRoles: boolean;
}

interface WSInfo { ws: WebSocket; code: string; id: string }

const kv = await Deno.openKv();
const bc = new BroadcastChannel('werewolf-relay');
const sockets = new Set<WSInfo>();
const ISOLATE = Math.random().toString(36).slice(2);

const ROLE_NAME: Record<Role, string> = {
  wolf: '狼人', seer: '预言家', witch: '女巫', hunter: '猎人', villager: '村民',
};
const ROLE_DESC: Record<Role, string> = {
  wolf: '每晚与同伴商议并击杀一名玩家。白天隐藏身份，活到狼人数量不少于好人即获胜。',
  seer: '每晚可查验一名玩家的阵营。',
  witch: '拥有一瓶解药与一瓶毒药，每晚最多用一瓶。解药可救当晚被杀者，毒药可毒杀一人。',
  hunter: '被投票放逐时可开枪带走一名玩家（被狼人击杀不能开枪）。',
  villager: '没有特殊技能，靠发言与投票找出狼人。',
};
const SPEECH_OPTIONS = [10, 20, 30, 40, 50, 60];
const VOTE_OPTIONS = [10, 20, 30, 40, 50, 60];
const PHASE_MS = { reveal: 6000, night: 45000, day: 7000, verdict: 7000, hunter: 12000 };

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const now = () => Date.now();

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function rolesFor(n: number): Role[] {
  const r: Role[] = [];
  for (let i = 0; i < Math.max(1, Math.floor(n / 3)); i++) r.push('wolf');
  if (n >= 4) r.push('seer');
  if (n >= 5) r.push('witch');
  if (n >= 8) r.push('hunter');
  while (r.length < n) r.push('villager');
  return shuffle(r);
}

function addLog(r: Room, text: string, kind = 'info') {
  r.log.push({ text, ts: now(), kind });
  if (r.log.length > 120) r.log.shift();
}

function setPhase(r: Room, phase: Phase, ms: number) {
  r.phase = phase;
  r.phaseId++;
  r.phaseEndsAt = now() + ms;
  r.serverNow = now();
}

function aliveList(r: Room) { return r.players.filter((p) => p.alive); }
function byId(r: Room, id: string) { return r.players.find((p) => p.id === id); }
function nameOf(r: Room, id: string) { const p = byId(r, id); return p ? `${p.seat}号 ${p.name}` : '无人'; }

function freshNight() {
  return { wolfVotes: {}, seerTarget: '', witchSave: false, witchPoison: '', witchActed: false, killed: '' };
}

// ---------- 存档（KV 原子 CAS，跨 isolate 一致） ----------
async function load(code: string): Promise<{ value: Room | null; vs: string | null }> {
  const e = await kv.get<Room>(['werewolf', code]);
  return { value: e.value ?? null, vs: e.versionstamp };
}

async function mutate(code: string, fn: (r: Room) => void | boolean, silent = false): Promise<Room | null> {
  for (let i = 0; i < 6; i++) {
    const e = await kv.get<Room>(['werewolf', code]);
    const cur = e.value as Room | null;
    if (!cur) return null;
    const next = clone(cur);
    const res = fn(next);
    if (res === false) return null;
    next.serverNow = now();
    const ok = await kv.atomic().check(e).set(['werewolf', code], next).commit();
    if (ok) { if (!silent) announce(code, next.phaseId); return next; }
  }
  return null;
}

async function create(code: string, r: Room) { await kv.set(['werewolf', code], r); }

async function listRooms(): Promise<any[]> {
  const out: any[] = [];
  const cutoff = now() - 6 * 3600000;
  for await (const e of kv.list<Room>({ prefix: ['werewolf'] })) {
    const r = e.value as Room;
    if (!r || r.created < cutoff) continue;
    if (r.phase === 'lobby' && r.players.length < r.config.slots) {
      out.push({ code: r.code, players: r.players.length, slots: r.config.slots, speechSec: r.config.speechSec });
    }
  }
  return out.slice(0, 20);
}

// ---------- 状态推进 ----------
function startGame(r: Room) {
  const roles = rolesFor(r.players.length);
  r.players.forEach((p, i) => { p.role = roles[i]; p.alive = true; });
  r.round = 1;
  r.night = freshNight();
  r.witchSaveLeft = 1;
  r.witchPoisonLeft = 1;
  r.votes = {};
  r.seerResults = [];
  r.lastDeaths = [];
  r.executed = '';
  r.hunterPending = '';
  r.winners = '';
  r.revealRoles = false;
  r.speech = { order: [], idx: 0, speakerId: '', lines: [] };
  r.log = [];
  addLog(r, `游戏开始，共 ${r.players.length} 人。天黑请闭眼。`, 'system');
  setPhase(r, 'reveal', PHASE_MS.reveal);
}

function toNight(r: Room) {
  r.night = freshNight();
  r.votes = {};
  r.executed = '';
  r.lastDeaths = [];
  addLog(r, `第 ${r.round} 夜降临，天黑请闭眼。`, 'night');
  setPhase(r, 'night', PHASE_MS.night);
}

// 狼人票：多数决，平票在最高票里随机取一个
function wolfTarget(n: Room['night']): string {
  const tally: Record<string, number> = {};
  Object.values(n.wolfVotes).forEach((t) => { if (t) tally[t] = (tally[t] || 0) + 1; });
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  const top = entries.filter((x) => x[1] === entries[0][1]);
  return top[Math.floor(Math.random() * top.length)][0];
}

function nightActorsDone(r: Room): boolean {
  const alive = aliveList(r);
  const wolves = alive.filter((p) => p.role === 'wolf');
  // 允许狼人投空票（放弃击杀），只要每只狼都提交过
  if (wolves.some((p) => !(p.id in r.night.wolfVotes))) return false;
  const seer = alive.find((p) => p.role === 'seer');
  if (seer && !r.night.seerTarget) return false;
  const witch = alive.find((p) => p.role === 'witch');
  if (witch && !r.night.witchActed && (r.witchSaveLeft > 0 || r.witchPoisonLeft > 0)) return false;
  return true;
}

function maybeEndNight(r: Room) {
  if (r.phase === 'night' && nightActorsDone(r)) r.phaseEndsAt = Math.min(r.phaseEndsAt, now() + 1500);
}

function resolveNight(r: Room) {
  const n = r.night;
  n.killed = n.killed || wolfTarget(n);
  // 预言家结果
  if (n.seerTarget) {
    const t = byId(r, n.seerTarget);
    if (t) r.seerResults.push({ round: r.round, target: t.id, name: `${t.seat}号 ${t.name}`, wolf: t.role === 'wolf' });
  }
  const deaths = new Set<string>();
  if (n.killed && !(n.witchSave && r.witchSaveLeft > 0)) deaths.add(n.killed);
  if (n.witchPoison && r.witchPoisonLeft > 0) deaths.add(n.witchPoison);
  if (n.witchSave && n.killed && r.witchSaveLeft > 0) r.witchSaveLeft--;
  if (n.witchPoison && r.witchPoisonLeft > 0) r.witchPoisonLeft--;
  deaths.forEach((id) => { const p = byId(r, id); if (p) p.alive = false; });
  r.lastDeaths = [...deaths];
  // 猎人夜间被杀不开枪
  const text = deaths.size
    ? `天亮了，昨夜 ${[...deaths].map((d) => nameOf(r, d)).join('、')} 倒下了。`
    : '天亮了，昨夜是平安夜，没有人倒下。';
  addLog(r, text, 'day');
  setPhase(r, 'day', PHASE_MS.day);
}

function checkWin(r: Room): boolean {
  const a = aliveList(r);
  const wolves = a.filter((p) => p.role === 'wolf').length;
  const goods = a.length - wolves;
  if (wolves === 0) { r.winners = 'good'; addLog(r, '所有狼人已出局，好人阵营获胜！', 'win'); }
  else if (wolves >= goods) { r.winners = 'wolf'; addLog(r, '狼人数量已不少于好人，狼人阵营获胜！', 'win'); }
  if (r.winners) { r.revealRoles = true; setPhase(r, 'over', 0); return true; }
  return false;
}

function startSpeech(r: Room) {
  const alive = aliveList(r).slice().sort((a, b) => a.seat - b.seat);
  if (!alive.length) return;
  // 从上一夜死者下一位开始（第一天随机），顺序固定，死亡玩家不在列表里
  const startSeat = r.lastDeaths.length ? (byId(r, r.lastDeaths[0])?.seat ?? alive[0].seat) + 1 : alive[Math.floor(Math.random() * alive.length)].seat;
  const ordered = alive.slice().sort((a, b) => ((a.seat - startSeat + 999) % 999) - ((b.seat - startSeat + 999) % 999));
  r.speech.order = ordered.map((p) => p.id);
  r.speech.idx = 0;
  r.speech.speakerId = r.speech.order[0] || '';
  addLog(r, `发言开始：存活 ${ordered.length} 人依次发言，每人 ${r.config.speechSec} 秒。已死亡玩家自动跳过。`, 'system');
  setPhase(r, 'speech', r.config.speechSec * 1000);
}

function nextSpeaker(r: Room) {
  // 自动跳过死亡 / 掉线离场玩家
  while (r.speech.idx < r.speech.order.length) {
    const id = r.speech.order[r.speech.idx];
    const p = byId(r, id);
    if (p && p.alive && p.role) {
      r.speech.speakerId = id;
      r.phaseId++;
      r.phaseEndsAt = now() + r.config.speechSec * 1000;
      r.serverNow = now();
      return;
    }
    r.speech.idx++;
  }
  r.speech.speakerId = '';
  r.votes = {};
  addLog(r, `发言结束，进入投票，限时 ${r.config.voteSec} 秒。`, 'system');
  setPhase(r, 'vote', r.config.voteSec * 1000);
}

function resolveVote(r: Room) {
  const tally: Record<string, number> = {};
  Object.entries(r.votes).forEach(([voter, target]) => {
    const p = byId(r, voter);
    if (!p || !p.alive || !target) return;
    tally[target] = (tally[target] || 0) + 1;
  });
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  let out = '';
  if (entries.length && (!entries[1] || entries[0][1] > entries[1][1])) out = entries[0][0];
  if (!out) {
    addLog(r, '投票平票（或无人投票），本轮无人被放逐。', 'day');
  } else {
    const p = byId(r, out);
    if (p) p.alive = false;
    r.executed = out;
    addLog(r, `${nameOf(r, out)} 被投票放逐（${entries[0][1]} 票）。`, 'day');
    if (p?.role === 'hunter') {
      r.hunterPending = out;
      addLog(r, '被放逐的是猎人，可以开枪带走一人。', 'warn');
      setPhase(r, 'hunter', PHASE_MS.hunter);
      return;
    }
  }
  verdictDone(r);
}

function verdictDone(r: Room) {
  setPhase(r, 'verdict', PHASE_MS.verdict);
}

function afterVerdict(r: Room) {
  if (checkWin(r)) return;
  r.round++;
  toNight(r);
}

function advance(r: Room, phaseId: number) {
  if (phaseId !== r.phaseId || r.phase === 'over' || now() < r.phaseEndsAt) return;
  switch (r.phase) {
    case 'reveal': toNight(r); break;
    case 'night': resolveNight(r); break;
    case 'day':
      if (checkWin(r)) break;
      startSpeech(r);
      break;
    case 'speech': r.speech.idx++; nextSpeaker(r); break;
    case 'vote': resolveVote(r); break;
    case 'verdict': afterVerdict(r); break;
    case 'hunter': r.hunterPending = ''; verdictDone(r); break;
    default: break;
  }
}

// ---------- 动作 ----------
function applyAction(r: Room, a: any, id: string, name: string): string {
  const me = byId(r, id);
  if (a.t === 'ping') {
    if (me) { me.lastSeen = now(); me.connected = true; }
    return '';
  }
  if (a.t === 'config') {
    if (r.phase !== 'lobby' || !me?.host) return '只有房主能在等待阶段修改设置';
    if (SPEECH_OPTIONS.includes(+a.speechSec)) r.config.speechSec = +a.speechSec;
    if (VOTE_OPTIONS.includes(+a.voteSec)) r.config.voteSec = +a.voteSec;
    if (+a.slots >= 4 && +a.slots <= 12 && +a.slots >= r.players.length) r.config.slots = +a.slots;
    if (r.players.length >= r.config.slots) { startGame(r); return ''; }
    addLog(r, `房主设置：${r.config.slots} 人局 / 发言 ${r.config.speechSec} 秒 / 投票 ${r.config.voteSec} 秒`, 'system');
    return '';
  }
  if (a.t === 'start') {
    if (!me?.host) return '只有房主可以开始';
    if (r.phase !== 'lobby') return '游戏已经开始';
    if (r.players.length < 4) return '至少需要 4 人才能开始';
    r.config.slots = r.players.length;
    startGame(r);
    return '';
  }
  if (a.t === 'leave') {
    if (r.phase === 'lobby') {
      const wasHost = me?.host;
      r.players = r.players.filter((p) => p.id !== id);
      if (wasHost && r.players.length) r.players[0].host = true;
      addLog(r, `${name} 离开了房间`, 'system');
    } else if (me) {
      me.connected = false;
      addLog(r, `${name} 断线了（可重新连接）`, 'warn');
    }
    return '';
  }
  if (a.t === 'restart') {
    if (r.phase !== 'over') return '游戏尚未结束';
    if (!me?.host) return '只有房主可以重开';
    r.phase = 'lobby';
    r.phaseId++;
    r.players.forEach((p) => { p.alive = true; p.role = 'villager'; p.connected = true; });
    r.log = [];
    addLog(r, '房主重开了房间，等待玩家准备。', 'system');
    return '';
  }
  if (a.t === 'tick') { advance(r, +a.phaseId); return ''; }

  if (!me) return '你不在这个房间里';

  // 夜间行动
  if (a.t === 'night') {
    if (r.phase !== 'night') return '现在不是夜晚';
    if (!me.alive) return '已死亡玩家不能行动';
    const target = String(a.target || '');
    if (target && !byId(r, target)?.alive) return '目标无效';
    if (me.role === 'wolf') {
      r.night.wolfVotes[id] = target;
      // 实时算出当前击杀目标，供女巫查看预览
      r.night.killed = wolfTarget(r.night);
      maybeEndNight(r);
      return '';
    }
    if (me.role === 'seer') {
      if (r.night.seerTarget) return '今晚已经查验过了';
      const t = byId(r, target);
      if (!t) return '请选择一名玩家';
      r.night.seerTarget = target;
      maybeEndNight(r);
      return '';
    }
    if (me.role === 'witch') {
      if (a.kind === 'save') {
        if (r.witchSaveLeft <= 0) return '解药已用完';
        if (!r.night.killed) return '今晚没有被杀的人';
        r.night.witchSave = true;
        r.night.witchActed = true;
      } else if (a.kind === 'poison') {
        if (r.witchPoisonLeft <= 0) return '毒药已用完';
        if (!target) return '请选择一名玩家';
        if (target === r.night.killed && r.night.witchSave) return '不能毒杀已被解药救下的人';
        r.night.witchPoison = target;
        r.night.witchActed = true;
      } else if (a.kind === 'skip') {
        r.night.witchActed = true;
      } else return '女巫操作无效';
      maybeEndNight(r);
      return '';
    }
    return '你的角色在夜晚没有行动';
  }
  if (a.t === 'speechText') {
    if (r.phase !== 'speech' || r.speech.speakerId !== id) return '现在不是你的发言时间';
    const text = String(a.text || '').trim().slice(0, 200);
    if (!text) return '请输入发言内容';
    r.speech.lines.push({ id, name: me.name, seat: me.seat, text, ts: now(), voice: false });
    if (r.speech.lines.length > 200) r.speech.lines.shift();
    return '';
  }
  if (a.t === 'voiceNote') {
    if (r.phase !== 'speech' || r.speech.speakerId !== id) return '现在不是你的发言时间';
    if (!r.speech.lines.some((l) => l.id === id && l.voice && l.ts > r.phaseEndsAt - (r.config.speechSec * 1000) - 1000)) {
      r.speech.lines.push({ id, name: me.name, seat: me.seat, text: '语音发言', ts: now(), voice: true });
    }
    return '';
  }
  if (a.t === 'endSpeech') {
    if (r.phase !== 'speech' || r.speech.speakerId !== id) return '现在不是你的发言时间';
    r.speech.idx++;
    nextSpeaker(r);
    return '';
  }
  if (a.t === 'vote') {
    if (r.phase !== 'vote') return '现在不是投票时间';
    if (!me.alive) return '已死亡玩家不能投票';
    const t = String(a.target || '');
    if (t && !byId(r, t)?.alive) return '目标无效';
    r.votes[id] = t;
    // 全员投完提前结束
    if (Object.keys(r.votes).filter((k) => byId(r, k)?.alive).length >= aliveList(r).length) {
      r.phaseEndsAt = Math.min(r.phaseEndsAt, now() + 800);
    }
    return '';
  }
  if (a.t === 'hunter') {
    if (r.phase !== 'hunter' || r.hunterPending !== id) return '现在不能开枪';
    const t = String(a.target || '');
    if (t && byId(r, t)?.alive) {
      const p = byId(r, t)!;
      p.alive = false;
      addLog(r, `猎人开枪带走了 ${nameOf(r, t)}。`, 'day');
    } else addLog(r, '猎人放弃开枪。', 'day');
    r.hunterPending = '';
    verdictDone(r);
    return '';
  }
  return '未知动作';
}

function view(r: Room, id: string) {
  const me = byId(r, id);
  const isWolf = me?.role === 'wolf';
  const showAll = r.phase === 'over' || r.revealRoles;
  const wolfVotes: Record<string, string> = {};
  if (isWolf && r.phase === 'night') Object.assign(wolfVotes, r.night.wolfVotes);
  const myPrivate: any = {
    role: me?.role || '',
    roleName: me ? ROLE_NAME[me.role] : '',
    roleDesc: me ? ROLE_DESC[me.role] : '',
    seerResults: me?.role === 'seer' ? r.seerResults : [],
    witchSaveLeft: me?.role === 'witch' ? r.witchSaveLeft : 0,
    witchPoisonLeft: me?.role === 'witch' ? r.witchPoisonLeft : 0,
    killedPreview: me?.role === 'witch' && r.phase === 'night' && r.night.killed ? r.night.killed : '',
    witchActed: me?.role === 'witch' ? r.night.witchActed : false,
    wolfVotes,
    wolfPeers: isWolf ? r.players.filter((p) => p.role === 'wolf').map((p) => p.id) : [],
    myNightTarget: me?.role === 'wolf' ? r.night.wolfVotes[id] || '' : me?.role === 'seer' ? r.night.seerTarget : '',
  };
  return {
    code: r.code,
    phase: r.phase,
    phaseId: r.phaseId,
    phaseEndsAt: r.phaseEndsAt,
    serverNow: now(),
    round: r.round,
    config: r.config,
    me: me ? { id: me.id, name: me.name, seat: me.seat, alive: me.alive, host: me.host, connected: me.connected, ...myPrivate } : null,
    inRoom: !!me,
    players: r.players.map((p) => ({
      id: p.id, name: p.name, seat: p.seat, alive: p.alive, host: p.host, connected: p.connected,
      role: showAll || p.id === id || (isWolf && p.role === 'wolf') ? p.role : undefined,
      voted: r.phase === 'vote' ? !!r.votes[p.id] : false,
      speaking: r.phase === 'speech' && r.speech.speakerId === p.id,
      myVote: p.id === id ? r.votes[id] || '' : undefined,
    })),
    speech: {
      order: r.speech.order.map((pid) => { const p = byId(r, pid); return p ? { id: p.id, seat: p.seat, name: p.name, alive: p.alive } : null; }).filter(Boolean),
      idx: r.speech.idx,
      speakerId: r.speech.speakerId,
      lines: r.speech.lines.slice(-60),
    },
    log: r.log.slice(-60),
    lastDeaths: r.lastDeaths.map((d) => nameOf(r, d)),
    executed: r.executed ? nameOf(r, r.executed) : '',
    hunterPending: r.hunterPending,
    winners: r.winners,
    voteTallyCount: r.phase === 'vote' ? Object.keys(r.votes).filter((k) => byId(r, k)?.alive).length : 0,
    aliveTotal: aliveList(r).length,
    roleNames: ROLE_NAME,
  };
}

// ---------- 广播 ----------
function announce(code: string, phaseId: number) {
  try { bc.postMessage({ t: 'update', code, phaseId, from: ISOLATE }); } catch (_) { /* ignore */ }
  for (const c of sockets) if (c.code === code) sendJSON(c.ws, { t: 'update', phaseId });
}

function sendJSON(ws: WebSocket, obj: any) {
  if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(obj)); } catch (_) { /* ignore */ } }
}

function relayAudio(code: string, from: string, bytes: Uint8Array, exclude?: WSInfo) {
  const idb = new TextEncoder().encode(from);
  const packet = new Uint8Array(1 + idb.length + bytes.length);
  packet[0] = idb.length;
  packet.set(idb, 1);
  packet.set(bytes, 1 + idb.length);
  for (const c of sockets) {
    if (c.code !== code || c.id === from || c === exclude) continue;
    if (c.ws.readyState === WebSocket.OPEN) { try { c.ws.send(packet); } catch (_) { /* ignore */ } }
  }
}

bc.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (!m || m.from === ISOLATE) return;
  if (m.t === 'update') for (const c of sockets) if (c.code === m.code) sendJSON(c.ws, { t: 'update', phaseId: m.phaseId });
  if (m.t === 'audio' && m.buf) relayAudio(m.code, m.id, new Uint8Array(m.buf));
};

// ---------- HTTP / WS ----------
const JSON_HEAD = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: JSON_HEAD });

async function page(): Promise<Response> {
  const head = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' };
  // 本地优先读源文件，方便改 HTML 即时生效；Deno Deploy 若未附带静态文件则用内嵌副本
  try {
    const html = await Deno.readFile(new URL('./werewolf.html', import.meta.url));
    return new Response(html, { headers: head });
  } catch (_) {
    return new Response(PAGE_HTML, { headers: head });
  }
}

function makeRoom(code: string, cfg: any, id: string, name: string): Room {
  const r: Room = {
    code, created: now(), phase: 'lobby', phaseId: 1, phaseEndsAt: 0, serverNow: now(), round: 0,
    config: {
      slots: Math.min(12, Math.max(4, +cfg.slots || 6)),
      speechSec: SPEECH_OPTIONS.includes(+cfg.speechSec) ? +cfg.speechSec : 30,
      voteSec: VOTE_OPTIONS.includes(+cfg.voteSec) ? +cfg.voteSec : 20,
    },
    players: [{ id, name, seat: 1, role: 'villager', alive: true, host: true, connected: true, lastSeen: now() }],
    night: freshNight(), seerResults: [], witchSaveLeft: 1, witchPoisonLeft: 1,
    votes: {}, speech: { order: [], idx: 0, speakerId: '', lines: [] }, log: [],
    lastDeaths: [], executed: '', hunterPending: '', winners: '', revealRoles: false,
  };
  addLog(r, `${name} 创建了房间，等待 ${r.config.slots} 人凑齐自动开局。`, 'system');
  return r;
}

function cleanName(v: any) { return String(v || '').trim().replace(/[<>]/g, '').slice(0, 12) || '玩家'; }
function cleanCode(v: any) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); }

export async function handleWerewolf(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname;
  if (p === '/werewolf/ws') {
    const code = cleanCode(url.searchParams.get('room'));
    const id = String(url.searchParams.get('id') || '');
    if (!code || !id) return json({ error: '缺少房间或玩家编号' }, 400);
    const { socket, response } = Deno.upgradeWebSocket(req);
    const info: WSInfo = { ws: socket, code, id };
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => { sockets.add(info); sendJSON(socket, { t: 'hello' }); };
    socket.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        if (ev.data === 'p') sendJSON(socket, { t: 'pong' });
        return;
      }
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      relayAudio(code, id, bytes, info);
      try { bc.postMessage({ t: 'audio', code, id, buf: bytes.buffer, from: ISOLATE }); } catch (_) { /* ignore */ }
    };
    socket.onclose = () => sockets.delete(info);
    socket.onerror = () => sockets.delete(info);
    return response;
  }
  if (p === '/werewolf' || p === '/werewolf/') return page();
  if (p === '/werewolf/rooms') return json({ rooms: await listRooms() });
  if (p === '/werewolf/state') {
    const code = cleanCode(url.searchParams.get('room'));
    const id = String(url.searchParams.get('id') || '');
    const { value: r } = await load(code);
    if (!r) return json({ error: '房间不存在或已过期' }, 404);
    return json(view(r, id));
  }
  if (p === '/werewolf/action' && req.method === 'POST') {
    let a: any;
    try { a = await req.json(); } catch (_) { return json({ error: '请求格式错误' }, 400); }
    const id = String(a.id || '');
    const name = cleanName(a.name);
    if (!id) return json({ error: '缺少玩家编号' }, 400);
    const code = a.t === 'create' || a.t === 'quickjoin' ? '' : cleanCode(a.room);
    let err = '';
    let result: Room | null = null;

    if (a.t === 'create') {
      const c = cleanCode(a.code) || Math.random().toString(36).slice(2, 6).toUpperCase();
      const { value } = await load(c);
      if (value) return json({ error: '房间号已存在，换一个' });
      await create(c, makeRoom(c, a, id, name));
      return json({ ok: true, code: c, state: view((await load(c)).value!, id) });
    }
    if (a.t === 'quickjoin') {
      const rooms = await listRooms();
      const pick = rooms[0];
      if (!pick) return json({ error: '暂时没有可加入的房间，先创建一个吧' });
      a.room = pick.code;
      a.t = 'join';
    }
    const c = cleanCode(a.room || code);
    if (a.t === 'join' || a.t === 'quickjoin') {
      result = await mutate(c, (r) => {
        if (r.phase !== 'lobby' && !byId(r, id)) { err = '游戏已开始，无法中途加入'; return false; }
        const me = byId(r, id);
        if (me) {
          me.name = name || me.name;
          me.connected = true;
          me.lastSeen = now();
          return;
        }
        if (r.players.length >= r.config.slots) { err = '房间已满'; return false; }
        if (r.players.some((x) => x.name === name)) { err = '这个昵称已被使用'; return false; }
        const used = new Set(r.players.map((x) => x.seat));
        let seat = 1; while (used.has(seat)) seat++;
        r.players.push({ id, name, seat, role: 'villager', alive: true, host: false, connected: true, lastSeen: now() });
        addLog(r, `${name} 加入房间（${r.players.length}/${r.config.slots}）`, 'system');
        if (r.players.length >= r.config.slots) startGame(r);
      });
      if (err) return json({ error: err });
      if (!result) return json({ error: '房间不存在或已过期' }, 404);
      return json({ ok: true, code: c, state: view(result, id) });
    }
    result = await mutate(c, (r) => {
      err = applyAction(r, a, id, name);
      if (err) return false;
    }, a.t === 'ping' || a.t === 'voiceNote');
    if (err) return json({ error: err });
    if (!result) return json({ error: '房间不存在或已过期' }, 404);
    return json({ ok: true, code: c, state: view(result, id) });
  }
  if (p === '/werewolf/health') return json({ ok: true, ts: now(), sockets: sockets.size });
  return null;
}

// 本地独立运行（Deno Deploy 中被 deploy.ts import，import.meta.main 为 false）
if (import.meta.main) {
  const port = +(Deno.env.get('PORT') || 8787);
  Deno.serve({ port }, async (req) => {
    const url = new URL(req.url);
    const res = await handleWerewolf(req, url);
    return res ?? new Response('Not Found', { status: 404 });
  });
  console.log(`狼人杀服务已启动: http://localhost:${port}/werewolf`);
}
