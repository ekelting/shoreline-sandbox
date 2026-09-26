// Shoreline Sandbox: one-line shoreline model with groins, breakwaters, seawalls,
// rivers, nourishment, storms, sea-level rise and shorebird nesting. See README.md.
(() => {
'use strict';
// ---------- constants ----------
const g = 9.81, GAMMA = 0.78, SM1 = 1.585, POR = 0.4, SEC = 3.156e7, BERM = 2, TANB = 0.03;
const W_CS = 250, KE = 150, KA = 8;          // cross-shore: response width (m), erosion / recovery rates (1/yr)
const XL = 1500, YL = 700, DX = 10, N = XL / DX, Y0 = 180, DUNE_TOE = 70, STEM_ROOT = 52;
const HOUSES = Array.from({ length: 15 }, (_, i) => 50 + i * 100);
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Illustrative monthly offshore climate for an east-facing Gulf of Maine beach: [H0 m, T s, angle deg (+ = from north/left)]
const CLIMATE = [[1.3,8.5,15],[1.4,9,20],[1.2,8.5,12],[1.0,8,2],[0.8,7.5,-10],[0.6,7,-20],[0.6,7,-22],[0.6,7.5,-18],[0.8,8.5,-8],[1.0,8.5,5],[1.2,8.5,12],[1.3,8.5,15]];
const SEASONS = { winter: [11,0,1], spring: [2,3,4], summer: [5,6,7], fall: [8,9,10] };
const STORMS = {
  noreaster: { name: "Nor'easter", H0: 4.5, T: 11, th: 24, surge: 0.9, days: 3 },
  tropical:  { name: 'Tropical storm', H0: 4.0, T: 13, th: -28, surge: 0.6, days: 2 }
};
const COL = { groin: '#d95926', jetty: '#d95926', tgroin: '#d95926', breakwater: '#8a55c9', seawall: '#7a8790', river: '#1fa37a', fill: '#1fa37a', storm: '#c98500', slr: '#1690a0', drift: '#2f78d6' };
const START_MONTH = 8; // September

// ---------- state ----------
const S = {
  t: 0, yls: new Float64Array(N), ycs: new Float64Array(N), structures: [], fills: [], sandAdded: 0,
  storm: null, storms: 0, mode: 'cycle', H0: 1, T: 8.5, th: 0, slr: 2, eta: 0, speed: 1 / 30, playing: false,
  K1: 0.2, d50: 0.3, hstar: 8, normal: 90, turn: 0, expo: 1, place: 'generic', houses: HOUSES.map(x => ({ x, gone: false })), riverW: 60, critters: [], nests: [], fledged: 0, lastMonth: -1, vol: 200000, tool: 'inspect', nextId: 1, placed: false, lastSurge: 0
};
const y = new Float64Array(N), Hc = new Float64Array(N), Kd = new Float64Array(N), Q = new Float64Array(N + 1);
let W = null; // current waves (breaking info)

const Aprof = () => 0.21 * Math.pow(S.d50, 0.48);
const Dact = () => S.hstar + BERM;
const Wstar = () => Math.pow(S.hstar / Aprof(), 1.5);
const a1f = () => S.K1 / (16 * SM1 * (1 - POR) * Math.pow(1.416, 2.5));
const a2f = () => 0.8 * S.K1 / (8 * SM1 * (1 - POR) * TANB * Math.pow(1.416, 3.5));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sig = z => 1 / (1 + Math.exp(-z));
const rad = d => d * Math.PI / 180;

// ---------- waves ----------
function monthPos() { return ((START_MONTH + S.t * 12) % 12 + 12) % 12; }
function seasonAvg(key) {
  const m = SEASONS[key]; let H = 0, T = 0, th = 0;
  m.forEach(i => { H += CLIMATE[i][0]; T += CLIMATE[i][1]; th += CLIMATE[i][2]; });
  return { H0: H / 3, T: T / 3, th: th / 3 };
}
function baseWaves() {
  if (S.mode === 'cycle') {
    const mp = monthPos() - 0.5, i = ((Math.floor(mp) % 12) + 12) % 12, j = (i + 1) % 12, f = mp - Math.floor(mp);
    const a = CLIMATE[i], b = CLIMATE[j];
    return { H0: a[0] + (b[0] - a[0]) * f, T: a[1] + (b[1] - a[1]) * f, th: a[2] + (b[2] - a[2]) * f };
  }
  if (SEASONS[S.mode]) return seasonAvg(S.mode);
  return { H0: S.H0, T: S.T, th: S.th };
}
// climate angles are stored for an east-facing beach; rotate them to this site's shoreline,
// apply the bay's wave turning, and scale heights by the site's exposure
const siteTh = th => clamp(th + (S.normal - 90) - S.turn, -80, 80);
function siteBase() {
  if (S.mode === 'custom') return { H0: S.H0, T: S.T, th: S.th };
  const b = baseWaves(); return { H0: b.H0 * S.expo, T: b.T, th: siteTh(b.th) };
}
function currentWaves() {
  const b = siteBase(); let H0 = b.H0, T = b.T, th = b.th, surge = 0, sf = 0;
  if (S.storm) {
    const tau = (S.t - S.storm.t0) / S.storm.dur;
    if (tau >= 1) { S.storm = null; onStormEnd(); }
    else {
      const d = S.storm.def; sf = Math.pow(Math.sin(Math.PI * clamp(tau, 0, 1)), 1.2);
      const dH = d.H0 * S.expo, dth = siteTh(d.th);
      H0 = b.H0 + (dH - b.H0) * sf; T = b.T + (d.T - b.T) * sf; th = b.th + (dth - b.th) * Math.min(1, sf * 2); surge = d.surge * sf;
    }
  }
  const w = breaking(H0, T, th); w.surge = surge; w.sf = sf; w.H0 = H0; w.thDeg = th;
  return w;
}
function breaking(H0, T, thDeg) {
  const th0 = rad(thDeg), om = 2 * Math.PI / T, C0 = g / om, g5 = Math.pow(g, 0.2);
  let Hb = 0.39 * g5 * Math.pow(T * H0 * H0, 0.4), thb = th0;
  for (let k = 0; k < 4; k++) {
    const Cb = Math.sqrt(g * Hb / GAMMA);
    thb = Math.asin(clamp(Math.sin(th0) * Cb / C0, -0.99, 0.99));
    const Kr = Math.sqrt(Math.cos(th0) / Math.cos(thb));
    Hb = 0.39 * g5 * Math.pow(T * (H0 * Kr) * (H0 * Kr), 0.4);
  }
  return { Hb, thb, th0, hb: Hb / GAMMA, T, om, L0: g * T * T / (2 * Math.PI) };
}

// ---------- structures ----------
const isStem = s => s.type === 'groin' || s.type === 'jetty' || s.type === 'tgroin';
function heads() {
  const out = [];
  for (const s of S.structures) {
    if (s.type === 'breakwater') out.push({ xa: s.x1, xb: s.x2, y: s.y });
    if (s.type === 'tgroin') out.push({ xa: s.x - s.head, xb: s.x + s.head, y: s.tip });
  }
  return out;
}
// wave height reduction factor (diffraction / sheltering) at world point (X, Y)
function shelterAt(X, Y, w, hs) {
  let K = 1;
  const thS = (w.th0 + w.thb) / 2, tn = Math.tan(thS), L = w.L0;
  for (const h of hs) {
    if (h.y <= Y + 1) continue;
    const r = h.y - Y, xi = X - r * tn, wd = 0.3 * Math.sqrt(L * r) + 10;
    const Sh = sig((xi - h.xa) / wd) * sig((h.xb - xi) / wd);
    K *= 1 - 0.85 * Sh;
  }
  if (Math.abs(tn) > 0.02) {
    const at = Math.abs(tn);
    for (const s of S.structures) {
      if (!isStem(s) || Y >= s.tip) continue;
      const dxl = tn > 0 ? X - s.x : s.x - X;
      if (dxl <= 0) continue;
      const yint = Y + dxl / at, r = Math.hypot(dxl, s.tip - Y), wd = 0.3 * Math.sqrt(L * r) + 12;
      K *= 1 - 0.5 * sig((s.tip - yint) / wd) * sig(dxl / 15 - 1);
    }
  }
  return K;
}

// ---------- physics ----------
function totals() { for (let i = 0; i < N; i++) y[i] = S.yls[i] + S.ycs[i]; }
function stableDt(w) {
  const E = w.Hb * w.Hb * Math.sqrt(g * w.Hb / GAMMA);
  const eps = 2 * E * a1f() * SEC / Dact();
  return 0.4 * DX * DX / Math.max(eps, 1);
}
function step(dt, w) {
  const A = Aprof(), Dd = Dact(), a1 = a1f(), a2 = a2f(), hs = heads();
  totals();
  for (let i = 0; i < N; i++) Kd[i] = shelterAt((i + 0.5) * DX, y[i], w, hs);
  for (let i = 0; i < N; i++) { // light alongshore smoothing: diffraction never makes sharper steps than this
    const a = Kd[Math.max(0, i - 1)], b = Kd[Math.min(N - 1, i + 1)];
    Hc[i] = w.Hb * (0.25 * a + 0.5 * Kd[i] + 0.25 * b);
  }
  for (let j = 1; j < N; j++) {
    const Hf = 0.5 * (Hc[j - 1] + Hc[j]), Cg = Math.sqrt(g * Hf / GAMMA), E = Hf * Hf * Cg;
    const phi = Math.atan((y[j] - y[j - 1]) / DX), a = w.thb - phi, dH = (Hc[j] - Hc[j - 1]) / DX;
    const dif = clamp(a2 * Math.cos(a) * dH, -a1, a1);
    Q[j] = E * (a1 * Math.sin(2 * a) - dif) * SEC;
  }
  Q[0] = Q[1]; Q[N] = Q[N - 1];
  for (const s of S.structures) {
    if (!isStem(s)) continue;
    const gi = s.face, ys = 0.5 * (y[gi - 1] + y[gi]), yG = s.tip - ys;
    let byp = 1;
    if (yG > 0) {
      const hbf = Math.max(0.05, 0.5 * (Hc[gi - 1] + Hc[gi]) / GAMMA), yB = Math.pow(hbf / A, 1.5);
      byp = Math.max(0, 1 - yG / yB);
    }
    Q[gi] *= byp; s.byp = byp;
  }
  for (const s of S.structures) {
    if (s.type !== 'seawall') continue;
    for (let i = s.i1; i <= s.i2; i++) {
      const avail = Math.max(0, y[i] - s.y) * Dd * DX / dt;
      const out = Math.max(0, Q[i + 1]) + Math.max(0, -Q[i]), inn = Math.max(0, Q[i]) + Math.max(0, -Q[i + 1]);
      if (out > 0 && out - inn > avail) {
        const f = Math.max(0, (avail + inn) / out);
        if (Q[i + 1] > 0) Q[i + 1] *= f;
        if (Q[i] < 0) Q[i] *= f;
      }
    }
  }
  const c = dt / (Dd * DX);
  for (let i = 0; i < N; i++) S.yls[i] -= c * (Q[i + 1] - Q[i]);
  // rivers: sand is delivered to the beach on both sides of the mouth; a river mouth held
  // between jetties sends its sand out past the jetties instead (it never reaches the beach)
  for (const s of S.structures) if (s.type === 'river') {
    const ch = riverCells(s);
    if (ch.jettied) continue;
    const band = 6, per = s.q * c / (2 * band);
    for (let k = 1; k <= band; k++) { if (ch.i1 - k >= 0) S.yls[ch.i1 - k] += per; if (ch.i2 + k < N) S.yls[ch.i2 + k] += per; }
  }
  if (S.slr > 0) {
    const R = S.slr * 1e-3 * Wstar() / Dd * dt;
    for (let i = 0; i < N; i++) S.yls[i] -= R;
    S.eta += S.slr * 1e-3 * dt;
  }
  for (let i = 0; i < N; i++) {
    const Hl = Hc[i], yeq = -W_CS * (0.068 * Hl + w.surge) / (BERM + 1.28 * Hl);
    const k = yeq < S.ycs[i] ? KE : KA;
    S.ycs[i] = yeq + (S.ycs[i] - yeq) * Math.exp(-k * dt);
  }
  // constraints
  for (const s of S.structures) {
    if (s.type === 'seawall') for (let i = s.i1; i <= s.i2; i++) S.ycs[i] = Math.max(S.ycs[i], s.y - S.yls[i]);
    if (s.type === 'breakwater') {
      const i1 = Math.max(0, Math.floor(s.x1 / DX)), i2 = Math.min(N - 1, Math.floor(s.x2 / DX));
      for (let i = i1; i <= i2; i++) if (S.yls[i] + S.ycs[i] > s.y - 4) S.yls[i] = s.y - 4 - S.ycs[i];
    }
  }
  // the river keeps its mouth open: the shoreline across the channel can't build out past the banks
  for (const s of S.structures) if (s.type === 'river') {
    const ch = riverCells(s), cap = Y0 + 20; // the mouth can build out a little, but the river flushes anything more
    for (let i = ch.i1; i <= ch.i2; i++) if (S.yls[i] + S.ycs[i] > cap) S.yls[i] = cap - S.ycs[i];
  }
  for (let i = 0; i < N; i++) if (S.yls[i] + S.ycs[i] < 8) S.yls[i] = 8 - S.ycs[i];
  S.t += dt;
}
function advance(dtReal) {
  const simSpeed = S.storm ? 1 / 365 : S.speed;
  let remaining = simSpeed * dtReal, n = 0;
  while (remaining > 1e-12 && n < 1500) {
    W = currentWaves();
    const dt = Math.min(stableDt(W), remaining);
    step(dt, W); remaining -= dt; n++;
  }
  totals();
}

// ---------- canvas ----------
const stage = document.getElementById('stage'), cv = document.getElementById('beach'), ctx = cv.getContext('2d');
const ch = document.getElementById('chart'), cctx = ch.getContext('2d');
let CW = 900, CH = 420, sc = 0.6, dpr = 1;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  CW = stage.clientWidth; sc = CW / XL; CH = Math.round(YL * sc);
  cv.width = Math.round(CW * dpr); cv.height = Math.round(CH * dpr); cv.style.height = CH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cw = ch.clientWidth; ch.width = Math.round(cw * dpr); ch.height = Math.round(110 * dpr);
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const px = X => X * sc, py = Y => CH - Y * sc;
function shoreAt(X) {
  const f = X / DX - 0.5, i = clamp(Math.floor(f), 0, N - 1), j = Math.min(N - 1, i + 1), t = clamp(f - i, 0, 1);
  return y[i] + (y[j] - y[i]) * t;
}
function surfWidthAt(X) {
  const i = clamp(Math.floor(X / DX), 0, N - 1), A = Aprof();
  return Math.pow(Math.max(0.05, (Hc[i] || (W ? W.Hb : 1)) / GAMMA) / A, 1.5);
}
function seeded(n) { let s = n * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

// wave crest geometry (refraction over a Dean profile)
function drawCrests(w, time) {
  const A = Aprof(), om = w.om, k0 = om * om / g, c0 = g / om, s0 = Math.sin(w.th0), kx = k0 * s0;
  const step = 5, nd = Math.floor(YL / step) + 1, F = new Float64Array(nd), I = new Float64Array(nd);
  for (let i = 0; i < nd; i++) {
    const d = i * step, h = A * Math.pow(d, 2 / 3) + 0.3, x0 = k0 * h;
    const kh = x0 * Math.pow(1 / Math.tanh(Math.pow(x0, 0.75)), 2 / 3), k = kh / h, c = om / k;
    const s = clamp(s0 * c / c0, -0.999, 0.999); I[i] = k * Math.sqrt(1 - s * s);
  }
  F[nd - 1] = 0; for (let i = nd - 2; i >= 0; i--) F[i] = F[i + 1] + 0.5 * (I[i] + I[i + 1]) * step;
  const phase = wavePhase, hs = heads();
  const lo = Math.min(0, kx * XL), hi = Math.max(0, kx * XL) + F[0];
  const nMin = Math.floor((lo - phase) / (2 * Math.PI)) - 1, nMax = Math.ceil((hi - phase) / (2 * Math.PI)) + 1;
  const dstep = 12;
  ctx.lineCap = 'round';
  for (let n = nMin; n <= nMax; n++) {
    let prev = null;
    for (let X = 0; X <= XL; X += dstep) {
      const target = 2 * Math.PI * n + phase - kx * X;
      const dB = surfWidthAt(X), iB = Math.min(nd - 1, Math.floor(dB / step));
      if (target <= 0 || target >= F[iB]) { prev = null; continue; }
      let a = iB, b = nd - 1;
      while (b - a > 1) { const m = (a + b) >> 1; if (F[m] > target) a = m; else b = m; }
      const d = (a + (F[a] - target) / (F[a] - F[b] || 1)) * step;
      const Yw = shoreAt(X) + d;
      if (Yw > YL + 20) { prev = null; continue; }
      const kd = shelterAt(X, Yw, w, hs);
      const near = clamp(1 - (d - dB) / 260, 0, 1);
      const pt = { x: px(X), y: py(Yw), a: (0.16 + 0.42 * near) * kd, lw: 1 + 1.6 * near };
      if (prev) {
        ctx.strokeStyle = `rgba(255,255,255,${((pt.a + prev.a) / 2).toFixed(3)})`;
        ctx.lineWidth = (pt.lw + prev.lw) / 2;
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
      }
      prev = pt;
    }
  }
}

// sand particles in the surf zone
const PARTS = Array.from({ length: 240 }, (_, i) => ({ x: Math.random() * XL, f: Math.random(), j: Math.random() }));
function faceQ(X) { const j = clamp(Math.round(X / DX), 0, N); return Q[j]; }
function moveParticles(dtReal) {
  const scale = S.storm ? 0.6 : clamp(Math.sqrt(S.speed / 0.5), 0.45, 2);
  for (const p of PARTS) {
    const q = faceQ(p.x), v = Math.sign(q) * Math.min(95, 26 * Math.sqrt(Math.abs(q) / 1e5)) * scale * (0.6 + 0.8 * p.j);
    const nx = p.x + v * dtReal;
    let blocked = false;
    for (const s of S.structures) {
      if (!isStem(s)) continue;
      if ((p.x < s.x && nx >= s.x) || (p.x > s.x && nx <= s.x)) {
        const sh = shoreAt(s.x), yp = sh + 3 + p.f * (surfWidthAt(s.x) - 3);
        if (yp < s.tip - 2) { blocked = true; break; }
      }
    }
    if (!blocked) p.x = nx;
    p.f = clamp(p.f + (Math.random() - 0.5) * 0.05, 0, 1);
    if (p.x < 0) p.x += XL; if (p.x > XL) p.x -= XL;
  }
}

function drawRocks(x1, y1, x2, y2, widthM, seed) {
  const lw = Math.max(4, widthM * sc);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#4f4b47'; ctx.lineWidth = lw + 2;
  ctx.beginPath(); ctx.moveTo(px(x1), py(y1)); ctx.lineTo(px(x2), py(y2)); ctx.stroke();
  ctx.strokeStyle = '#75706a'; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(px(x1), py(y1)); ctx.lineTo(px(x2), py(y2)); ctx.stroke();
  const r = seeded(seed), len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(3, Math.floor(len / 7));
  for (let i = 0; i < n; i++) {
    const t = r(), ox = (r() - 0.5) * widthM * 0.6, oy = (r() - 0.5) * widthM * 0.6;
    ctx.fillStyle = r() > 0.5 ? '#9a948c' : '#5f5a55';
    ctx.beginPath(); ctx.arc(px(x1 + (x2 - x1) * t + ox), py(y1 + (y2 - y1) * t + oy), Math.max(1.2, lw * 0.28), 0, 7); ctx.fill();
  }
}

let fx = []; // transient effects (nourishment sparkle)
let draft = null;

function draw(time) {
  const w = W || currentWaves();
  ctx.clearRect(0, 0, CW, CH);
  // sea
  const sg = ctx.createLinearGradient(0, py(YL), 0, py(Y0));
  sg.addColorStop(0, '#16557d'); sg.addColorStop(0.7, '#2a7fa6'); sg.addColorStop(1, '#3f98b5');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, CH);
  // shallow water band + offshore bar
  ctx.beginPath();
  for (let X = 0; X <= XL; X += 10) { const Y = shoreAt(X) + Math.min(420, surfWidthAt(X) * 2.2 + 30); X ? ctx.lineTo(px(X), py(Y)) : ctx.moveTo(px(X), py(Y)); }
  for (let X = XL; X >= 0; X -= 10) ctx.lineTo(px(X), py(shoreAt(X)));
  ctx.closePath(); ctx.fillStyle = 'rgba(110, 205, 208, 0.30)'; ctx.fill();
  let barMean = 0; for (let i = 0; i < N; i++) barMean += S.ycs[i]; barMean /= N;
  const barA = clamp(-barMean / 30, 0, 0.5);
  if (barA > 0.03) {
    ctx.strokeStyle = `rgba(232, 214, 160, ${barA.toFixed(3)})`; ctx.lineWidth = Math.max(3, 14 * sc);
    ctx.beginPath();
    for (let X = 0; X <= XL; X += 15) { const Y = shoreAt(X) + surfWidthAt(X) * 0.9 + 15; X ? ctx.lineTo(px(X), py(Y)) : ctx.moveTo(px(X), py(Y)); }
    ctx.stroke();
  }
  // river plumes
  for (const s of S.structures) if (s.type === 'river') {
    const sy = shoreAt(s.x), pr = (90 + s.w) * sc, rg = ctx.createRadialGradient(px(s.x), py(sy), 2, px(s.x), py(sy), pr);
    rg.addColorStop(0, 'rgba(150, 128, 70, 0.55)'); rg.addColorStop(1, 'rgba(150, 128, 70, 0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(px(s.x), py(sy), pr, 0, 7); ctx.fill();
  }
  drawCrests(w, time);
  // surf foam
  ctx.beginPath();
  for (let X = 0; X <= XL; X += 10) { const Y = shoreAt(X) + surfWidthAt(X); X ? ctx.lineTo(px(X), py(Y)) : ctx.moveTo(px(X), py(Y)); }
  for (let X = XL; X >= 0; X -= 10) ctx.lineTo(px(X), py(shoreAt(X)));
  ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.20)'; ctx.fill();
  // sand
  ctx.beginPath(); ctx.moveTo(0, CH);
  for (let X = 0; X <= XL; X += 5) ctx.lineTo(px(X), py(shoreAt(X)));
  ctx.lineTo(CW, CH); ctx.closePath();
  const sandG = ctx.createLinearGradient(0, py(Y0 + 40), 0, CH);
  sandG.addColorStop(0, '#ecd6a4'); sandG.addColorStop(1, '#e2c68c');
  ctx.fillStyle = sandG; ctx.fill();
  // wet sand strip
  ctx.beginPath();
  for (let X = 0; X <= XL; X += 5) { const Y = shoreAt(X); X ? ctx.lineTo(px(X), py(Y)) : ctx.moveTo(px(X), py(Y)); }
  for (let X = XL; X >= 0; X -= 5) ctx.lineTo(px(X), py(Math.max(DUNE_TOE, shoreAt(X) - 9)));
  ctx.closePath(); ctx.fillStyle = 'rgba(176, 142, 88, 0.45)'; ctx.fill();
  // swash line
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let X = 0; X <= XL; X += 5) { const Y = shoreAt(X) + 2 + 1.5 * Math.sin(time * 1.3 + X * 0.02); X ? ctx.lineTo(px(X), py(Y)) : ctx.moveTo(px(X), py(Y)); }
  ctx.stroke();
  // everything on land is clipped to the land side of the shoreline, so when the sea
  // pushes inland it takes the dune, the houses and the road with it
  ctx.save(); ctx.beginPath(); ctx.moveTo(0, CH);
  for (let X = 0; X <= XL; X += 5) ctx.lineTo(px(X), py(shoreAt(X)));
  ctx.lineTo(CW, CH); ctx.closePath(); ctx.clip();
  // dune + road + houses
  ctx.fillStyle = '#9fb477'; ctx.fillRect(0, py(DUNE_TOE), CW, (DUNE_TOE - 40) * sc);
  const rg2 = seeded(7);
  ctx.strokeStyle = 'rgba(80, 110, 60, 0.55)'; ctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) { const X = rg2() * XL, Y = 42 + rg2() * 26; ctx.beginPath(); ctx.moveTo(px(X), py(Y)); ctx.lineTo(px(X + 2), py(Y + 4)); ctx.stroke(); }
  ctx.fillStyle = '#d8d2c3'; ctx.fillRect(0, py(40), CW, 26 * sc);
  ctx.fillStyle = '#6f757b'; ctx.fillRect(0, py(12), CW, 12 * sc);
  ctx.strokeStyle = 'rgba(255, 230, 140, 0.8)'; ctx.setLineDash([8, 8]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, py(6)); ctx.lineTo(CW, py(6)); ctx.stroke(); ctx.setLineDash([]);
  for (const h of S.houses) {
    if (!houseVisible(h)) continue;
    const st = houseStatus(h), wpx = Math.max(8, 26 * sc), hpx = Math.max(7, 20 * sc), cx = px(h.x), cy = py(33);
    ctx.save(); ctx.translate(cx, cy);
    if (st === 'gone') { // empty lot with rubble
      ctx.strokeStyle = 'rgba(80,80,80,0.7)'; ctx.setLineDash([3, 2]); ctx.lineWidth = 1; ctx.strokeRect(-wpx / 2, -hpx / 2, wpx, hpx); ctx.setLineDash([]);
      const rr = seeded(Math.round(h.x));
      for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#8a7d6b' : '#a8a29a'; ctx.fillRect(-wpx / 2 + rr() * wpx * 0.8, -hpx / 2 + rr() * hpx * 0.8, 2.5, 2); }
    } else {
      ctx.fillStyle = '#f4efe6'; ctx.fillRect(-wpx / 2, -hpx / 2, wpx, hpx);
      ctx.fillStyle = st === 'ok' ? '#6c4b3b' : '#d95926'; ctx.fillRect(-wpx / 2, -hpx / 2, wpx, hpx * 0.45);
      if (st === 'risk') { ctx.strokeStyle = '#d95926'; ctx.lineWidth = 2; ctx.strokeRect(-wpx / 2 - 2, -hpx / 2 - 2, wpx + 4, hpx + 4); }
    }
    ctx.restore();
  }
  drawNests();
  // rivers (channel)
  for (const s of S.structures) if (s.type === 'river') drawRiver(s, time);
  drawCars();
  ctx.restore();
  // erosion scarp where the sea has cut into the dune or beyond
  ctx.strokeStyle = '#7a5c3a'; ctx.lineWidth = 2.2; ctx.beginPath(); let pen = false;
  for (let X = 0; X <= XL; X += 5) { const Y = shoreAt(X); if (Y < DUNE_TOE + 3) { pen ? ctx.lineTo(px(X), py(Y)) : ctx.moveTo(px(X), py(Y)); pen = true; } else pen = false; }
  ctx.stroke();
  // initial shoreline ghost
  ctx.strokeStyle = 'rgba(15, 40, 55, 0.55)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, py(Y0)); ctx.lineTo(CW, py(Y0)); ctx.stroke(); ctx.setLineDash([]);
  // structures
  for (const s of S.structures) {
    if (s.type === 'seawall') {
      ctx.strokeStyle = '#4c5359'; ctx.lineWidth = Math.max(5, 7 * sc) + 2; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(px(s.x1), py(s.y)); ctx.lineTo(px(s.x2), py(s.y)); ctx.stroke();
      ctx.strokeStyle = '#b3b8bc'; ctx.lineWidth = Math.max(5, 7 * sc);
      ctx.beginPath(); ctx.moveTo(px(s.x1), py(s.y)); ctx.lineTo(px(s.x2), py(s.y)); ctx.stroke();
    } else if (s.type === 'breakwater') drawRocks(s.x1, s.y, s.x2, s.y, 14, s.id);
    else if (isStem(s)) {
      drawRocks(s.x, STEM_ROOT, s.x, s.tip, s.type === 'jetty' ? 18 : 10, s.id);
      if (s.type === 'tgroin') drawRocks(s.x - s.head, s.tip, s.x + s.head, s.tip, 11, s.id + 99);
    }
  }
  // seasonal fun: umbrellas in summer, boats, seals on breakwaters
  drawFun(time);
  // particles
  ctx.fillStyle = 'rgba(250, 232, 180, 0.95)';
  for (const p of PARTS) {
    const sh = shoreAt(p.x), yb = surfWidthAt(p.x), Y = sh + 3 + p.f * Math.max(4, yb - 3);
    ctx.beginPath(); ctx.arc(px(p.x), py(Y), Math.max(1.3, 2.2 * sc), 0, 7); ctx.fill();
  }
  // draft preview
  if (draft) drawDraft();
  // effects
  fx = fx.filter(e => time - e.t0 < 2.2);
  for (const e of fx) {
    const a = 1 - (time - e.t0) / 2.2, R = (30 + 120 * (1 - a)) * sc;
    ctx.strokeStyle = `rgba(31,163,122,${a})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(px(e.x), py(shoreAt(e.x)), R, 0, 7); ctx.stroke();
    ctx.fillStyle = `rgba(10,40,30,${a})`; ctx.font = '600 13px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillText(e.label, px(e.x) + 8, py(shoreAt(e.x) + 40));
  }
  // storm tint
  if (w.sf > 0.02) {
    ctx.fillStyle = `rgba(20, 28, 45, ${0.32 * w.sf})`; ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = `rgba(210, 225, 240, ${0.35 * w.sf})`; ctx.lineWidth = 1;
    const rr = seeded(Math.floor(time * 20));
    for (let i = 0; i < 90; i++) { const x = rr() * CW, yy = rr() * CH; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x - 6, yy + 14); ctx.stroke(); }
  }
  // compass + scale
  ctx.fillStyle = 'rgba(10,26,36,0.7)'; ctx.fillRect(8, CH - 30, 96, 22);
  ctx.fillStyle = '#f2f7f8'; ctx.font = '600 12px ' + getComputedStyle(document.body).fontFamily;
  ctx.fillText(`← ${leftDir()}   ${rightDir()} →`, 14, CH - 15);
  const bar = 200 * sc, bx = CW - bar - 16;
  ctx.fillStyle = 'rgba(10,26,36,0.7)'; ctx.fillRect(bx - 8, CH - 30, bar + 16, 22);
  ctx.fillStyle = '#f2f7f8'; ctx.fillRect(bx, CH - 14, bar, 3);
  ctx.fillText('200 m', bx + bar / 2 - 16, CH - 17);
}
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
function emoji(ch, X, Y, sizePx) { ctx.font = `${sizePx}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, px(X), py(Y)); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }
function emojiAt(ch, X, Y, size, flip, alpha) {
  ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.translate(px(X), py(Y)); if (flip) ctx.scale(-1, 1);
  ctx.font = `${size}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, 0, 0); ctx.restore();
}
const SHELLS = (() => { const r = seeded(99); return Array.from({ length: 24 }, () => ({ u: r(), f: r(), k: r() })); })();
// does moving from X0 to X1 at height Y run into a structure (or the beach, for swimmers and boats)?
function blockedSea(X0, X1, Y) {
  for (const s of S.structures) {
    if (isStem(s) && ((X0 < s.x && X1 >= s.x) || (X0 > s.x && X1 <= s.x)) && Y < s.tip + 14) return true;
    if (s.type === 'breakwater' && Math.abs(Y - s.y) < 20 && X1 > s.x1 - 12 && X1 < s.x2 + 12) return true;
    if (s.type === 'tgroin' && Math.abs(Y - s.tip) < 20 && X1 > s.x - s.head - 12 && X1 < s.x + s.head + 12) return true;
  }
  return Y < shoreAt(clamp(X1, 0, XL)) + surfWidthAt(clamp(X1, 0, XL)) + 20;
}
function blockedBeach(X0, X1) {
  for (const s of S.structures) {
    if (isStem(s) && ((X0 < s.x && X1 >= s.x) || (X0 > s.x && X1 <= s.x))) return true;
    if (s.type === 'river' && Math.abs(X1 - s.x) < s.w / 2 + 8) return true;
  }
  return X1 < 5 || X1 > XL - 5;
}
function spawnCritters() {
  S.critters = [
    { kind: 'boat', e: '🚤', x: 200, y: 610, vx: 11, size: 0.95 },
    { kind: 'sail', e: '⛵', x: 1100, y: 520, vx: -6, size: 1.05 },
    { kind: 'gull', e: '🕊️', x: 700, y: 470, vx: 18, size: 0.65 },
    { kind: 'fish', e: '🐟', x: 300, y: 330, vx: 5, size: 0.55 },
    { kind: 'fish', e: '🐠', x: 900, y: 390, vx: -4, size: 0.55 },
    { kind: 'fish', e: '🐟', x: 1300, y: 300, vx: -6, size: 0.5 }
  ];
}
function updateCritters(dt, t) {
  if (!S.critters.length) spawnCritters();
  const stormy = W && W.sf > 0.1;
  // occasional visitors
  if (!stormy && Math.random() < dt / 9 && S.critters.filter(c => c.kind === 'crab').length < 2) {
    const x = 80 + Math.random() * (XL - 160);
    if (shoreAt(x) - DUNE_TOE > 20 && !blockedBeach(x, x)) S.critters.push({ kind: 'crab', e: '🦀', x, off: 4 + Math.random() * 14, vx: (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 5), size: 0.55, life: 5 + Math.random() * 5 });
  }
  if (Math.random() < dt / 50 && !S.critters.some(c => c.kind === 'shark')) {
    const dir = Math.random() < 0.5 ? 1 : -1; S.critters.push({ kind: 'shark', e: '🦈', x: dir > 0 ? -60 : XL + 60, y: 470 + Math.random() * 150, vx: dir * 10, size: 0.9, once: true });
    toast('🦈 Shark spotted offshore! It\'s just passing through.');
  }
  if (Math.random() < dt / 110 && !S.critters.some(c => c.kind === 'whale')) {
    const dir = Math.random() < 0.5 ? 1 : -1; S.critters.push({ kind: 'whale', e: '🐋', x: dir > 0 ? -80 : XL + 80, y: YL - 20, vx: dir * 5, size: 1.3, once: true });
    toast('🐋 Whale sighting far offshore!');
  }
  for (const c of S.critters) {
    if (c.kind === 'crab') {
      const go = Math.sin(t * 7 + c.x) > -0.2 ? 1 : 0.1, nx = c.x + c.vx * go * dt;
      if (blockedBeach(c.x, nx)) c.vx = -c.vx; else c.x = nx;
      c.life -= dt; continue;
    }
    if (c.kind === 'fish' && Math.random() < dt / 6) c.vx = -c.vx;
    if (c.kind === 'fish') c.y = clamp(c.y + (Math.random() - 0.5) * 6 * dt, 200, YL - 40);
    const nx = c.x + c.vx * dt;
    if (c.kind !== 'gull' && blockedSea(c.x, nx, c.y)) {
      // stuck against the beach? swim or sail farther out; otherwise turn around
      if (c.y < shoreAt(clamp(nx, 0, XL)) + surfWidthAt(clamp(nx, 0, XL)) + 20) c.y = Math.min(YL - 20, c.y + 30 * dt + 2);
      else c.vx = -c.vx;
    } else c.x = nx;
    if (c.x < -100 || c.x > XL + 100) { if (c.once) c.dead = true; else c.x = c.x < 0 ? XL + 90 : -90; }
  }
  S.critters = S.critters.filter(c => !c.dead && !(c.kind === 'crab' && (c.life <= 0 || stormy)));
}
// ---------- hand-drawn sprites (top-down, same flat style as the structures and cars) ----------
// every sprite is drawn facing +x around (0,0); spr() flips it when it moves left
function spr(X, Y, dir, fn, alpha) {
  ctx.save(); if (alpha != null) ctx.globalAlpha = alpha; ctx.translate(px(X), py(Y)); if (dir < 0) ctx.scale(-1, 1); fn(); ctx.restore();
}
const ell = (x, y, rx, ry, rot, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, 7); ctx.fill(); };
function wake(k, len, spread) {
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-len * 0.35 * k, -2 * k); ctx.lineTo(-len * k, -spread * k); ctx.moveTo(-len * 0.35 * k, 2 * k); ctx.lineTo(-len * k, spread * k); ctx.stroke();
}
function sprLobsterBoat(k, t) {
  wake(k, 34, 8);
  ctx.fillStyle = '#f4f1ea'; ctx.strokeStyle = '#2b3a44'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(15 * k, 0); ctx.quadraticCurveTo(8 * k, -5.2 * k, -9 * k, -5 * k); ctx.lineTo(-12 * k, -4.4 * k); ctx.lineTo(-12 * k, 4.4 * k); ctx.lineTo(-9 * k, 5 * k); ctx.quadraticCurveTo(8 * k, 5.2 * k, 15 * k, 0); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#b8413a'; ctx.fillRect(-12 * k, -4.4 * k, 1.4 * k, 8.8 * k);                 // red transom
  ctx.fillStyle = '#3c6e91'; ctx.fillRect(-1 * k, -3.2 * k, 7 * k, 6.4 * k);                    // wheelhouse roof
  ctx.fillStyle = '#a9d6ee'; ctx.fillRect(5 * k, -3.2 * k, 1.4 * k, 6.4 * k);                   // windshield
  ctx.fillStyle = '#e8a33a'; ctx.fillRect(-9.5 * k, -3.6 * k, 3.2 * k, 3 * k); ctx.fillStyle = '#e0c24a'; ctx.fillRect(-9.5 * k, 0.6 * k, 3.2 * k, 3 * k); // lobster traps
}
function sprSailboat(k, t) {
  wake(k, 26, 6);
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2b3a44'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(13 * k, 0); ctx.quadraticCurveTo(4 * k, -4 * k, -10 * k, -3.2 * k); ctx.lineTo(-10 * k, 3.2 * k); ctx.quadraticCurveTo(4 * k, 4 * k, 13 * k, 0); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c7d6de'; ctx.fillRect(-9 * k, -1.6 * k, 4 * k, 3.2 * k);                   // cockpit
  const luff = Math.sin(t * 1.5) * 0.6;
  ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = 'rgba(40,60,70,0.7)';
  ctx.beginPath(); ctx.moveTo(3 * k, 0); ctx.quadraticCurveTo(-2 * k, (6 + luff) * k, -9 * k, 7.5 * k); ctx.lineTo(-9 * k, 6.3 * k); ctx.lineTo(3 * k, 0); ctx.fill(); ctx.stroke(); // mainsail (boom out to one side)
  ell(3 * k, 0, 1 * k, 1 * k, 0, '#2b3a44');                                                    // mast
}
function sprGull(k, t) {
  const f = Math.sin(t * 9), span = (8 + 2.5 * f) * k;
  ell(6 * k, 9 * k, 5 * k, 2 * k, 0, 'rgba(0,0,0,0.12)');                                       // shadow on the water
  ctx.fillStyle = '#d7dde1'; ctx.strokeStyle = '#6a737a'; ctx.lineWidth = 0.6;
  for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(1.5 * k, 0); ctx.quadraticCurveTo(0, sgn * span * 0.6, -3 * k, sgn * span); ctx.lineTo(-4.5 * k, sgn * span * 0.9); ctx.quadraticCurveTo(-2 * k, sgn * span * 0.4, -2 * k, 0); ctx.fill(); ctx.stroke();
    ell(-3.6 * k, sgn * span * 0.93, 1.3 * k, 0.8 * k, 0, '#222'); }                            // black wingtips
  ell(0, 0, 4.5 * k, 1.6 * k, 0, '#ffffff'); ell(4.3 * k, 0, 1.5 * k, 1.3 * k, 0, '#ffffff');
  ctx.fillStyle = '#e8a22b'; ctx.beginPath(); ctx.moveTo(5.6 * k, -0.4 * k); ctx.lineTo(7.4 * k, 0); ctx.lineTo(5.6 * k, 0.4 * k); ctx.fill();
}
function sprFish(k, t, col) {
  const w = Math.sin(t * 8) * 0.25;
  ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, 5 * k, 1.7 * k, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-4 * k, 0); ctx.lineTo(-7.5 * k, (-2 + w * 4) * k); ctx.lineTo(-7.5 * k, (2 + w * 4) * k); ctx.fill();
}
function sprShark(k, t) {
  const w = Math.sin(t * 3) * 0.2, sil = 'rgba(12, 32, 48, 0.5)';
  ctx.fillStyle = sil; ctx.beginPath(); ctx.ellipse(0, 0, 14 * k, 3.4 * k, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(3 * k, 2 * k); ctx.lineTo(-2 * k, 7 * k); ctx.lineTo(-1 * k, 2 * k); ctx.moveTo(3 * k, -2 * k); ctx.lineTo(-2 * k, -7 * k); ctx.lineTo(-1 * k, -2 * k); ctx.fill(); // pectoral fins
  ctx.beginPath(); ctx.moveTo(-12 * k, 0); ctx.lineTo(-19 * k, (-5 + w * 10) * k); ctx.lineTo(-17 * k, (w * 10) * k); ctx.lineTo(-19 * k, (4 + w * 10) * k); ctx.fill(); // tail
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(1 * k, 0, 4.2 * k, 2.2, 4.1); ctx.stroke(); // ripple round the fin
  ctx.fillStyle = '#56646d'; ctx.beginPath(); ctx.moveTo(3.5 * k, 0); ctx.lineTo(-3 * k, -1.6 * k); ctx.lineTo(-2 * k, 1.2 * k); ctx.fill(); // dorsal fin
}
function sprWhale(k, t) {
  const sil = 'rgba(10, 24, 38, 0.55)', w = Math.sin(t * 1.2) * 0.15;
  ctx.fillStyle = sil; ctx.beginPath(); ctx.ellipse(0, 0, 26 * k, 7 * k, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-24 * k, 0); ctx.quadraticCurveTo(-32 * k, (-9 + w * 20) * k, -36 * k, (-8 + w * 20) * k); ctx.quadraticCurveTo(-31 * k, (w * 20) * k, -36 * k, (8 + w * 20) * k); ctx.quadraticCurveTo(-32 * k, (9 + w * 20) * k, -24 * k, 0); ctx.fill();
  ctx.beginPath(); ctx.ellipse(4 * k, 8 * k, 8 * k, 2 * k, 0.5, 0, 7); ctx.ellipse(4 * k, -8 * k, 8 * k, 2 * k, -0.5, 0, 7); ctx.fill(); // flippers
  const ph = (t * 0.35) % 1;                                                                    // blow every few seconds
  if (ph < 0.18) { const r = ph / 0.18; ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - r)})`; for (const [dx, dy, rr] of [[0, 0, 3], [-2, -3, 2.4], [-2, 3, 2.4], [-4, 0, 2]]) { ctx.beginPath(); ctx.arc((18 + dx - r * 4) * k, dy * k * (1 + r), rr * k * (1 + r * 1.5), 0, 7); ctx.fill(); } }
}
function sprCrab(k, t, moving) {
  const wig = moving ? Math.sin(t * 30) * 0.6 : 0;
  ell(1 * k, 1.2 * k, 4.5 * k, 3.2 * k, 0, 'rgba(0,0,0,0.12)');
  ctx.strokeStyle = '#b8401d'; ctx.lineWidth = 1.1 * Math.max(0.8, k);
  for (let i = 0; i < 3; i++) for (const sgn of [-1, 1]) {
    const bx = (-2 + i * 2) * k, by = sgn * 2.2 * k;
    ctx.beginPath(); ctx.moveTo(bx, by * 0.6); ctx.lineTo(bx + (i - 1 + (i % 2 ? wig : -wig)) * 1.5 * k, by + sgn * 2.6 * k); ctx.stroke(); // legs out to each side
  }
  ell(0, 0, 3.6 * k, 2.6 * k, 0, '#d9542c'); ell(-0.4 * k, -0.4 * k, 2.4 * k, 1.5 * k, 0, '#e8764a');
  for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sgn * 1.8 * k, -2 * k); ctx.lineTo(sgn * 3 * k, -4 * k); ctx.stroke(); ell(sgn * 3.2 * k, -4.8 * k, 1.5 * k, 1.1 * k, sgn * 0.5, '#c94a24'); } // claws toward the sea
  ell(-1 * k, -2.3 * k, 0.45 * k, 0.45 * k, 0, '#111'); ell(1 * k, -2.3 * k, 0.45 * k, 0.45 * k, 0, '#111');
}
function sprLobster(k, t) {
  const tw = Math.sin(t * 2) * 0.3;
  ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(4 * k, -0.6 * k); ctx.quadraticCurveTo(9 * k, (-4 + tw) * k, 13 * k, (-5 + tw) * k); ctx.moveTo(4 * k, 0.6 * k); ctx.quadraticCurveTo(9 * k, (4 - tw) * k, 13 * k, (5 - tw) * k); ctx.stroke(); // antennae
  for (let i = 0; i < 5; i++) ell((-2.5 - i * 1.7) * k, 0, (1.6 - i * 0.12) * k, (1.9 - i * 0.2) * k, 0, i % 2 ? '#3f3a22' : '#4d4528'); // tail segments
  ctx.fillStyle = '#4d4528'; ctx.beginPath(); ctx.moveTo(-10.5 * k, 0); ctx.lineTo(-13 * k, -2.2 * k); ctx.lineTo(-13 * k, 2.2 * k); ctx.fill(); // tail fan
  ell(1 * k, 0, 3.4 * k, 2 * k, 0, '#4a4226');                                                  // carapace
  for (const sgn of [-1, 1]) { ctx.strokeStyle = '#4a4226'; ctx.lineWidth = 1.2 * k; ctx.beginPath(); ctx.moveTo(3 * k, sgn * 1.2 * k); ctx.lineTo(5.5 * k, sgn * 3.2 * k); ctx.stroke();
    ell(7.5 * k, sgn * 3.6 * k, 2.6 * k, (sgn > 0 ? 1.4 : 1.1) * k, sgn * 0.25, '#3f3a22'); ell(9.3 * k, sgn * 3.9 * k, 0.9 * k, 0.6 * k, 0, '#9a4a22'); } // big claws, rusty tips
}
function sprSeal(k, t) {
  const bob = Math.sin(t * 0.8) * 0.3;
  ell(1 * k, 1.5 * k, 10 * k, 3.6 * k, 0, 'rgba(0,0,0,0.15)');
  ell(0, 0, 9 * k, 3.4 * k, bob * 0.1, '#6f6863');
  ctx.fillStyle = 'rgba(40,36,34,0.35)'; for (const [x, y] of [[-3, -1], [1, 1.2], [-6, 0.8], [3, -1.4]]) { ctx.beginPath(); ctx.arc(x * k, y * k, 0.6 * k, 0, 7); ctx.fill(); } // spots
  ell(-9.5 * k, -1.4 * k, 2.2 * k, 0.9 * k, -0.5, '#5f5853'); ell(-9.5 * k, 1.4 * k, 2.2 * k, 0.9 * k, 0.5, '#5f5853'); // rear flippers
  ell(2 * k, -3.4 * k, 2 * k, 0.8 * k, -0.6, '#5f5853'); ell(2 * k, 3.4 * k, 2 * k, 0.8 * k, 0.6, '#5f5853');       // fore flippers
  ell(8.5 * k, bob * k, 2.8 * k, 2.4 * k, 0, '#655e59');                                         // head
  ell(9.6 * k, (bob - 0.9) * k, 0.45 * k, 0.45 * k, 0, '#111'); ell(9.6 * k, (bob + 0.9) * k, 0.45 * k, 0.45 * k, 0, '#111');
  ell(11.1 * k, bob * k, 0.5 * k, 0.5 * k, 0, '#222');                                           // nose
}
function sprShell(kind, k, rot) {
  ctx.rotate(rot);
  if (kind === 0) { // scallop
    ctx.fillStyle = '#f2e3cf'; ctx.beginPath(); ctx.moveTo(0, 1.6 * k); ctx.arc(0, 1.6 * k, 3 * k, Math.PI * 1.15, Math.PI * 1.85); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c9a987'; ctx.lineWidth = 0.5; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(0, 1.6 * k); ctx.lineTo(i * 1.1 * k, -1.2 * k); ctx.stroke(); }
  } else if (kind === 1) { // moon snail
    ell(0, 0, 2 * k, 2 * k, 0, '#e8dac4'); ctx.strokeStyle = '#8a6d52'; ctx.lineWidth = 0.6;
    ctx.beginPath(); for (let a = 0; a < 9; a += 0.3) { const r = 0.2 * k + a * 0.2 * k; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke();
  } else { // blue mussel
    ell(0, 0, 2.8 * k, 1.2 * k, 0, '#26303c'); ell(-0.5 * k, -0.3 * k, 1.6 * k, 0.4 * k, 0, '#5d7494');
  }
}
function sprUmbrella(k, palette) {
  ell(3 * k, 3 * k, 8 * k, 8 * k, 0, 'rgba(0,0,0,0.13)');                                        // shade
  ctx.save(); ctx.translate(10 * k, 5 * k); ctx.rotate(0.3); ctx.fillStyle = palette[2]; ctx.fillRect(-2.5 * k, -5 * k, 5 * k, 10 * k);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(-2.5 * k, -2 * k, 5 * k, 1.2 * k); ctx.fillRect(-2.5 * k, 1.5 * k, 5 * k, 1.2 * k); ctx.restore(); // towel
  for (let i = 0; i < 8; i++) { ctx.fillStyle = palette[i % 2]; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 7 * k, i * Math.PI / 4, (i + 1) * Math.PI / 4); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(0, 0, 7 * k, 0, 7); ctx.stroke();
  ell(0, 0, 0.9 * k, 0.9 * k, 0, '#444');
}
function sprBuoy(k, t, c1, c2) {
  const b = Math.sin(t * 2) * 0.4;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(0, 0, (3.4 + b) * k, 0, 7); ctx.stroke();
  ell(0, 0, 2.2 * k, 2.2 * k, 0, c1); ell(0, 0, 1.2 * k, 1.2 * k, 0, c2); ell(0, 0, 0.5 * k, 0.5 * k, 0, '#222');
}
const UMBRELLA_COLORS = [['#e04b3f', '#ffffff', '#3b82c4'], ['#2f78d6', '#f5d34a', '#e07a3a'], ['#1fa37a', '#ffffff', '#f0a1b8'], ['#f08a24', '#fff3d6', '#5e8bd6']];
function drawFun(time) {
  const m = Math.floor(monthPos()), summer = m >= 5 && m <= 7, stormy = W && W.sf > 0.1, k = clamp(sc * 1.7, 1, 2.3);
  const onRiver = X => S.structures.some(r => r.type === 'river' && Math.abs(X - r.x) < r.w / 2 + 25);
  // shells along the wrack line
  for (const sh of SHELLS) {
    const X = 20 + sh.u * (XL - 40), wid = shoreAt(X) - DUNE_TOE;
    if (wid < 12 || onRiver(X)) continue;
    const Y = DUNE_TOE + wid * (0.6 + 0.3 * sh.f);
    ctx.save(); ctx.translate(px(X), py(Y)); sprShell(Math.floor(sh.k * 3), k * 0.9, sh.f * 6); ctx.restore();
  }
  if (summer && !stormy) {
    const rr = seeded(42);
    for (let i = 0; i < 9; i++) {
      const X = 60 + rr() * (XL - 120), wid = shoreAt(X) - DUNE_TOE, onWall = S.structures.some(s => s.type === 'seawall' && X >= s.x1 && X <= s.x2);
      const nearNest = S.nests.some(n => Math.abs(n.x - X) < 30 + 16 * n.pairs), Yf = 0.45 + rr() * 0.2;
      if (wid > 45 && !onWall && !nearNest && !onRiver(X)) spr(X, DUNE_TOE + wid * Yf, 1, () => sprUmbrella(k, UMBRELLA_COLORS[i % 4]));
    }
  }
  // lobsters on the jetty rocks, lobster buoys off the tips, seals hauled out on breakwaters
  for (const s of S.structures) {
    if (s.type === 'jetty' || (isStem(s) && s.tip - shoreAt(s.x) > 120)) {
      spr(s.x + 9, s.tip - 22, 1, () => { ctx.rotate(-1.2); sprLobster(k * 0.8, time); }, 0.95);
      if (s.tip < YL - 30) { spr(s.x + 30, s.tip + 12, 1, () => sprBuoy(k, time, '#e04b3f', '#f5d34a')); spr(s.x - 26, s.tip + 22, 1, () => sprBuoy(k, time + 1, '#2f78d6', '#ffffff')); }
    }
    if (s.type === 'breakwater') spr((s.x1 + s.x2) / 2 + 15 * Math.sin(time * 0.2), s.y + 3, 1, () => sprSeal(k, time));
  }
  const m5 = m >= 4 && m <= 8;
  for (const c of S.critters) {
    if ((c.kind === 'boat' || c.kind === 'sail') && stormy) continue;
    if (c.kind === 'sail' && !m5) continue;
    const dir = c.vx > 0 ? 1 : -1;
    if (c.kind === 'crab') { const moving = Math.sin(time * 7 + c.x) > -0.2; spr(c.x, shoreAt(c.x) - c.off, 1, () => sprCrab(k * 0.9, time, moving), Math.min(1, c.life)); continue; }
    const y = c.kind === 'gull' ? c.y + 18 * Math.sin(time * 1.7) : c.y;
    if (c.kind === 'boat') spr(c.x, y, dir, () => sprLobsterBoat(k, time));
    else if (c.kind === 'sail') spr(c.x, y, dir, () => sprSailboat(k * 1.1, time));
    else if (c.kind === 'gull') spr(c.x, y, dir, () => sprGull(k, time));
    else if (c.kind === 'fish') spr(c.x, y, dir, () => { for (const [dx, dy] of [[0, 0], [-9, 4], [-7, -5]]) { ctx.save(); ctx.translate(dx * k, dy * k); sprFish(k * c.size * 1.4, time + dx, 'rgba(14, 44, 64, 0.42)'); ctx.restore(); } });
    else if (c.kind === 'shark') spr(c.x, y, dir, () => sprShark(k, time));
    else if (c.kind === 'whale') spr(c.x, y, dir, () => sprWhale(k, time));
  }
}
// ---------- cars on the road (top-down, driving on the right) ----------
const CAR_COLORS = ['#d23b3b', '#2f6fd6', '#f2c230', '#2e9d63', '#f4f4f4', '#333a40', '#e57c2e', '#8a55c9'];
let cars = [];
const roadOut = X => shoreAt(clamp(X, 0, XL)) < 16; // road washed away here
function updateCars(dt) {
  if (!(W && W.sf > 0.2) && Math.random() < dt / 2.5 && cars.length < 5) {
    const dir = Math.random() < 0.5 ? 1 : -1, x = dir > 0 ? -20 : XL + 20;
    const m = Math.floor(monthPos()), icecream = m >= 5 && m <= 7 && Math.random() < 0.2;
    cars.push({ x, dir, v: 11 + Math.random() * 7, col: icecream ? '#fbf3e4' : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], len: icecream ? 15 : 10, ice: icecream, wait: 0 });
  }
  for (const c of cars) {
    const ahead = c.x + c.dir * (c.len / 2 + 6);
    const gap = cars.some(o => o !== c && o.dir === c.dir && (o.x - c.x) * c.dir > 0 && (o.x - c.x) * c.dir < o.len / 2 + c.len / 2 + 6);
    if (roadOut(ahead)) { // road washed out: stop, then U-turn into the other lane
      c.wait += dt; if (c.wait > 0.8) { c.dir = -c.dir; c.wait = 0; }
    } else if (!gap) c.x += c.dir * c.v * dt;
  }
  cars = cars.filter(c => c.x > -40 && c.x < XL + 40);
}
function drawCars() {
  for (const c of cars) {
    // driving on the right: rightbound in the lower lane, leftbound in the upper lane
    const Yc = c.dir > 0 ? 3.2 : 8.8, L = c.len * sc, Wd = Math.max(3, 4.4 * sc), cx = px(c.x), cy = py(Yc);
    ctx.save(); ctx.translate(cx, cy); if (c.dir < 0) ctx.scale(-1, 1); // front of the car points +x
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-L / 2 + 1, -Wd / 2 + 1, L, Wd);
    ctx.fillStyle = c.col; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-L / 2, -Wd / 2, L, Wd, Math.min(3, Wd / 2)) : ctx.rect(-L / 2, -Wd / 2, L, Wd); ctx.fill();
    ctx.fillStyle = 'rgba(30, 50, 70, 0.8)'; ctx.fillRect(L * 0.12, -Wd / 2 + 1, L * 0.16, Wd - 2); // windshield (front)
    ctx.fillRect(-L * 0.36, -Wd / 2 + 1, L * 0.1, Wd - 2);                                          // rear window
    ctx.fillStyle = '#fff6b0'; ctx.fillRect(L / 2 - 1.5, -Wd / 2 + 0.5, 1.5, 1.2); ctx.fillRect(L / 2 - 1.5, Wd / 2 - 1.7, 1.5, 1.2); // headlights
    ctx.fillStyle = '#d23b3b'; ctx.fillRect(-L / 2, -Wd / 2 + 0.5, 1.2, 1.2); ctx.fillRect(-L / 2, Wd / 2 - 1.7, 1.2, 1.2);               // tail lights
    if (c.ice) { ctx.fillStyle = '#f08fb6'; ctx.fillRect(-L * 0.2, -Wd / 2, L * 0.3, Wd); }
    ctx.restore();
  }
}
function riverCells(s) {
  const i1 = clamp(Math.floor((s.x - s.w / 2) / DX), 0, N - 1), i2 = clamp(Math.floor((s.x + s.w / 2) / DX), 0, N - 1);
  const jettied = S.structures.some(j => j.type === 'jetty' && Math.abs(j.x - s.x) < s.w / 2 + 120);
  return { i1, i2, jettied };
}
function drawRiver(s, time) {
  const sy = shoreAt(s.x), hw = s.w / 2, bank = hw + 40;
  // salt marsh banks where the houses and dune would be
  ctx.fillStyle = '#8eab6b'; ctx.fillRect(px(s.x - bank), py(DUNE_TOE), px(2 * bank), (DUNE_TOE - 12) * sc); // from the road up to the dune line
  const rr = seeded(Math.round(s.x) + 3); ctx.strokeStyle = 'rgba(60, 90, 45, 0.6)'; ctx.lineWidth = 1;
  for (let i = 0; i < 40 + s.w / 2; i++) { const X = s.x - bank + rr() * 2 * bank, Y = 14 + rr() * (DUNE_TOE - 14); ctx.beginPath(); ctx.moveTo(px(X), py(Y)); ctx.lineTo(px(X - 1), py(Y + 5)); ctx.moveTo(px(X), py(Y)); ctx.lineTo(px(X + 2), py(Y + 5)); ctx.stroke(); }
  // sandy river banks on the beach
  ctx.fillStyle = '#e4cc98'; ctx.beginPath(); ctx.ellipse(px(s.x), py((DUNE_TOE + sy) / 2), px(hw + 25), Math.max(4, (sy - DUNE_TOE) / 2 * sc), 0, 0, 7); ctx.fill();
  // the channel: gentle meander, widening at the mouth
  const wig = X => 0.25 * s.w * Math.sin(X * 0.03 + s.x);
  ctx.fillStyle = '#3f8fb2'; ctx.beginPath();
  const pts = 10;
  for (let i = 0; i <= pts; i++) { const Y = sy * i / pts, ww = hw * (1 + 0.5 * Math.pow(i / pts, 3)); const X = s.x - ww + wig(Y) * (1 - i / pts); i ? ctx.lineTo(px(X), py(Y)) : ctx.moveTo(px(X), CH); }
  for (let i = pts; i >= 0; i--) { const Y = sy * i / pts, ww = hw * (1 + 0.5 * Math.pow(i / pts, 3)); const X = s.x + ww + wig(Y) * (1 - i / pts); ctx.lineTo(px(X), i ? py(Y) : CH); }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([6, 10]); ctx.lineDashOffset = -time * 12;
  ctx.beginPath(); for (let i = 0; i <= pts; i++) { const Y = sy * i / pts; const X = s.x + wig(Y) * (1 - i / pts); i ? ctx.lineTo(px(X), py(Y)) : ctx.moveTo(px(X), CH); } ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  // bridge carrying the road over the river
  // the road continues straight across: pavement over the whole marsh, railings over the water
  const rx1 = px(s.x - bank), rx2 = px(s.x + bank), bx1 = px(s.x - hw - 12), bx2 = px(s.x + hw + 12);
  ctx.fillStyle = '#6f757b'; ctx.fillRect(rx1, py(12), rx2 - rx1, 12 * sc);
  ctx.fillStyle = '#c9c4b8'; ctx.fillRect(bx1, py(12.8), bx2 - bx1, Math.max(1.5, 1.2 * sc)); ctx.fillRect(bx1, py(0.4) - Math.max(1.5, 1.2 * sc), bx2 - bx1, Math.max(1.5, 1.2 * sc));
  ctx.strokeStyle = 'rgba(255, 230, 140, 0.8)'; ctx.setLineDash([8, 8]); ctx.lineWidth = 1;
  ctx.lineDashOffset = rx1; // keep the centre-line dashes in step with the rest of the road
  ctx.beginPath(); ctx.moveTo(rx1, py(6)); ctx.lineTo(rx2, py(6)); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
}
function drawDraft() {
  const d = draft; ctx.globalAlpha = 0.75;
  if (isStem(d)) { drawRocks(d.x, STEM_ROOT, d.x, d.tip, d.type === 'jetty' ? 18 : 10, 1); if (d.type === 'tgroin') drawRocks(d.x - d.head, d.tip, d.x + d.head, d.tip, 11, 2); }
  else if (d.type === 'breakwater') drawRocks(d.x1, d.y, d.x2, d.y, 14, 3);
  else if (d.type === 'seawall') { ctx.strokeStyle = '#b3b8bc'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(px(d.x1), py(d.y)); ctx.lineTo(px(d.x2), py(d.y)); ctx.stroke(); }
  ctx.globalAlpha = 1;
}
// ---------- shorebird nesting ----------
// Piping plovers and least terns (both endangered in Maine) nest on open, dry sand between the
// wrack line and the dunes, May 1 – Aug 31 (Maine IF&W). A site needs dry beach in front of the dune.
const CHICKS_PER_PAIR = 1.44; // Maine statewide productivity, 2025 (Maine Audubon)
const inSeason = () => { const m = Math.floor(monthPos()); return m >= 4 && m <= 7; };
function nestStatus(n) {
  const w = Math.min(shoreAt(n.x - 20), shoreAt(n.x), shoreAt(n.x + 20)) - DUNE_TOE;
  if (w < 8) return 'lost';
  if (w < 20) return 'risk';
  return 'ok';
}
function nestSeasonTick(w) {
  const m = Math.floor(monthPos());
  if (S.lastMonth !== m) {
    if (m === 4) { S.nests.forEach(n => { n.washed = false; }); if (S.nests.length && S.lastMonth === 3) toast('🐦 The plovers are back! Nesting season has started.'); }
    if (S.lastMonth === 7 && m === 8) {                                    // Sep: count the season's chicks
      const before = S.fledged;
      for (const n of S.nests) {
        const st = nestStatus(n);
        if (!n.washed && st !== 'lost') S.fledged += n.pairs * CHICKS_PER_PAIR * (st === 'risk' ? 0.5 : 1);
      }
      if (S.nests.length) { const c = Math.round(S.fledged) - Math.round(before); toast(c > 0 ? `🐣 Nesting season over: ${c} chick${c === 1 ? '' : 's'} fledged!` : '😢 Nesting season over: no chicks fledged this year.'); }
    }
    S.lastMonth = m;
  }
  // a storm during nesting season washes over nests on narrow beaches
  if (w && w.sf > 0.4 && inSeason()) for (const n of S.nests) {
    const wid = Math.min(shoreAt(n.x - 20), shoreAt(n.x), shoreAt(n.x + 20)) - DUNE_TOE;
    if (wid < 25 + 30 * w.surge && !n.washed) { n.washed = true; toast('🌊 The storm washed over a nest!'); }
  }
}
function drawPlover(cx, cy, k) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k);
  ctx.fillStyle = '#d9c6a0'; ctx.beginPath(); ctx.ellipse(0, 0, 4.2, 2.8, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(0.4, 1.1, 3, 1.4, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#d9c6a0'; ctx.beginPath(); ctx.arc(3.6, -1.8, 1.9, 0, 7); ctx.fill();
  ctx.strokeStyle = '#1d1d1d'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(2.1, -0.6); ctx.lineTo(4.8, -0.4); ctx.stroke();
  ctx.fillStyle = '#e8892b'; ctx.beginPath(); ctx.moveTo(5.3, -2); ctx.lineTo(6.9, -1.6); ctx.lineTo(5.3, -1.3); ctx.fill();
  ctx.fillStyle = '#1d1d1d'; ctx.beginPath(); ctx.arc(4, -2.2, 0.45, 0, 7); ctx.fill();
  ctx.restore();
}
function drawScrape(cx, cy, r, eggs, wet) {
  // a plover "nest" is a shallow scrape in the sand, lined with bits of shell and pebbles
  ctx.fillStyle = wet ? 'rgba(106,169,201,0.55)' : '#cdb07c';
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.25, r * 0.85, 0, 0, 7); ctx.fill();
  ctx.fillStyle = wet ? 'rgba(80,120,150,0.5)' : '#b9955e';
  ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.1, r * 0.85, r * 0.55, 0, 0, 7); ctx.fill();
  const rr = seeded(Math.round(cx * 7 + cy));
  for (let i = 0; i < 14; i++) { // shell and pebble lining around the rim
    const a = (i / 14) * Math.PI * 2 + rr() * 0.3, d = r * (1.05 + rr() * 0.2);
    ctx.fillStyle = ['#f3ece0', '#8d7a66', '#e2d5bd', '#6f6254'][i % 4];
    ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, Math.max(0.9, r * 0.16), Math.max(0.7, r * 0.11), a, 0, 7); ctx.fill();
  }
  for (let i = 0; i < eggs; i++) { // speckled, sand-coloured eggs, pointy ends to the middle
    const a = (i / Math.max(eggs, 1)) * Math.PI * 2 + 0.6, d = eggs > 1 ? r * 0.36 : 0;
    const ex = cx + Math.cos(a) * d * (wet ? 2.2 : 1), ey = cy + Math.sin(a) * d * 0.6 * (wet ? 2.2 : 1);
    ctx.fillStyle = '#efe4c8'; ctx.strokeStyle = 'rgba(90,70,40,0.6)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.ellipse(ex, ey, Math.max(1.6, r * 0.3), Math.max(1.2, r * 0.22), a, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4a3a2a';
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(ex + (rr() - 0.5) * r * 0.35, ey + (rr() - 0.5) * r * 0.25, Math.max(0.35, r * 0.045), 0, 7); ctx.fill(); }
  }
}
function drawNests() {
  const season = inSeason();
  for (const n of S.nests) {
    const st = nestStatus(n), sh = shoreAt(n.x);
    const y1 = DUNE_TOE + 2, y2 = Math.min(DUNE_TOE + 26, sh - 1);
    const half = 14 + 16 * n.pairs;
    const x1 = px(n.x - half), x2 = px(n.x + half), top = py(Math.max(y1 + 2, y2)), bot = py(y1), cy = (top + bot) / 2;
    // symbolic fencing: rope strung between stakes
    const rope = st === 'lost' ? 'rgba(90,90,90,0.8)' : st === 'risk' ? '#d95926' : '#7a5a36';
    ctx.strokeStyle = rope; ctx.lineWidth = 1.1; ctx.setLineDash([4, 2]);
    ctx.strokeRect(x1, top, x2 - x1, bot - top); ctx.setLineDash([]);
    ctx.fillStyle = rope;
    for (const sx of [x1, (x1 + x2) / 2, x2]) for (const sy of [top, bot]) ctx.fillRect(sx - 1.2, sy - 2, 2.4, 4);
    if (st === 'lost') {
      ctx.strokeStyle = '#d95926'; ctx.lineWidth = 2; const cx = (x1 + x2) / 2;
      ctx.beginPath(); ctx.moveTo(cx - 6, cy - 5); ctx.lineTo(cx + 6, cy + 5); ctx.moveTo(cx + 6, cy - 5); ctx.lineTo(cx - 6, cy + 5); ctx.stroke();
      continue;
    }
    const r = clamp(sc * 9, 5, 12), k = clamp(sc * 2.5, 1, 2.3);
    for (let i = 0; i < n.pairs; i++) {
      const nx = x1 + (x2 - x1) * (i + 1) / (n.pairs + 1) - r * 0.6;
      if (season && !n.washed) { drawScrape(nx, cy, r, 4, false); drawPlover(nx + r * 2.3, cy - r * 0.2, k); }
      else if (season && n.washed) drawScrape(nx, cy, r, 3, true);
      else drawScrape(nx, cy, r * 0.85, 0, false);
    }
  }
}
function houseVisible(h) { return !S.structures.some(r => r.type === 'river' && Math.abs(h.x - r.x) < r.w / 2 + 45); }
function houseRaw(h) {
  for (const s of S.structures) if (s.type === 'seawall' && h.x >= s.x1 && h.x <= s.x2) return 'ok';
  const sh = Math.min(shoreAt(h.x - 15), shoreAt(h.x), shoreAt(h.x + 15));
  if (sh < 44) return 'lost';
  if (sh - DUNE_TOE < 15) return 'risk';
  return 'ok';
}
function houseStatus(h) { return h.gone ? 'gone' : houseRaw(h); }
function checkHouses() {
  for (const h of S.houses) if (!h.gone && houseVisible(h) && houseRaw(h) === 'lost') { h.gone = true; toast('🏚️ Oh no! A house washed away. Use 🔨 Rebuild once there is beach again.'); }
}
function canRebuild(h) { return Math.min(shoreAt(h.x - 15), shoreAt(h.x), shoreAt(h.x + 15)) - DUNE_TOE >= 20 || S.structures.some(s => s.type === 'seawall' && h.x >= s.x1 && h.x <= s.x2); }
function rebuild(h, quiet) {
  if (!h.gone) return false;
  if (!canRebuild(h)) { if (!quiet) toast('🚫 Too risky to rebuild here: less than 20 m of beach. Try adding sand first!'); return false; }
  h.gone = false; if (!quiet) toast('🔨 House rebuilt! Good as new.'); return true;
}

function drawChart() {
  const w = ch.clientWidth, h = 110; cctx.clearRect(0, 0, w, h);
  const cs = getComputedStyle(document.documentElement);
  const cOr = cs.getPropertyValue('--orange').trim(), cGr = cs.getPropertyValue('--green').trim(), cMu = cs.getPropertyValue('--muted').trim(), cLn = cs.getPropertyValue('--line').trim();
  let mx = 10; for (let i = 0; i < N; i++) mx = Math.max(mx, Math.abs(y[i] - Y0));
  mx = Math.ceil(mx / 10) * 10;
  const left = 46, top = 8, bottom = h - 18, mid = (top + bottom) / 2, sy = (bottom - top) / 2 / mx, bw = (w - left) / N;
  cctx.strokeStyle = cLn; cctx.lineWidth = 1;
  [top, mid, bottom].forEach(yy => { cctx.beginPath(); cctx.moveTo(left, yy + 0.5); cctx.lineTo(w, yy + 0.5); cctx.stroke(); });
  for (let i = 0; i < N; i++) {
    const d = y[i] - Y0; cctx.fillStyle = d >= 0 ? cGr : cOr;
    const x = left + i * bw; cctx.fillRect(x, d >= 0 ? mid - d * sy : mid, Math.max(1, bw - 0.4), Math.abs(d) * sy);
  }
  cctx.fillStyle = cMu; cctx.font = '11px ' + getComputedStyle(document.body).fontFamily; cctx.textAlign = 'right';
  cctx.fillText('+' + mx + ' m', left - 6, top + 8); cctx.fillText('0', left - 6, mid + 4); cctx.fillText('−' + mx + ' m', left - 6, bottom);
  cctx.textAlign = 'left'; cctx.fillText(`${leftDir()} end`, left, h - 3); cctx.textAlign = 'right'; cctx.fillText(`${rightDir()} end · 1,500 m`, w, h - 3);
  cctx.textAlign = 'left';
  for (const s of S.structures) {
    const xs = s.x !== undefined ? [s.x] : [(s.x1 + s.x2) / 2];
    cctx.fillStyle = COL[s.type];
    xs.forEach(X => { const x = left + X / XL * (w - left); cctx.beginPath(); cctx.moveTo(x, bottom + 1); cctx.lineTo(x - 4, bottom + 8); cctx.lineTo(x + 4, bottom + 8); cctx.fill(); });
  }
}

// ---------- tools ----------
const TOOLS = [
  { id: 'inspect', label: 'Look', hint: '<b>Look:</b> hover over the beach to read its width and the sand drift at that spot.',
    svg: '<circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' },
  { id: 'groin', label: 'Groin', hint: '<b>Groin:</b> click the water where you want the tip, or click the beach for a 80 m groin. Drag up or down to change its length.',
    svg: '<rect x="2" y="16" width="20" height="6" rx="1" fill="#e2c68c"/><rect x="10" y="3" width="4" height="15" rx="2" fill="currentColor"/>' },
  { id: 'tgroin', label: 'T-groin / spur', hint: '<b>T-groin (spur):</b> a groin with a shore-parallel head that shelters the beach behind it. Click the water for the tip.',
    svg: '<rect x="2" y="16" width="20" height="6" rx="1" fill="#e2c68c"/><rect x="10.5" y="6" width="3" height="12" rx="1.5" fill="currentColor"/><rect x="5" y="4" width="14" height="3.5" rx="1.5" fill="currentColor"/>' },
  { id: 'jetty', label: 'Jetty', hint: '<b>Jetty:</b> a long, heavy groin, usually at a river mouth or harbor. Click the water far out for the tip.',
    svg: '<rect x="2" y="16" width="20" height="6" rx="1" fill="#e2c68c"/><rect x="9.5" y="1" width="5" height="17" rx="2" fill="currentColor"/>' },
  { id: 'breakwater', label: 'Breakwater', hint: '<b>Breakwater:</b> click in the water (drag sideways to set its length) to place a rock barrier parallel to shore.',
    svg: '<rect x="2" y="16" width="20" height="6" rx="1" fill="#e2c68c"/><rect x="4" y="5" width="16" height="4" rx="2" fill="currentColor"/>' },
  { id: 'seawall', label: 'Seawall', hint: '<b>Seawall:</b> drag along the back of the beach to armour it. The shoreline cannot retreat past the wall.',
    svg: '<rect x="2" y="16" width="20" height="6" rx="1" fill="#e2c68c"/><rect x="2" y="11" width="20" height="4" fill="currentColor"/>' },
  { id: 'nourish', label: 'Add sand', hint: '<b>Add sand:</b> click the beach to dump a nourishment fill (size is set under Storms and sea level).',
    svg: '<rect x="2" y="16" width="20" height="6" rx="1" fill="#e2c68c"/><path d="M5 16 Q12 5 19 16Z" fill="#d7b270" stroke="currentColor" stroke-width="1.4"/>' },
  { id: 'river', label: 'River', hint: '<b>River:</b> click the beach to add a river. Set its width with the River width slider below; wider rivers bring more sand (about 700 m³ a year per metre of width). The slider also resizes the river you placed last.',
    svg: '<rect x="2" y="16" width="20" height="6" rx="1" fill="#e2c68c"/><path d="M11 23 C8 18 15 15 11 9 M11 9 l-3 -5" stroke="#2f82ad" stroke-width="3.2" fill="none" stroke-linecap="round"/>' },
  { id: 'nest', label: 'Nesting area', hint: '<b>Nesting area:</b> click the upper beach to rope off a shorebird nesting area (piping plovers and least terns nest on open sand just in front of the dunes, May–August).',
    svg: '<rect x="2" y="16" width="20" height="6" rx="1" fill="#e2c68c"/><path d="M4 16V9M20 16V9M4 10h16" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1.5" fill="none"/><ellipse cx="12" cy="13" rx="4" ry="2.6" fill="#d8c7a0" stroke="currentColor" stroke-width="1"/><circle cx="15.2" cy="11" r="1.7" fill="#d8c7a0" stroke="currentColor" stroke-width="1"/><path d="M13.6 12.3h3" stroke="#1b1b1b" stroke-width="1.2"/>' },
  { id: 'build', label: 'Rebuild house', hint: '<b>Rebuild house:</b> click an empty lot to rebuild a washed-away house. It needs at least 20 m of beach in front (or a seawall).',
    svg: '<path d="M4 12l8-7 8 7v9H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><rect x="10" y="15" width="4" height="6" fill="currentColor"/>' },
  { id: 'erase', label: 'Remove', hint: '<b>Remove:</b> click a structure, river or nesting area to take it away.',
    svg: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' }
];
const toolbar = document.getElementById('toolbar'), toolHint = document.getElementById('toolHint');
TOOLS.forEach(t => {
  const b = document.createElement('button'); b.className = 'tool'; b.type = 'button'; b.dataset.tool = t.id;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${t.svg}</svg>${t.label}`;
  b.addEventListener('click', () => setTool(t.id)); toolbar.appendChild(b);
});
function setTool(id) {
  S.tool = id; stage.dataset.tool = id;
  toolbar.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === id));
  toolHint.innerHTML = TOOLS.find(t => t.id === id).hint;
}

function worldFromEvent(e) {
  const r = cv.getBoundingClientRect();
  return { X: clamp((e.clientX - r.left) / r.width * XL, 0, XL), Y: clamp((r.bottom - e.clientY) / r.height * YL, 0, YL) };
}
function snapX(X) { return clamp(Math.round(X / DX) * DX, DX, XL - DX); }
function makeDraft(tool, p) {
  const sh = shoreAt(p.X);
  if (tool === 'groin' || tool === 'tgroin' || tool === 'jetty') {
    const def = tool === 'jetty' ? 260 : tool === 'tgroin' ? 90 : 80;
    const x = snapX(p.X), tip = p.Y > sh + 15 ? p.Y : sh + def;
    return { type: tool, x, tip: clamp(tip, sh + 10, YL - 20), head: 45, y0: p.Y, userTip: p.Y > sh + 15 };
  }
  if (tool === 'breakwater') {
    const yb = clamp(Math.max(p.Y, sh + 40), sh + 30, YL - 30);
    return { type: 'breakwater', xs: p.X, x1: clamp(p.X - 110, 0, XL), x2: clamp(p.X + 110, 0, XL), y: yb, dragged: false };
  }
  if (tool === 'seawall') {
    const yw = p.Y < sh - 5 && p.Y > DUNE_TOE - 5 ? p.Y : DUNE_TOE + 2;
    return { type: 'seawall', xs: p.X, x1: clamp(p.X - 150, 0, XL), x2: clamp(p.X + 150, 0, XL), y: yw, dragged: false };
  }
  return null;
}
function updateDraft(p) {
  if (!draft) return;
  if (isStem(draft)) { const sh = shoreAt(draft.x); if (Math.abs(p.Y - draft.y0) > 6) draft.tip = clamp(p.Y, sh + 10, YL - 20); }
  else if (Math.abs(p.X - draft.xs) > 15) {
    draft.dragged = true; draft.x1 = clamp(Math.min(draft.xs, p.X), 0, XL); draft.x2 = clamp(Math.max(draft.xs, p.X), 0, XL);
  }
}
function commitDraft() {
  const d = draft; draft = null; if (!d) return;
  if (d.x2 !== undefined && d.x2 - d.x1 < 40) { d.x1 = clamp(d.xs - 60, 0, XL); d.x2 = clamp(d.xs + 60, 0, XL); }
  addStructure(d);
}
function addStructure(d) {
  const s = Object.assign({ id: S.nextId++ }, d);
  if (isStem(s)) { s.face = clamp(Math.round(s.x / DX), 1, N - 1); s.x = s.face * DX; s.byp = 1; }
  if (s.type === 'seawall') { s.i1 = clamp(Math.floor(s.x1 / DX), 0, N - 1); s.i2 = clamp(Math.floor(s.x2 / DX), 0, N - 1); }
  if (s.type === 'river') { s.cell = clamp(Math.floor(s.x / DX), 0, N - 1); if (!s.w) s.w = 60; }
  S.structures.push(s); placed(); refreshTerms();
}
function toast(msg) {
  const box = $('toasts'); if (!box) return;
  while (box.children.length > 2) box.firstChild.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3400); setTimeout(() => t.remove(), 4000);
}
function placed() { if (!S.placed) { S.placed = true; document.getElementById('hint').hidden = true; } }
function nourish(X) {
  const V = S.vol, sig0 = 120, Dd = Dact();
  for (let i = 0; i < N; i++) { const x = (i + 0.5) * DX; S.yls[i] += V / (Dd * sig0 * Math.sqrt(2 * Math.PI)) * Math.exp(-((x - X) ** 2) / (2 * sig0 * sig0)); }
  S.fills.push({ x: X, V, t: S.t }); S.sandAdded += V;
  fx.push({ x: X, t0: performance.now() / 1000, label: '+' + fmtVol(V) + ' m³' });
  if (!S.silent) toast(`🚚 Beep beep! ${fmtVol(V)} m³ of sand delivered.`);
  placed(); totals(); refreshTerms(true);
}
function eraseAt(p) {
  let best = null, bd = 30;
  const seg = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, t = clamp(((p.X - x1) * dx + (p.Y - y1) * dy) / L, 0, 1); return Math.hypot(p.X - x1 - t * dx, p.Y - y1 - t * dy); };
  for (const s of S.structures) {
    let d = 1e9;
    if (isStem(s)) { d = seg(s.x, STEM_ROOT, s.x, s.tip); if (s.type === 'tgroin') d = Math.min(d, seg(s.x - s.head, s.tip, s.x + s.head, s.tip)); }
    else if (s.type === 'breakwater' || s.type === 'seawall') d = seg(s.x1, s.y, s.x2, s.y);
    else if (s.type === 'river') d = seg(s.x, 0, s.x, shoreAt(s.x));
    if (d < bd) { bd = d; best = s; }
  }
  let bestNest = null;
  for (const n of S.nests) { const hw = 14 + 16 * n.pairs; const d = seg(n.x - hw, DUNE_TOE + 12, n.x + hw, DUNE_TOE + 12); if (d < bd) { bd = d; bestNest = n; } }
  if (bestNest) { S.nests = S.nests.filter(n => n !== bestNest); return; }
  if (best) { S.structures = S.structures.filter(s => s !== best); refreshTerms(); }
}
cv.addEventListener('pointerdown', e => {
  const p = worldFromEvent(e);
  if (S.tool === 'inspect') return;
  if (S.tool === 'erase') { eraseAt(p); return; }
  if (S.tool === 'nourish') { nourish(snapX(p.X)); return; }
  if (S.tool === 'river') { addStructure({ type: 'river', x: snapX(p.X), w: S.riverW, q: 700 * S.riverW }); toast(`🏞️ A new river, ${S.riverW} m wide, bringing ${fmtVol(700 * S.riverW)} m³ of sand a year.`); return; }
  if (S.tool === 'build') {
    const h = S.houses.filter(h => houseVisible(h)).sort((a, b) => Math.abs(a.x - p.X) - Math.abs(b.x - p.X))[0];
    if (h && Math.abs(h.x - p.X) < 50) { if (h.gone) rebuild(h); else toast('🏡 That house is still standing.'); }
    return;
  }
  if (S.tool === 'nest') { S.nests.push({ x: snapX(p.X), pairs: 2, washed: false }); placed(); return; }
  draft = makeDraft(S.tool, p);
  if (draft) cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  const p = worldFromEvent(e);
  if (draft) { updateDraft(p); return; }
  showTip(e, p);
});
cv.addEventListener('pointerup', e => { if (draft) { updateDraft(worldFromEvent(e)); commitDraft(); } });
cv.addEventListener('pointercancel', () => { draft = null; });
cv.addEventListener('pointerleave', () => { tip.hidden = true; });
const tip = document.getElementById('tip');
function showTip(e, p) {
  const r = stage.getBoundingClientRect();
  const sh = shoreAt(p.X), q = faceQ(p.X), width = sh - DUNE_TOE, i = clamp(Math.floor(p.X / DX), 0, N - 1);
  const nest = S.nests.find(n => Math.abs(n.x - p.X) < 14 + 16 * n.pairs && p.Y < DUNE_TOE + 40 && p.Y > DUNE_TOE - 10);
  const nestTxt = nest ? `<br><b>Shorebird nesting area</b>: ${nest.pairs} plover pair${nest.pairs > 1 ? 's' : ''}, ${{ ok: 'safe', risk: 'at risk (narrow beach)', lost: 'lost (no dry beach)' }[nestStatus(nest)]}${nest.washed && inSeason() ? ', washed out this season' : ''}` : '';
  tip.innerHTML = `<span class="mono">x = ${Math.round(p.X)} m</span><br>Dry beach ${Math.max(0, width).toFixed(0)} m wide (${(sh - Y0 >= 0 ? '+' : '−') + Math.abs(sh - Y0).toFixed(1)} m)<br>Drift ${fmtQ(q)}<br>Breaking waves ${(Hc[i] || 0).toFixed(2)} m${nestTxt}`;
  tip.style.left = Math.min(e.clientX - r.left, r.width - 280) + 'px'; tip.style.top = Math.min(e.clientY - r.top, r.height - 130) + 'px';
  tip.hidden = false;
}

// ---------- formatting ----------
function fmtVol(v) { const a = Math.abs(v); return a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : Math.round(a).toString(); }
const leftDir = () => compass(S.normal - 90), rightDir = () => compass(S.normal + 90);
function fmtQ(q) { return Math.abs(q) < 500 ? 'about 0' : (q > 0 ? `toward ${rightDir()} → ` : `← toward ${leftDir()} `) + fmtVol(q) + ' m³/yr'; }
function compass(deg) { const n = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']; return n[((Math.round(deg / 22.5) % 16) + 16) % 16]; }
const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);

// ---------- controls ----------
const $ = id => document.getElementById(id);
const h0 = $('h0'), per = $('per'), slr = $('slr'), vol = $('vol'), k1 = $('k1'), d50 = $('d50'), hsIn = $('hs');
function setMode(m) {
  S.mode = m;
  $('modeSeg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
  const notes = {
    cycle: 'Waves change month by month: winter swell from the east–northeast, calmer summer swell from the south–southeast.',
    winter: 'Holding winter: bigger waves from the east–northeast.',
    spring: 'Holding spring: moderate waves from the east.',
    summer: 'Holding summer: small waves from the south–southeast.',
    fall: 'Holding fall: moderate waves, turning from southeast to east.',
    custom: 'Your own waves: set the direction, height and period below.'
  };
  $('modeNote').textContent = notes[m];
  $('waveTag').textContent = m === 'cycle' ? 'Year-round waves' : m === 'custom' ? 'Custom waves' : m[0].toUpperCase() + m.slice(1) + ' waves';
}
$('modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
function toCustom() { if (S.mode !== 'custom') { const b = siteBase(); S.H0 = b.H0; S.T = b.T; S.th = Math.round(b.th); setMode('custom'); } }
h0.addEventListener('input', () => { toCustom(); S.H0 = +h0.value; });
per.addEventListener('input', () => { toCustom(); S.T = +per.value; });
slr.addEventListener('input', () => { S.slr = +slr.value; refreshTerms(); });
vol.addEventListener('input', () => { S.vol = +vol.value; });
$('rw').addEventListener('input', () => {
  S.riverW = +$('rw').value;
  const last = [...S.structures].reverse().find(s => s.type === 'river');
  if (last) { last.w = S.riverW; last.q = 700 * S.riverW; refreshTerms(true); }
});
$('btnRebuild').addEventListener('click', () => {
  const gone = S.houses.filter(h => h.gone && houseVisible(h));
  if (!gone.length) { toast('🏡 All the houses are standing.'); return; }
  const done = gone.filter(h => rebuild(h, true)).length;
  toast(done === gone.length ? `🔨 Rebuilt ${done} house${done > 1 ? 's' : ''}!` : done ? `🔨 Rebuilt ${done}; ${gone.length - done} still have too little beach.` : '🚫 Not enough beach to rebuild safely. Add sand first!');
});
k1.addEventListener('input', () => { S.K1 = +k1.value; });
d50.addEventListener('input', () => { S.d50 = +d50.value; });
hsIn.addEventListener('input', () => { S.hstar = +hsIn.value; });
$('nrm').addEventListener('input', () => { S.normal = +$('nrm').value; updateFrameNote(); });
$('trn').addEventListener('input', () => { S.turn = +$('trn').value; });
$('expo').addEventListener('input', () => { S.expo = +$('expo').value; });
function updateFrameNote() {
  $('frameNote').textContent = `The beach faces ${compass(S.normal)} (${Math.round(S.normal)}°): ${leftDir()} is to the left, ${rightDir()} to the right, open ocean at the top.`;
}
// speed slider: logarithmic, from 1 year every 30 s up to 2 years per second
const SP_MIN = 1 / 30, SP_MAX = 2;
const spFrom = v => SP_MIN * Math.pow(SP_MAX / SP_MIN, v / 1000);
const spTo = sp => Math.round(1000 * Math.log(sp / SP_MIN) / Math.log(SP_MAX / SP_MIN));
function speedLabel(sp) {
  if (sp < 0.95) { const s = 1 / sp; return `1 year every ${s >= 10 ? Math.round(s) : s.toFixed(1)} s`; }
  return `${sp < 1.05 ? '1 year' : sp.toFixed(1) + ' years'} per second`;
}
function setSpeed(sp) { S.speed = sp; $('speed').value = spTo(sp); $('speedo').textContent = speedLabel(sp); $('speed').setAttribute('aria-valuetext', speedLabel(sp)); }
$('speed').addEventListener('input', () => { S.speed = spFrom(+$('speed').value); $('speedo').textContent = speedLabel(S.speed); $('speed').setAttribute('aria-valuetext', speedLabel(S.speed)); });
function setPlaying(v) {
  if (v && !S.playing && S.t === 0) toast('🏁 And we\'re off!');
  S.playing = v;
  $('btnStart').disabled = v; $('btnPause').disabled = !v;
  $('runStatus').innerHTML = v ? '<b>Running.</b> Sand is moving; time is passing.' : (S.t > 0 ? '<b>Paused.</b> Waves still animate, but the beach and clock are frozen.' : '<b>Ready.</b> Add structures now, then press Start.');
}
$('btnStart').addEventListener('click', () => setPlaying(true));
$('btnPause').addEventListener('click', () => setPlaying(false));
$('btnUndo').addEventListener('click', () => { S.structures.pop(); refreshTerms(); });
$('btnClear').addEventListener('click', () => { S.structures = []; refreshTerms(); });
$('btnReset').addEventListener('click', () => { resetBeach(); refreshTerms(); });
$('btnNoreaster').addEventListener('click', () => startStorm('noreaster'));
$('btnTropical').addEventListener('click', () => startStorm('tropical'));
function startStorm(k) {
  if (S.storm) return;
  const def = STORMS[k]; S.storm = { def, t0: S.t, dur: def.days / 365 }; S.storms++;
  toast(k === 'noreaster' ? '🌬️ Nor\'easter incoming! Batten down the hatches.' : '🌀 Tropical storm incoming!');
  $('btnNoreaster').disabled = $('btnTropical').disabled = true;
  setPlaying(true);
  refreshTerms(true);
}
function onStormEnd() { toast('☀️ The storm has passed. Watch the beach slowly heal.'); $('btnNoreaster').disabled = $('btnTropical').disabled = false; $('stormBanner').hidden = true; setTimeout(() => refreshTerms(), 0); }

// wave direction dial
const dial = $('dial'), DC = { x: 110, y: 112, r: 90 };
(function ticks() {
  let s = '';
  for (let a = -75; a <= 75; a += 15) { const t = rad(a); s += `<line class="tick" x1="${DC.x - 80 * Math.sin(t)}" y1="${DC.y - 80 * Math.cos(t)}" x2="${DC.x - 100 * Math.sin(t)}" y2="${DC.y - 100 * Math.cos(t)}"/>`; }
  $('dialTicks').innerHTML = s;
})();
function drawDial(th) {
  const t = rad(th), kx = DC.x - DC.r * Math.sin(t), ky = DC.y - DC.r * Math.cos(t);
  const ex = DC.x - 26 * Math.sin(t), ey = DC.y - 26 * Math.cos(t);
  $('dialKnob').setAttribute('cx', kx); $('dialKnob').setAttribute('cy', ky);
  const a = $('dialArrow'); a.setAttribute('x1', kx); a.setAttribute('y1', ky); a.setAttribute('x2', ex); a.setAttribute('y2', ey);
  const ux = Math.sin(t), uy = Math.cos(t); // direction toward knob
  const tipx = DC.x - 16 * Math.sin(t), tipy = DC.y - 16 * Math.cos(t), bx2 = DC.x - 30 * Math.sin(t), by2 = DC.y - 30 * Math.cos(t);
  $('dialHead').setAttribute('d', `M ${tipx} ${tipy} L ${bx2 + 7 * uy} ${by2 - 7 * ux} L ${bx2 - 7 * uy} ${by2 + 7 * ux} Z`);
  let cr = '';
  for (let k = -1; k <= 1; k++) { const cx = DC.x - (DC.r - 22 + k * 14) * Math.sin(t), cy = DC.y - (DC.r - 22 + k * 14) * Math.cos(t); cr += `<line class="crest" x1="${cx - 14 * Math.cos(t)}" y1="${cy + 14 * Math.sin(t)}" x2="${cx + 14 * Math.cos(t)}" y2="${cy - 14 * Math.sin(t)}"/>`; }
  $('dialCrests').innerHTML = cr;
  dial.setAttribute('aria-valuenow', Math.round(th));
  const comp = S.normal - th;
  $('dirBig').textContent = 'from ' + compass(comp);
  $('dirSmall').textContent = `${Math.round(((comp % 360) + 360) % 360)}° · ${Math.abs(Math.round(th))}° ${th > 0.5 ? 'from the ' + leftDir() + ' side' : th < -0.5 ? 'from the ' + rightDir() + ' side' : 'straight on'}`;
  $('dlL').textContent = leftDir(); $('dlC').textContent = compass(S.normal); $('dlR').textContent = rightDir();
}
let dialDrag = false;
function dialFromEvent(e) {
  const r = dial.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * 220, vy = (e.clientY - r.top) / r.height * 132;
  const th = clamp(Math.atan2(DC.x - vx, DC.y - vy) * 180 / Math.PI, -75, 75);
  toCustom(); S.th = Math.round(th);
}
dial.addEventListener('pointerdown', e => { dialDrag = true; dial.setPointerCapture(e.pointerId); dialFromEvent(e); });
dial.addEventListener('pointermove', e => { if (dialDrag) dialFromEvent(e); });
dial.addEventListener('pointerup', () => { dialDrag = false; });
dial.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { toCustom(); S.th = clamp(S.th + 5, -75, 75); e.preventDefault(); }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { toCustom(); S.th = clamp(S.th - 5, -75, 75); e.preventDefault(); }
});

// experiments
document.querySelectorAll('[data-exp]').forEach(b => b.addEventListener('click', () => runExperiment(b.dataset.exp)));
function runExperiment(k) {
  S.structures = []; S.storm = null; $('btnNoreaster').disabled = $('btnTropical').disabled = false;
  S.slr = 2;
  if (k === 'groins') { setMode('winter'); [450, 650, 850, 1050].forEach(x => addStructure({ type: 'groin', x, tip: Y0 + 130 })); }
  if (k === 'jetty') { setMode('cycle'); addStructure({ type: 'jetty', x: 900, tip: Y0 + 320 }); addStructure({ type: 'river', x: 960, w: 60, q: 40000 }); }
  if (k === 'salient') { setMode('custom'); S.H0 = 1.2; S.T = 9; S.th = 0; addStructure({ type: 'breakwater', x1: 620, x2: 860, y: Y0 + 120 }); }
  if (k === 'squeeze') { setMode('winter'); S.slr = 15; addStructure({ type: 'groin', x: 420, tip: Y0 + 140 }); addStructure({ type: 'seawall', x1: 600, x2: 1150, y: DUNE_TOE + 2 }); }
  slr.value = S.slr;
  resetBeach(); placed(); refreshTerms();
  try { stage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); } catch (e) {}
  setPlaying(true);
}

// ---------- Maine beach presets ----------
// Each place is a stylised 1.5 km stretch. Structure sizes and positions are approximate; the wave
// settings are teaching estimates (normal = direction the beach faces; turn = clockwise bending of
// the offshore waves by headlands and the bay; expo = offshore wave-height factor).
const FT = 0.3048;
const PLACES = {
  generic: { nests: [[230, 2], [570, 1], [930, 2], [1270, 1]], name: 'Generic beach', normal: 90, turn: 0, expo: 1, d50: 0.3, hstar: 8, K1: 0.2, build: () => {},
    blurb: 'A straight, open beach with nothing built on it yet. A blank sandbox.' },
  campEllis: { nests: [[140, 1], [380, 1]], name: 'Camp Ellis', normal: 73, turn: 10, expo: 0.55, d50: 0.2, hstar: 7, K1: 0.2,
    build: () => {
      addStructure({ type: 'jetty', x: 1250, tip: YL - 25 });
      addStructure({ type: 'river', x: 1340, w: 110, q: 40000 });
      addStructure({ type: 'jetty', x: 1430, tip: YL - 55 });
      addStructure({ type: 'seawall', x1: 930, x2: 1240, y: DUNE_TOE + 2 });
    },
    blurb: 'Saco, at the south end of Saco Bay. The Saco River reaches the sea at the SSE end between its north and south jetties (built from the 1860s on). Sand drifts north along the bay, so the beach beside the jetty gets no new supply and has eroded for over a century; riprap now fronts many homes. The river\'s sand is carried out past the jetty instead of feeding the beach. Waves are gentle most of the time (UNE buoy: mean 0.4 m) but storms come from the E–ENE. Plovers nest toward Ferry Beach; the Camp Ellis–Pine Point stretch had 13 pairs in 2025 but fledged only 3 chicks.' },
  campEllisSpur: { nests: [[140, 1], [380, 1]], name: 'Camp Ellis + spur jetty', normal: 73, turn: 10, expo: 0.55, d50: 0.2, hstar: 7, K1: 0.2,
    build: () => {
      addStructure({ type: 'jetty', x: 1250, tip: YL - 25 });
      addStructure({ type: 'breakwater', x1: 1250 - 750 * FT, x2: 1246, y: Y0 + 150 });
      addStructure({ type: 'river', x: 1340, w: 110, q: 40000 });
      addStructure({ type: 'jetty', x: 1430, tip: YL - 55 });
      addStructure({ type: 'seawall', x1: 930, x2: 1240, y: DUNE_TOE + 2 });
    },
    fill: { x: 1150, V: 56000 },
    blurb: 'Camp Ellis with the Army Corps\' 750-ft (230 m) spur jetty, built off the north jetty and running parallel to shore (construction began in 2026, due to finish in August 2027). It shelters the beach behind it. The first nourishment (about 73,000 yd³, 56,000 m³) is planned for 2028 and is already placed here.' },
  oob: { nests: [[240, 1], [1250, 1]], name: 'Old Orchard Beach', normal: 110, turn: 35, expo: 0.65, d50: 0.2, hstar: 7, K1: 0.2,
    build: () => { addStructure({ type: 'seawall', x1: 520, x2: 1050, y: DUNE_TOE + 2 }); },
    blurb: 'The middle of Saco Bay: a wide, flat, fine-sand beach. Seawalls and riprap back its most built-up stretch. The Pier stands on open piles, so sand passes under it and it is not modelled. Net drift in Saco Bay is toward the north.' },
  pinePoint: { nests: [[420, 2], [700, 2], [1020, 1]], name: 'Pine Point', normal: 110, turn: 40, expo: 0.6, d50: 0.2, hstar: 7, K1: 0.2,
    build: () => { addStructure({ type: 'jetty', x: 200, tip: Y0 + 300 }); addStructure({ type: 'river', x: 90, w: 90, q: 10000 }); },
    blurb: 'Scarborough, at the north end of Saco Bay, beside the Scarborough River jetty. Sand drifting north along the bay piles up against the jetty.' },
  wells: { nests: [[110, 3], [190, 3], [520, 2]], name: 'Wells Beach', normal: 115, turn: 35, expo: 0.9, d50: 0.25, hstar: 8, K1: 0.2,
    build: () => {
      addStructure({ type: 'jetty', x: 300, tip: Y0 + 260 });
      addStructure({ type: 'jetty', x: 430, tip: Y0 + 250 });
      addStructure({ type: 'seawall', x1: 600, x2: 1420, y: DUNE_TOE + 2 });
    },
    blurb: 'Wells Harbor\'s twin rubble jetties (1960s, extended in 1965 to about 1,225 and 1,300 ft, 425 ft apart) guard the Webhannet River inlet at the NNE end, with Drakes Island beyond them. A seawall backs much of the developed Wells Beach to the south. The unarmored sand near the jetties is Maine\'s busiest plover beach: 23 pairs fledged 45 chicks in 2025.' },
  kennebunk: { nests: [], name: 'Kennebunk Beach', normal: 165, turn: 30, expo: 0.6, d50: 0.25, hstar: 7, K1: 0.2,
    build: () => {
      addStructure({ type: 'seawall', x1: 180, x2: 1300, y: DUNE_TOE + 2 });
      addStructure({ type: 'jetty', x: 1380, tip: Y0 + 250 });
      addStructure({ type: 'river', x: 1450, w: 50, q: 5000 });
    },
    blurb: 'Gooch\'s, Middle and Mother\'s beaches along Beach Avenue face south, with a long seawall behind them and the Kennebunk River jetties at the WSW end. With the seawall and no dry upper beach, there is no nesting habitat here.' },
  ogunquit: { nests: [[280, 3], [600, 3], [920, 3], [1230, 3]], name: 'Ogunquit Beach', normal: 100, turn: 0, expo: 0.9, d50: 0.25, hstar: 8, K1: 0.2,
    build: () => { addStructure({ type: 'river', x: 1440, w: 45, q: 8000 }); },
    blurb: 'A natural barrier spit with dunes and the Ogunquit River behind it, reaching the sea at the south end. With no hard structures, it is a good control to compare with the others. It is one of Maine\'s main plover beaches (12+ pairs in 2025).' },
  popham: { nests: [[620, 2], [880, 2], [1320, 2]], name: 'Popham Beach', normal: 180, turn: 45, expo: 0.8, d50: 0.3, hstar: 8, K1: 0.2,
    build: () => {
      addStructure({ type: 'river', x: 60, w: 140, q: 60000 });
      addStructure({ type: 'seawall', x1: 150, x2: 380, y: DUNE_TOE + 2 });
      addStructure({ type: 'breakwater', x1: 1020, x2: 1180, y: Y0 + 110 });
      addStructure({ type: 'river', x: 1460, w: 40, q: 5000 });
    },
    blurb: 'Phippsburg. A south-facing beach between the Kennebec River (E end) and the Morse River (W end). Fox Island, a rock island just offshore, acts like a natural breakwater with a tombolo that comes and goes. A riprap seawall at Hunnewell Beach causes erosion at its end. The beach swings hundreds of feet as the river channels move, which the model can\'t capture.' }
};
function syncSliders() {
  slr.value = S.slr; vol.value = S.vol; $('rw').value = S.riverW; k1.value = S.K1; d50.value = S.d50; hsIn.value = S.hstar;
  $('nrm').value = S.normal; $('trn').value = S.turn; $('expo').value = S.expo;
  updateFrameNote();
}
const chips = $('placeChips');
Object.entries(PLACES).forEach(([k, pl]) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.place = k; b.textContent = pl.name;
  b.addEventListener('click', () => loadPlace(k)); chips.appendChild(b);
});
function loadPlace(k) {
  const pl = PLACES[k]; S.place = k;
  Object.assign(S, { normal: pl.normal, turn: pl.turn, expo: pl.expo, d50: pl.d50, hstar: pl.hstar, K1: pl.K1, slr: 2 });
  S.structures = []; S.storm = null;
  S.nests = (pl.nests || []).map(([x, pairs]) => ({ x, pairs, washed: false }));
  setMode('cycle'); resetBeach(); pl.build();
  if (pl.fill) { const keep = S.vol; S.vol = pl.fill.V; S.silent = true; nourish(pl.fill.x); S.silent = false; S.vol = keep; }
  S.sandAdded = pl.fill ? pl.fill.V : 0;
  syncSliders(); refreshTerms(); setPlaying(false);
  chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.place === k));
  $('placeBlurb').innerHTML = `<b>${pl.name}.</b> ${pl.blurb}` + (k === 'generic' ? '' : ' <span class="fine">This is a simplified 1.5 km stretch: structure sizes and positions are approximate, and the settings are teaching estimates, not a calibrated model. Press Start to run it.</span>');
  if (k !== 'generic') { placed(); toast(`📍 Welcome to ${pl.name}! Press Start when you're ready.`); }
}

function resetBeach() {
  S.alert = null; S.houses.forEach(h => { h.gone = false; }); S.t = 0; S.eta = 0; S.fills = []; S.sandAdded = 0; S.storms = 0; S.storm = null; S.fledged = 0; S.lastMonth = -1; S.nests.forEach(n => { n.washed = false; });
  $('btnNoreaster').disabled = $('btnTropical').disabled = false;
  W = currentWaves();
  const yeq = -W_CS * (0.068 * W.Hb) / (BERM + 1.28 * W.Hb);
  for (let i = 0; i < N; i++) { S.ycs[i] = yeq; S.yls[i] = Y0 - yeq; Hc[i] = W.Hb; }
  Q.fill(0); totals();
}

// ---------- equations panel ----------
const HX = { blue: '2F78D6', orange: 'D95926', purple: '8A55C9', slate: '7A8790', green: '1FA37A', amber: 'C98500', teal: '1690A0' };
const col = (c, s) => String.raw`{\color{#${c}}{${s}}}`;
function activeSet() {
  const t = new Set(S.structures.map(s => s.type));
  return {
    groin: t.has('groin') || t.has('jetty') || t.has('tgroin'),
    breakwater: t.has('breakwater') || t.has('tgroin'),
    seawall: t.has('seawall'), river: t.has('river'), fill: S.fills.length > 0,
    storm: S.storms > 0, slr: S.slr > 0
  };
}
function masterTeX(a) {
  let src = '';
  if (a.river || a.fill) src += col(HX.green, String.raw`+\,\frac{q(x,t)}{D}`);
  if (a.slr) src += col(HX.teal, String.raw`-\,\frac{W_*}{D}\frac{d\eta}{dt}`);
  let q = String.raw`a_1 \sin 2(\theta_b-\phi)`;
  if (a.breakwater) q += col(HX.purple, String.raw`\;-\;a_2\cos(\theta_b-\phi)\,\frac{\partial H_b}{\partial x}`);
  const surge = a.storm ? col(HX.amber, '+\\,S') : '';
  let lines = [
    String.raw`y &= y_s + y_c`,
    String.raw`\frac{\partial y_s}{\partial t} &= -\frac{1}{D}\frac{\partial Q}{\partial x}` + src,
    String.raw`Q &= \left(H_b^2 C_g\right)_b\left[${q}\right]`,
    String.raw`\frac{\partial y_c}{\partial t} &= k\,\left(y_{eq}-y_c\right),\quad y_{eq} = -W\,\frac{0.068H_b${surge}}{B+1.28H_b}`
  ];
  const bc = [];
  if (a.groin) bc.push(col(HX.orange, String.raw`Q(x_g) = \mathrm{BYP}_g\,Q`));
  if (a.seawall) bc.push(col(HX.slate, String.raw`y \ge y_w`));
  if (bc.length) lines.push(String.raw`&\text{with}\;\; ` + bc.join(String.raw`,\;\; `));
  return String.raw`\begin{aligned}` + lines.join(String.raw`\\[4pt]`) + String.raw`\end{aligned}`;
}
const TERMS = [
  { key: 'budget', core: true, c: 'blue', title: 'Sand budget', tag: 'always on',
    tex: String.raw`\frac{\partial y_s}{\partial t} = -\frac{1}{D}\frac{\partial Q}{\partial x}`,
    text: 'Think of the beach as a row of buckets. Where more sand leaves a stretch than arrives (\\(Q\\) grows along the shore), the shoreline moves back. \\(D\\) is the depth of beach that moves: closure depth \\(h_*\\) plus berm height \\(B\\).',
    live: [['D', 'D'], ['Beach length', 'len']] },
  { key: 'drift', core: true, c: 'blue', title: 'Longshore drift', tag: 'always on',
    tex: String.raw`Q = \left(H_b^2C_g\right)_b\,a_1\sin 2(\theta_b-\phi),\qquad \phi=\arctan\frac{\partial y}{\partial x}`,
    text: 'Waves that hit the beach at an angle push sand along it, fastest at 45° and not at all when they arrive straight on. \\(\\phi\\) is the local tilt of the shoreline, so a beach that turns to face the waves slows its own drift.',
    live: [['Drift mid-beach', 'Qmid'], ['\\(a_1\\)', 'a1']] },
  { key: 'waves', core: true, c: 'blue', title: 'Waves reaching the beach', tag: 'always on',
    tex: String.raw`H_b = 0.39\,g^{1/5}\left(T H_0^2\right)^{2/5},\qquad \frac{\sin\theta_b}{C_b} = \frac{\sin\theta_0}{C_0}`,
    text: 'Offshore waves of height \\(H_0\\) and period \\(T\\) grow as the water shallows and break at height \\(H_b\\). They also bend (refract) to face the beach, so a steep offshore angle becomes a small one at the breakers.',
    live: [['\\(H_0\\)', 'H0'], ['\\(H_b\\)', 'Hb'], ['\\(\\theta_0 \\to \\theta_b\\)', 'ang'], ['Surf zone', 'yB']] },
  { key: 'cross', core: true, c: 'blue', title: 'Beach breathing (cross-shore)', tag: 'always on',
    tex: String.raw`\frac{\partial y_c}{\partial t}=k\,(y_{eq}-y_c),\qquad y_{eq}=-W\frac{0.068H_b+S}{B+1.28H_b}`,
    text: 'Big waves pull sand off the beach into an offshore bar, so the beach narrows; calm waves push it back. Erosion is fast (\\(k \\approx 150\\) per year, days) and recovery is slow (\\(k \\approx 8\\) per year, weeks). This is why beaches are narrower in winter.',
    live: [['\\(y_{eq}\\) now', 'yeq'], ['\\(y_c\\) now', 'yc']] },
  { key: 'smooth', core: true, c: 'blue', title: 'Why bumps spread out', tag: 'the big idea',
    tex: String.raw`\frac{\partial y}{\partial t} \approx \varepsilon\,\frac{\partial^2 y}{\partial x^2},\qquad \varepsilon = \frac{2Q_0}{D}`,
    text: 'For small angles the drift equation turns into the heat equation (Pelnard-Considère, 1956). A bump of sand spreads out along the shore the way heat spreads along a metal bar.',
    live: [['\\(\\varepsilon\\)', 'eps'], ['A 500 m bump spreads in', 'tspread']] },
  { key: 'groin', c: 'orange', title: 'Groins, spurs and jetties', tag: 'from your structures',
    tex: String.raw`\begin{gathered}Q(x_g) = \mathrm{BYP}\cdot Q\\ \mathrm{BYP} = 1-\frac{y_G}{y_B},\qquad y_B = \left(\frac{h_b}{A}\right)^{3/2}\end{gathered}`,
    text: 'A groin blocks the part of the surf zone it reaches, so sand piles up on the updrift side and the downdrift side starves. \\(y_G\\) is how far it sticks out past the shoreline and \\(y_B\\) is the surf-zone width. Once sand reaches the tip, it bypasses. Waves are also calmer in its lee (Bakker, 1968).',
    live: [['Bypassing', 'byp']], lock: 'Add a groin, spur or jetty' },
  { key: 'breakwater', c: 'purple', title: 'Breakwater shadow', tag: 'from your structures',
    tex: String.raw`\begin{gathered}Q = \left(H_b^2C_g\right)_b\left[a_1\sin2(\theta_b-\phi) - a_2\cos(\theta_b-\phi)\frac{\partial H_b}{\partial x}\right]\\ H_b \to K_d\,H_b \ \text{behind the breakwater}\end{gathered}`,
    text: 'Behind a breakwater the waves are smaller (\\(K_d \\lt 1\\)) because they only reach it by bending around the ends (diffraction). Sand flows from where waves are big to where they are small, building a bulge called a salient. If it reaches the breakwater it becomes a tombolo.',
    live: [['Smallest \\(K_d\\) on shore', 'kd'], ['Shape', 'salient']], lock: 'Add a breakwater or T-groin' },
  { key: 'seawall', c: 'slate', title: 'Seawall', tag: 'from your structures',
    tex: String.raw`y(x,t) \ge y_w`,
    text: 'A seawall stops the shoreline from moving landward, but it does not stop sand from leaving. The beach in front narrows and can disappear. This is called coastal squeeze.',
    live: [['Wall with no dry beach', 'wallbare']], lock: 'Add a seawall' },
  { key: 'river', c: 'green', title: 'River sand supply', tag: 'from your rivers',
    tex: String.raw`q(x,t) = Q_r\,\delta(x-x_r)`,
    text: 'A river delivers new sand at one point along the shore. The drift then spreads it out, so beaches downdrift of a river mouth are fed.',
    live: [['Supply', 'qr']], lock: 'Add a river' },
  { key: 'fill', c: 'green', title: 'Beach nourishment', tag: 'from your fills',
    tex: String.raw`q(x,t) = \frac{V}{\sqrt{2\pi}\,\sigma}\,e^{-(x-x_n)^2/2\sigma^2}\,\delta(t-t_n)`,
    text: 'Trucks or dredges add a volume \\(V\\) of sand in one go. The bump then spreads along the shore (the heat equation again), feeding the neighbours and slowly flattening out.',
    live: [['Fills', 'nfill'], ['Total added', 'vfill']], lock: 'Add sand' },
  { key: 'storm', c: 'amber', title: 'Storm surge', tag: 'from your storms',
    tex: String.raw`y_{eq} = -W\,\frac{0.068H_b + S}{B+1.28H_b}`,
    text: 'During a storm the water rises by the surge \\(S\\) and the waves are huge, so the equilibrium beach sits far landward. The beach races toward it for a few days, then slowly recovers as sand comes back from the bar.',
    live: [['Surge \\(S\\)', 'surge'], ['Storms so far', 'nstorm']], lock: 'Send a storm' },
  { key: 'slr', c: 'teal', title: 'Sea-level rise (Bruun rule)', tag: 'from the sea-level slider',
    tex: String.raw`\frac{\partial y_s}{\partial t} \mathrel{+}= -\frac{W_*}{h_*+B}\,\frac{d\eta}{dt}`,
    text: 'As the sea rises, the whole beach profile shifts up and landward to keep its shape. Each millimetre of rise moves the shoreline back by \\(W_*/(h_*+B)\\) millimetres, often 50 to 100 times more.',
    live: [['Rise rate', 'slrr'], ['Retreat', 'slrret'], ['Total rise', 'eta']], lock: 'Raise the sea level' }
];
const COLVAR = { blue: 'var(--blue)', orange: 'var(--orange)', purple: 'var(--purple)', slate: 'var(--slate)', green: 'var(--green)', amber: 'var(--amber)', teal: 'var(--teal)' };
let lastSig = '', firstBuild = true;
function typeset(els) {
  if (window.MathJax && MathJax.typesetPromise) { MathJax.typesetClear(els); return MathJax.typesetPromise(els).catch(() => {}); }
}
function refreshTerms(flash) {
  const a = activeSet();
  const sig = JSON.stringify(a);
  if (sig === lastSig && !flash) return;
  const prev = lastSig ? JSON.parse(lastSig) : {};
  lastSig = sig;
  const master = $('master');
  renderMaster(masterTeX(a));
  if (!firstBuild) { master.classList.remove('flash'); void master.offsetWidth; master.classList.add('flash'); }
  const terms = $('terms'); terms.innerHTML = '';
  const locked = $('locked'); locked.innerHTML = '';
  for (const t of TERMS) {
    const on = t.core || a[t.key];
    if (!on) { const sp = document.createElement('span'); sp.style.setProperty('--c', COLVAR[t.c]); sp.innerHTML = `<b>+</b> ${t.lock} to add “${t.title.toLowerCase()}”`; locked.appendChild(sp); continue; }
    const el = document.createElement('article'); el.className = 'term'; el.dataset.key = t.key; el.style.setProperty('--c', COLVAR[t.c]);
    if (!firstBuild && !t.core && !prev[t.key]) el.classList.add('new');
    el.innerHTML = `<header><h3>${t.title}</h3><span class="tag">${t.tag}</span></header><div class="tex">\\[${t.tex}\\]</div><p>${t.text}</p><dl class="live">${t.live.map(([k, id]) => `<div><dt>${k}</dt><dd data-live="${id}">–</dd></div>`).join('')}</dl>`;
    terms.appendChild(el);
  }
  // non-core cards first after master for visibility
  [...terms.querySelectorAll('.term')].filter(el => !TERMS.find(t => t.key === el.dataset.key).core).reverse().forEach(el => terms.prepend(el));
  firstBuild = false;
  typeset([terms, document.querySelector('.math-head')]);
  updateLive();
}
let masterSrc = '';
function renderMaster(tex) {
  masterSrc = tex; const el = $('master');
  if (window.MathJax && MathJax.tex2svgPromise) {
    MathJax.tex2svgPromise(tex, { display: true }).then(node => { if (masterSrc === tex) { el.innerHTML = ''; el.appendChild(node); } }).catch(() => { el.innerHTML = '<div class="tex-fallback"></div>'; el.firstChild.textContent = tex; });
  } else { el.innerHTML = '<div class="tex-fallback">Loading equations…</div>'; }
}
window.__mjReady = () => { renderMaster(masterSrc); typeset([$('terms'), document.querySelector('.math-head'), document.querySelector('.glossary')]); };

function updateLive() {
  const w = W || currentWaves(), Dd = Dact(), A = Aprof();
  let Qm = 0; for (let j = 40; j <= 110; j++) Qm += Q[j]; Qm /= 71;
  const E = w.Hb * w.Hb * Math.sqrt(g * w.hb), Q0 = E * a1f() * SEC, eps = 2 * Q0 / Dd;
  const stems = S.structures.filter(isStem);
  let kdMin = 1; for (let i = 0; i < N; i++) kdMin = Math.min(kdMin, Kd[i] || 1);
  let shape = '—';
  for (const s of S.structures) if (s.type === 'breakwater' || s.type === 'tgroin') {
    const yb = s.type === 'breakwater' ? s.y : s.tip, xm = s.type === 'breakwater' ? (s.x1 + s.x2) / 2 : s.x;
    const gap = yb - shoreAt(xm); shape = gap < 8 ? 'tombolo (joined)' : `salient, ${gap.toFixed(0)} m gap`;
  }
  let bare = 0; for (const s of S.structures) if (s.type === 'seawall') for (let i = s.i1; i <= s.i2; i++) if (y[i] - s.y < 3) bare += DX;
  let yeqAvg = 0, ycAvg = 0; for (let i = 0; i < N; i++) { const Hl = Hc[i] || w.Hb; yeqAvg += -W_CS * (0.068 * Hl + w.surge) / (BERM + 1.28 * Hl); ycAvg += S.ycs[i]; }
  const vals = {
    D: `${Dd.toFixed(1)} m`, len: '1,500 m', Qmid: fmtQ(Qm), a1: a1f().toFixed(4),
    H0: `${w.H0.toFixed(2)} m`, Hb: `${w.Hb.toFixed(2)} m`, ang: `${Math.abs(w.thDeg).toFixed(0)}° → ${Math.abs(w.thb * 180 / Math.PI).toFixed(1)}°`,
    yB: `${Math.pow(w.hb / A, 1.5).toFixed(0)} m`, yeq: `${(yeqAvg / N).toFixed(1)} m`, yc: `${(ycAvg / N).toFixed(1)} m`,
    eps: `${fmtVol(eps)} m²/yr`, tspread: eps > 1 ? `${(500 * 500 / (4 * eps) * 12).toFixed(1)} months` : '—',
    byp: stems.length ? stems.map(s => `${s.type === 'jetty' ? 'J' : 'G'}@${s.x}m ${Math.round((s.byp ?? 1) * 100)}%`).join(' · ') : '—',
    kd: kdMin.toFixed(2), salient: shape, wallbare: `${bare} m`,
    qr: S.structures.filter(s => s.type === 'river').map(s => `${fmtVol(s.q)} m³/yr`).join(', ') || '—',
    nfill: String(S.fills.length), vfill: `${fmtVol(S.sandAdded)} m³`,
    surge: `${w.surge.toFixed(2)} m`, nstorm: String(S.storms),
    slrr: `${S.slr.toFixed(1)} mm/yr`, slrret: `${(S.slr * 1e-3 * Wstar() / Dd).toFixed(2)} m/yr`, eta: `${(S.eta * 1000).toFixed(0)} mm`
  };
  document.querySelectorAll('[data-live]').forEach(el => { const v = vals[el.dataset.live]; if (v !== undefined && el.textContent !== v) el.textContent = v; });
  document.querySelectorAll('.term[data-key="storm"]').forEach(el => el.classList.toggle('hot', !!S.storm));
  document.querySelectorAll('.term[data-key="cross"]').forEach(el => el.classList.toggle('hot', !!S.storm));
}

// ---------- readouts ----------
function updateReadouts() {
  const w = W || currentWaves();
  const mp = monthPos(), yr = Math.floor(S.t);
  $('clock').textContent = `Year ${yr} · ${MONTHS[Math.floor(mp)]}`;
  let Qm = 0; for (let j = 40; j <= 110; j++) Qm += Q[j]; Qm /= 71;
  $('driftPill').textContent = 'Sand drift ' + fmtQ(Qm);
  const sb = $('stormBanner');
  if (S.storm) { const left = (S.storm.t0 + S.storm.dur - S.t) * 365; sb.hidden = false; sb.textContent = `${S.storm.def.name}: waves ${w.H0.toFixed(1)} m, surge ${w.surge.toFixed(1)} m · ${Math.max(0, left).toFixed(1)} days left (slow motion)`; }
  // sliders follow waves
  const b = siteBase();
  if (document.activeElement !== h0) h0.value = b.H0; if (document.activeElement !== per) per.value = b.T;
  $('h0o').textContent = `${b.H0.toFixed(2)} m`; $('pero').textContent = `${b.T.toFixed(1)} s`;
  drawDial(b.th);
  $('slro').textContent = `${S.slr.toFixed(1)} mm/yr`; $('volo').textContent = `${fmtVol(S.vol)} m³`; $('rwo').textContent = `${S.riverW} m`;
  $('nrmo').textContent = `${compass(S.normal)} ${Math.round(S.normal)}°`; $('trno').textContent = `${S.turn > 0 ? '+' : ''}${S.turn}°`; $('expoo').textContent = `× ${S.expo.toFixed(2)}`;
  $('k1o').textContent = S.K1.toFixed(2); $('d50o').textContent = `${S.d50.toFixed(2)} mm`; $('hso').textContent = `${S.hstar.toFixed(1)} m`;
  // stats
  let sum = 0, mn = 1e9, mnI = 0, mx = -1e9, mxI = 0;
  for (let i = 0; i < N; i++) { const d = y[i] - Y0; sum += d; if (d < mn) { mn = d; mnI = i; } if (d > mx) { mx = d; mxI = i; } }
  $('stTime').textContent = `${S.t.toFixed(1)} yr`;
  $('stAvg').textContent = `${sgn(sum / N)} m`;
  $('stWorst').textContent = `${sgn(Math.min(0, mn))} m`; $('stWorstS').textContent = mn < -0.5 ? `at ${Math.round((mnI + 0.5) * DX)} m` : 'none yet';
  $('stBest').textContent = `${sgn(Math.max(0, mx))} m`; $('stBestS').textContent = mx > 0.5 ? `at ${Math.round((mxI + 0.5) * DX)} m` : 'none yet';
  let risk = 0, lost = 0, vis = 0; for (const h of S.houses) { if (!houseVisible(h)) continue; vis++; const s = houseStatus(h); if (s === 'risk') risk++; if (s === 'gone') lost++; }
  if (S.playing && S.alert && risk > S.alert.risk) toast('🏠 A house is now at risk!');
  $('stHouses').textContent = `${risk + lost} / ${vis}`;
  $('stHousesS').textContent = lost ? `${lost} washed away, ${risk} with under 15 m of beach` : 'beach under 15 m wide';
  $('stHouseBox').className = 'stat' + (risk + lost ? ' bad' : '');
  $('stSand').textContent = fmtVol(S.sandAdded);
  const nn = S.nests.length; let nOk = 0, nRisk = 0, nLost = 0, nWash = 0;
  for (const n of S.nests) { const st = nestStatus(n); if (st === 'ok') nOk++; else if (st === 'risk') nRisk++; else nLost++; if (n.washed && inSeason()) nWash++; }
  $('stNests').textContent = nn ? `${nOk} / ${nn} safe` : 'none';
  const chicks = Math.round(S.fledged);
  $('stNestsS').textContent = !nn ? 'add a nesting area' : `${inSeason() ? 'Nesting now' : 'Off season'} · ${chicks} chick${chicks === 1 ? '' : 's'} fledged` + (nWash ? ` · ${nWash} washed out` : '') + (nLost ? ` · ${nLost} lost` : '');
  $('stNestBox').className = 'stat' + (nn && (nRisk || nLost || nWash) ? ' bad' : '');
  let tomb = 0; for (const s of S.structures) if (s.type === 'breakwater') { const xm = (s.x1 + s.x2) / 2; if (s.y - shoreAt(xm) < 8) tomb++; }
  if (S.playing && S.alert) {
    if (nLost > S.alert.nLost) toast('🪹 A nesting area just lost its beach.');
    if (tomb > S.alert.tomb) toast('🏝️ Tombolo! The beach has joined the breakwater.');
  }
  S.alert = { risk, nLost, tomb };
}

// ---------- main loop ----------
let last = performance.now(), lastUI = 0, wavePhase = 0;
function frame(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000); last = now;
  wavePhase += (W ? W.om : 0.75) * dtReal * 2.2; // accumulate, so a change in period never makes the crests jump or race
  if (S.playing) { advance(dtReal); moveParticles(dtReal); nestSeasonTick(W); checkHouses(); }
  updateCritters(dtReal, now / 1000); updateCars(dtReal);
  const tSec = now / 1000;
  draw(tSec);
  if (now - lastUI > 200) { lastUI = now; updateReadouts(); updateLive(); drawChart(); }
  requestAnimationFrame(frame);
}

// ---------- light / dark ----------
function applyTheme(t, save) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  $('themeSeg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === t));
  if (save) { try { localStorage.setItem('shoreline-theme', t); } catch (e) {} }
  drawChart();
}
$('themeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) applyTheme(b.dataset.themeSet, true); });
(function initTheme() {
  let t = null; try { t = localStorage.getItem('shoreline-theme'); } catch (e) {}
  if (t) applyTheme(t, false);
  else { const cur = document.documentElement.getAttribute('data-theme'); $('themeSeg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === (cur || 'auto'))); }
})();

// ---------- init ----------
h0.value = 1; per.value = 8.5; syncSliders();
S.nests = PLACES.generic.nests.map(([x, pairs]) => ({ x, pairs, washed: false }));
setTool('inspect'); setMode('cycle'); setSpeed(SP_MIN); setPlaying(false);
chips.querySelector('[data-place="generic"]').setAttribute('aria-pressed', 'true'); $('placeBlurb').innerHTML = '<b>Generic beach.</b> ' + PLACES.generic.blurb + ' Pick a Maine beach to load its structures and wave settings.';
resize(); window.addEventListener('resize', () => { resize(); });
resetBeach();
refreshTerms(); updateReadouts(); drawChart();
if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { /* waves still animate slowly; user can pause */ }
requestAnimationFrame(frame);
})();
