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
  K1: 0.2, d50: 0.3, hstar: 8, normal: 90, turn: 0, expo: 1, place: 'generic', nests: [], fledged: 0, lastMonth: -1, vol: 200000, tool: 'inspect', nextId: 1, placed: false, lastSurge: 0
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
  for (const s of S.structures) if (s.type === 'river') S.yls[s.cell] += s.q * c;
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
    const sy = shoreAt(s.x), rg = ctx.createRadialGradient(px(s.x), py(sy), 2, px(s.x), py(sy), 150 * sc);
    rg.addColorStop(0, 'rgba(150, 128, 70, 0.55)'); rg.addColorStop(1, 'rgba(150, 128, 70, 0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(px(s.x), py(sy), 150 * sc, 0, 7); ctx.fill();
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
  // dune + road + houses
  ctx.fillStyle = '#9fb477'; ctx.fillRect(0, py(DUNE_TOE), CW, (DUNE_TOE - 40) * sc);
  const rg2 = seeded(7);
  ctx.strokeStyle = 'rgba(80, 110, 60, 0.55)'; ctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) { const X = rg2() * XL, Y = 42 + rg2() * 26; ctx.beginPath(); ctx.moveTo(px(X), py(Y)); ctx.lineTo(px(X + 2), py(Y + 4)); ctx.stroke(); }
  ctx.fillStyle = '#d8d2c3'; ctx.fillRect(0, py(40), CW, 26 * sc);
  ctx.fillStyle = '#6f757b'; ctx.fillRect(0, py(12), CW, 12 * sc);
  ctx.strokeStyle = 'rgba(255, 230, 140, 0.8)'; ctx.setLineDash([8, 8]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, py(6)); ctx.lineTo(CW, py(6)); ctx.stroke(); ctx.setLineDash([]);
  for (const hx of HOUSES) {
    const st = houseStatus(hx), wpx = Math.max(8, 26 * sc), hpx = Math.max(7, 20 * sc), cx = px(hx), cy = py(33);
    ctx.save(); ctx.translate(cx, cy); if (st === 'lost') ctx.rotate(0.35);
    ctx.fillStyle = st === 'lost' ? '#8f9599' : '#f4efe6'; ctx.fillRect(-wpx / 2, -hpx / 2, wpx, hpx);
    ctx.fillStyle = st === 'ok' ? '#6c4b3b' : st === 'risk' ? '#d95926' : '#50565a';
    ctx.fillRect(-wpx / 2, -hpx / 2, wpx, hpx * 0.45);
    if (st === 'risk') { ctx.strokeStyle = '#d95926'; ctx.lineWidth = 2; ctx.strokeRect(-wpx / 2 - 2, -hpx / 2 - 2, wpx + 4, hpx + 4); }
    ctx.restore();
  }
  drawNests();
  // rivers (channel)
  for (const s of S.structures) if (s.type === 'river') {
    const sy = shoreAt(s.x);
    ctx.fillStyle = '#3f8fb2'; ctx.beginPath();
    ctx.moveTo(px(s.x - 18), CH); ctx.bezierCurveTo(px(s.x - 30), py(sy * 0.5), px(s.x - 12), py(sy - 20), px(s.x - 16), py(sy + 2));
    ctx.lineTo(px(s.x + 16), py(sy + 2)); ctx.bezierCurveTo(px(s.x + 12), py(sy - 20), px(s.x + 30), py(sy * 0.5), px(s.x + 18), CH);
    ctx.closePath(); ctx.fill();
  }
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
    if (m === 4) S.nests.forEach(n => { n.washed = false; });           // May: birds arrive, new nests
    if (S.lastMonth === 7 && m === 8) {                                    // Sep: count the season's chicks
      for (const n of S.nests) {
        const st = nestStatus(n);
        if (!n.washed && st !== 'lost') S.fledged += n.pairs * CHICKS_PER_PAIR * (st === 'risk' ? 0.5 : 1);
      }
    }
    S.lastMonth = m;
  }
  // a storm during nesting season washes over nests on narrow beaches
  if (w && w.sf > 0.4 && inSeason()) for (const n of S.nests) {
    const wid = Math.min(shoreAt(n.x - 20), shoreAt(n.x), shoreAt(n.x + 20)) - DUNE_TOE;
    if (wid < 25 + 30 * w.surge) n.washed = true;
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
function drawNests() {
  const season = inSeason();
  for (const n of S.nests) {
    const st = nestStatus(n), sh = shoreAt(n.x);
    const y1 = DUNE_TOE + 2, y2 = Math.min(DUNE_TOE + 24, sh - 1);
    const x1 = px(n.x - 30), x2 = px(n.x + 30), top = py(Math.max(y1 + 2, y2)), bot = py(y1);
    ctx.setLineDash([3, 2]); ctx.lineWidth = 1.2;
    ctx.strokeStyle = st === 'lost' ? 'rgba(90,90,90,0.8)' : st === 'risk' ? '#d95926' : '#2f5e3a';
    ctx.strokeRect(x1, top, x2 - x1, bot - top); ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(x1 - 1, top - 1, 2, bot - top + 2); ctx.fillRect(x2 - 1, top - 1, 2, bot - top + 2);
    const k = Math.max(1.1, Math.min(1.9, sc * 2.8));
    if (st === 'lost') {
      ctx.strokeStyle = '#d95926'; ctx.lineWidth = 2; const cx = (x1 + x2) / 2, cy = (top + bot) / 2;
      ctx.beginPath(); ctx.moveTo(cx - 5, cy - 4); ctx.lineTo(cx + 5, cy + 4); ctx.moveTo(cx + 5, cy - 4); ctx.lineTo(cx - 5, cy + 4); ctx.stroke();
    } else if (season && !n.washed) {
      for (let i = 0; i < n.pairs; i++) drawPlover(x1 + (x2 - x1) * (i + 1) / (n.pairs + 1), (top + bot) / 2, k);
    } else if (season && n.washed) {
      ctx.fillStyle = '#6aa9c9'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(x1 + (x2 - x1) * (i + 1) / 4, (top + bot) / 2, 1.8, 1.3, 0, 0, 7); ctx.fill(); }
    }
  }
}
function houseStatus(hx) {
  for (const s of S.structures) if (s.type === 'seawall' && hx >= s.x1 && hx <= s.x2) return 'ok';
  const sh = Math.min(shoreAt(hx - 15), shoreAt(hx), shoreAt(hx + 15));
  if (sh < 44) return 'lost';
  if (sh - DUNE_TOE < 15) return 'risk';
  return 'ok';
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
  { id: 'river', label: 'River', hint: '<b>River:</b> click the beach to add a river that delivers 40,000 m³ of new sand a year.',
    svg: '<rect x="2" y="16" width="20" height="6" rx="1" fill="#e2c68c"/><path d="M11 23 C8 18 15 15 11 9 M11 9 l-3 -5" stroke="#2f82ad" stroke-width="3.2" fill="none" stroke-linecap="round"/>' },
  { id: 'nest', label: 'Nesting area', hint: '<b>Nesting area:</b> click the upper beach to rope off a shorebird nesting area (piping plovers and least terns nest on open sand just in front of the dunes, May–August).',
    svg: '<rect x="2" y="16" width="20" height="6" rx="1" fill="#e2c68c"/><path d="M4 16V9M20 16V9M4 10h16" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1.5" fill="none"/><ellipse cx="12" cy="13" rx="4" ry="2.6" fill="#d8c7a0" stroke="currentColor" stroke-width="1"/><circle cx="15.2" cy="11" r="1.7" fill="#d8c7a0" stroke="currentColor" stroke-width="1"/><path d="M13.6 12.3h3" stroke="#1b1b1b" stroke-width="1.2"/>' },
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
  if (s.type === 'river') { s.cell = clamp(Math.floor(s.x / DX), 0, N - 1); }
  S.structures.push(s); placed(); refreshTerms();
}
function placed() { if (!S.placed) { S.placed = true; document.getElementById('hint').hidden = true; } }
function nourish(X) {
  const V = S.vol, sig0 = 120, Dd = Dact();
  for (let i = 0; i < N; i++) { const x = (i + 0.5) * DX; S.yls[i] += V / (Dd * sig0 * Math.sqrt(2 * Math.PI)) * Math.exp(-((x - X) ** 2) / (2 * sig0 * sig0)); }
  S.fills.push({ x: X, V, t: S.t }); S.sandAdded += V;
  fx.push({ x: X, t0: performance.now() / 1000, label: '+' + fmtVol(V) + ' m³' });
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
  for (const n of S.nests) { const d = seg(n.x - 30, DUNE_TOE + 12, n.x + 30, DUNE_TOE + 12); if (d < bd) { bd = d; bestNest = n; } }
  if (bestNest) { S.nests = S.nests.filter(n => n !== bestNest); return; }
  if (best) { S.structures = S.structures.filter(s => s !== best); refreshTerms(); }
}
cv.addEventListener('pointerdown', e => {
  const p = worldFromEvent(e);
  if (S.tool === 'inspect') return;
  if (S.tool === 'erase') { eraseAt(p); return; }
  if (S.tool === 'nourish') { nourish(snapX(p.X)); return; }
  if (S.tool === 'river') { addStructure({ type: 'river', x: snapX(p.X), q: 40000 }); return; }
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
  const nest = S.nests.find(n => Math.abs(n.x - p.X) < 32 && p.Y < DUNE_TOE + 40 && p.Y > DUNE_TOE - 10);
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
  $('btnNoreaster').disabled = $('btnTropical').disabled = true;
  setPlaying(true);
  refreshTerms(true);
}
function onStormEnd() { $('btnNoreaster').disabled = $('btnTropical').disabled = false; $('stormBanner').hidden = true; setTimeout(() => refreshTerms(), 0); }

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
  if (k === 'jetty') { setMode('cycle'); addStructure({ type: 'jetty', x: 900, tip: Y0 + 320 }); addStructure({ type: 'river', x: 930, q: 40000 }); }
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
      addStructure({ type: 'jetty', x: 1300, tip: YL - 25 });
      addStructure({ type: 'seawall', x1: 980, x2: 1290, y: DUNE_TOE + 2 });
      addStructure({ type: 'river', x: 1440, q: 40000 });
    },
    blurb: 'Saco, at the south end of Saco Bay. The Saco River\'s north jetty (built from the 1860s on) sits at the SSE end. Sand drifts north along the bay, so the beach beside the jetty gets no new supply and has eroded for over a century; riprap now fronts many homes. The river\'s sand is carried out past the jetty instead of feeding the beach. Waves are gentle most of the time (UNE buoy: mean 0.4 m) but storms come from the E–ENE. Plovers nest toward Ferry Beach; the Camp Ellis–Pine Point stretch had 13 pairs in 2025 but fledged only 3 chicks.' },
  campEllisSpur: { nests: [[140, 1], [380, 1]], name: 'Camp Ellis + spur jetty', normal: 73, turn: 10, expo: 0.55, d50: 0.2, hstar: 7, K1: 0.2,
    build: () => {
      addStructure({ type: 'jetty', x: 1300, tip: YL - 25 });
      addStructure({ type: 'breakwater', x1: 1300 - 750 * FT, x2: 1296, y: Y0 + 150 });
      addStructure({ type: 'seawall', x1: 980, x2: 1290, y: DUNE_TOE + 2 });
      addStructure({ type: 'river', x: 1440, q: 40000 });
    },
    fill: { x: 1150, V: 56000 },
    blurb: 'Camp Ellis with the Army Corps\' 750-ft (230 m) spur jetty, built off the north jetty and running parallel to shore (construction began in 2026, due to finish in August 2027). It shelters the beach behind it. The first nourishment (about 73,000 yd³, 56,000 m³) is planned for 2028 and is already placed here.' },
  oob: { nests: [[240, 1], [1250, 1]], name: 'Old Orchard Beach', normal: 110, turn: 35, expo: 0.65, d50: 0.2, hstar: 7, K1: 0.2,
    build: () => { addStructure({ type: 'seawall', x1: 520, x2: 1050, y: DUNE_TOE + 2 }); },
    blurb: 'The middle of Saco Bay: a wide, flat, fine-sand beach. Seawalls and riprap back its most built-up stretch. The Pier stands on open piles, so sand passes under it and it is not modelled. Net drift in Saco Bay is toward the north.' },
  pinePoint: { nests: [[420, 2], [700, 2], [1020, 1]], name: 'Pine Point', normal: 110, turn: 40, expo: 0.6, d50: 0.2, hstar: 7, K1: 0.2,
    build: () => { addStructure({ type: 'jetty', x: 200, tip: Y0 + 300 }); addStructure({ type: 'river', x: 90, q: 10000 }); },
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
      addStructure({ type: 'river', x: 1450, q: 5000 });
    },
    blurb: 'Gooch\'s, Middle and Mother\'s beaches along Beach Avenue face south, with a long seawall behind them and the Kennebunk River jetties at the WSW end. With the seawall and no dry upper beach, there is no nesting habitat here.' },
  ogunquit: { nests: [[280, 3], [600, 3], [920, 3], [1230, 3]], name: 'Ogunquit Beach', normal: 100, turn: 0, expo: 0.9, d50: 0.25, hstar: 8, K1: 0.2,
    build: () => { addStructure({ type: 'river', x: 1440, q: 8000 }); },
    blurb: 'A natural barrier spit with dunes and the Ogunquit River behind it, reaching the sea at the south end. With no hard structures, it is a good control to compare with the others. It is one of Maine\'s main plover beaches (12+ pairs in 2025).' },
  popham: { nests: [[620, 2], [880, 2], [1320, 2]], name: 'Popham Beach', normal: 180, turn: 45, expo: 0.8, d50: 0.3, hstar: 8, K1: 0.2,
    build: () => {
      addStructure({ type: 'river', x: 40, q: 60000 });
      addStructure({ type: 'seawall', x1: 150, x2: 380, y: DUNE_TOE + 2 });
      addStructure({ type: 'breakwater', x1: 1020, x2: 1180, y: Y0 + 110 });
      addStructure({ type: 'river', x: 1460, q: 5000 });
    },
    blurb: 'Phippsburg. A south-facing beach between the Kennebec River (E end) and the Morse River (W end). Fox Island, a rock island just offshore, acts like a natural breakwater with a tombolo that comes and goes. A riprap seawall at Hunnewell Beach causes erosion at its end. The beach swings hundreds of feet as the river channels move, which the model can\'t capture.' }
};
function syncSliders() {
  slr.value = S.slr; vol.value = S.vol; k1.value = S.K1; d50.value = S.d50; hsIn.value = S.hstar;
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
  if (pl.fill) { const keep = S.vol; S.vol = pl.fill.V; nourish(pl.fill.x); S.vol = keep; S.fx = []; }
  S.sandAdded = pl.fill ? pl.fill.V : 0;
  syncSliders(); refreshTerms(); setPlaying(false);
  chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.place === k));
  $('placeBlurb').innerHTML = `<b>${pl.name}.</b> ${pl.blurb}` + (k === 'generic' ? '' : ' <span class="fine">This is a simplified 1.5 km stretch: structure sizes and positions are approximate, and the settings are teaching estimates, not a calibrated model. Press Start to run it.</span>');
  if (k !== 'generic') { placed(); }
}

function resetBeach() {
  S.t = 0; S.eta = 0; S.fills = []; S.sandAdded = 0; S.storms = 0; S.storm = null; S.fledged = 0; S.lastMonth = -1; S.nests.forEach(n => { n.washed = false; });
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
  $('slro').textContent = `${S.slr.toFixed(1)} mm/yr`; $('volo').textContent = `${fmtVol(S.vol)} m³`;
  $('nrmo').textContent = `${compass(S.normal)} ${Math.round(S.normal)}°`; $('trno').textContent = `${S.turn > 0 ? '+' : ''}${S.turn}°`; $('expoo').textContent = `× ${S.expo.toFixed(2)}`;
  $('k1o').textContent = S.K1.toFixed(2); $('d50o').textContent = `${S.d50.toFixed(2)} mm`; $('hso').textContent = `${S.hstar.toFixed(1)} m`;
  // stats
  let sum = 0, mn = 1e9, mnI = 0, mx = -1e9, mxI = 0;
  for (let i = 0; i < N; i++) { const d = y[i] - Y0; sum += d; if (d < mn) { mn = d; mnI = i; } if (d > mx) { mx = d; mxI = i; } }
  $('stTime').textContent = `${S.t.toFixed(1)} yr`;
  $('stAvg').textContent = `${sgn(sum / N)} m`;
  $('stWorst').textContent = `${sgn(Math.min(0, mn))} m`; $('stWorstS').textContent = mn < -0.5 ? `at ${Math.round((mnI + 0.5) * DX)} m` : 'none yet';
  $('stBest').textContent = `${sgn(Math.max(0, mx))} m`; $('stBestS').textContent = mx > 0.5 ? `at ${Math.round((mxI + 0.5) * DX)} m` : 'none yet';
  let risk = 0, lost = 0; for (const hx of HOUSES) { const s = houseStatus(hx); if (s === 'risk') risk++; if (s === 'lost') lost++; }
  $('stHouses').textContent = `${risk + lost} / ${HOUSES.length}`;
  $('stHousesS').textContent = lost ? `${lost} flooded, ${risk} with under 15 m of beach` : 'beach under 15 m wide';
  $('stHouseBox').className = 'stat' + (risk + lost ? ' bad' : '');
  $('stSand').textContent = fmtVol(S.sandAdded);
  const nn = S.nests.length; let nOk = 0, nRisk = 0, nLost = 0, nWash = 0;
  for (const n of S.nests) { const st = nestStatus(n); if (st === 'ok') nOk++; else if (st === 'risk') nRisk++; else nLost++; if (n.washed && inSeason()) nWash++; }
  $('stNests').textContent = nn ? `${nOk} / ${nn} safe` : 'none';
  const chicks = Math.round(S.fledged);
  $('stNestsS').textContent = !nn ? 'add a nesting area' : `${inSeason() ? 'Nesting now' : 'Off season'} · ${chicks} chick${chicks === 1 ? '' : 's'} fledged` + (nWash ? ` · ${nWash} washed out` : '') + (nLost ? ` · ${nLost} lost` : '');
  $('stNestBox').className = 'stat' + (nn && (nRisk || nLost || nWash) ? ' bad' : '');
}

// ---------- main loop ----------
let last = performance.now(), lastUI = 0, wavePhase = 0;
function frame(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000); last = now;
  wavePhase += (W ? W.om : 0.75) * dtReal * 2.2; // accumulate, so a change in period never makes the crests jump or race
  if (S.playing) { advance(dtReal); moveParticles(dtReal); nestSeasonTick(W); }
  const tSec = now / 1000;
  draw(tSec);
  if (now - lastUI > 200) { lastUI = now; updateReadouts(); updateLive(); drawChart(); }
  requestAnimationFrame(frame);
}

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
