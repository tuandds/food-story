'use strict';
// Food Story — tap ingredients on plates, send them to the looping conveyor,
// 3 of a kind merge into a dish, dishes are served to waiting customers.

const ING_IDS = Array.from({ length: 45 }, (_, i) => i + 6); // sprites 6..50
// dominant colour of each ingredient sprite, used for its plate on the belt and the order bubble
const ING_COLOR = {"6":"#81c213","7":"#ff9f04","8":"#ff9e0d","9":"#7dbd14","10":"#c05a2a","11":"#ffab2b","12":"#ffde4f","13":"#f22406","14":"#7fbd00","15":"#feb133","16":"#ff9d00","17":"#ff4f81","18":"#ffa200","19":"#ffcc04","20":"#ff5744","21":"#f49e5e","22":"#ba48c7","23":"#7d331f","24":"#30b8fe","25":"#f5b142","26":"#eab469","27":"#ffb827","28":"#ff6775","29":"#a95c2a","30":"#b4ba1e","31":"#4c82ca","32":"#f2c770","33":"#ff958b","34":"#684948","35":"#5fc70c","36":"#ef2b00","37":"#ffa301","38":"#9f461b","39":"#e9382f","40":"#ffd592","41":"#e93440","42":"#ffa171","43":"#ff9253","44":"#f96f5d","45":"#fb6e5c","46":"#f1746b","47":"#ffedac","48":"#c7ec92","49":"#ffa798","50":"#ffa102"};
const AVATARS = 16;
const GAME_W = 540, GAME_H = 960;
const CUST_X = [150, 230, 310, 390]; // front-row customer columns
const BASE_CAP = 7;
const BELT_SPEED = 0.2; // loops per second
const BELT_ARROWS = 14;

// Belt lane centre-line in Group-1.png pixel space (1012x376): a stadium shape
const BELT = { x: 32, y: 334, w: 476, h: 177, imgW: 1012, imgH: 376, cl: 174, cr: 838, cy: 155, r: 95 };

const $ = (s) => document.querySelector(s);
const game = $('#game'), table = $('#table'), layer = $('#layer'), beltEl = $('#belt');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const ingSrc = (id) => `assets/ing/${id}.png`;
const dishSrc = (id) => `assets/dish/${id}.png`;

let level = 1;
try { level = Math.max(1, parseInt(localStorage.getItem('fs_level'), 10) || 1); } catch (e) {}

let S; // level state

// ---------------- phone-sized stage ----------------
let SCALE = 1;
function fit() {
  SCALE = Math.min(innerWidth / GAME_W, innerHeight / GAME_H);
  game.style.left = `${(innerWidth - GAME_W * SCALE) / 2}px`;
  game.style.top = `${(innerHeight - GAME_H * SCALE) / 2}px`;
  game.style.transform = `scale(${SCALE})`;
}
// element rect in unscaled game coordinates
function rel(el) {
  const g = game.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: (r.left - g.left) / SCALE, y: (r.top - g.top) / SCALE, w: r.width / SCALE, h: r.height / SCALE };
}

// ---------------- sound ----------------
let actx;
function beep(freq, dur = 0.08, type = 'sine', vol = 0.12) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
  } catch (e) {}
}
const sfx = {
  tap: () => beep(520, 0.06, 'triangle'),
  merge: () => { beep(660, 0.1); setTimeout(() => beep(880, 0.12), 80); },
  serve: () => { beep(784, 0.08, 'triangle'); setTimeout(() => beep(1046, 0.15, 'triangle'), 90); },
  plate: () => beep(300, 0.08, 'square', 0.05),
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle'), i * 120)),
  lose: () => [392, 330, 262].forEach((f, i) => setTimeout(() => beep(f, 0.22, 'sawtooth', 0.06), i * 160)),
};

// ---------------- level generation ----------------
function difficulty(n) {
  if (n > 2 && n % 5 === 0) return 'hard';
  if (n > 2 && n % 3 === 0) return 'normal';
  return 'easy';
}

function levelConfig(n) {
  const extra = { easy: 0, normal: 1, hard: 2 }[difficulty(n)];
  return {
    customers: Math.min(5 + n * 2, 36),
    types: Math.min(3 + Math.ceil(n * 0.8) + extra, 16),
  };
}

function newLevel() {
  const cfg = levelConfig(level);
  const types = shuffle(ING_IDS.slice()).slice(0, cfg.types);
  const orders = [];
  for (let i = 0; i < cfg.customers; i++) orders.push(types[i % types.length]);
  shuffle(orders);

  // 3 ingredients per order, scattered across plates of 2–3 items
  const items = shuffle(orders.flatMap((id) => [id, id, id]));
  const sizes = [];
  let left = items.length;
  while (left > 0) {
    const n = left === 4 ? 2 : left <= 3 ? left : Math.random() < 0.45 ? 2 : 3;
    sizes.push(n); left -= n;
  }
  let k = 0;
  const plateItems = sizes.map((n) => items.slice(k, (k += n)));
  // avoid plates holding three identical items (too easy)
  plateItems.forEach((p, i) => {
    if (p.length === 3 && p[0] === p[1] && p[1] === p[2]) {
      const o = plateItems[(i + 1) % plateItems.length];
      [p[0], o[0]] = [o[0], p[0]];
    }
  });

  if (S) S.belt.forEach((b) => b.el.remove());
  S = {
    cap: BASE_CAP,
    belt: [], // {kind:'ing'|'dish', id, el, pos, fly}
    offset: 0,
    holdUntil: 0,
    plates: plateItems.map((ids) => ({
      r: ids.length === 3 ? rand(0.145, 0.165) : rand(0.112, 0.128), // fraction of table width
      px: Math.random(),
      slots: ids.map((id) => ({ id })),
      el: null,
    })),
    queue: orders.map((id) => ({ id, avatar: Math.floor(Math.random() * AVATARS) })),
    custs: [],
    served: 0,
    total: orders.length,
    boosters: { hint: 2, shuffle: 1, slot: 1 },
    pending: Promise.resolve(),
    jobs: 0,
    over: false,
    paused: false,
  };
  render();
}

// ---------------- rendering ----------------
function render() {
  $('#lvl').textContent = `Level ${level}`;
  $('#overlay').classList.add('hidden');
  layer.innerHTML = '';
  table.innerHTML = '';
  $('#customers').innerHTML = '';
  S.custs = CUST_X.map((x) => {
    const el = document.createElement('div');
    el.className = 'cust empty';
    el.style.left = `${x}px`;
    el.innerHTML = '<div class="shadow"></div><div class="body"></div><img class="head" alt=""><div class="bubble"><img alt=""></div><img class="tick" src="assets/ui/icon_tick.png" alt="">';
    $('#customers').appendChild(el);
    return { el, order: null, busy: false };
  });
  S.plates.forEach((p, i) => buildPlate(p, i));
  layoutPlates();
  updateHud();
  renderQueue();
  S.custs.forEach((c, i) => setTimeout(() => nextCustomer(c), 250 + i * 160));
}

function renderQueue() {
  const row = $('#queue-row');
  row.innerHTML = '';
  S.queue.slice(0, CUST_X.length).forEach((q, i) => {
    const g = document.createElement('div');
    g.className = 'ghost';
    g.style.left = `${CUST_X[i] + (i % 2 ? 6 : -6)}px`;
    g.style.top = '150px';
    g.innerHTML = `<img src="assets/cust/${q.avatar}.png" alt=""><div class="body"></div>`;
    row.appendChild(g);
  });
}

function buildPlate(p, idx) {
  const el = document.createElement('div');
  el.className = 'plate spawn';
  p.el = el;
  p.slots.forEach((s) => {
    const img = document.createElement('img');
    img.className = 'item'; img.src = ingSrc(s.id); img.draggable = false;
    img.addEventListener('pointerdown', (e) => { e.preventDefault(); tapItem(p, s); });
    s.el = img; el.appendChild(img);
  });
  table.appendChild(el);
  setTimeout(() => el.classList.remove('spawn'), 60 + idx * 40);
}

// item positions inside a plate, in units of plate radius
const ITEM_POS = {
  2: [[-0.1, -0.34], [0.1, 0.3]],
  3: [[0, -0.4], [-0.38, 0.26], [0.38, 0.26]],
};
const PLATE_ASPECT = 132 / 140; // dow.png is slightly wider than tall

function drawPlate(p) {
  const h = 2 * p.R * PLATE_ASPECT;
  p.el.style.transform = `translate(${p.x - p.R}px, ${p.y - h / 2}px)`;
}

// Plates float like bubbles: a constant upward pull, damped motion, and
// circle-vs-circle / wall collisions. Vertical distances are measured in plate
// space (y / PLATE_ASPECT) so the slightly flattened plates pack like circles.
const PHYS = { lift: 2200, damping: 3.2, bounce: 0.25, gap: 4, pad: 8, maxV: 1400, iters: 4, substeps: 3 };

function stepPlates(dt) {
  const W = table.clientWidth, ps = S.plates, A = PLATE_ASPECT;
  const h = dt / PHYS.substeps;
  for (let s = 0; s < PHYS.substeps; s++) {
    const damp = Math.exp(-PHYS.damping * h);
    for (const p of ps) {
      p.vy -= PHYS.lift * h;
      p.vx *= damp; p.vy *= damp;
      const v = Math.hypot(p.vx, p.vy);
      if (v > PHYS.maxV) { p.vx *= PHYS.maxV / v; p.vy *= PHYS.maxV / v; }
      p.x += p.vx * h;
      p.y += p.vy * h;
    }
    for (let it = 0; it < PHYS.iters; it++) {
      for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        for (let j = i + 1; j < ps.length; j++) {
          const b = ps[j];
          const dx = b.x - a.x, dy = (b.y - a.y) / A;
          const min = a.R + b.R + PHYS.gap;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d;
          const ma = a.R * a.R, mb = b.R * b.R, wa = mb / (ma + mb), wb = ma / (ma + mb);
          const over = min - d;
          a.x -= nx * over * wa; a.y -= ny * over * wa * A;
          b.x += nx * over * wb; b.y += ny * over * wb * A;
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn < 0) {
            const jimp = (-(1 + PHYS.bounce) * vn) / (1 / ma + 1 / mb);
            a.vx -= (jimp / ma) * nx; a.vy -= (jimp / ma) * ny;
            b.vx += (jimp / mb) * nx; b.vy += (jimp / mb) * ny;
          }
        }
      }
      for (const p of ps) {
        const top = p.R * A + PHYS.pad;
        if (p.y < top) { p.y = top; if (p.vy < 0) p.vy *= -PHYS.bounce; }
        if (p.x < p.R + PHYS.pad) { p.x = p.R + PHYS.pad; if (p.vx < 0) p.vx *= -PHYS.bounce; }
        if (p.x > W - p.R - PHYS.pad) { p.x = W - p.R - PHYS.pad; if (p.vx > 0) p.vx *= -PHYS.bounce; }
      }
    }
  }
  ps.forEach(drawPlate);
}

function layoutPlates() {
  const W = table.clientWidth;
  const gap = 4, pad = 8;
  const placed = [];
  for (const p of S.plates) {
    const r = p.r * W;
    let best = null;
    // drop each plate in at the highest spot it can float up to without overlapping
    for (let x = r + pad; x <= W - r - pad + 0.01; x += 3) {
      let y = r + pad;
      for (const q of placed) {
        const R = r + q.R + gap, dx = Math.abs(x - q.x);
        if (dx < R) y = Math.max(y, q.y + Math.sqrt(R * R - dx * dx) * PLATE_ASPECT);
      }
      const score = y + Math.abs(x - (r + pad + p.px * (W - 2 * r - 2 * pad))) * 0.12;
      if (!best || score < best.score) best = { x, y, score };
    }
    p.x = best.x; p.y = best.y; p.R = r;
    p.vx = p.vy = 0;
    placed.push(p);

    const el = p.el, h = 2 * r * PLATE_ASPECT;
    el.style.width = `${2 * r}px`;
    el.style.height = `${h}px`;
    drawPlate(p);
    const pos = ITEM_POS[p.slots.length];
    const size = r * (p.slots.length === 3 ? 0.8 : 0.92);
    const cy = h * 0.46; // centre of the plate's top face (rim is drawn below)
    p.slots.forEach((s, i) => {
      s.el.style.width = s.el.style.height = `${size}px`;
      s.el.style.left = `${r + pos[i][0] * r}px`;
      s.el.style.top = `${cy + pos[i][1] * r}px`;
    });
  }
}

// ---------------- conveyor ----------------
// point on the belt lane for loop parameter u (0..1), in game coordinates
function beltPoint(u) {
  const { cl, cr, cy, r } = BELT;
  const L = cr - cl, A = Math.PI * r, P = 2 * L + 2 * A;
  let d = (((u % 1) + 1) % 1) * P, x, y;
  if (d < L) { x = cr - d; y = cy - r; }
  else if ((d -= L) < A) { const t = d / r; x = cl - r * Math.sin(t); y = cy - r * Math.cos(t); }
  else if ((d -= A) < L) { x = cl + d; y = cy + r; }
  else { d -= L; const t = d / r; x = cr + r * Math.sin(t); y = cy + r * Math.cos(t); }
  return { x: BELT.x + (x * BELT.w) / BELT.imgW, y: BELT.y + (y * BELT.h) / BELT.imgH };
}

function beltItemEl(kind, id) {
  const el = document.createElement('div');
  el.className = `bi ${kind}`;
  if (kind === 'ing') el.style.setProperty('--c', ING_COLOR[id]);
  el.innerHTML = `<div class="disc"></div><img src="${kind === 'ing' ? ingSrc(id) : dishSrc(id)}" alt="">`;
  layer.appendChild(el);
  return el;
}

const ITEM_HALF = 27, ITEM_LIFT = 34; // .bi is 54x54; the plate disc sits on the lane

// chevrons painted on the belt surface, travelling with it to show the direction
const arrows = Array.from({ length: BELT_ARROWS }, () => {
  const a = document.createElement('div');
  a.className = 'arrow';
  beltEl.appendChild(a);
  return a;
});

function drawArrows(offset) {
  arrows.forEach((a, k) => {
    const u = offset + (k + 0.5) / BELT_ARROWS;
    const p = beltPoint(u), q = beltPoint(u + 0.002);
    const deg = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    // .arrow is a top-left corner; rotating by 135° makes it point along +x
    a.style.transform = `translate(${p.x - BELT.x}px, ${p.y - BELT.y}px) rotate(${deg + 135}deg)`;
  });
}

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S && !S.paused) {
    S.offset += dt * BELT_SPEED;
    stepPlates(dt);
    drawArrows(S.offset);
    // slots stay put while a merge is resolving so the dish appears where the middle item was
    const ease = now < S.holdUntil ? 0 : Math.min(1, dt * 7);
    S.belt.forEach((b, i) => {
      b.pos += (i - b.pos) * ease;
      const p = beltPoint(S.offset - b.pos / S.cap);
      b.x = p.x - ITEM_HALF; b.y = p.y - ITEM_LIFT; b.s = 1;
      b.z = Math.round(p.y);
      if (b.fly) {
        const t = Math.min(1, (now - b.fly.t0) / b.fly.dur), e = 1 - (1 - t) ** 3;
        b.x = b.fly.x + (b.x - b.fly.x) * e;
        b.y = b.fly.y + (b.y - b.fly.y) * e - Math.sin(t * Math.PI) * 60;
        b.s = b.fly.s + (1 - b.fly.s) * e;
        b.z = 50;
        if (t >= 1) b.fly = null;
      }
    });
    // outer items of a merging trio slide into the middle one as it rides the belt
    S.belt.forEach((b) => {
      if (!b.merge) return;
      const t = Math.min(1, (now - b.merge.t0) / b.merge.dur), e = t * t;
      b.x += (b.merge.into.x - b.x) * e;
      b.y += (b.merge.into.y - b.y) * e;
      b.s = 1 - 0.3 * e;
      b.z = b.merge.into.z + 1;
    });
    S.belt.forEach((b) => {
      b.el.style.transform = `translate(${b.x}px, ${b.y}px) scale(${b.s})`;
      b.el.style.zIndex = b.z;
    });
  }
  requestAnimationFrame(tick);
}

function updateBeltHud() {
  $('#belt-count').textContent = `${S.belt.length}/${S.cap}`;
  beltEl.classList.toggle('danger', S.belt.length >= S.cap - 1);
}

function updateHud() {
  $('#qcount').textContent = S.total - S.served;
  updateBeltHud();
  document.querySelectorAll('.booster').forEach((b) => {
    const n = S.boosters[b.dataset.b];
    b.querySelector('.cnt').textContent = n;
    b.classList.toggle('off', n <= 0);
  });
}

function burst(x, y, size, src = 'assets/ui/click_effect.png') {
  const b = document.createElement('img');
  b.className = 'burst'; b.src = src;
  b.style.left = `${x}px`; b.style.top = `${y}px`; b.style.width = `${size}px`;
  b.style.zIndex = 60;
  layer.appendChild(b);
  setTimeout(() => b.remove(), 500);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1200);
}

// ---------------- customers ----------------
function nextCustomer(c) {
  if (S.over) return;
  const next = S.queue.shift();
  renderQueue();
  if (!next) { c.order = null; c.el.classList.add('empty'); return; }
  c.order = next.id; c.busy = false;
  const el = c.el;
  el.classList.remove('empty', 'happy', 'leave');
  el.querySelector('.head').src = `assets/cust/${next.avatar}.png`;
  el.querySelector('.bubble').style.setProperty('--c', ING_COLOR[next.id]);
  el.querySelector('.bubble img').src = dishSrc(next.id);
  el.style.transition = 'none';
  el.classList.add('enter');
  el.offsetWidth;
  el.style.transition = '';
  el.classList.remove('enter');
  updateHud();
}

// ---------------- gameplay ----------------
function tapItem(plate, slot) {
  if (S.over || S.paused || slot.taken) return;
  if (S.belt.length >= S.cap) { toast('Băng chuyền đầy!'); return; }
  slot.taken = true;
  sfx.tap();
  clearHints();

  const from = rel(slot.el);
  slot.el.style.visibility = 'hidden';
  slot.el.style.pointerEvents = 'none';

  // insert right behind identical ingredients
  let at = S.belt.length;
  for (let i = S.belt.length - 1; i >= 0; i--) {
    if (S.belt[i].kind === 'ing' && S.belt[i].id === slot.id) { at = i + 1; break; }
  }
  const el = beltItemEl('ing', slot.id);
  const entry = {
    kind: 'ing', id: slot.id, el, pos: at,
    fly: { x: from.x + from.w / 2 - ITEM_HALF, y: from.y - 6, s: from.w / 40, t0: performance.now(), dur: 380 },
  };
  S.belt.splice(at, 0, entry);
  updateBeltHud();

  // empty plate disappears, the rest float up
  if (plate.slots.every((s) => s.taken)) {
    S.plates.splice(S.plates.indexOf(plate), 1);
    plate.el.classList.add('vanish');
    sfx.plate();
    setTimeout(() => plate.el.remove(), 300);
  }

  S.jobs++;
  S.pending = S.pending.then(resolve);
}

async function resolve() {
  await wait(400);
  if (S.over) return;
  await doMerges();
  await doServes();
  S.jobs--;
  checkEnd();
}

async function doMerges() {
  let merged = true;
  while (merged && !S.over) {
    merged = false;
    for (let i = 0; i + 2 < S.belt.length; i++) {
      const trio = S.belt.slice(i, i + 3);
      if (trio.every((t) => t.kind === 'ing' && t.id === trio[0].id && !t.fly && !t.merging)) {
        await mergeAt(i);
        merged = true;
        break;
      }
    }
  }
}

// detach a belt item from the rAF loop and animate it with CSS instead
function release(b, x, y, s, ms) {
  b.el.style.transition = `transform ${ms}ms cubic-bezier(.5,-0.2,.4,1.1), opacity ${ms}ms`;
  b.el.style.zIndex = 60;
  b.el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
}

async function mergeAt(i) {
  const [a, mid, c] = S.belt.slice(i, i + 3);
  const MERGE_MS = 240;
  S.holdUntil = Infinity;
  mid.merging = true;
  [a, c].forEach((t) => { t.merging = true; t.merge = { into: mid, t0: performance.now(), dur: MERGE_MS }; });
  await wait(MERGE_MS);

  // the middle entry becomes the dish in place; the outer two vanish
  a.el.remove(); c.el.remove();
  S.belt.splice(S.belt.indexOf(a), 1);
  S.belt.splice(S.belt.indexOf(c), 1);
  mid.el.remove();
  mid.el = beltItemEl('dish', mid.id);
  mid.el.classList.add('pop');
  mid.kind = 'dish';
  mid.merging = false;
  mid.el.style.transform = `translate(${mid.x}px, ${mid.y}px)`;
  burst(mid.x + ITEM_HALF, mid.y + ITEM_HALF, 120);
  sfx.merge();
  updateBeltHud();
  // let the dish pop where it was made, then close the gap
  S.holdUntil = performance.now() + 350;
  await wait(450);
}

async function doServes() {
  let served = true;
  while (served && !S.over) {
    served = false;
    for (let i = 0; i < S.belt.length; i++) {
      const b = S.belt[i];
      if (b.kind !== 'dish') continue;
      const c = S.custs.find((c) => c.order === b.id && !c.busy);
      if (!c) continue;
      c.busy = true;
      S.belt.splice(i, 1);
      updateBeltHud();
      serve(b, c);
      served = true;
      await wait(150);
      break;
    }
  }
}

async function serve(b, c) {
  const r = rel(c.el.querySelector('.bubble'));
  release(b, r.x + r.w / 2 - ITEM_HALF, r.y + r.h / 2 - ITEM_HALF, 0.8, 450);
  await wait(450);
  b.el.remove();
  burst(r.x + r.w / 2, r.y + r.h / 2, 120);
  sfx.serve();
  c.el.classList.add('happy');
  S.served++;
  updateHud();
  await wait(550);
  c.el.classList.add('leave');
  await wait(380);
  c.order = null;
  nextCustomer(c);
  checkEnd();
  // a newly arrived customer may already have a dish waiting
  if (!S.over) { S.jobs++; S.pending = S.pending.then(async () => { await doServes(); S.jobs--; checkEnd(); }); }
}

function checkEnd() {
  if (S.over) return;
  if (S.served >= S.total) { S.over = true; setTimeout(win, 500); return; }
  if (S.jobs === 0 && S.belt.length >= S.cap && !S.custs.some((c) => c.busy)) {
    S.over = true; setTimeout(lose, 400);
  }
}

// ---------------- overlays ----------------
function showOverlay(kind, msg, btn, alt) {
  const card = $('#overlay .card');
  card.className = `card ${kind}`;
  card.querySelector('.title-img').src = kind === 'win' ? 'assets/ui/youwin.png' : 'assets/ui/failed.png';
  card.querySelector('.title-txt').textContent = 'Tạm dừng';
  card.querySelector('.msg').textContent = msg;
  $('#btn-next').textContent = btn;
  $('#btn-alt').textContent = alt || '';
  $('#overlay').classList.remove('hidden');
  card.style.animation = 'none'; card.offsetWidth; card.style.animation = '';
}

function win() {
  sfx.win();
  showOverlay('win', `Đã phục vụ ${S.total} khách!`, 'Level tiếp');
  $('#btn-next').onclick = () => {
    level++;
    try { localStorage.setItem('fs_level', level); } catch (e) {}
    newLevel();
  };
}

function lose() {
  sfx.lose();
  showOverlay('lose', 'Băng chuyền đã đầy!', 'Chơi lại');
  $('#btn-next').onclick = newLevel;
}

$('#btn-settings').addEventListener('click', () => {
  if (S.over) return;
  S.paused = true;
  showOverlay('pause', `Level ${level} · còn ${S.total - S.served} khách`, 'Tiếp tục', 'Chơi lại');
  $('#btn-next').onclick = () => { S.paused = false; last = performance.now(); $('#overlay').classList.add('hidden'); };
  $('#btn-alt').onclick = newLevel;
});

// ---------------- boosters ----------------
function clearHints() { document.querySelectorAll('.item.hint').forEach((e) => e.classList.remove('hint')); }

const BOOSTERS = {
  hint() {
    // prefer finishing a triple already on the belt, else a waiting order
    const counts = {};
    S.belt.forEach((b) => { if (b.kind === 'ing') counts[b.id] = (counts[b.id] || 0) + 1; });
    const onPlates = (id) => S.plates.flatMap((p) => p.slots).filter((s) => !s.taken && s.id === id);
    let id = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a])
      .find((k) => onPlates(k).length >= 3 - counts[k]);
    if (id === undefined) id = S.custs.map((c) => c.order).find((o) => o && onPlates(o).length >= 3);
    if (id === undefined) return false;
    const need = 3 - (counts[id] || 0);
    const bottom = table.getBoundingClientRect().bottom;
    onPlates(id).sort((a, b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top)
      .slice(0, need).forEach((s) => { if (s.el.getBoundingClientRect().top < bottom) s.el.classList.add('hint'); });
    return true;
  },
  shuffle() {
    const slots = S.plates.flatMap((p) => p.slots).filter((s) => !s.taken);
    if (slots.length < 2) return false;
    const ids = shuffle(slots.map((s) => s.id));
    slots.forEach((s, i) => { s.id = ids[i]; s.el.src = ingSrc(s.id); s.el.animate([{ scale: 0.3 }, { scale: 1 }], 300); });
    // jostle the plates; physics lets them settle again
    S.plates.forEach((p) => { p.vx += rand(-500, 500); p.vy += rand(100, 500); });
    return true;
  },
  slot() {
    S.cap++;
    updateBeltHud();
    return true;
  },
};

document.querySelectorAll('.booster').forEach((btn) => {
  btn.addEventListener('click', () => {
    const k = btn.dataset.b;
    if (S.over || S.paused || S.boosters[k] <= 0) return;
    clearHints();
    if (BOOSTERS[k]()) { S.boosters[k]--; sfx.merge(); updateHud(); }
    else toast('Không dùng được lúc này');
  });
});

window.addEventListener('resize', fit);
fit();
newLevel();
requestAnimationFrame(tick);
