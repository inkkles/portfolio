/* The engine. To change what is in the world, edit world.js instead. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const W = WORLD, D = W.dialogue;
const SANS = 'Helvetica, Arial, sans-serif';
const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono');
const ORANGE = '#ff8c00';
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ~ site variables: readable and settable from the terminal */
const site = { overlay: 0.5, textspeed: 240 };

/* ------------------------------------------------------------ boot screen */
function boot() {
  const c = $('#boot'), g = c.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const fs = 16 * dpr, cw = fs * 0.6, ch = fs * 1.2;
  const cols = Math.ceil(c.width / cw), rows = Math.ceil(c.height / ch), total = cols * rows;
  const SYM = '!@#$%^&*()_+-=[]{}|;:,.<>?/~0123456789ABCDEF';
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.font = fs + 'px ' + MONO; g.textBaseline = 'top';
  // cell 0 is bottom-left; cells count left to right, then up a row
  const cell = i => [(i % cols) * cw, (rows - 1 - Math.floor(i / cols)) * ch];
  const put = i => { const [x, y] = cell(i); g.fillStyle = '#000'; g.fillRect(x, y, cw + 1, ch + 1); g.fillStyle = ORANGE; g.fillText(SYM[Math.random() * SYM.length | 0], x, y); };
  const wipe = i => { const [x, y] = cell(i); g.clearRect(x, y, cw + 1, ch + 1); };
  const FILL = 1800, DECAY = 900; // how long each half takes, in ms
  let n = 0, decay = false, t0 = performance.now();
  (function tick() {
    const now = performance.now();
    if (!decay) { // fill, bottom to top
      const goal = Math.min(total, total * (now - t0) / FILL);
      while (n < goal) put(n++);
      for (let k = 0; k < 30; k++) put(Math.random() * n | 0);
      if (n >= total) { decay = true; n = 0; t0 = now + 300; return setTimeout(tick, 300); }
    } else {      // decay, bottom to top, with a ragged edge
      const goal = Math.min(total, total * (now - t0) / DECAY);
      while (n < goal) wipe(n++);
      for (let k = cols; k--;) wipe(n + (Math.random() * cols * 5 | 0));
      if (n >= total) return c.remove();
    }
    requestAnimationFrame(tick);
  })();
}

/* ------------------------------------------------------------------ world */
const cv = $('#world'), ctx = cv.getContext('2d');
const ink = document.createElement('canvas'), ik = ink.getContext('2d'); // everyone's drawings
const cache = {};
const sheet = src => cache[src] || (cache[src] = Object.assign(new Image(), { src }));
const bg = sheet(W.image);
let WW = 4096, WH = 1024, vw = 1, vh = 1, dpr = 1;
const cam = { x: W.start, y: W.margin }; // x = world x at screen center, y = world y at screen top
const scale = () => vh / (WH - 2 * W.margin);
const toWorld = (px, py) => { const s = scale(); return [cam.x + (px - vw / 2) / s, cam.y + py / s]; };
const near = (a, b) => mod(a - b + WW / 2, WW) - WW / 2; // shortest signed distance around the loop

let mode = null;      // null | 'draw' | 'pick'
let ui = null;        // null | 'term' | 'phone' | 'color'
let hover = null, turn = null;
const shade = $('#shade');

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2); vw = innerWidth; vh = innerHeight;
  cv.width = vw * dpr; cv.height = vh * dpr;
}
addEventListener('resize', resize); resize();

function drawThing(th, t) {
  if (th.text != null) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = th.color || '#000';
    ctx.font = `bold ${th.size}px ${SANS}`;
    ctx.fillText(th.text, th.x, th.y);
    th._w = ctx.measureText(th.text).width;
    if (th.sub) { ctx.font = `${th === hover ? 'bold ' : ''}${th.size * 0.5}px ${SANS}`; ctx.fillText(th.sub, th.x, th.y + th.size * 0.9); }
    return;
  }
  const im = sheet(th === guy && dlg && th.talkSheet ? th.talkSheet : th.sheet);
  if (!im.naturalWidth) return;
  const side = im.naturalHeight, frames = Math.max(1, Math.floor(im.naturalWidth / side)); // frames are forced square
  const f = th.always || th === hover ? Math.floor(t / 1000 * (th.fps || W.fps)) % frames : 0;
  ctx.drawImage(im, f * side, 0, side, side, th.x - th.size / 2, th.y - th.size / 2, th.size, th.size);
}

function hit(wx, wy) {
  for (let i = W.things.length - 1; i >= 0; i--) {
    const th = W.things[i];
    if (!th.link && !th.action) continue;
    const isText = th.text != null;
    const hw = isText ? (th._w || 0) / 2 + th.size : th.size / 2, hh = isText ? th.size * 1.5 : th.size / 2;
    if (Math.abs(near(wx, th.x)) <= hw && Math.abs(wy - th.y) <= hh) return th;
  }
  return null;
}

/* the character and his dialogue box */
const guy = W.things.find(t => t.action === 'guy');
let dlg = null, guySeen = false, ringing = false;
function say(lines, auto) { dlg = { lines, i: 0, t0: performance.now(), shown: 0, auto }; }
function advance() {
  if (!dlg) return;
  if (dlg.shown < dlg.lines[dlg.i].length) { dlg.t0 = -1e9; return; }  // finish revealing first
  if (++dlg.i >= dlg.lines.length) dlg = null;
  else { dlg.t0 = performance.now(); dlg.shown = 0; dlg.held = false; }
}
function updateGuy(t) {
  if (!guy) return;
  const on = Math.abs(near(guy.x, cam.x)) < Math.max(vw / scale() / 2 - guy.size / 4, guy.size / 4);
  if (on && !guySeen && !ui) { say(ringing ? D.ring : D.lines, ringing); ringing = false; }
  if (!on) dlg = null;
  guySeen = on;
  if (!dlg) return;
  const text = dlg.lines[dlg.i], n = Math.min(text.length, Math.floor((t - dlg.t0) / 1000 * D.speed));
  if (n > dlg.shown) { if (text[n - 1] !== ' ') chirp(); dlg.shown = n; }
  if (dlg.auto && n >= text.length && !dlg.held) { dlg.held = true; const d = dlg; setTimeout(() => { if (dlg === d) advance(); }, D.hold); }
}
function drawDialogue(t) {
  const text = dlg.lines[dlg.i];
  ctx.font = `bold ${D.size}px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const rows = [''];
  for (const w of text.split(' ')) {
    const cur = rows[rows.length - 1], next = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(next).width > D.width) rows.push(w); else rows[rows.length - 1] = next;
  }
  const lh = D.size * 1.3, pad = D.size * 0.8;
  const tw = Math.max(...rows.map(r => ctx.measureText(r).width));
  const bw = tw + pad * 2, bh = rows.length * lh + pad * 2, bx = guy.x + D.dx - bw / 2, by = guy.y + D.dy - bh / 2;
  ctx.fillStyle = '#fff'; ctx.fillRect(bx, by, bw, bh);
  ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = '#000';
  let k = 0;
  rows.forEach((r, row) => {
    let x = bx + pad;
    for (const chr of r) {
      if (k >= dlg.shown) return;
      ctx.fillText(chr, x, by + pad + lh * (row + 0.5) + Math.sin(t / 120 + k * 0.7) * D.wobble);
      x += ctx.measureText(chr).width; k++;
    }
    k++; // the space that became a line break
  });
  dlg.box = [bx + bw / 2, by + bh / 2, bw / 2, bh / 2];
}

function frame(t) {
  requestAnimationFrame(frame);
  const s = scale(), viewW = vw / s;
  if (turn) {
    const p = Math.min(1, (t - turn.t0) / turn.dur);
    cam.x = turn.from + turn.by * (1 - Math.pow(1 - p, 3));
    if (p >= 1) turn = null;
  }
  cam.y = clamp(cam.y, 0, Math.max(0, WH - vh / s));
  updateGuy(t);
  const left = mod(cam.x - viewW / 2, WW);
  const at = ox => ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * s * dpr, -cam.y * s * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
  // the world repeats sideways: draw as many copies as the screen needs
  if (bg.naturalWidth) for (let ox = -left; ox < viewW; ox += WW) { at(ox); ctx.drawImage(bg, 0, 0); }
  for (let ox = -left - WW; ox < viewW + WW; ox += WW) { at(ox); for (const th of W.things) drawThing(th, t); }
  for (let ox = -left; ox < viewW; ox += WW) { at(ox); ctx.drawImage(ink, 0, 0); }
  if (dlg) for (let ox = -left - WW; ox < viewW + WW; ox += WW) { at(ox); drawDialogue(t); }
}

/* digital chirps */
let ac;
function chirp() {
  if (!ac || ac.state !== 'running') return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'square'; o.frequency.value = 500 + Math.random() * 500; g.gain.value = 0.04;
  o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.04);
}
const wake = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) {} };
addEventListener('pointerdown', wake, true); addEventListener('keydown', wake, true);

/* ------------------------------------------------------------------ input */
function pan(dx, dy) {
  if (!shade.hidden) return; // no moving while a console UI is open
  const s = scale(); turn = null;
  cam.x += dx / s; cam.y += dy / s;
}
const ptrs = new Map(); let moved = 0;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0;
  if (stroke) endStroke();
  else if (mode === 'draw' && ptrs.size === 1) startStroke(e);
});
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) { // just hovering
    hover = mode ? null : hit(...toWorld(e.clientX, e.clientY));
    cv.style.cursor = mode ? 'crosshair' : hover ? 'pointer' : '';
    return;
  }
  const dx = e.clientX - p[0], dy = e.clientY - p[1]; p[0] = e.clientX; p[1] = e.clientY;
  moved += Math.abs(dx) + Math.abs(dy);
  if (stroke) addPoint(e); else if (mode !== 'draw' || ptrs.size > 1) pan(-dx / ptrs.size, -dy / ptrs.size);
});
const up = e => {
  if (!ptrs.delete(e.pointerId)) return;
  if (stroke) endStroke(); else if (moved < 6 && mode !== 'draw') click(e);
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
addEventListener('wheel', e => {
  e.preventDefault();
  if (e.shiftKey) pan(e.deltaY + e.deltaX, 0); else pan(e.deltaX, e.deltaY);
}, { passive: false });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeUI(); stopDraw(); }
  if (ui) return;
  const k = { ArrowLeft: [-60, 0], ArrowRight: [60, 0], ArrowUp: [0, -60], ArrowDown: [0, 60] }[e.key];
  if (k) pan(...k);
});

function click(e) {
  if (mode === 'pick') { // eyedropper: read the colour under the click
    const d = ctx.getImageData(e.clientX * dpr, e.clientY * dpr, 1, 1).data;
    mode = null; cv.style.cursor = '';
    $('#color').hidden = shade.hidden = false;
    return setRGB('#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
  }
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  if (dlg && dlg.box && Math.abs(near(wx, dlg.box[0])) <= dlg.box[2] && Math.abs(wy - dlg.box[1]) <= dlg.box[3]) return advance();
  const th = hit(wx, wy);
  if (!th) return;
  if (th.link) location.href = th.link;
  else if (th.action === 'artbox') openUI('color');
  else if (th.action === 'guy') dlg ? advance() : say(D.lines);
}

/* ---------------------------------------------------------------- drawing */
let color = '#000000', stroke = null, recent;
try { recent = JSON.parse(localStorage.recent); } catch (e) {}
if (!Array.isArray(recent)) recent = ['#ff8c00', '#ffffff', '#000000'];

function toHex(c) { // any CSS colour name / hex -> '#rrggbb', or null
  c = String(c).trim();
  if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c)) c = '#' + c;
  if (!c || !CSS.supports('color', c)) return null;
  const g = document.createElement('canvas').getContext('2d');
  g.fillStyle = c;
  return /^#[0-9a-f]{6}$/.test(g.fillStyle) ? g.fillStyle : null;
}
function startDraw(c) {
  const hex = toHex(c);
  if (!hex) return false;
  closeUI();
  color = hex; mode = 'draw'; hover = null; cv.style.cursor = 'crosshair'; $('#eject').hidden = false;
  recent = [hex, ...recent.filter(x => x !== hex)].slice(0, 3);
  try { localStorage.recent = JSON.stringify(recent); } catch (e) {}
  return true;
}
function stopDraw() {
  if (mode !== 'draw') return;
  if (stroke) endStroke();
  mode = null; cv.style.cursor = ''; $('#eject').hidden = true;
}
function paint(st) { // draw one stroke onto the shared ink layer (3 times so it wraps at the seam)
  const p = st.p, base = Math.floor(p[0] / WW) * WW;
  ik.strokeStyle = st.c; ik.lineWidth = st.w; ik.lineCap = ik.lineJoin = 'round';
  for (const off of [-WW, 0, WW]) {
    ik.beginPath(); ik.moveTo(p[0] - base + off, p[1]);
    for (let i = 2; i < p.length; i += 2) ik.lineTo(p[i] - base + off, p[i + 1]);
    if (p.length === 2) ik.lineTo(p[0] - base + off + 0.01, p[1]);
    ik.stroke();
  }
}
function wipeInk() { ik.clearRect(0, 0, ink.width, ink.height); }
function startStroke(e) { stroke = { c: color, w: W.brush, p: [], sent: 0, saved: 0 }; addPoint(e); }
function addPoint(e) {
  const [x, y] = toWorld(e.clientX, e.clientY), p = stroke.p;
  p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  paint({ c: stroke.c, w: stroke.w, p: p.slice(-4) });
}
function flush(final) { // push new points to everyone, a few times a second
  const st = stroke;
  if (!st) return;
  const part = (t, from) => send({ t, c: st.c, w: st.w, p: st.p.slice(Math.max(0, from - 2)) });
  if (st.p.length > st.sent) { part('live', st.sent); st.sent = st.p.length; }           // shown to everyone right away
  if (st.p.length > st.saved && (final === true || st.p.length - st.saved >= 600)) {     // stored in bigger pieces
    part('save', st.saved); st.saved = st.p.length;
  }
}
function endStroke() { flush(true); stroke = null; }
setInterval(flush, 80);

/* ---------------------------------------------------------------- network */
// One live connection to the shared server. If there is none, the site still works alone.
let ws = null, retry = 1000;
const send = m => ws && ws.readyState === 1 ? (ws.send(JSON.stringify(m)), true) : false;
function connect() {
  const here = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.hostname.endsWith('.workers.dev');
  const url = here || !W.server ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws` : W.server;
  try { ws = new WebSocket(url); } catch (e) { return; }
  ws.onopen = () => { retry = 1000; wipeInk(); }; // the server sends all graffiti right after this
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'strokes') m.a.forEach(paint);
    else if (m.t === 'stroke') paint(m);
    else if (m.t === 'hello') heard(m.text);
    else if (m.t === 'clear') wipeInk();
    else if (m.t === 'denied') print('wipe: wrong password');
  };
  ws.onclose = () => { setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); };
}
bg.onload = () => { WW = bg.naturalWidth; WH = bg.naturalHeight; ink.width = WW; ink.height = WH; connect(); };

function hello(text) { // say something to everyone on the site
  text = String(text).trim().slice(0, 255);
  if (text && !send({ t: 'hello', text })) heard(text); // no server: just show it here
}
function heard(text) {
  const d = document.createElement('div');
  d.className = 'danmaku'; d.textContent = text;
  d.style.top = 8 + Math.random() * 70 + '%';
  d.style.animationDuration = 6 + text.length / 20 + 's';
  d.onanimationend = () => d.remove();
  document.body.append(d);
  if ('Notification' in window && Notification.permission === 'granted')
    navigator.serviceWorker?.getRegistration().then(r => r ? r.showNotification('Portfolio', { body: text }) : new Notification('Portfolio', { body: text })).catch(() => {});
}
function askNotify() { try { if (Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} }
navigator.serviceWorker?.register('sw.js').catch(() => {});

/* --------------------------------------------------------------------- UI */
const term = $('#term'), out = $('#out'), cmd = $('#cmd'), msg = $('#msg');
function type(el, text) { // text appears quickly over time
  const run = el._run = {}, t0 = performance.now();
  el.textContent = '';
  (function step() {
    if (el._run !== run) return;
    const i = 1 + (performance.now() - t0) / 1000 * site.textspeed;
    el.textContent = text.slice(0, Math.floor(i));
    if (i < text.length) requestAnimationFrame(step); else term.scrollTop = term.scrollHeight;
  })();
}
function flash() {
  const f = $('#flash');
  f.textContent = 'overlay: ' + site.overlay;
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
}
function applyOverlay() { shade.style.background = `rgba(0,0,0,${site.overlay})`; flash(); }
function openUI(name) {
  if (ui === name) return closeUI();
  closeUI(); stopDraw();
  ui = name; hover = null;
  $('#' + name).hidden = shade.hidden = false;
  applyOverlay();
  $('#' + name).querySelectorAll('[data-t]').forEach(el => type(el, el.dataset.t || (el.dataset.t = el.textContent)));
  if (name === 'term') { if (!out.childNodes.length) print("type 'help'"); cmd.focus(); }
  if (name === 'phone') { askNotify(); msg.focus(); }
  if (name === 'color') showRecent();
}
function closeUI() {
  if (!ui) return;
  $('#' + ui).hidden = shade.hidden = true;
  if (mode === 'pick') { mode = null; cv.style.cursor = ''; }
  ui = null; document.activeElement.blur();
}
shade.onclick = closeUI;
$('#b-term').onclick = () => openUI('term');
$('#b-phone').onclick = () => openUI('phone');
$('#eject').onclick = stopDraw;

/* phone */
msg.oninput = () => { $('#count').textContent = msg.value.length + '/255'; };
$('#speak').onclick = () => {
  if (!msg.value.trim()) return;
  hello(msg.value); msg.value = ''; msg.oninput(); closeUI();
};
$('#ring').onclick = () => { // back to the world, spun round to face the character
  closeUI(); if (!guy) return;
  dlg = null; guySeen = false; ringing = true;
  turn = { from: cam.x, by: near(guy.x, cam.x), t0: performance.now(), dur: 1400 };
};

/* drawing tool: 3 recent colours + a dotted box that opens the RGB picker */
const sliders = [...document.querySelectorAll('#picker input')];
const picked = () => '#' + sliders.map(s => (+s.value).toString(16).padStart(2, '0')).join('');
const showPicked = () => { $('#hex').textContent = picked(); $('#pv').style.background = picked(); };
function setRGB(hex) { sliders.forEach((s, i) => { s.value = parseInt(hex.substr(1 + i * 2, 2), 16); }); showPicked(); }
sliders.forEach(s => { s.oninput = showPicked; });
function showRecent() {
  const r = $('#recent'); r.textContent = ''; $('#picker').hidden = true;
  for (const c of recent) {
    const b = document.createElement('button');
    b.className = 'sw'; b.style.background = c; b.title = c; b.onclick = () => startDraw(c);
    r.append(b);
  }
  const d = document.createElement('button');
  d.className = 'sw dotted'; d.title = 'pick a colour';
  d.onclick = () => { $('#picker').hidden = false; setRGB(recent[0]); };
  r.append(d);
}
$('#eye').onclick = () => { $('#color').hidden = shade.hidden = true; mode = 'pick'; cv.style.cursor = 'crosshair'; };
$('#ok').onclick = () => startDraw(picked());

/* --------------------------------------------------------------- terminal */
const vars = {}, hist = []; let hi = 0;
function print(s = '') { const d = document.createElement('div'); out.append(d); type(d, String(s)); term.scrollTop = term.scrollHeight; }
const lookup = n => n === 'RANDOM' ? Math.random() * 32768 | 0 : n in site ? site[n] : vars[n] ?? '';

function arith(src) { // $(( ... )): whole-number maths with + - * / % ** ( ) and variables
  const tok = src.match(/\d+|[A-Za-z_]\w*|\*\*|[-+*/%()]/g) || []; let i = 0;
  const atom = () => {
    const t = tok[i++];
    if (t === '(') { const v = sum(); i++; return v; }
    if (t === '-') return -atom();
    if (t === '+') return atom();
    return /^\d/.test(t) ? +t : Math.trunc(Number(lookup(t)) || 0);
  };
  const pow = () => { const a = atom(); return tok[i] === '**' ? (i++, a ** pow()) : a; };
  const mul = () => {
    let a = pow();
    while (tok[i] === '*' || tok[i] === '/' || tok[i] === '%') {
      const o = tok[i++], b = pow();
      if (o !== '*' && !b) throw 'division by 0';
      a = o === '*' ? a * b : o === '/' ? Math.trunc(a / b) : a % b;
    }
    return a;
  };
  const sum = () => { let a = mul(); while (tok[i] === '+' || tok[i] === '-') a = tok[i++] === '+' ? a + mul() : a - mul(); return a; };
  const v = sum();
  if (i < tok.length) throw 'syntax error';
  return v;
}
function expand(s) { // $x  ${x}  $((maths))
  let o = '', i = 0;
  while (i < s.length) {
    if (s.startsWith('$((', i)) {
      let depth = 0, j = i + 3;
      for (; j < s.length; j++) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')') { if (!depth && s[j + 1] === ')') break; depth--; }
      }
      o += arith(s.slice(i + 3, j)); i = j + 2;
    } else {
      const m = /^\$(?:\{(\w+)\}|(\w+))/.exec(s.slice(i));
      if (m) { o += lookup(m[1] || m[2]); i += m[0].length; } else o += s[i++];
    }
  }
  return o;
}
function assign(name, val) {
  if (!(name in site)) { vars[name] = val; return; }
  const n = Number(val);
  if (val === '' || !isFinite(n)) return print(name + ': needs a number');
  site[name] = name === 'overlay' ? clamp(n, 0, 1) : n;
  if (name === 'overlay') applyOverlay();
}
const cmds = {
  help() {
    print('commands: help echo get set unset clear history date whoami pwd ls exit');
    print('  phone <text>   say something to everyone here');
    print('  draw <color>   draw on the world (a color name or #rrggbb)');
    print('  wipe <password>  clear all graffiti, for everyone');
    print('  x=5   echo $x  echo $((RANDOM % 6 + 1))');
    print('~ site variables: ' + Object.keys(site).join(' ') + '   (get overlay / overlay = 0)');
  },
  echo: a => print(a.join(' ')),
  get: a => print(lookup(a[0])),
  set: a => a.length ? assign(a[0], a.slice(1).join(' ').replace(/^=\s*/, '')) : Object.entries({ ...site, ...vars }).forEach(([k, v]) => print(k + '=' + v)),
  unset: a => { delete vars[a[0]]; },
  clear: () => { out.textContent = ''; },
  history: () => hist.forEach((h, i) => print(i + 1 + '  ' + h)),
  date: () => print(new Date().toString()),
  whoami: () => print('guest'),
  pwd: () => print('/world'),
  ls: () => print(W.things.map(t => t.id || t.text).join('  ')),
  exit: () => closeUI(),
  phone: a => { if (!a.length) return print('usage: phone <text>'); askNotify(); hello(a.join(' ')); print('sent.'); },
  wipe: a => {
    if (!a.length) return print('usage: wipe <password>');
    if (!send({ t: 'clear', pw: a.join(' ') })) print('wipe: not connected');
  },
  draw: a => { if (!startDraw(a.join(' '))) print('draw: not a color: ' + a.join(' ')); },
};
cmds.hello = cmds.phone; cmds.env = cmds.set;

function run(line) {
  for (const part of line.split(';')) {
    let s;
    try { s = part.split(/('[^']*')/).map((p, i) => i % 2 ? p : expand(p)).join(''); } // no expanding inside '...'
    catch (e) { print('error: ' + e); continue; }
    const w = (s.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) || []).map(x => x.replace(/'([^']*)'|"([^"]*)"/g, (m, a, b) => a ?? b));
    if (!w.length) continue;
    const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(w[0]);
    if (m && w.length === 1) assign(m[1], m[2]);                                               // x=5
    else if (w[1] === '=' && /^[A-Za-z_]\w*$/.test(w[0])) assign(w[0], w.slice(2).join(' '));  // x = 5
    else if (cmds[w[0]]) cmds[w[0]](w.slice(1));
    else print(w[0] + ': command not found');
  }
}
cmd.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') return closeUI();
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    hi = clamp(hi + (e.key === 'ArrowUp' ? -1 : 1), 0, hist.length);
    cmd.value = hist[hi] || '';
  }
  if (e.key !== 'Enter') return;
  const line = cmd.value; cmd.value = '';
  print('$ ' + line);
  if (line.trim()) { hist.push(line); run(line); }
  hi = hist.length;
});
msg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') closeUI(); });

boot();
requestAnimationFrame(frame);
})();
