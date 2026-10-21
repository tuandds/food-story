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

  const plates = plateItems.map((ids) => ({
    r: ids.length === 3 ? rand(0.145, 0.165) : rand(0.112, 0.128), // fraction of table width
    px: Math.random(),
    slots: ids.map((id) => ({ id })),
    el: null,
  }));
  addFeatures(plates);
  const queue = orderQueue(orders, plates);
  const hidden = plates.find((p) => p.hidden);
  if (hidden) {
    // reveal after a few serves that never depend on what is under the cover
    const free = queue.filter((q) => !q.blocked).length;
    if (free > 0) hidden.hidden = Math.min(3, free);
    else delete hidden.hidden;
  }

  if (S) S.belt.forEach((b) => b.el.remove());
  S = {
    cap: BASE_CAP,
    // The belt is a ring of fixed slots rotating together; items keep their slot until
    // they leave, so gaps stay where they are.
    slots: new Array(BASE_CAP).fill(null),
    belt: [], // occupied entries {kind:'ing'|'dish', id, el, slot, rel, fly}
    offset: 0, // how far the ring has turned, in loops
    plates,
    queue,
    ropes: [], // Food Link ropes travelling with their pair to the belt
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

// ---------------- level features ----------------
// Each feature starts at its level and stays in every later level.
const FEATURES = [
  { key: 'hidden', level: 3, name: 'Hidden Dish' },
  { key: 'link', level: 5, name: 'Food Link' },
  { key: 'locked', level: 8, name: 'Locked Dish' },
];
const hasFeature = (key) => level >= FEATURES.find((f) => f.key === key).level;

function addFeatures(plates) {
  // feature plates come from the first few, which the packing puts near the top
  const pool = shuffle(plates.slice(0, Math.min(6, plates.length)));
  const take = (ok = () => true) => {
    const i = pool.findIndex(ok);
    return i < 0 ? null : pool.splice(i, 1)[0];
  };
  if (hasFeature('locked') && pool.length >= 2) {
    take().locked = true;
    take().key = true;
  }
  if (hasFeature('hidden')) {
    const p = take();
    if (p) p.hidden = 1; // real count is set once the order queue is known
  }
  if (hasFeature('link')) {
    const p = take((q) => q.slots.length >= 2) || plates.find((q) => q.slots.length >= 2 && !q.hidden && !q.locked);
    if (p) {
      const [a, b] = shuffle(p.slots.slice());
      a.link = b; b.link = a;
    }
  }
}

// Orders that need an ingredient sealed under a cover or dome go to the back of the
// queue, so the customers up front can always be served first.
function orderQueue(orders, plates) {
  const sealed = {};
  plates.filter((p) => p.hidden || p.locked).forEach((p) => p.slots.forEach((s) => { sealed[s.id] = (sealed[s.id] || 0) + 1; }));
  const total = {};
  orders.forEach((id) => { total[id] = (total[id] || 0) + 1; });
  const ready = {};
  Object.keys(total).forEach((id) => { ready[id] = Math.min(total[id], Math.floor((total[id] * 3 - (sealed[id] || 0)) / 3)); });
  const front = [], back = [];
  orders.forEach((id) => {
    const q = { id, avatar: Math.floor(Math.random() * AVATARS) };
    if (ready[id] > 0) { ready[id]--; front.push(q); } else { q.blocked = true; back.push(q); }
  });
  return front.concat(back);
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
  const intro = FEATURES.find((f) => f.level === level);
  if (intro) setTimeout(() => toast(`Tính năng mới: ${intro.name}`), 900);
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
  if (p.key) {
    p.keyEl = document.createElement('div');
    p.keyEl.className = 'keymark';
    p.keyEl.innerHTML = KEY_SVG;
    el.appendChild(p.keyEl);
  }
  const linked = p.slots.find((s) => s.link);
  if (linked) {
    const rope = document.createElement('img');
    rope.className = 'rope'; rope.src = 'assets/ui/link.png'; rope.draggable = false;
    linked.rope = linked.link.rope = rope;
    el.appendChild(rope);
  }
  p.slots.forEach((s) => {
    const img = document.createElement('img');
    img.className = 'item'; img.src = ingSrc(s.id); img.draggable = false;
    img.addEventListener('pointerdown', (e) => { e.preventDefault(); tapItem(p, s); });
    s.el = img; el.appendChild(img);
  });
  if (p.hidden || p.locked) {
    p.cover = document.createElement('div');
    p.cover.className = p.locked ? 'cover dome' : 'cover cloche';
    p.cover.innerHTML = p.locked
      ? '<img src="assets/ui/locked_dome.png" alt="">'
      : `<img src="assets/ui/cloche.png" alt=""><div class="tag"><span>${p.hidden}</span></div>`;
    p.cover.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      p.cover.animate([{ rotate: '0deg' }, { rotate: '-6deg' }, { rotate: '6deg' }, { rotate: '0deg' }], 300);
      toast(p.locked ? 'Dọn đĩa có chìa khóa để mở!' : `Phục vụ thêm ${p.hidden} khách để mở!`);
    });
    el.appendChild(p.cover);
  }
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
  // position via the `translate` property so CSS `scale` animations stay centred on the element
  p.el.style.translate = `${p.x - p.R}px ${p.y - h / 2}px`;
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
      s.ix = r + pos[i][0] * r; s.iy = cy + pos[i][1] * r;
      s.el.style.width = s.el.style.height = `${size}px`;
      s.el.style.left = `${s.ix}px`;
      s.el.style.top = `${s.iy}px`;
    });
    const linked = p.slots.find((s) => s.rope && !s.taken);
    if (linked) placeRope(linked.rope, linked.ix, linked.iy, linked.link.ix, linked.link.iy, size * 0.3);
    if (p.keyEl) p.keyEl.style.width = p.keyEl.style.height = `${r * 0.75}px`;
    if (p.cover) {
      p.cover.style.width = `${2 * r * 1.06}px`;
      p.cover.style.left = `${-r * 0.06}px`;
    }
  }
}

// stretch the link sprite (drawn vertically) between two points
function placeRope(el, x1, y1, x2, y2, width) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI - 90;
  el.style.width = `${width}px`;
  el.style.height = `${len}px`;
  el.style.left = `${(x1 + x2) / 2 - width / 2}px`;
  el.style.top = `${(y1 + y2) / 2 - len / 2}px`;
  el.style.transform = `rotate(${deg}deg)`;
}

const KEY_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><g fill="#ffcc2e" stroke="#9a5b00" stroke-width="5" stroke-linejoin="round">
<circle cx="30" cy="34" r="20"/><path d="M44 47 L84 87 L76 95 L69 88 L62 95 L55 88 L62 81 L36 55 Z"/></g>
<circle cx="30" cy="34" r="8" fill="#9a5b00"/><path d="M18 26 a14 14 0 0 1 14 -8" fill="none" stroke="#fff6c0" stroke-width="4" stroke-linecap="round"/></svg>`;

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
    // rel only changes when the ring is re-spaced by the +1 slot booster
    const ease = Math.min(1, dt * 7);
    S.belt.forEach((b) => {
      b.rel += (b.slot / S.cap - b.rel) * ease;
      const p = beltPoint(S.offset - b.rel);
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
      b.el.style.translate = `${b.x}px ${b.y}px`;
      b.el.style.transform = `scale(${b.s})`;
      b.el.style.zIndex = b.z;
    });
    S.ropes = S.ropes.filter((r) => {
      const ax = r.a.x + ITEM_HALF, ay = r.a.y + 20, bx = r.b.x + ITEM_HALF, by = r.b.y + 20;
      placeRope(r.el, ax, ay, bx, by, 16);
      if (r.a.fly || r.b.fly) return true;
      r.el.classList.add('snap');
      beep(900, 0.05, 'square', 0.05);
      setTimeout(() => r.el.remove(), 350);
      return false;
    });
    passServes();
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
  if (S.over || S.paused || slot.taken || plate.hidden || plate.locked) return;
  // a Food Link pair always travels together
  const group = slot.link && !slot.link.taken ? [slot, slot.link] : [slot];
  if (S.cap - S.belt.length < group.length) { toast(group.length > 1 ? 'Cần 2 ô trống!' : 'Băng chuyền đầy!'); return; }
  sfx.tap();
  clearHints();

  const entries = group.map((s) => launch(s));
  if (entries.length === 2) {
    // the rope leaves the plate with the pair and snaps once both are on the belt
    const rope = slot.rope;
    rope.remove();
    rope.className = 'rope flying';
    layer.appendChild(rope);
    S.ropes.push({ el: rope, a: entries[0], b: entries[1] });
  }
  updateBeltHud();

  // empty plate disappears, the rest float up
  if (plate.slots.every((s) => s.taken)) {
    S.plates.splice(S.plates.indexOf(plate), 1);
    plate.el.classList.add('vanish');
    sfx.plate();
    if (plate.key) releaseKey(plate);
    setTimeout(() => plate.el.remove(), 300);
  }

  S.jobs++;
  S.pending = S.pending.then(resolve);
}

function launch(slot) {
  slot.taken = true;
  const from = rel(slot.el);
  slot.el.style.visibility = 'hidden';
  slot.el.style.pointerEvents = 'none';
  const k = pickSlot(slot.id, from.x + from.w / 2, from.y + from.h / 2);
  const entry = {
    kind: 'ing', id: slot.id, el: beltItemEl('ing', slot.id), slot: k, rel: k / S.cap,
    fly: { x: from.x + from.w / 2 - ITEM_HALF, y: from.y - 6, s: from.w / 40, t0: performance.now(), dur: 380 },
  };
  S.slots[k] = entry;
  S.belt.push(entry);
  return entry;
}

// Locked Dish: the key printed on a cleared plate flies to the nearest locked plate
async function releaseKey(plate) {
  const from = rel(plate.keyEl);
  const locks = S.plates.filter((p) => p.locked && !p.unlocking);
  if (!locks.length) return;
  const target = locks.reduce((a, b) => (Math.hypot(a.x - plate.x, a.y - plate.y) < Math.hypot(b.x - plate.x, b.y - plate.y) ? a : b));
  target.unlocking = true;
  const key = document.createElement('div');
  key.className = 'key-fly';
  key.innerHTML = KEY_SVG;
  key.style.width = key.style.height = `${from.w}px`;
  key.style.translate = `${from.x}px ${from.y}px`;
  layer.appendChild(key);
  key.animate([{ scale: 1 }, { scale: 1.5 }], { duration: 250, fill: 'forwards' });
  await wait(250);
  const to = rel(target.el);
  key.style.transition = 'translate .55s cubic-bezier(.5,-0.3,.4,1.2), rotate .55s';
  key.style.translate = `${to.x + to.w / 2 - from.w / 2}px ${to.y + to.h * 0.45 - from.h / 2}px`;
  key.style.rotate = '360deg';
  await wait(560);
  key.remove();
  sfx.merge();
  openCover(target);
  target.locked = false;
}

function openCover(p) {
  const r = rel(p.el);
  burst(r.x + r.w / 2, r.y + r.h / 2, r.w * 1.6);
  p.cover.classList.add('open');
  setTimeout(() => { p.cover.remove(); p.cover = null; }, 450);
}

// Hidden Dish: every serve counts the cover down; at 0 it lifts
function countDownHidden() {
  S.plates.forEach((p) => {
    if (!p.hidden) return;
    p.hidden--;
    const tag = p.cover.querySelector('.tag span');
    tag.textContent = p.hidden;
    tag.parentElement.animate([{ scale: 1.4 }, { scale: 1 }], 300);
    if (p.hidden === 0) openCover(p);
  });
}

const ringDist = (a, b) => { const d = Math.abs(a - b) % S.cap; return Math.min(d, S.cap - d); };

// Empty slot for a new ingredient: as close as possible to its twins on the ring,
// otherwise the free slot currently nearest to where it was tapped.
function pickSlot(id, x, y) {
  const twins = S.belt.filter((b) => b.kind === 'ing' && b.id === id && !b.merging).map((b) => b.slot);
  let best = -1, bestScore = Infinity;
  S.slots.forEach((occ, k) => {
    if (occ) return;
    const p = beltPoint(S.offset - k / S.cap);
    const near = twins.length ? Math.min(...twins.map((t) => ringDist(t, k))) : 0;
    const score = near * 1e4 + Math.hypot(p.x - x, p.y - y);
    if (score < bestScore) { bestScore = score; best = k; }
  });
  return best;
}

function vacate(b) {
  S.slots[b.slot] = null;
  S.belt.splice(S.belt.indexOf(b), 1);
}

async function resolve() {
  await wait(400);
  if (S.over) return;
  await doMerges();
  S.jobs--;
  checkEnd();
}

async function doMerges() {
  let merged = true;
  while (merged && !S.over) {
    merged = false;
    // any three landed copies of an ingredient merge, wherever they sit on the ring
    const groups = {};
    S.belt.forEach((b) => { if (b.kind === 'ing' && !b.fly && !b.merging) (groups[b.id] ||= []).push(b); });
    const trio = Object.values(groups).find((g) => g.length >= 3);
    if (trio) { await mergeTrio(trio.slice(0, 3)); merged = true; }
  }
}

// detach a belt item from the rAF loop and animate it with CSS instead
function release(b, x, y, s, ms) {
  b.el.style.transition = `translate ${ms}ms cubic-bezier(.5,-0.2,.4,1.1), transform ${ms}ms, opacity ${ms}ms`;
  b.el.style.zIndex = 60;
  b.el.style.translate = `${x}px ${y}px`;
  b.el.style.transform = `scale(${s})`;
}

async function mergeTrio(trio) {
  // the middle one along the ring stays put and becomes the dish
  const cost = (t) => trio.reduce((sum, o) => sum + ringDist(t.slot, o.slot), 0);
  const mid = trio.reduce((m, t) => (cost(t) < cost(m) ? t : m));
  const [a, c] = trio.filter((t) => t !== mid);
  const MERGE_MS = 240;
  mid.merging = true;
  [a, c].forEach((t) => { t.merging = true; t.merge = { into: mid, t0: performance.now(), dur: MERGE_MS }; });
  await wait(MERGE_MS);

  // the middle entry becomes the dish in place; the outer two vanish
  a.el.remove(); c.el.remove();
  vacate(a); vacate(c);
  mid.el.remove();
  mid.el = beltItemEl('dish', mid.id);
  mid.el.classList.add('pop');
  mid.kind = 'dish';
  mid.merging = false;
  mid.el.style.translate = `${mid.x}px ${mid.y}px`;
  burst(mid.x + ITEM_HALF, mid.y + ITEM_HALF, 120);
  sfx.merge();
  updateBeltHud();
  await wait(350);
}

// Dishes ride the belt; one is handed over only as it passes under the customer who ordered it.
const TOP_LANE_Y = BELT.y + ((BELT.cy - BELT.r) * BELT.h) / BELT.imgH;
const SERVE_REACH = 8; // px either side of the customer's column

function passServes() {
  if (S.over) return;
  for (let i = 0; i < S.belt.length; i++) {
    const b = S.belt[i];
    if (b.kind !== 'dish' || b.fly || b.merging) continue;
    const cx = b.x + ITEM_HALF, cy = b.y + ITEM_LIFT;
    if (Math.abs(cy - TOP_LANE_Y) > 4) continue;
    const c = S.custs.find((c, k) => c.order === b.id && !c.busy && Math.abs(cx - CUST_X[k]) < SERVE_REACH);
    if (!c) continue;
    c.busy = true;
    vacate(b);
    updateBeltHud();
    serve(b, c);
    return;
  }
}

// a dish on the belt that some visible customer is waiting for will be served on its next pass
const servePending = () => S.belt.some((b) => b.kind === 'dish' && S.custs.some((c) => c.order === b.id && !c.busy));

async function serve(b, c) {
  const r = rel(c.el.querySelector('.bubble'));
  release(b, r.x + r.w / 2 - ITEM_HALF, r.y + r.h / 2 - ITEM_HALF, 0.8, 450);
  await wait(450);
  b.el.remove();
  burst(r.x + r.w / 2, r.y + r.h / 2, 120);
  sfx.serve();
  c.el.classList.add('happy');
  S.served++;
  countDownHidden();
  updateHud();
  await wait(550);
  c.el.classList.add('leave');
  await wait(380);
  c.order = null;
  nextCustomer(c);
  checkEnd();
}

function checkEnd() {
  if (S.over) return;
  if (S.served >= S.total) { S.over = true; setTimeout(win, 500); return; }
  if (S.jobs === 0 && S.belt.length >= S.cap && !S.custs.some((c) => c.busy) && !servePending()) {
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
    const onPlates = (id) => S.plates.filter((p) => !p.hidden && !p.locked).flatMap((p) => p.slots).filter((s) => !s.taken && s.id === id);
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
    // covered plates and linked pairs keep their contents
    const slots = S.plates.filter((p) => !p.hidden && !p.locked).flatMap((p) => p.slots).filter((s) => !s.taken && !s.link);
    if (slots.length < 2) return false;
    const ids = shuffle(slots.map((s) => s.id));
    slots.forEach((s, i) => { s.id = ids[i]; s.el.src = ingSrc(s.id); s.el.animate([{ scale: 0.3 }, { scale: 1 }], 300); });
    // jostle the plates; physics lets them settle again
    S.plates.forEach((p) => { p.vx += rand(-500, 500); p.vy += rand(100, 500); });
    return true;
  },
  slot() {
    // a new empty slot joins the ring; items glide to the new spacing
    S.cap++;
    S.slots.push(null);
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
