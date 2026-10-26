(() => {
'use strict';
const W = 420, H = 720, PLAYER_Y = 560, PPM = 14, GOAL = 2000, GOAL_PX = GOAL * PPM;
const MAXV = 330, ACC = 2300, JUMP_T = 0.72, JUMP_CD = 1.3, MAX_HEARTS = 3;

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
const $ = id => document.getElementById(id);
let scale = 1, offX = 0, offY = 0, dpr = 1, cssW = 0, cssH = 0;

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
const speedAt = p => 15 + 9 * p; // m/s

function resize() {
  const r = cvs.getBoundingClientRect();
  cssW = r.width; cssH = r.height;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = Math.round(cssW * dpr); cvs.height = Math.round(cssH * dpr);
  scale = Math.min(cssW / W, cssH / H);
  offX = (cssW - W * scale) / 2; offY = (cssH - H * scale) / 2;
  const hud = $('hud');
  hud.style.width = Math.min(cssW, W * scale) + 'px';
  hud.style.top = (offY + 10) + 'px';
}
addEventListener('resize', resize);

// ---------- storage ----------
let best = { dist: 0, time: 0 };
try { const s = localStorage.getItem('surf2000-best'); if (s) best = Object.assign(best, JSON.parse(s)); } catch (e) {}
function saveBest() { try { localStorage.setItem('surf2000-best', JSON.stringify(best)); } catch (e) {} }
function fmtTime(t) { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
function showBestMenu() {
  const el = $('bestMenu');
  if (best.time) el.textContent = '최단 완주 ' + fmtTime(best.time);
  else if (best.dist) el.textContent = '최고 기록 ' + Math.floor(best.dist) + ' m';
  else el.textContent = '';
}
showBestMenu();

// ---------- state ----------
let state = 'menu';
let P, obs, items, parts, nextRowWY, prevRowWY, lastGapX, lastJumpWY, dist, runTime, hearts, stars,
    slow, inv, jumpT, jumpCD, shake, milestoneIdx, extraSpace, clock = 0, idleScroll = 0;
const milestones = [
  { m: 500, t: '500m! 점점 빨라져요' },
  { m: 1000, t: '절반 왔어요!' },
  { m: 1500, t: '1500m, 거친 구간이에요' },
  { m: 1800, t: '마지막 200m!' }
];

function reset() {
  P = { x: W / 2, vx: 0, z: 0 };
  obs = []; items = []; parts = [];
  nextRowWY = 620; prevRowWY = 400; lastGapX = W / 2; lastJumpWY = -9999;
  dist = 0; runTime = 0; hearts = MAX_HEARTS; stars = 0;
  slow = 1; inv = 0; jumpT = 0; jumpCD = 0; shake = 0; milestoneIdx = 0; extraSpace = 0;
}
reset();

// ---------- spawning ----------
function makeObs(type, x, wy) {
  const o = { type, x, wy, hit: false };
  if (type === 'rock') {
    o.r = rnd(18, 27); o.tall = true; o.pts = [];
    for (let i = 0; i < 9; i++) o.pts.push(rnd(0.78, 1.08));
  } else if (type === 'buoy') { o.r = 11; o.tall = false; }
  else if (type === 'jelly') { o.r = 12; o.tall = false; o.bx = x; o.ph = rnd(0, 6.28); }
  else if (type === 'log') { o.hw = 39; o.hh = 8; o.tall = false; o.r = 39; }
  else if (type === 'shark') { o.r = 15; o.tall = true; }
  else if (type === 'cross') { o.r = 13; o.tall = true; }
  return o;
}
function extent(o) { return o.type === 'log' ? 39 : o.type === 'jelly' ? o.r + 13 : o.r; }

function pickKind(p, canJump) {
  const w = {
    scatter: 1,
    wall: p > 0.12 ? 0.35 + 0.3 * p : 0,
    shark: p > 0.08 ? 0.18 : 0,
    cross: p > 0.3 ? 0.14 : 0,
    jump: canJump ? 0.16 + 0.14 * p : 0
  };
  let tot = 0; for (const k in w) tot += w[k];
  let r = Math.random() * tot;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return 'scatter';
}

function addGapItem(gx, wy, p) {
  if (hearts < MAX_HEARTS && p > 0.25 && Math.random() < 0.05) items.push({ type: 'heart', x: gx, wy });
  else if (Math.random() < 0.3) items.push({ type: 'star', x: gx, wy });
}

function spawnRow(wy) {
  const p = clamp(wy / GOAL_PX, 0, 1);
  const spd = speedAt(p) * PPM;
  const spacing = wy - prevRowWY; prevRowWY = wy;
  const reach = Math.max(55, MAXV * 0.6 * (spacing / spd));
  const gx = clamp(lastGapX + rnd(-reach, reach), 55, W - 55);
  const canJump = p > 0.2 && (wy - lastJumpWY) > (JUMP_CD + 0.6) * spd;
  const kind = pickKind(p, canJump);
  extraSpace = 0;

  if (kind === 'scatter') {
    const gw = lerp(150, 96, p);
    const n = 1 + Math.floor(Math.random() * (1.6 + 2.6 * p));
    const placed = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      let type = r < 0.45 ? 'rock' : r < 0.65 ? 'buoy' : r < 0.85 ? (p > 0.15 ? 'jelly' : 'buoy') : 'log';
      for (let tries = 0; tries < 14; tries++) {
        const o = makeObs(type, rnd(22, W - 22), wy + rnd(-28, 28));
        const e = extent(o);
        if (Math.abs(o.x - gx) < gw / 2 + e) continue;
        if (o.x - e < 4 || o.x + e > W - 4) { if (type === 'log') continue; }
        if (placed.some(q => Math.abs(q.x - o.x) < extent(q) + e + 8 && Math.abs(q.wy - o.wy) < 50)) continue;
        if (o.type === 'jelly') o.bx = o.x;
        placed.push(o); break;
      }
    }
    obs.push(...placed);
    addGapItem(gx, wy, p);
    lastGapX = gx;
  } else if (kind === 'wall') {
    const gw = lerp(122, 94, p);
    let x = 20 + rnd(0, 10);
    while (x <= W - 14) {
      const o = makeObs('rock', x, wy + rnd(-6, 6));
      o.r = rnd(21, 25);
      if (Math.abs(x - gx) > gw / 2 + o.r) obs.push(o);
      x += 44;
    }
    addGapItem(gx, wy, p);
    lastGapX = gx;
  } else if (kind === 'jump') {
    if (Math.random() < 0.5) {
      let x = rnd(-24, 0) + 39;
      while (x - 39 < W) { obs.push(makeObs('log', x, wy)); x += 84; }
    } else {
      let x = rnd(6, 20);
      const line = [];
      while (x < W + 10) { const o = makeObs('buoy', x, wy); o.rope = true; line.push(o); x += 36; }
      obs.push(...line);
    }
    lastJumpWY = wy;
    extraSpace = 60;
  } else if (kind === 'shark') {
    const o = makeObs('shark', rnd(40, W - 40), wy);
    o.vx = (Math.random() < 0.5 ? -1 : 1) * (70 + 90 * p);
    obs.push(o);
    if (Math.random() < 0.4) items.push({ type: 'star', x: rnd(40, W - 40), wy: wy + 70 });
    extraSpace = 50;
  } else if (kind === 'cross') {
    const fromLeft = Math.random() < 0.5;
    const tArrive = (PLAYER_Y + 120) / spd;
    const target = fromLeft ? W * rnd(0.35, 0.8) : W * rnd(0.2, 0.65);
    const sx = fromLeft ? -30 : W + 30;
    const o = makeObs('cross', sx, wy);
    o.vx = (target - sx) / tArrive;
    obs.push(o);
    extraSpace = 60;
  }
}

function rowSpacing(p) { return lerp(235, 138, p) * rnd(0.9, 1.15); }

// ---------- input ----------
const keys = { l: false, r: false };
function jump() {
  if (state !== 'play') return;
  if (jumpT <= 0 && jumpCD <= 0) {
    jumpT = JUMP_T; jumpCD = JUMP_CD;
    for (let i = 0; i < 10; i++) parts.push({ x: P.x + rnd(-10, 10), wy: dist * PPM + rnd(-12, 12), vx: rnd(-60, 60), vwy: rnd(-40, 40), life: 0.5, max: 0.5, r: rnd(2, 4), kind: 'spray' });
  }
}
addEventListener('keydown', e => {
  const c = e.code;
  if (c === 'ArrowLeft' || c === 'KeyA') { keys.l = true; e.preventDefault(); }
  if (c === 'ArrowRight' || c === 'KeyD') { keys.r = true; e.preventDefault(); }
  if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') {
    e.preventDefault();
    if (state === 'play') jump();
    else if (!e.repeat && (state === 'menu' || state === 'over' || state === 'clear')) start();
    else if (!e.repeat && state === 'pause') resume();
  }
  if (c === 'Enter' && !e.repeat) {
    if (state === 'menu' || state === 'over' || state === 'clear') { e.preventDefault(); start(); }
    else if (state === 'pause') { e.preventDefault(); resume(); }
  }
  if ((c === 'KeyP' || c === 'Escape') && !e.repeat) { if (state === 'play') pause(); else if (state === 'pause') resume(); }
});
addEventListener('keyup', e => {
  const c = e.code;
  if (c === 'ArrowLeft' || c === 'KeyA') keys.l = false;
  if (c === 'ArrowRight' || c === 'KeyD') keys.r = false;
});

function holdBtn(el, key) {
  const on = e => { e.preventDefault(); keys[key] = true; el.classList.add('down'); try { el.setPointerCapture(e.pointerId); } catch (_) {} };
  const off = () => { keys[key] = false; el.classList.remove('down'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('lostpointercapture', off);
}
holdBtn($('tLeft'), 'l');
holdBtn($('tRight'), 'r');
$('tJump').addEventListener('pointerdown', e => { e.preventDefault(); jump(); $('tJump').classList.add('down'); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('tJump').addEventListener(ev, () => $('tJump').classList.remove('down')));
addEventListener('pointerdown', e => { if (e.pointerType === 'touch') document.body.classList.add('touch'); }, { capture: true });
if (matchMedia('(pointer:coarse)').matches) document.body.classList.add('touch');

$('startBtn').addEventListener('click', start);
$('retryBtn').addEventListener('click', start);
$('againBtn').addEventListener('click', start);
$('resumeBtn').addEventListener('click', resume);
$('pauseBtn').addEventListener('click', () => { if (state === 'play') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });

function showOverlay(id) {
  ['menu', 'pause', 'over', 'clear'].forEach(k => $(k).classList.toggle('on', k === id));
  $('hud').classList.toggle('on', state === 'play' || state === 'pause');
  $('touch').classList.toggle('on', state === 'play');
}
function start() { reset(); state = 'play'; showOverlay(null); keys.l = keys.r = false; }
function pause() { state = 'pause'; showOverlay('pause'); $('resumeBtn').focus(); }
function resume() { state = 'play'; showOverlay(null); }

let toastTimer = 0;
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); toastTimer = 1.6; }

// ---------- update ----------
function hitRect(cx, cy, r, rx, ry, hw, hh) {
  const dx = Math.max(Math.abs(cx - rx) - hw, 0), dy = Math.max(Math.abs(cy - ry) - hh, 0);
  return dx * dx + dy * dy < r * r;
}
const sy = wy => PLAYER_Y - (wy - dist * PPM);

function splash(x, wy, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), s = rnd(60, 220);
    parts.push({ x, wy, vx: Math.cos(a) * s, vwy: Math.sin(a) * s, life: rnd(0.4, 0.8), max: 0.8, r: rnd(2, 5), kind: 'splash', color });
  }
}

function update(dt) {
  runTime += dt;
  const p = clamp(dist / GOAL, 0, 1);
  slow = Math.min(1, slow + 0.32 * dt);
  const speed = speedAt(p) * slow;
  dist += speed * dt;
  const camWY = dist * PPM;

  // steering
  const dir = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
  const air = jumpT > 0 ? 0.6 : 1;
  if (dir) {
    const turning = Math.sign(P.vx) !== dir && P.vx !== 0;
    P.vx += dir * ACC * air * (turning ? 1.5 : 1) * dt;
  } else {
    P.vx *= Math.pow(0.004, dt);
  }
  P.vx = clamp(P.vx, -MAXV, MAXV);
  P.x += P.vx * dt;
  if (P.x < 16) { P.x = 16; P.vx = 0; }
  if (P.x > W - 16) { P.x = W - 16; P.vx = 0; }

  // jump
  if (jumpT > 0) { jumpT -= dt; P.z = Math.max(0, Math.sin(Math.PI * (1 - jumpT / JUMP_T))); if (jumpT <= 0) { P.z = 0; splash(P.x, camWY, 8, '#ffffff'); } }
  if (jumpCD > 0) jumpCD -= dt;
  if (inv > 0) inv -= dt;
  if (shake > 0) shake -= dt;

  // spawn rows
  while (nextRowWY < camWY + PLAYER_Y + 120 && nextRowWY < GOAL_PX - 260) {
    spawnRow(nextRowWY);
    nextRowWY += rowSpacing(clamp(nextRowWY / GOAL_PX, 0, 1)) + extraSpace;
  }

  // obstacles
  for (const o of obs) {
    if (o.type === 'jelly') o.x = o.bx + Math.sin(clock * 1.6 + o.ph) * 12;
    else if (o.type === 'shark') { o.x += o.vx * dt; if (o.x < 25 || o.x > W - 25) { o.vx *= -1; o.x = clamp(o.x, 25, W - 25); } }
    else if (o.type === 'cross') o.x += o.vx * dt;
    if (o.hit) continue;
    const oy = sy(o.wy);
    if (Math.abs(oy - PLAYER_Y) > 60) continue;
    if (!o.tall && P.z > 0.3) continue;
    let hit;
    if (o.type === 'log') hit = hitRect(P.x, PLAYER_Y, 11, o.x, oy, o.hw, o.hh);
    else { const dx = P.x - o.x, dy = PLAYER_Y - oy, rr = o.r + 10; hit = dx * dx + dy * dy < rr * rr; }
    if (hit && inv <= 0) {
      o.hit = true; hearts--; inv = 1.4; slow = 0.5; shake = 0.35;
      splash(P.x, camWY, 22, '#ffffff');
      P.vx = -P.vx * 0.4;
      if (hearts <= 0) { gameOver(); return; }
    }
  }
  obs = obs.filter(o => sy(o.wy) < H + 80 && !(o.type === 'cross' && (o.x < -80 || o.x > W + 80)));

  // items
  for (const it of items) {
    if (it.got) continue;
    const dx = P.x - it.x, dy = PLAYER_Y - sy(it.wy);
    if (dx * dx + dy * dy < 26 * 26) {
      it.got = true;
      if (it.type === 'star') { stars++; splash(it.x, it.wy, 10, '#ffb347'); }
      else { hearts = Math.min(MAX_HEARTS, hearts + 1); splash(it.x, it.wy, 12, '#ff5f6d'); toast('목숨 +1'); }
    }
  }
  items = items.filter(it => !it.got && sy(it.wy) < H + 40);

  // wake
  if (P.z === 0) {
    for (let i = 0; i < 2; i++) parts.push({ x: P.x + rnd(-5, 5) - Math.sin(P.vx / MAXV * 0.4) * 18, wy: camWY - 22, vx: rnd(-20, 20), vwy: 0, life: 0.9, max: 0.9, r: rnd(2.5, 4), kind: 'wake' });
    if (Math.abs(P.vx) > 200) parts.push({ x: P.x - Math.sign(P.vx) * 10, wy: camWY - 6, vx: -P.vx * 0.4 + rnd(-30, 30), vwy: rnd(-30, 30), life: 0.45, max: 0.45, r: rnd(1.5, 3), kind: 'spray' });
  }
  for (const pt of parts) { pt.x += pt.vx * dt; pt.wy += pt.vwy * dt; pt.vx *= Math.pow(0.15, dt); pt.vwy *= Math.pow(0.15, dt); pt.life -= dt; }
  parts = parts.filter(pt => pt.life > 0);

  // milestones
  if (milestoneIdx < milestones.length && dist >= milestones[milestoneIdx].m) { toast(milestones[milestoneIdx].t); milestoneIdx++; }
  if (dist >= GOAL) finish();
}

function gameOver() {
  state = 'over';
  if (dist > best.dist) { best.dist = dist; saveBest(); }
  $('overText').textContent = Math.floor(dist) + 'm 지점에서 넘어졌어요. 목표까지 ' + Math.ceil(GOAL - dist) + 'm 남았어요.';
  $('overDist').textContent = Math.floor(dist) + ' m';
  $('overBest').textContent = Math.floor(best.dist) + ' m';
  showOverlay('over'); $('retryBtn').focus();
}
function finish() {
  state = 'clear'; dist = GOAL;
  best.dist = GOAL;
  if (!best.time || runTime < best.time) best.time = runTime;
  saveBest();
  $('clearTitle').textContent = hearts === 3 ? '완벽한 라이드!' : hearts === 2 ? '멋진 라이드!' : '아슬아슬한 완주!';
  $('clearText').textContent = '2000m를 끝까지 탔어요. 목숨을 지키면서 더 빨리 완주해 보세요.';
  $('clearTime').textContent = fmtTime(runTime);
  $('clearBestTime').textContent = fmtTime(best.time);
  $('clearHearts').textContent = hearts;
  $('clearStars').textContent = stars;
  showOverlay('clear'); $('againBtn').focus();
}

// ---------- drawing ----------
function wavyLine(x0, x1, y, amp, freq, ph) {
  ctx.beginPath();
  for (let x = x0; x <= x1; x += 12) {
    const yy = y + Math.sin(x * freq + ph) * amp;
    if (x === x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  }
}

function drawWater(camWY) {
  const x0 = -offX / scale - 4, x1 = W + offX / scale + 4, y0 = -offY / scale - 4, y1 = H + offY / scale + 4;
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#0a6584'); g.addColorStop(0.6, '#0e8aa3'); g.addColorStop(1, '#17a9b8');
  ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  const wyTop = camWY + PLAYER_Y - y0, wyBot = camWY + PLAYER_Y - y1;
  // swells
  const band = 190;
  for (let k = Math.floor(wyBot / band) - 1; k <= Math.ceil(wyTop / band) + 1; k++) {
    const y = sy(k * band);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    wavyLine(x0, x1, y, 8, 0.018, k * 1.7 + clock * 0.6);
    ctx.lineTo(x1, y + 46); ctx.lineTo(x0, y + 46); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 2.5;
    wavyLine(x0, x1, y, 8, 0.018, k * 1.7 + clock * 0.6); ctx.stroke();
  }
  // fine ripples
  const fb = 64;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1.5;
  for (let k = Math.floor(wyBot / fb) - 1; k <= Math.ceil(wyTop / fb) + 1; k++) {
    const y = sy(k * fb + 30);
    const seg = hash(k, 3) * 200;
    wavyLine(x0 + seg, x0 + seg + 140, y, 3, 0.05, k + clock); ctx.stroke();
    wavyLine(x0 + seg + 260, x0 + seg + 360, y + 10, 3, 0.05, k * 2 + clock); ctx.stroke();
  }
  // glints
  const cell = 56;
  for (let j = Math.floor(wyBot / cell) - 1; j <= Math.ceil(wyTop / cell); j++) {
    for (let i = Math.floor(x0 / cell); i <= Math.ceil(x1 / cell); i++) {
      const h = hash(i, j); if (h > 0.45) continue;
      const a = 0.5 + 0.5 * Math.sin(clock * 3 + h * 40);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.35 * a).toFixed(3) + ')';
      ctx.fillRect(i * cell + hash(j, i) * cell, sy(j * cell + h * cell), 3, 1.6);
    }
  }
  // out-of-bounds shade
  ctx.fillStyle = 'rgba(2,28,40,0.45)';
  ctx.fillRect(x0, y0, -x0, y1 - y0);
  ctx.fillRect(W, y0, x1 - W, y1 - y0);
  // lane ropes
  const fs = 40;
  for (let k = Math.floor(wyBot / fs); k <= Math.ceil(wyTop / fs); k++) {
    const y = sy(k * fs);
    for (const x of [-3, W + 3]) {
      ctx.fillStyle = k % 2 ? '#ff8a3d' : '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawMarkers() {
  for (let m = 250; m < GOAL; m += 250) {
    const y = sy(m * PPM);
    if (y < -40 || y > H + 40) continue;
    ctx.save();
    ctx.setLineDash([10, 10]); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '26px "Black Han Sans", system-ui, sans-serif';
    ctx.fillText(m + ' m', 14, y - 8);
    ctx.restore();
  }
  const fy = sy(GOAL_PX);
  if (fy > -60 && fy < H + 40) {
    const sq = 14;
    for (let i = 0; i < Math.ceil(W / sq); i++) for (let r = 0; r < 2; r++) {
      ctx.fillStyle = (i + r) % 2 ? '#0d2a35' : '#ffffff';
      ctx.fillRect(i * sq, fy - r * sq, sq, sq);
    }
    for (const x of [8, W - 8]) {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, fy - 70, 4, 70);
      ctx.fillStyle = '#ffc93c';
      ctx.beginPath(); ctx.moveTo(x, fy - 70); ctx.lineTo(x + (x < W / 2 ? 30 : -30), fy - 60); ctx.lineTo(x, fy - 50); ctx.fill();
    }
    ctx.fillStyle = '#ffffff'; ctx.font = '30px "Black Han Sans", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('FINISH', W / 2, fy - 30); ctx.textAlign = 'left';
  }
}

function foamRing(x, y, r) {
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    const a = i / 16 * Math.PI * 2, rr = r + 5 + Math.sin(a * 5 + clock * 4) * 1.6;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.fill();
}

function drawObs(o) {
  const y = sy(o.wy), x = o.x;
  if (y < -60 || y > H + 60) return;
  if (o.type === 'rock') {
    foamRing(x, y, o.r);
    ctx.fillStyle = '#56656b'; ctx.beginPath();
    o.pts.forEach((k, i) => { const a = i / o.pts.length * Math.PI * 2; const px = x + Math.cos(a) * o.r * k, py = y + Math.sin(a) * o.r * k; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#87979c'; ctx.beginPath(); ctx.ellipse(x - o.r * 0.25, y - o.r * 0.3, o.r * 0.45, o.r * 0.3, -0.5, 0, Math.PI * 2); ctx.fill();
  } else if (o.type === 'buoy') {
    if (o.rope) { ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 36, y); ctx.stroke(); }
    foamRing(x, y, o.r - 2);
    ctx.fillStyle = '#e8483b'; ctx.beginPath(); ctx.arc(x, y, o.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, o.r - 4, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#7a1d16'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  } else if (o.type === 'jelly') {
    ctx.strokeStyle = 'rgba(255,170,220,0.6)'; ctx.lineWidth = 1.6;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * 4, y + 4); ctx.quadraticCurveTo(x + i * 5 + Math.sin(clock * 4 + i) * 4, y + 14, x + i * 4, y + 24); ctx.stroke(); }
    const pulse = 1 + Math.sin(clock * 4 + o.ph) * 0.08;
    ctx.fillStyle = 'rgba(255,140,205,0.75)'; ctx.beginPath(); ctx.ellipse(x, y, o.r * pulse, o.r * 0.85 / pulse, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(x - 3, y - 3, 3.5, 0, Math.PI * 2); ctx.fill();
  } else if (o.type === 'log') {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.ellipse(x - o.hw, y, 7, 11, 0, 0, Math.PI * 2); ctx.ellipse(x + o.hw, y, 7, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a5a2e'; roundRect(x - o.hw, y - o.hh, o.hw * 2, o.hh * 2, o.hh); ctx.fill();
    ctx.strokeStyle = '#6b4220'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - o.hw + 8, y - 2); ctx.lineTo(x + 10, y - 2); ctx.moveTo(x - 12, y + 3); ctx.lineTo(x + o.hw - 8, y + 3); ctx.stroke();
    ctx.fillStyle = '#c99a63'; ctx.beginPath(); ctx.ellipse(x + o.hw - 2, y, 3, o.hh - 1, 0, 0, Math.PI * 2); ctx.fill();
  } else if (o.type === 'shark') {
    const d = Math.sign(o.vx) || 1;
    ctx.fillStyle = 'rgba(8,35,48,0.38)'; ctx.beginPath(); ctx.ellipse(x - d * 6, y + 2, 30, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - d * 4, y - 6); ctx.lineTo(x - d * 22, y - 12); ctx.moveTo(x - d * 4, y + 6); ctx.lineTo(x - d * 22, y + 12); ctx.stroke();
    ctx.fillStyle = '#3f4d55'; ctx.beginPath(); ctx.moveTo(x + d * 12, y); ctx.lineTo(x - d * 8, y - 7); ctx.lineTo(x - d * 4, y); ctx.lineTo(x - d * 8, y + 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6c7c84'; ctx.beginPath(); ctx.moveTo(x + d * 12, y); ctx.lineTo(x - d * 6, y - 3); ctx.lineTo(x - d * 4, y); ctx.closePath(); ctx.fill();
  } else if (o.type === 'cross') {
    const d = Math.sign(o.vx) || 1;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.arc(x - d * (18 + i * 9), y + Math.sin(i * 2) * 3, 5 - i, 0, Math.PI * 2); ctx.fill(); }
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(0, 0, 25, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2f80ed'; ctx.fillRect(-22, -1.5, 44, 3);
    ctx.fillStyle = '#7c3aed'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b1d14'; ctx.beginPath(); ctx.arc(0, 0, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawItem(it) {
  const y = sy(it.wy) + Math.sin(clock * 3 + it.x) * 2, x = it.x;
  if (y < -30 || y > H + 30) return;
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill();
  if (it.type === 'star') {
    ctx.save(); ctx.translate(x, y); ctx.rotate(clock * 0.8);
    ctx.fillStyle = '#ff9a3c'; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 4.5 : 11; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd08a'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else {
    ctx.save(); ctx.translate(x, y); const s = 1 + Math.sin(clock * 6) * 0.08; ctx.scale(s, s);
    ctx.fillStyle = '#ff4d5e'; ctx.beginPath();
    ctx.moveTo(0, 9); ctx.bezierCurveTo(-14, -1, -8, -12, 0, -5); ctx.bezierCurveTo(8, -12, 14, -1, 0, 9); ctx.fill();
    ctx.restore();
  }
}

function drawParts() {
  for (const pt of parts) {
    const a = pt.life / pt.max, y = sy(pt.wy);
    if (pt.kind === 'wake') {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.55 * a).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(pt.x, y, pt.r * (1.6 - a * 0.6), 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.globalAlpha = a; ctx.fillStyle = pt.color || '#ffffff';
      ctx.beginPath(); ctx.arc(pt.x, y, pt.r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
}

function drawPlayer() {
  const z = P.z, tilt = P.vx / MAXV * 0.42;
  if (z > 0) {
    ctx.fillStyle = 'rgba(0,30,40,0.28)';
    ctx.beginPath(); ctx.ellipse(P.x + z * 10, PLAYER_Y + 6, 12, 25, tilt, 0, Math.PI * 2); ctx.fill();
  }
  if (inv > 0 && Math.floor(inv * 12) % 2 === 0) return;
  ctx.save();
  ctx.translate(P.x, PLAYER_Y - z * 22);
  const s = 1 + z * 0.3; ctx.scale(s, s); ctx.rotate(tilt);
  // board
  ctx.fillStyle = '#ffc93c'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 27, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(80,50,0,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#e8483b'; ctx.beginPath(); ctx.ellipse(0, 0, 1.8, 25, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0d2a35'; ctx.beginPath(); ctx.moveTo(-2, 20); ctx.lineTo(2, 20); ctx.lineTo(0, 26); ctx.fill();
  // rider
  const armSwing = tilt * 14;
  ctx.strokeStyle = '#f1c27d'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-7, 2); ctx.lineTo(-15, 6 - armSwing); ctx.moveTo(7, 2); ctx.lineTo(15, 6 + armSwing); ctx.stroke();
  ctx.fillStyle = '#14b8a6'; ctx.beginPath(); ctx.ellipse(0, 2, 9, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3b2a20'; ctx.beginPath(); ctx.arc(0, 0.5, 4.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#06384b'; ctx.fillRect(0, 0, cvs.width, cvs.height);
  let sx = 0, syy = 0;
  if (shake > 0) { sx = rnd(-1, 1) * shake * 14; syy = rnd(-1, 1) * shake * 14; }
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (offX + sx), dpr * (offY + syy));
  const camWY = dist * PPM;
  drawWater(camWY);
  drawMarkers();
  for (const it of items) drawItem(it);
  drawParts();
  const sorted = obs.slice().sort((a, b) => b.wy - a.wy);
  for (const o of sorted) drawObs(o);
  drawPlayer();
}

// ---------- HUD ----------
function updateHUD() {
  let h = '';
  for (let i = 0; i < MAX_HEARTS; i++) h += '<span class="' + (i < hearts ? '' : 'off') + '">♥</span>';
  $('hearts').innerHTML = h;
  $('distNum').textContent = Math.floor(dist);
  const pct = clamp(dist / GOAL, 0, 1) * 100;
  $('barFill').style.width = pct + '%';
  $('barSurfer').style.left = pct + '%';
  $('stars').textContent = '불가사리 ' + stars;
  const ready = jumpT <= 0 && jumpCD <= 0;
  $('jumpFill').style.transform = 'scaleX(' + (ready ? 1 : clamp(1 - jumpCD / JUMP_CD, 0, 1)) + ')';
}

// ---------- loop ----------
let last = performance.now(), hudTick = 0;
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  clock += dt;
  if (state === 'play') {
    update(dt);
    hudTick += dt;
    if (hudTick > 0.05) { hudTick = 0; updateHUD(); }
  } else if (state === 'menu') {
    idleScroll += dt * 140;
    dist = idleScroll / PPM;
    P.x = W / 2 + Math.sin(clock * 0.9) * 60; P.vx = Math.cos(clock * 0.9) * 60 * 0.9 * 3;
    if (Math.random() < 0.9) parts.push({ x: P.x + rnd(-4, 4), wy: dist * PPM - 22, vx: rnd(-15, 15), vwy: 0, life: 0.9, max: 0.9, r: rnd(2.5, 4), kind: 'wake' });
    for (const pt of parts) pt.life -= dt;
    parts = parts.filter(pt => pt.life > 0);
  }
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); }
  render();
  requestAnimationFrame(frame);
}
resize();
if (state === 'menu') { dist = 0; }
requestAnimationFrame(t => { last = t; frame(t); });
})();
