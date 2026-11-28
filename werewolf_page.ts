// 由 werewolf.html 自动生成，供 Deno Deploy 内嵌兜底（勿手改）
export const PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>月夜狼人杀 · 联机</title>
<style>
:root{
  --bg:#f7f4f2; --card:#fff; --line:#e9e0da; --ink:#3d3540; --muted:#9a8d94;
  --blue:#9cc3e0; --pink:#f2b8c6; --mint:#a9d9c3; --cream:#f5dda7; --lilac:#cbb8e3;
  --danger:#e28b8b; --shadow:0 6px 20px rgba(120,100,110,.07);
  --r:16px;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.6;min-height:100vh}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(680px 380px at 8% -8%,rgba(156,195,224,.20),transparent 70%),radial-gradient(620px 360px at 100% 0%,rgba(242,184,198,.18),transparent 70%);z-index:0}
button,input,select,textarea{font-family:inherit;font-size:inherit;color:inherit}
button{cursor:pointer;border:1px solid var(--line);background:#fff;border-radius:10px;padding:9px 14px;transition:.18s;font-weight:600}
button:hover:not(:disabled){transform:translateY(-1px);box-shadow:var(--shadow)}
button:disabled{opacity:.45;cursor:not-allowed}
.btn-main{background:linear-gradient(135deg,var(--blue),#8fb0d8);border-color:transparent;color:#fff;box-shadow:0 4px 14px rgba(140,175,210,.35)}
.btn-pink{background:linear-gradient(135deg,var(--pink),#eba9b9);border-color:transparent;color:#fff}
.btn-mint{background:linear-gradient(135deg,var(--mint),#8fc9b0);border-color:transparent;color:#fff}
.btn-ghost{background:transparent}
.btn-sm{padding:6px 10px;font-size:12px;border-radius:8px}
input,select,textarea{border:1px solid var(--line);background:#fdfbfa;border-radius:10px;padding:10px 12px;outline:none;width:100%;transition:.18s}
input:focus,select:focus,textarea:focus{border-color:var(--blue);background:#fff;box-shadow:0 0 0 3px rgba(156,195,224,.18)}
textarea{resize:vertical;min-height:78px}
label{display:block;font-size:12px;color:var(--muted);font-weight:600;margin:0 0 6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow)}
.hidden{display:none!important}
.wrap{position:relative;z-index:1;max-width:1180px;margin:0 auto;padding:22px 18px 40px}
.ico{width:18px;height:18px;vertical-align:-4px;flex:none}
/* ---------- 大厅 ---------- */
.hero{text-align:center;padding:26px 0 22px}
.hero h1{margin:0;font-size:34px;letter-spacing:6px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:12px}
.hero h1 span{background:linear-gradient(100deg,#7fa8cc,#e2a3b6,#9fc9b4);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{margin:8px 0 0;color:var(--muted);font-size:13px}
.hero .badges{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:14px}
.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 12px;font-size:12px;color:#7d7279}
.lobby-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px}
.pane{padding:22px}
.pane h2{margin:0 0 4px;font-size:17px;display:flex;align-items:center;gap:8px}
.pane .sub{color:var(--muted);font-size:12px;margin:0 0 18px}
.field{margin-bottom:14px}
.seg{display:flex;gap:6px;flex-wrap:wrap}
.seg button{flex:1;min-width:44px;padding:8px 4px;font-size:12px;border-radius:9px}
.seg button.on{background:var(--blue);border-color:transparent;color:#fff}
.seg.pink button.on{background:var(--pink);border-color:transparent;color:#fff}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.hint{font-size:11px;color:var(--muted);margin-top:6px}
.rooms{margin-top:16px;padding:18px 22px}
.rooms h2{margin:0 0 12px;font-size:15px;display:flex;align-items:center;gap:8px}
.room-item{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:8px;background:#fdfbfa}
.room-code{font-family:ui-monospace,Consolas,monospace;font-size:17px;font-weight:800;letter-spacing:2px}
.msg{min-height:20px;font-size:12px;color:var(--danger);margin-top:10px}
/* ---------- 游戏 ---------- */
.topbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;margin-bottom:14px}
.topbar .code{font-family:ui-monospace,Consolas,monospace;font-size:19px;font-weight:800;letter-spacing:2px}
.chip{border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:12px;color:#7d7279;background:#fff;display:inline-flex;align-items:center;gap:6px}
.chip.night{background:#eae5f2;border-color:#ddd3e8;color:#6b5b80}
.chip.day{background:#fff3d9;border-color:#f0e0b8;color:#917438}
.chip.speech{background:#e4f2ea;border-color:#cfe8da;color:#4b8565}
.chip.vote{background:#fde9ed;border-color:#f6d3da;color:#a45f70}
.grow{flex:1}
.timer{min-width:96px;text-align:right}
.timer b{font-size:22px;font-variant-numeric:tabular-nums}
.bar{height:6px;border-radius:99px;background:#f0eae6;overflow:hidden;margin-top:4px}
.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--blue),var(--pink));transition:width .25s linear}
.game-grid{display:grid;grid-template-columns:250px 1fr 290px;gap:14px;align-items:start}
.col{display:flex;flex-direction:column;gap:14px}
.pad{padding:16px}
.pad h3{margin:0 0 12px;font-size:13px;color:var(--muted);font-weight:700;letter-spacing:1px;display:flex;align-items:center;gap:7px}
/* 身份卡 */
.role-card{background:linear-gradient(150deg,#fff,#faf6fb);border:1px solid var(--line);border-radius:var(--r);padding:18px;text-align:center}
.role-card .glyph{width:54px;height:54px;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;background:#eef1f8;border:1px solid var(--line)}
.role-card .rn{font-size:20px;font-weight:800;letter-spacing:2px}
.role-card .rd{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.7;text-align:left}
.role-card.wolf{background:linear-gradient(150deg,#fff,#fdefef)}
.role-card.wolf .glyph{background:#fbe4e4}
.role-card.good{background:linear-gradient(150deg,#fff,#eef7f2)}
.role-card.good .glyph{background:#dff0e7}
/* 玩家座位 */
.seats{display:flex;flex-direction:column;gap:7px}
.seat{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:12px;padding:9px 11px;background:#fff;transition:.18s;position:relative;overflow:hidden}
.seat .no{width:27px;height:27px;border-radius:9px;background:#f2ece8;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex:none}
.seat .nm{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.seat .tag{font-size:10px;border-radius:6px;padding:2px 6px;background:#f3eee9;color:#8b7e85;white-space:nowrap}
.seat.me{border-color:var(--blue);background:#f4f9fd}
.seat.dead{opacity:.5;background:#f7f5f4}
.seat.dead .nm{text-decoration:line-through}
.seat.speaking{border-color:var(--mint);box-shadow:0 0 0 3px rgba(169,217,195,.28)}
.seat.sel{border-color:var(--pink);box-shadow:0 0 0 3px rgba(242,184,198,.3)}
.seat.clickable{cursor:pointer}
.seat.clickable:hover{transform:translateX(2px)}
.seat .wolfmark{color:var(--danger);font-size:11px;font-weight:700}
/* 主舞台 */
.stage{min-height:430px;padding:22px;display:flex;flex-direction:column}
.stage .phase-title{font-size:22px;font-weight:800;letter-spacing:1px;margin:0;display:flex;align-items:center;gap:10px}
.stage .phase-sub{color:var(--muted);font-size:12px;margin:6px 0 18px}
.big-msg{font-size:17px;font-weight:700;padding:18px;border-radius:14px;background:#faf6f4;border:1px solid var(--line);margin-bottom:16px;text-align:center}
.big-msg.night{background:#f1edf7;border-color:#e3d9ef;color:#5f5475}
.big-msg.day{background:#fff6e2;border-color:#f2e3bd;color:#8c7139}
.big-msg.warn{background:#fdeef0;border-color:#f5d9de;color:#a35f6d}
.big-msg.win{background:#e8f5ee;border-color:#cfe8da;color:#3f7a5c}
.action-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.sel-target{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.sel-target button.on{background:var(--pink);border-color:transparent;color:#fff}
.order{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.order span{font-size:11px;border:1px solid var(--line);border-radius:8px;padding:4px 8px;background:#fff;color:var(--muted)}
.order span.on{background:var(--mint);border-color:transparent;color:#fff}
.order span.dead{text-decoration:line-through;opacity:.5}
.waiting{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:36px 10px;text-align:center;color:var(--muted)}
.waiting .ring{width:58px;height:58px;border-radius:50%;border:4px solid #f0e8e2;border-top-color:var(--blue);animation:spin 1.2s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.progress{display:flex;align-items:center;gap:10px;margin:10px 0 18px}
.progress .bar{flex:1;margin:0;height:9px}
/* 语音 */
.mic-box{border:1px dashed var(--line);border-radius:14px;padding:16px;background:#fbf9f8;text-align:center}
.mic-box .wave{display:flex;align-items:flex-end;justify-content:center;gap:3px;height:38px;margin:10px 0}
.mic-box .wave i{width:4px;border-radius:3px;background:var(--mint);height:5px;transition:height .08s}
.mic-state{font-size:12px;color:var(--muted)}
.speech-lines{max-height:190px;overflow:auto;display:flex;flex-direction:column;gap:8px}
.line{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:#fff;font-size:12px}
.line .who{font-weight:700;color:#7c6e77;font-size:11px;margin-bottom:2px}
.log{max-height:230px;overflow:auto;display:flex;flex-direction:column;gap:6px}
.log div{font-size:11.5px;border-left:2px solid var(--line);padding:3px 0 3px 9px;color:#7c7079}
.log div.night{border-color:var(--lilac)}
.log div.day{border-color:var(--cream)}
.log div.warn{border-color:var(--danger)}
.log div.win{border-color:var(--mint);font-weight:700;color:#3f7a5c}
.role-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
.role-table td,.role-table th{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left}
.role-table th{color:var(--muted);font-weight:700}
.foot-note{font-size:11px;color:var(--muted);margin-top:12px;text-align:center}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#3d3540;color:#fff;border-radius:12px;padding:10px 18px;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.18);z-index:99;max-width:88vw;text-align:center}
@media(max-width:980px){.game-grid{grid-template-columns:1fr 1fr}.stage{grid-column:1/-1;order:-1}.lobby-grid{grid-template-columns:1fr}}
@media(max-width:640px){.wrap{padding:14px 12px 30px}.hero h1{font-size:26px;letter-spacing:3px}.game-grid{grid-template-columns:1fr}.stage{grid-column:auto}.stage{min-height:340px;padding:16px}.topbar{gap:8px}.timer{min-width:72px}.row2{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
  <!-- ============ 大厅 ============ -->
  <div id="lobby">
    <div class="hero">
      <h1>
        <svg class="ico" style="width:30px;height:30px" viewBox="0 0 24 24" fill="none" stroke="#9cc3e0" stroke-width="1.6"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4a8.5 8.5 0 1 0 11.5 11.5z"/><circle cx="17" cy="6" r="1"/></svg>
        <span>月夜狼人杀</span>
      </h1>
      <p>房间码联机 · 人数凑齐自动开局 · 天亮轮流发言 · 原生麦克风</p>
      <div class="badges">
        <span class="pill">发言 10-60 秒可选</span>
        <span class="pill">投票时长可选</span>
        <span class="pill">自动跳过死亡玩家</span>
        <span class="pill">无麦克风自动转打字</span>
      </div>
    </div>
    <div class="lobby-grid">
      <div class="card pane">
        <h2><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#9cc3e0" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>创建房间</h2>
        <p class="sub">设定人数与时长，把房间码发给朋友，人满自动开始。</p>
        <div class="field"><label>你的昵称</label><input id="cName" maxlength="12" placeholder="例如：小c"></div>
        <div class="row2">
          <div class="field"><label>开局人数（4-12）</label><select id="cSlots"></select></div>
          <div class="field"><label>房间码（可留空随机）</label><input id="cCode" maxlength="4" placeholder="自动生成" style="text-transform:uppercase"></div>
        </div>
        <div class="field"><label>每人发言时长</label><div class="seg" id="cSpeech"></div></div>
        <div class="field"><label>投票阶段时长</label><div class="seg pink" id="cVote"></div></div>
        <button class="btn-main" style="width:100%" id="btnCreate">创建房间</button>
        <div class="msg" id="lobbyMsg"></div>
      </div>
      <div class="card pane">
        <h2><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#f2b8c6" stroke-width="1.8"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H3"/></svg>加入房间</h2>
        <p class="sub">输入朋友给出的 4 位房间码即可加入。</p>
        <div class="field"><label>你的昵称</label><input id="jName" maxlength="12" placeholder="例如：小明"></div>
        <div class="field"><label>房间码</label><input id="jCode" maxlength="4" placeholder="例如：A7K2" style="text-transform:uppercase;letter-spacing:4px;font-size:20px;font-weight:800"></div>
        <button class="btn-pink" style="width:100%" id="btnJoin">加入房间</button>
        <div class="hint">同一昵称不能重复；刷新页面会自动回到原房间。</div>
        <div style="margin-top:20px;border-top:1px solid var(--line);padding-top:18px">
          <label>不想建房？快速加入一个正在等人的房间</label>
          <button class="btn-ghost" style="width:100%" id="btnQuick">快速加入</button>
        </div>
      </div>
    </div>
    <div class="card rooms hidden" id="roomList"></div>
    <p class="foot-note">语音使用浏览器原生麦克风，需要 HTTPS 或 localhost；没有麦克风 / 拒绝授权时自动切换为打字发言。</p>
  </div>

  <!-- ============ 游戏 ============ -->
  <div id="game" class="hidden">
    <div class="card topbar">
      <div>
        <div style="font-size:10px;color:var(--muted);letter-spacing:1px">房间码</div>
        <div class="code" id="gCode">----</div>
      </div>
      <button class="btn-sm btn-ghost" id="btnCopy">复制房间码</button>
      <span class="chip" id="gPhase">等待</span>
      <span class="chip" id="gRound">第 0 夜</span>
      <span class="chip" id="gAlive">存活 0</span>
      <span class="grow"></span>
      <span class="chip" id="gMic">麦克风检测中</span>
      <div class="timer"><b id="gTimer">--</b><span style="font-size:11px;color:var(--muted)"> 秒</span><div class="bar"><i id="gTimerBar" style="width:0%"></i></div></div>
      <button class="btn-sm btn-ghost" id="btnLeave">离开</button>
    </div>

    <div class="game-grid">
      <!-- 左 -->
      <div class="col">
        <div class="card pad" id="roleWrap"></div>
        <div class="card pad">
          <h3><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#9a8d94" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0-1-5.8M18 20a5 5 0 0 0-3-4.6"/></svg>玩家座位</h3>
          <div class="seats" id="seats"></div>
        </div>
      </div>
      <!-- 中 -->
      <div class="card stage" id="stage"></div>
      <!-- 右 -->
      <div class="col">
        <div class="card pad">
          <h3><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#9a8d94" stroke-width="1.8"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg>发言记录</h3>
          <div class="speech-lines" id="speechLines"></div>
        </div>
        <div class="card pad">
          <h3><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#9a8d94" stroke-width="1.8"><path d="M4 5h16v14H4zM8 9h8M8 13h8M8 17h5"/></svg>事件日志</h3>
          <div class="log" id="logBox"></div>
        </div>
      </div>
    </div>
  </div>
</div>
<div id="toast" class="toast hidden"></div>

<script>
(() => {
'use strict';
// ---------------- 基础 ----------------
const $ = (s) => document.querySelector(s);
const IS_HTTP = location.protocol.startsWith('http');
const API = IS_HTTP ? '/werewolf' : 'http://localhost:8787/werewolf';
const WSBASE = IS_HTTP
  ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/werewolf/ws'
  : 'ws://localhost:8787/werewolf/ws';
const SPEECH_OPTIONS = [10,20,30,40,50,60];
const PHASE_LABEL = { lobby:'等待开局', reveal:'查看身份', night:'夜晚', day:'天亮了', speech:'白天发言', vote:'投票', verdict:'放逐结果', hunter:'猎人开枪', over:'游戏结束' };
const ROLE_NAME = { wolf:'狼人', seer:'预言家', witch:'女巫', hunter:'猎人', villager:'村民' };
const ROLE_GLYPH = {
  wolf:'<svg class="ico" style="width:28px;height:28px" viewBox="0 0 24 24" fill="none" stroke="#c98080" stroke-width="1.6"><path d="M3 8l3-4 4 3h4l4-3 3 4-3 8-6 4-6-4-3-8z"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/></svg>',
  seer:'<svg class="ico" style="width:28px;height:28px" viewBox="0 0 24 24" fill="none" stroke="#7e9fbd" stroke-width="1.6"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  witch:'<svg class="ico" style="width:28px;height:28px" viewBox="0 0 24 24" fill="none" stroke="#a58ac4" stroke-width="1.6"><path d="M9 3h6l-1 6h3l-7 12-2-8H5l4-10z"/></svg>',
  hunter:'<svg class="ico" style="width:28px;height:28px" viewBox="0 0 24 24" fill="none" stroke="#d1a35e" stroke-width="1.6"><path d="M3 17l14-14M14 3h5v5M3 21l4-2-2-2-2 4z"/></svg>',
  villager:'<svg class="ico" style="width:28px;height:28px" viewBox="0 0 24 24" fill="none" stroke="#79ad92" stroke-width="1.6"><path d="M3 11l9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/></svg>'
};
let S = null;                 // 最近一次状态
let MY = localStorage.getItem('ww_id') || (Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4));
localStorage.setItem('ww_id', MY);
let ROOM = localStorage.getItem('ww_room') || '';
let NAME = localStorage.getItem('ww_name') || '';
let offset = 0;               // 服务器时间 - 本地时间
let cfg = { slots:6, speechSec:30, voteSec:20 };
let sel = '';                 // 当前选中的目标
let toastTimer = null;
let pollTimer = null, tickTimer = null, syncPending = false;
let lastTickAt = 0, lastVoiceKey = '', lastPhase = '';

function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.add('hidden'), 2600); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function sNow() { return Date.now() + offset; }

async function api(path, body) {
  const opt = body ? { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) } : {};
  const r = await fetch(API + path, opt);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
async function act(a) {
  a.id = MY; a.name = NAME; a.room = ROOM;
  if (S) a.phaseId = S.phaseId;
  try {
    const j = await api('/action', a);
    if (j.state) applyState(j.state);
    return j;
  } catch (e) { toast(e.message); return null; }
}
async function sync() {
  if (!ROOM) return;
  try { const j = await api('/state?room=' + encodeURIComponent(ROOM) + '&id=' + encodeURIComponent(MY)); applyState(j); }
  catch (e) { if (/不存在/.test(e.message)) { leave(true); } }
}
function scheduleSync() { if (syncPending) return; syncPending = true; setTimeout(() => { syncPending = false; sync(); }, 130); }

function applyState(st) {
  if (!st || !st.code) return;
  $('#lobbyMsg').textContent = '';
  offset = st.serverNow - Date.now();
  S = st;
  if (!st.inRoom) { leave(true); return; }
  ROOM = st.code; localStorage.setItem('ww_room', ROOM);
  if (st.phase !== lastPhase) { sel = ''; lastVoiceKey = ''; lastPhase = st.phase; }
  if (st.phase !== 'lobby' || st.config) cfg = st.config;
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  render();
}

function leave(silent) {
  const old = ROOM;
  if (!silent && NAME && old) api('/action', { t:'leave', id:MY, name:NAME, room:old }).catch(() => {});
  ROOM = ''; S = null; lastPhase = ''; localStorage.removeItem('ww_room');
  $('#game').classList.add('hidden'); $('#lobby').classList.remove('hidden');
  stopMic(); closeWS(); loadRooms();
}

// ---------------- 麦克风 / 语音 ----------------
let ws = null, wsOk = false, wsRetry = 0;
let micStream = null, micCtx = null, micProc = null, micReady = false, micDenied = false, micTried = false;
let playCtx = null, playQueues = new Map(), speakingStream = false;
const RATE = 16000;

async function initMic() {
  if (micTried) return;
  micTried = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.AudioContext) { micDenied = true; updateMicChip(); return; }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true } });
    micCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RATE });
    await micCtx.resume();
    const src = micCtx.createMediaStreamSource(micStream);
    micProc = micCtx.createScriptProcessor(2048, 1, 1);
    const mute = micCtx.createGain(); mute.gain.value = 0;
    src.connect(micProc); micProc.connect(mute); mute.connect(micCtx.destination);
    micProc.onaudioprocess = (ev) => {
      if (!speakingStream || !wsOk || !ws || ws.readyState !== 1) return;
      let input = ev.inputBuffer.getChannelData(0);
      let pcm;
      const ratio = micCtx.sampleRate / RATE;
      if (Math.abs(ratio - 1) < 0.01) pcm = input;
      else {
        const len = Math.floor(input.length / ratio);
        pcm = new Float32Array(len);
        for (let i = 0; i < len; i++) pcm[i] = input[Math.floor(i * ratio)];
      }
      const buf = new ArrayBuffer(pcm.length * 2);
      const dv = new DataView(buf);
      for (let i = 0; i < pcm.length; i++) {
        let v = Math.max(-1, Math.min(1, pcm[i]));
        dv.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      }
      try { ws.send(buf); } catch (_) {}
      drawWave(pcm);
    };
    micReady = true;
  } catch (e) { micDenied = true; micReady = false; }
  updateMicChip();
}
function updateMicChip() {
  const e = $('#gMic'); if (!e) return;
  e.textContent = micReady ? '麦克风已连接' : (micDenied ? '打字发言模式' : '麦克风检测中');
  e.style.color = micReady ? '#4b8565' : '#a45f70';
}
function drawWave(pcm) {
  const box = $('#waveBox'); if (!box) return;
  let peak = 0; for (let i = 0; i < pcm.length; i += 8) peak = Math.max(peak, Math.abs(pcm[i]));
  const bars = box.children;
  for (let i = 0; i < bars.length; i++) {
    const h = Math.min(36, 4 + peak * 90 * (0.4 + Math.random() * 0.8));
    bars[i].style.height = h.toFixed(0) + 'px';
  }
}
function ensurePlayCtx() {
  if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RATE });
  if (playCtx.state === 'suspended') playCtx.resume();
}
function onAudioPacket(data) {
  ensurePlayCtx();
  const u = new Uint8Array(data), dv = new DataView(data);
  const idLen = u[0]; if (!idLen || idLen > 40) return;
  const id = new TextDecoder().decode(u.subarray(1, 1 + idLen));
  const n = Math.floor((u.length - 1 - idLen) / 2); if (n < 1) return;
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = dv.getInt16(1 + idLen + i * 2, true) / 0x8000;
  const b = playCtx.createBuffer(1, n, RATE); b.copyToChannel(f, 0);
  const src = playCtx.createBufferSource(); src.buffer = b; src.connect(playCtx.destination);
  let q = playQueues.get(id);
  if (!q || q.t < playCtx.currentTime - 0.4) q = { t: playCtx.currentTime + 0.05 };
  const start = Math.max(playCtx.currentTime + 0.02, q.t);
  src.start(start); q.t = start + b.duration; playQueues.set(id, q);
}
function stopMic() { speakingStream = false; }
function closeWS() { if (ws) { try { ws.close(); } catch (_) {} ws = null; } wsOk = false; }
function openWS() {
  if (!ROOM) return;
  closeWS();
  try { ws = new WebSocket(WSBASE + '?room=' + encodeURIComponent(ROOM) + '&id=' + encodeURIComponent(MY)); }
  catch (e) { return; }
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { wsOk = true; wsRetry = 0; };
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      try { const m = JSON.parse(ev.data); if (m.t === 'update') scheduleSync(); } catch (_) {}
    } else onAudioPacket(ev.data);
  };
  ws.onclose = () => { wsOk = false; if (ROOM) setTimeout(openWS, Math.min(6000, 800 * (++wsRetry))); };
  ws.onerror = () => {};
}

// ---------------- 渲染 ----------------
function render() {
  const st = S; if (!st) return;
  $('#gCode').textContent = st.code;
  const ph = $('#gPhase'); ph.textContent = PHASE_LABEL[st.phase] || st.phase;
  ph.className = 'chip ' + ({ night:'night', day:'day', reveal:'night', verdict:'day', speech:'speech', vote:'vote', hunter:'vote' }[st.phase] || '');
  $('#gRound').textContent = st.round ? '第 ' + st.round + ' 夜' : '未开局';
  $('#gAlive').textContent = '存活 ' + st.aliveTotal;
  renderRole(st);
  renderSeats(st);
  renderStage(st);
  renderSpeech(st);
  renderLog(st);
  updateTimer();
}
function renderRole(st) {
  const m = st.me;
  if (!m) { $('#roleWrap').innerHTML = ''; return; }
  if (st.phase === 'lobby') {
    $('#roleWrap').innerHTML = '<h3>我的信息</h3><div style="font-size:13px">' + esc(m.name) + ' · ' + m.seat + ' 号' + (m.host ? ' · 房主' : '') + '</div><div class="hint" style="margin-top:8px">身份在开局后发放。</div>';
    return;
  }
  const wolf = m.role === 'wolf';
  let extra = '';
  if (m.role === 'seer' && m.seerResults && m.seerResults.length) {
    extra = '<div class="hint" style="margin-top:10px;text-align:left">查验记录：<br>' + m.seerResults.map(x => '第' + x.round + '夜 ' + esc(x.name) + ' → ' + (x.wolf ? '狼人' : '好人')).join('<br>') + '</div>';
  }
  if (m.role === 'witch') {
    extra = '<div class="hint" style="margin-top:10px">解药 ' + m.witchSaveLeft + ' · 毒药 ' + m.witchPoisonLeft + '</div>';
  }
  if (wolf && m.wolfPeers) {
    extra = '<div class="hint" style="margin-top:10px">同伴：' + m.wolfPeers.map(id => { const p = st.players.find(x => x.id === id); return p ? p.seat + '号' + esc(p.name) : ''; }).filter(Boolean).join('、') + '</div>';
  }
  $('#roleWrap').innerHTML = '<h3>我的身份</h3><div class="role-card ' + (wolf ? 'wolf' : 'good') + '">' +
    '<div class="glyph">' + (ROLE_GLYPH[m.role] || '') + '</div><div class="rn">' + esc(m.roleName || ROLE_NAME[m.role] || '') + '</div>' +
    '<div class="rd">' + esc(m.roleDesc || '') + '</div>' + extra + '</div>' +
    (m.alive ? '' : '<div class="hint" style="margin-top:10px;color:var(--danger);text-align:center">你已出局，仍可旁观与发言区打字。</div>');
}
function seatClickable(st) {
  if (st.phase === 'vote') return !!st.me && st.me.alive;
  if (st.phase === 'night') return !!st.me && st.me.alive && ['wolf','seer','witch'].includes(st.me.role);
  if (st.phase === 'hunter') return st.hunterPending === MY;
  return false;
}
function renderSeats(st) {
  const can = seatClickable(st);
  const html = st.players.map(p => {
    let tag = '';
    if (!p.alive) tag = '<span class="tag">已出局</span>';
    else if (p.host) tag = '<span class="tag">房主</span>';
    if (p.id === MY) tag = '<span class="tag">我</span>';
    if (p.speaking) tag += '<span class="tag" style="background:#dff0e7;color:#4b8565">发言中</span>';
    if (st.phase === 'vote' && p.voted) tag += '<span class="tag">已投</span>';
    if ((st.phase === 'over' || p.role) && p.role) tag += '<span class="tag">' + ROLE_NAME[p.role] + '</span>';
    return '<div class="seat ' + (p.id === MY ? 'me ' : '') + (p.alive ? '' : 'dead ') + (p.speaking ? 'speaking ' : '') + (sel === p.id ? 'sel ' : '') + (can && p.alive ? 'clickable' : '') + '" data-id="' + p.id + '">' +
      '<div class="no">' + p.seat + '</div><div class="nm">' + esc(p.name) + '</div>' + tag + '</div>';
  }).join('');
  const box = $('#seats'); box.innerHTML = html;
  box.querySelectorAll('.seat.clickable').forEach(el => el.addEventListener('click', () => onPick(el.dataset.id)));
}
function renderStage(st) {
  const e = $('#stage'); const m = st.me || {};
  let h = '';
  const title = (t, s) => '<h2 class="phase-title">' + t + '</h2><p class="phase-sub">' + s + '</p>';
  if (st.phase === 'lobby') {
    h += title('等待玩家凑齐', '人数达到 ' + st.config.slots + ' 人后自动开局，无需房主点开始。');
    h += '<div class="progress"><div class="bar"><i style="width:' + Math.round(100 * st.players.length / st.config.slots) + '%"></i></div><b>' + st.players.length + ' / ' + st.config.slots + '</b></div>';
    h += '<div class="big-msg">设置：每人发言 ' + st.config.speechSec + ' 秒 · 投票 ' + st.config.voteSec + ' 秒</div>';
    if (m.host) {
      h += '<div class="field"><label>调整开局人数（不少于当前人数）</label><select id="gSlots"></select></div>';
      h += '<div class="field"><label>每人发言时长</label><div class="seg" id="gSpeech"></div></div>';
      h += '<div class="field"><label>投票阶段时长</label><div class="seg pink" id="gVote"></div></div>';
      h += '<div class="action-row"><button class="btn-mint" id="btnSaveCfg">保存设置</button><button class="btn-main" id="btnStartNow">立即开始（至少 4 人）</button></div>';
    } else h += '<div class="waiting"><div class="ring"></div><div>等待房主或新玩家加入…</div></div>';
  } else if (st.phase === 'reveal') {
    h += title('身份发放', '请记住自己的身份，天黑后开始行动。');
    h += '<div class="big-msg night">' + esc(m.roleName || '') + ' · ' + esc(m.roleDesc || '') + '</div>';
    if (m.role === 'wolf' && m.wolfPeers) h += '<div class="hint">你的同伴：' + m.wolfPeers.map(id => { const p = st.players.find(x => x.id === id); return p ? p.seat + '号 ' + esc(p.name) : ''; }).filter(Boolean).join('、') + '</div>';
  } else if (st.phase === 'night') {
    h += title('第 ' + st.round + ' 夜', '天黑请闭眼，按身份完成夜间行动。');
    if (!m.alive) h += '<div class="big-msg night">你已出局，今晚只能旁观。</div>';
    else if (m.role === 'wolf') {
      h += '<div class="big-msg night">狼人行动：点击左侧玩家座位选择今晚的击杀目标。</div>';
      const votes = Object.entries(m.wolfVotes || {}).map(([id, t]) => { const p = st.players.find(x => x.id === id); const q = st.players.find(x => x.id === t); return p ? p.seat + '号→' + (q ? q.seat + '号' : '弃权') : ''; }).filter(Boolean).join('　');
      h += '<div class="hint">同伴选择：' + (votes || '暂无') + '</div>';
      h += '<div class="action-row"><button class="btn-pink" id="btnWolfSkip">放弃击杀</button></div>';
    } else if (m.role === 'seer') {
      h += '<div class="big-msg night">预言家行动：点击左侧玩家座位查验阵营。</div>';
      if (m.myNightTarget) { const p = st.players.find(x => x.id === m.myNightTarget); h += '<div class="hint">今晚已选择：' + (p ? p.seat + '号 ' + esc(p.name) : '') + '（天亮后公布结果）</div>'; }
    } else if (m.role === 'witch') {
      const killed = st.players.find(x => x.id === m.killedPreview);
      h += '<div class="big-msg night">' + (killed ? '今晚 ' + killed.seat + '号 ' + esc(killed.name) + ' 被狼人选中。' : '狼人尚未决定目标，稍等片刻。') + '</div>';
      h += '<div class="hint">解药 ' + m.witchSaveLeft + ' 瓶 · 毒药 ' + m.witchPoisonLeft + ' 瓶。毒杀请点击左侧玩家座位。</div>';
      h += '<div class="action-row"><button class="btn-mint" id="btnSave"' + (!killed || m.witchSaveLeft <= 0 || m.witchActed ? ' disabled' : '') + '>使用解药救人</button>' +
           '<button class="btn-pink" id="btnPoison"' + (m.witchPoisonLeft <= 0 || m.witchActed || !sel ? ' disabled' : '') + '>毒杀选中玩家</button>' +
           '<button class="btn-ghost" id="btnWitchSkip">不使用药水</button></div>';
    } else {
      h += '<div class="waiting"><div class="ring"></div><div>你今晚没有行动，请闭眼等待天亮…</div></div>';
    }
  } else if (st.phase === 'day') {
    h += title('天亮了', '公布昨夜结果，随后进入发言环节。');
    h += '<div class="big-msg day">' + (st.lastDeaths.length ? '昨夜 ' + esc(st.lastDeaths.join('、')) + ' 倒下了。' : '昨夜是平安夜，没有人倒下。') + '</div>';
    h += '<div class="waiting"><div class="ring"></div><div>马上开始白天发言…</div></div>';
  } else if (st.phase === 'speech') {
    const sp = st.players.find(p => p.id === st.speech.speakerId);
    const mine = st.speech.speakerId === MY && m.alive;
    h += title('白天发言', '每人 ' + st.config.speechSec + ' 秒，按座位顺序轮流发言，死亡玩家自动跳过。');
    h += '<div class="order">' + st.speech.order.map((o, i) => '<span class="' + (!o.alive ? 'dead ' : '') + (i === st.speech.idx ? 'on' : '') + '">' + o.seat + '号 ' + esc(o.name) + '</span>').join('') + '</div>';
    h += '<div class="order" style="margin-top:6px"><span style="border:none;background:transparent;color:var(--muted)">已跳过死亡玩家，当前发言顺序仅含存活者</span></div>';
    if (mine) {
      h += '<div class="big-msg" style="margin-top:14px">轮到你发言了</div>';
      if (micReady) {
        h += '<div class="mic-box"><div class="mic-state">原生麦克风已开启，房间内所有人实时收听</div><div class="wave" id="waveBox">' + Array.from({length:18}).map(() => '<i></i>').join('') + '</div>' +
             '<div class="action-row" style="justify-content:center"><button class="btn-mint" id="btnEndSpeech">结束发言</button><button class="btn-ghost" id="btnToggleType">改用打字补充</button></div></div>';
        h += '<div id="typeBox" class="hidden" style="margin-top:12px"><textarea id="speechText" maxlength="200" placeholder="也可以打字补充发言（会显示在发言记录里）"></textarea><div class="action-row"><button class="btn-main" id="btnSendText">发送发言</button></div></div>';
      } else {
        h += '<div class="mic-box"><div class="mic-state">未检测到可用麦克风，已切换为打字发言</div><div style="margin-top:10px"><textarea id="speechText" maxlength="200" placeholder="输入你的发言，回车或点发送"></textarea></div>' +
             '<div class="action-row" style="justify-content:center"><button class="btn-main" id="btnSendText">发送发言</button><button class="btn-mint" id="btnEndSpeech">结束发言</button></div></div>';
      }
    } else {
      h += '<div class="big-msg" style="margin-top:14px">正在聆听 ' + (sp ? sp.seat + '号 ' + esc(sp.name) : '…') + ' 发言</div>';
      h += '<div class="waiting"><svg class="ico" style="width:34px;height:34px" viewBox="0 0 24 24" fill="none" stroke="#a9d9c3" stroke-width="1.6"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg><div>语音实时播放中；若对方打字发言，内容会出现在右侧记录里。</div></div>';
    }
  } else if (st.phase === 'vote') {
    h += title('投票放逐', '点击左侧玩家座位投出你的一票，限时 ' + st.config.voteSec + ' 秒。');
    h += '<div class="progress"><div class="bar"><i style="width:' + Math.round(100 * st.voteTallyCount / Math.max(1, st.aliveTotal)) + '%"></i></div><b>' + st.voteTallyCount + ' / ' + st.aliveTotal + ' 已投</b></div>';
    if (!m.alive) h += '<div class="big-msg">你已出局，本轮不能投票。</div>';
    else if (m.myVote) { const p = st.players.find(x => x.id === m.myVote); h += '<div class="big-msg">已投给 ' + (p ? p.seat + '号 ' + esc(p.name) : '弃权') + '，改票直接点其他人。</div>'; }
    else h += '<div class="big-msg">尚未投票，点击左侧座位选择目标。</div>';
    h += '<div class="action-row"><button class="btn-ghost" id="btnAbstain">弃权</button></div>';
  } else if (st.phase === 'verdict') {
    h += title('放逐结果', '结果公布后进入下一夜。');
    h += '<div class="big-msg ' + (st.executed ? 'warn' : 'day') + '">' + (st.executed ? esc(st.executed) + ' 被放逐。' : '本轮无人被放逐。') + '</div>';
  } else if (st.phase === 'hunter') {
    const isMe = st.hunterPending === MY;
    h += title('猎人开枪', '猎人被放逐，可以带走一名玩家。');
    h += '<div class="big-msg warn">' + (isMe ? '点击左侧玩家座位开枪，或放弃。' : '猎人正在决定是否开枪…') + '</div>';
    if (isMe) h += '<div class="action-row"><button class="btn-ghost" id="btnHunterSkip">放弃开枪</button></div>';
  } else if (st.phase === 'over') {
    h += title('游戏结束', st.winners === 'good' ? '好人阵营获胜' : '狼人阵营获胜');
    h += '<div class="big-msg win">' + (st.winners === 'good' ? '所有狼人已出局，好人获胜！' : '狼人数量不少于好人，狼人获胜！') + '</div>';
    h += '<table class="role-table"><tr><th>座位</th><th>玩家</th><th>身份</th><th>状态</th></tr>' + st.players.map(p =>
      '<tr><td>' + p.seat + '号</td><td>' + esc(p.name) + '</td><td>' + (ROLE_NAME[p.role] || '—') + '</td><td>' + (p.alive ? '存活' : '出局') + '</td></tr>').join('') + '</table>';
    if (m.host) h += '<div class="action-row"><button class="btn-main" id="btnRestart">再来一局</button></div>';
  }
  e.innerHTML = h;
  bindStage(st);
}
function bindStage(st) {
  const seg = (id, opts, cur, cb) => {
    const box = $(id); if (!box) return;
    box.innerHTML = opts.map(o => '<button data-v="' + o + '" class="' + (o === cur ? 'on' : '') + '">' + o + 's</button>').join('');
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => cb(+b.dataset.v)));
  };
  const selBox = (id, cur) => {
    const e = $(id); if (!e) return;
    e.innerHTML = Array.from({length:9}, (_, i) => i + 4).map(n => '<option value="' + n + '"' + (n === cur ? ' selected' : '') + '>' + n + ' 人</option>').join('');
  };
  if (st.phase === 'lobby' && st.me && st.me.host) {
    const c = Object.assign({}, st.config);
    selBox('#gSlots', c.slots);
    seg('#gSpeech', SPEECH_OPTIONS, c.speechSec, () => {});
    seg('#gVote', SPEECH_OPTIONS, c.voteSec, () => {});
    const pick = (id, key) => {
      const box = $(id); if (!box) return;
      box.onclick = (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        box.querySelectorAll('button').forEach(x => x.classList.remove('on'));
        b.classList.add('on'); c[key] = +b.dataset.v;
      };
    };
    pick('#gSpeech', 'speechSec'); pick('#gVote', 'voteSec');
    const save = $('#btnSaveCfg');
    if (save) save.onclick = () => act({ t:'config', slots:+$('#gSlots').value, speechSec:c.speechSec, voteSec:c.voteSec });
    const start = $('#btnStartNow'); if (start) start.onclick = () => act({ t:'start' });
  }
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on('#btnWolfSkip', () => act({ t:'night', target:'' }));
  on('#btnSave', () => act({ t:'night', kind:'save' }));
  on('#btnPoison', () => sel && act({ t:'night', kind:'poison', target:sel }));
  on('#btnWitchSkip', () => act({ t:'night', kind:'skip' }));
  on('#btnEndSpeech', () => { stopMic(); act({ t:'endSpeech' }); });
  on('#btnToggleType', () => { const b = $('#typeBox'); if (b) b.classList.toggle('hidden'); });
  on('#btnSendText', () => {
    const t = $('#speechText');
    if (t && t.value.trim()) { act({ t:'speechText', text:t.value.trim() }); t.value = ''; toast('已发送'); }
  });
  on('#btnAbstain', () => act({ t:'vote', target:'' }));
  on('#btnHunterSkip', () => act({ t:'hunter', target:'' }));
  on('#btnRestart', () => act({ t:'restart' }));
  const ta = $('#speechText');
  if (ta) ta.onkeydown = (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); const b = $('#btnSendText'); if (b) b.click(); } };
  // 发言者开麦 / 非发言者关麦
  const shouldSpeak = st.phase === 'speech' && st.speech.speakerId === MY && st.me && st.me.alive && micReady;
  speakingStream = !!shouldSpeak;
  if (shouldSpeak) {
    if (micCtx && micCtx.state === 'suspended') micCtx.resume();
    const key = st.phaseId + '|' + st.speech.speakerId;
    if (key !== lastVoiceKey) { lastVoiceKey = key; act({ t:'voiceNote' }); }
  }
  if (st.phase !== 'speech') playQueues.clear();
}
function onPick(id) {
  const st = S; if (!st || !st.me) return;
  const p = st.players.find(x => x.id === id); if (!p || !p.alive) return;
  if (st.phase === 'vote') { act({ t:'vote', target:id }); sel = ''; return; }
  if (st.phase === 'hunter') { act({ t:'hunter', target:id }); sel = ''; return; }
  if (st.phase === 'night') {
    if (st.me.role === 'wolf') { act({ t:'night', target:id }); sel = ''; return; }
    if (st.me.role === 'seer') { act({ t:'night', target:id }); sel = ''; return; }
    if (st.me.role === 'witch') { sel = id; renderSeats(st); const b = $('#btnPoison'); if (b) b.disabled = false; toast('已选中 ' + p.seat + '号，点「毒杀选中玩家」确认'); return; }
  }
}
function renderSpeech(st) {
  const lines = st.speech.lines || [];
  $('#speechLines').innerHTML = lines.length
    ? lines.slice().reverse().map(l => '<div class="line"><div class="who">' + l.seat + '号 ' + esc(l.name) + (l.voice ? ' · 语音' : '') + '</div>' + esc(l.text) + '</div>').join('')
    : '<div class="hint">暂无发言记录</div>';
}
function renderLog(st) {
  $('#logBox').innerHTML = (st.log || []).slice().reverse().map(l => '<div class="' + esc(l.kind) + '">' + esc(l.text) + '</div>').join('');
}
function updateTimer() {
  if (!S) return;
  const left = Math.max(0, S.phaseEndsAt - sNow());
  const total = S.phase === 'speech' ? S.config.speechSec * 1000 : S.phase === 'vote' ? S.config.voteSec * 1000 : 0;
  $('#gTimer').textContent = S.phase === 'over' || S.phase === 'lobby' ? '--' : Math.ceil(left / 1000);
  $('#gTimerBar').style.width = (total ? Math.max(0, Math.min(100, 100 * left / total)) : 0) + '%';
  if (S.phase !== 'over' && S.phase !== 'lobby' && left <= 0 && Date.now() - lastTickAt > 900) {
    lastTickAt = Date.now();
    act({ t:'tick', phaseId:S.phaseId });
  }
}

// ---------------- 大厅交互 ----------------
function segInit(id, opts, cur, onPickFn) {
  const box = $(id);
  box.innerHTML = opts.map(o => '<button data-v="' + o + '" class="' + (o === cur ? 'on' : '') + '">' + o + 's</button>').join('');
  box.onclick = (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    box.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); onPickFn(+b.dataset.v);
  };
}
function initLobby() {
  $('#cSlots').innerHTML = Array.from({length:9}, (_, i) => i + 4).map(n => '<option value="' + n + '"' + (n === cfg.slots ? ' selected' : '') + '>' + n + ' 人</option>').join('');
  segInit('#cSpeech', SPEECH_OPTIONS, cfg.speechSec, v => cfg.speechSec = v);
  segInit('#cVote', SPEECH_OPTIONS, cfg.voteSec, v => cfg.voteSec = v);
  $('#cName').value = NAME; $('#jName').value = NAME;
  $('#btnCreate').onclick = async () => {
    NAME = ($('#cName').value || '').trim().slice(0,12) || '玩家' + Math.floor(Math.random()*90+10);
    localStorage.setItem('ww_name', NAME);
    await initMic(); ensurePlayCtx();
    cfg.slots = +$('#cSlots').value;
    const code = ($('#cCode').value || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
    try {
      const j = await api('/action', { t:'create', id:MY, name:NAME, code, slots:cfg.slots, speechSec:cfg.speechSec, voteSec:cfg.voteSec });
      ROOM = j.code; localStorage.setItem('ww_room', ROOM);
      applyState(j.state); openWS(); toast('房间 ' + ROOM + ' 已创建');
    } catch (e) { $('#lobbyMsg').textContent = e.message; }
  };
  $('#btnJoin').onclick = async () => {
    NAME = ($('#jName').value || '').trim().slice(0,12) || '玩家' + Math.floor(Math.random()*90+10);
    localStorage.setItem('ww_name', NAME);
    const code = ($('#jCode').value || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if (code.length !== 4) { $('#lobbyMsg').textContent = '请输入 4 位房间码'; return; }
    await initMic(); ensurePlayCtx();
    try {
      const j = await api('/action', { t:'join', id:MY, name:NAME, room:code });
      ROOM = j.code; localStorage.setItem('ww_room', ROOM);
      applyState(j.state); openWS();
    } catch (e) { $('#lobbyMsg').textContent = e.message; }
  };
  $('#btnQuick').onclick = async () => {
    NAME = ($('#jName').value || '').trim().slice(0,12) || '玩家' + Math.floor(Math.random()*90+10);
    localStorage.setItem('ww_name', NAME);
    await initMic(); ensurePlayCtx();
    try {
      const j = await api('/action', { t:'quickjoin', id:MY, name:NAME });
      ROOM = j.code; localStorage.setItem('ww_room', ROOM);
      applyState(j.state); openWS();
    } catch (e) { $('#lobbyMsg').textContent = e.message; }
  };
  $('#btnCopy').onclick = () => {
    const t = ROOM;
    navigator.clipboard?.writeText(t).then(() => toast('已复制房间码 ' + t)).catch(() => toast('房间码：' + t));
  };
  $('#btnLeave').onclick = () => leave(false);
  $('#gMic').style.cursor = 'pointer';
  $('#gMic').onclick = async () => { micTried = false; micDenied = false; await initMic(); toast(micReady ? '麦克风已连接' : '仍未获得麦克风授权，继续用打字发言'); };
  document.addEventListener('pointerdown', () => { if (ROOM) ensurePlayCtx(); });
}
async function loadRooms() {
  try {
    const j = await api('/rooms');
    const box = $('#roomList');
    if (!j.rooms || !j.rooms.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = '<h2>正在等人的房间</h2>' + j.rooms.map(r =>
      '<div class="room-item"><div><span class="room-code">' + esc(r.code) + '</span> <span class="hint" style="display:inline">' + r.players + '/' + r.slots + ' 人 · 发言 ' + r.speechSec + 's</span></div>' +
      '<button class="btn-sm btn-main" data-c="' + esc(r.code) + '">加入</button></div>').join('');
    box.querySelectorAll('button[data-c]').forEach(b => b.onclick = () => { $('#jCode').value = b.dataset.c; $('#btnJoin').click(); });
  } catch (_) {}
}
function boot() {
  initLobby();
  loadRooms();
  setInterval(updateTimer, 250);
  setInterval(() => { if (ROOM && !syncPending) sync(); }, 1600);
  setInterval(() => { if (ROOM) act({ t:'ping' }); }, 8000);
  if (ROOM) { initMic().then(() => { ensurePlayCtx(); sync().then(() => { if (ROOM) openWS(); }); }); }
  updateMicChip();
}
boot();
})();
</script>
</body>
</html>
`;
