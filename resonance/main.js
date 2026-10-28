// Resonance — the ISCA SIG Atlas as a landscape made of speech.
// Each territory is the log-mel spectrogram of a group's field, spoken by a synthetic
// voice: angle (or x, when unrolled) is time, radius is frequency, height is energy.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import spectra from '../shared/spectra.js';
import {
  loadAtlas, esc, FILTERS, passesFilter, matchesQuery, kindLabel, sigDetail, eventsBlock,
  seriesBlock, resourcesBlock, aboutBlock, splitEvents, totals, fmtDate,
} from '../shared/atlas-core.js';
import { Listener } from './listen.js';

const $ = s => document.querySelector(s);
const R_IN = 6.4, DEPTH = 10.2, R_OUT = R_IN + DEPTH, L = Math.PI * 2 * R_IN, H_MAX = 3.8, R_CAL = R_OUT + 2.4;
const BG = new THREE.Color('#05060a');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const narrow = () => innerWidth < 760;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const clamp01 = v => Math.min(1, Math.max(0, v));

/* the same colour ramp as the spectrogram previews (inferno-like, sRGB) */
const RAMP = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
const rampRGB = t => {
  const x = clamp01(t) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  return RAMP[i].map((c, k) => c + (RAMP[i + 1][k] - c) * f);
};

/* ---------- geometry of the ring <-> strip "bend" (mirrors the vertex shader) ---------- */
function bendPos(s, w, y, bend, out = new THREE.Vector3()) {
  const b = Math.max(bend, 1e-4), Rb = L / (Math.PI * 2 * b), th = s / Rb, sh = Math.sin(th / 2);
  return out.set((Rb + w) * Math.sin(th), y, -R_IN + 2 * Rb * sh * sh - w * Math.cos(th) + (1 - bend) * (R_IN + DEPTH / 2));
}

function decodeGrid(acronym) {
  const b64 = spectra.terrain[acronym];
  if (b64) return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  // a group added after this page was built: gentle placeholder dunes, flagged in the panel
  const g = new Uint8Array(spectra.frames * spectra.bins);
  for (let c = 0; c < spectra.frames; c++) for (let r = 0; r < spectra.bins; r++)
    g[c * spectra.bins + r] = 60 + 50 * Math.sin(c * 0.3) * Math.cos(r * 0.2);
  return g;
}

const imageCache = new Map();
function spectroImage(acronym, scale = 3) {
  const key = acronym + scale;
  if (imageCache.has(key)) return imageCache.get(key);
  const F = spectra.frames, B = spectra.bins, grid = decodeGrid(acronym);
  const cv = document.createElement('canvas');
  cv.width = F; cv.height = B;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(F, B);
  for (let c = 0; c < F; c++) for (let r = 0; r < B; r++) {
    const [R, G, Bl] = rampRGB(grid[c * B + r] / 255), p = ((B - 1 - r) * F + c) * 4;
    img.data[p] = R; img.data[p + 1] = G; img.data[p + 2] = Bl; img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const big = document.createElement('canvas');
  big.width = F * scale; big.height = B * scale;
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(cv, 0, 0, big.width, big.height);
  const url = big.toDataURL('image/png');
  imageCache.set(key, url);
  return url;
}

const GLSL_RAMP = `
vec3 ramp(float t){
  t = clamp(t, 0.0, 1.0) * 7.0;
  vec3 c[8];
  c[0]=vec3(0.,0.,4.); c[1]=vec3(40.,11.,84.); c[2]=vec3(101.,21.,110.); c[3]=vec3(159.,42.,99.);
  c[4]=vec3(212.,72.,66.); c[5]=vec3(245.,125.,21.); c[6]=vec3(250.,193.,39.); c[7]=vec3(252.,255.,164.);
  int i = int(min(floor(t), 6.0));
  return mix(c[i], c[i+1], t - float(i)) / 255.0;
}
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }`;

/* ---------- boot ---------- */
const state = {
  data: null, meta: null, sigs: [], selected: -1, hovered: -1, hoveredPin: null,
  filter: 'all', query: '', bend: 1, bendTarget: 1, rise: reduceMotion ? 1 : 0,
  voiceGain: 0, sound: false, tour: null, lastInteraction: performance.now(), panelOpen: false, viewShift: 0,
};

const { data, source, takenAt } = await loadAtlas();
state.data = data; state.meta = { source, takenAt };
state.sigs = data.sigs;
const N = state.sigs.length, SECTOR = L / N;
const sectorCentre = i => -L / 2 + (i + 0.5) * SECTOR;

let webglOK = true, advance = () => {};
try { const c = document.createElement('canvas'); webglOK = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { webglOK = false; }

/* ---------- renderer & scene ---------- */
const stage = $('#stage');
const renderer = webglOK ? new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }) : null;
const scene = new THREE.Scene();
scene.background = BG;
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 400);
const labels = new CSS2DRenderer();
let composer, bloom, controls;

const uniforms = {
  uBend: { value: 1 }, uRise: { value: state.rise }, uTime: { value: 0 }, uVoiceGain: { value: 0 },
  uState: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
  uVoice: { value: new Array(spectra.bins).fill(0) },
  uBg: { value: BG.clone().convertSRGBToLinear() },
};

function buildTerrain() {
  const F = spectra.frames, B = spectra.bins, g = 0.07 * SECTOR;
  const verts = N * F * B;
  const pos = new Float32Array(verts * 3), strip = new Float32Array(verts * 2), uv = new Float32Array(verts * 2);
  const height = new Float32Array(verts), energy = new Float32Array(verts), sector = new Float32Array(verts);
  const index = [];
  let v = 0;
  state.sigs.forEach((s, i) => {
    const grid = decodeGrid(s.acronym), s0 = -L / 2 + i * SECTOR + g, span = SECTOR - 2 * g, base = v;
    for (let c = 0; c < F; c++) for (let r = 0; r < B; r++) {
      const u = c / (F - 1), w = r / (B - 1);
      strip[v * 2] = s0 + u * span; strip[v * 2 + 1] = w * DEPTH;
      uv[v * 2] = u; uv[v * 2 + 1] = w;
      energy[v] = grid[c * B + r] / 255;
      height[v] = Math.pow(energy[v], 1.55);
      sector[v] = i;
      pos[v * 3] = strip[v * 2]; pos[v * 3 + 2] = strip[v * 2 + 1];
      v++;
    }
    for (let c = 0; c < F - 1; c++) for (let r = 0; r < B - 1; r++) {
      const a = base + c * B + r, b = a + B;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aStrip', new THREE.BufferAttribute(strip, 2));
  geo.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aHeight', new THREE.BufferAttribute(height, 1));
  geo.setAttribute('aEnergy', new THREE.BufferAttribute(energy, 1));
  geo.setAttribute('aSector', new THREE.BufferAttribute(sector, 1));
  geo.setIndex(index);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      uniform float uBend, uRise, uTime, uVoiceGain;
      uniform vec4 uState[32];
      uniform float uVoice[${spectra.bins}];
      attribute vec2 aStrip; attribute vec2 aUV; attribute float aHeight; attribute float aEnergy; attribute float aSector;
      varying float vH; varying float vE; varying vec3 vWorld; varying vec2 vUV; varying vec4 vState;
      const float L = ${L.toFixed(5)}; const float R_IN = ${R_IN.toFixed(3)}; const float DEPTH = ${DEPTH.toFixed(3)}; const float H_MAX = ${H_MAX.toFixed(3)};
      void main(){
        vec4 st = uState[int(aSector + 0.5)];
        float taper = smoothstep(0.0, 0.08, aUV.x) * smoothstep(1.0, 0.92, aUV.x) * smoothstep(0.0, 0.05, aUV.y) * smoothstep(1.0, 0.95, aUV.y);
        float lift = mix(1.0, 0.2, st.z) * (1.0 + 0.14 * st.x + 0.08 * st.y);
        float voice = uVoice[int(aUV.y * ${(spectra.bins - 1).toFixed(1)} + 0.5)] * uVoiceGain;
        float h = (aHeight * H_MAX * uRise * lift + voice * 2.6 * (0.6 + 0.4 * sin(aUV.x * 3.14159 + uTime * 2.0))) * taper;
        float b = max(uBend, 1e-4);
        float Rb = L / (6.2831853 * b);
        float th = aStrip.x / Rb;
        float sh = sin(th * 0.5);
        vec3 p = vec3((Rb + aStrip.y) * sin(th), h, -R_IN + 2.0 * Rb * sh * sh - aStrip.y * cos(th) + (1.0 - uBend) * (R_IN + DEPTH * 0.5));
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz; vH = h / H_MAX; vUV = aUV; vState = st;
        vE = (aEnergy * uRise * mix(1.0, 0.5, st.z) + voice * 0.9) * taper;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform vec3 uBg; uniform float uTime;
      varying float vH; varying float vE; varying vec3 vWorld; varying vec2 vUV; varying vec4 vState;
      ${GLSL_RAMP}
      void main(){
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        if (n.y < 0.0) n = -n;
        float diff = clamp(dot(n, normalize(vec3(-0.35, 0.85, 0.4))), 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(n, normalize(cameraPosition - vWorld)), 0.0, 1.0), 3.0);
        float t = clamp(vH, 0.0, 1.0);
        float e = clamp(vE, 0.0, 1.0);
        vec3 col = ramp(0.04 + pow(e, 1.15) * 0.96);
        col *= 0.55 + 0.7 * diff;
        col += rim * ramp(0.45) * 0.35;
        float hc = vH * 9.0;
        float fw = max(fwidth(hc), 1e-4);
        float line = 1.0 - clamp(abs(fract(hc - 0.5) - 0.5) / (fw * 1.2), 0.0, 1.0);
        col += line * mix(vec3(0.42, 0.22, 0.6), vec3(1.0, 0.92, 0.75), e) * 0.22 * smoothstep(0.015, 0.06, vH);
        // guide rings at 1, 2 and 4 kHz (mel positions on the frequency axis)
        float g1 = 1.0 - clamp(abs(vUV.y - 0.370) / (fwidth(vUV.y) * 1.1), 0.0, 1.0);
        float g2 = 1.0 - clamp(abs(vUV.y - 0.570) / (fwidth(vUV.y) * 1.1), 0.0, 1.0);
        float g4 = 1.0 - clamp(abs(vUV.y - 0.792) / (fwidth(vUV.y) * 1.1), 0.0, 1.0);
        col += (g1 + g2 + g4) * vec3(0.16, 0.12, 0.2) * (1.0 - smoothstep(0.05, 0.25, t));
        col += vState.x * vec3(0.16, 0.09, 0.03) + vState.y * vec3(0.10, 0.06, 0.02);
        float glow = smoothstep(0.62, 1.0, e) * (1.0 - vState.z);
        col += ramp(0.95) * glow * (0.32 + 0.3 * vState.y);
        float grey = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(grey) * 0.28 + vec3(0.02, 0.02, 0.04), vState.z * 0.9);
        vec3 lin = toLin(col);
        float d = length(cameraPosition - vWorld);
        lin = mix(lin, uBg, smoothstep(55.0, 120.0, d));
        gl_FragColor = vec4(lin, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function buildFloor() {
  const geo = new THREE.CircleGeometry(140, 96);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uBg: uniforms.uBg, uBend: uniforms.uBend, uTime: uniforms.uTime },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uBg; uniform float uBend, uTime; varying vec3 vW;
      ${GLSL_RAMP}
      void main(){
        float r = length(vW.xz);
        float pool = smoothstep(${(R_IN - 0.6).toFixed(2)}, 0.0, r) * uBend;
        float halo = exp(-pow((r - ${((R_IN + R_OUT) / 2).toFixed(2)}) / 9.0, 2.0)) * uBend;
        float ripple = 0.5 + 0.5 * sin(r * 3.2 - uTime * 1.6);
        vec3 col = toLin(ramp(0.18)) * halo * 0.22 + toLin(vec3(0.95, 0.55, 0.25)) * pool * (0.05 + 0.04 * ripple);
        float spokes = 0.0;
        float ring = 1.0 - clamp(abs(r - ${R_CAL.toFixed(2)}) / (fwidth(r) * 1.2), 0.0, 1.0);
        col += toLin(vec3(0.55, 0.42, 0.62)) * ring * 0.55 * uBend;
        float fade = smoothstep(130.0, 40.0, r);
        gl_FragColor = vec4(mix(uBg, uBg + col, fade), 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -0.04;
  return m;
}

/* ---------- labels, crystals, beams, calendar ---------- */
const sectorLabels = [];
function buildLabels() {
  state.sigs.forEach((s, i) => {
    const el = document.createElement('button');
    el.className = 'sector-label' + (s.kind === 'language' ? ' is-language' : '');
    el.type = 'button';
    el.innerHTML = `<b>${esc(s.acronym)}</b><span>${esc(spectra.phrases[s.acronym] || s.fullName)}</span>`;
    el.setAttribute('aria-label', `${s.acronym}: ${s.fullName}`);
    el.addEventListener('click', e => { e.stopPropagation(); select(i, { open: true }); });
    el.addEventListener('pointerenter', () => setHover(i));
    el.addEventListener('pointerleave', () => setHover(-1));
    const obj = new CSS2DObject(el);
    scene.add(obj);
    sectorLabels.push(obj);
  });
}

let crystals, crystalSlots = [];
function buildCrystals() {
  state.sigs.forEach((s, i) => s.videos.forEach((v, j) => crystalSlots.push({ i, j, n: s.videos.length, v })));
  const geo = new THREE.OctahedronGeometry(0.11, 0);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#bfe6ff'), toneMapped: false });
  crystals = new THREE.InstancedMesh(geo, mat, Math.max(1, crystalSlots.length));
  crystals.count = crystalSlots.length;
  crystals.frustumCulled = false;
  scene.add(crystals);
}

const beams = [];
function buildBeams() {
  const geo = new THREE.CylinderGeometry(0.05, 0.05, 1, 10, 1, true);
  geo.translate(0, 0.5, 0);
  state.sigs.forEach((s, i) => {
    if (!s.activeSeries) return;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uDim: { value: 0 } },
      vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime, uDim; varying float vY;
        void main(){ float a = (1.0 - vY) * (0.55 + 0.45 * sin(uTime * 2.2 + vY * 9.0)) * (1.0 - uDim * 0.85);
        gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * a * 1.6, a); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.scale.y = 8.5;
    m.userData.i = i;
    scene.add(m);
    beams.push(m);
  });
}

/* calendar halo: a rolling 13-month window starting two months back */
const cal = { start: 0, end: 0, pins: [], months: [], group: new THREE.Group(), arcs: new THREE.Group(), today: null };
function calAngle(t) { return -Math.PI + ((t - cal.start) / (cal.end - cal.start)) * Math.PI * 2; }
function calPos(theta, r, y, out = new THREE.Vector3()) { return out.set(r * Math.sin(theta), y, -r * Math.cos(theta)); }
function buildCalendar() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 13, 1));
  cal.start = start.getTime(); cal.end = end.getTime();
  // month ticks + labels
  const tick = [];
  for (let m = 0; m <= 13; m++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1));
    const th = calAngle(d.getTime());
    tick.push(calPos(th, R_CAL - 0.45, 0.01), calPos(th, R_CAL + 0.45, 0.01));
    if (m < 13) {
      const mid = calAngle(d.getTime() + 15 * 864e5);
      const el = document.createElement('span');
      el.className = 'month-label';
      el.textContent = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }) + (d.getUTCMonth() === 0 || m === 0 ? ` ’${String(d.getUTCFullYear()).slice(2)}` : '');
      const o = new CSS2DObject(el);
      calPos(mid, R_CAL + 1.25, 0.05, o.position);
      cal.group.add(o);
      cal.months.push(o);
    }
  }
  const tickGeo = new THREE.BufferGeometry().setFromPoints(tick);
  cal.group.add(new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({ color: '#8d7a9c', transparent: true, opacity: 0.7 })));
  // today notch
  const tt = calAngle(Date.now());
  const today = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 1.6), new THREE.MeshBasicMaterial({ color: '#ffd28a', toneMapped: false }));
  calPos(tt, R_CAL, 0.2, today.position);
  today.rotation.y = -tt;
  cal.group.add(today);
  const tl = document.createElement('span'); tl.className = 'month-label is-today'; tl.textContent = 'today';
  const to = new CSS2DObject(tl); calPos(tt, R_CAL + 2.5, 0.3, to.position); cal.group.add(to);
  // event pins
  const nowIso = new Date().toISOString().slice(0, 10);
  const stack = new Map();
  const stem = new THREE.CylinderGeometry(0.035, 0.035, 1, 6); stem.translate(0, 0.5, 0);
  const head = new THREE.SphereGeometry(0.13, 12, 8);
  const hit = new THREE.CylinderGeometry(0.45, 0.45, 2.4, 8); hit.translate(0, 1.2, 0);
  state.data.events.forEach(e => {
    const t = Date.parse(e.start + 'T12:00:00Z');
    if (!(t >= cal.start && t < cal.end)) return;
    const key = e.start.slice(0, 7) + Math.round(calAngle(t) * 40);
    const k = stack.get(key) || 0; stack.set(key, k + 1);
    const th = calAngle(t), upcoming = (e.end || e.start) >= nowIso;
    const color = new THREE.Color(upcoming ? '#ffb45c' : '#6d5a80');
    const g = new THREE.Group();
    calPos(th, R_CAL, 0, g.position);
    const h = 1.0 + k * 0.42;
    const sm = new THREE.Mesh(stem, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 })); sm.scale.y = h;
    const hm = new THREE.Mesh(head, new THREE.MeshBasicMaterial({ color: upcoming ? new THREE.Color('#ffd9a0') : color, toneMapped: false }));
    hm.position.y = h;
    const hitM = new THREE.Mesh(hit, new THREE.MeshBasicMaterial({ visible: false }));
    hitM.userData.event = e;
    g.add(sm, hm, hitM);
    g.userData = { event: e, head: hm, top: h, theta: th, upcoming };
    cal.group.add(g);
    cal.pins.push(g);
  });
  scene.add(cal.group, cal.arcs);
}

function arcTo(pin, i) {
  const a = calPos(pin.userData.theta, R_CAL, pin.userData.top, new THREE.Vector3());
  const b = i >= 0 ? bendPos(sectorCentre(i), DEPTH * 0.5, H_MAX * 0.75, 1) : new THREE.Vector3(0, 0.6, 0);
  const mid = a.clone().add(b).multiplyScalar(0.5); mid.y += 5.5;
  const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(48);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: pin.userData.upcoming ? '#ffc477' : '#9a84b0', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, toneMapped: false }));
  cal.arcs.add(line);
}
function refreshArcs() {
  cal.arcs.children.forEach(c => c.geometry.dispose());
  cal.arcs.clear();
  if (state.bend < 0.98) return;
  const sig = state.selected >= 0 ? state.sigs[state.selected].acronym : null;
  cal.pins.forEach(p => {
    const e = p.userData.event;
    if (p === state.hoveredPin || (sig && e.sig === sig)) arcTo(p, state.sigs.findIndex(s => s.acronym === e.sig));
  });
}

/* centre pool label (also the microphone switch) */
let poolLabel;
function buildPool() {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pool-label';
  const t = totals(state.data);
  el.innerHTML = `<span class="pool-num">${t.sigs}</span><span class="pool-cap">groups · ${t.recordings} recordings</span><span class="pool-act">Tap to speak</span>`;
  el.addEventListener('click', e => { e.stopPropagation(); toggleListen(); });
  poolLabel = new CSS2DObject(el);
  poolLabel.position.set(0, 0.4, 0);
  scene.add(poolLabel);
}

let dust;
function buildDust() {
  const n = coarse ? 260 : 520, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 8 + Math.random() * 60, th = Math.random() * Math.PI * 2;
    p[i * 3] = r * Math.cos(th); p[i * 3 + 1] = 0.5 + Math.random() * 22; p[i * 3 + 2] = r * Math.sin(th);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  dust = new THREE.Points(g, new THREE.PointsMaterial({ color: '#c99b7a', size: 0.07, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dust);
}

/* ---------- interaction state ---------- */
const sectorState = () => uniforms.uState.value;
function applyFilters() {
  let shown = 0;
  state.sigs.forEach((s, i) => {
    const on = passesFilter(s, state.filter) && matchesQuery(s, state.query);
    s._on = on; if (on) shown++;
  });
  $('#count').textContent = shown === N ? `${N} groups` : `${shown} of ${N} groups`;
  sectorLabels.forEach((o, i) => o.element.classList.toggle('is-dim', !state.sigs[i]._on));
}

function setHover(i) {
  if (state.hovered === i) return;
  state.hovered = i;
  document.body.style.cursor = i >= 0 || state.hoveredPin ? 'pointer' : '';
  sectorLabels.forEach((o, k) => o.element.classList.toggle('is-hover', k === i));
  if (i >= 0 && state.sound) speak(i);
  showTip();
}

let lastPointer = { x: 0, y: 0 };
function showTip() {
  const tip = $('#tip');
  if (coarse || (state.hovered < 0 && !state.hoveredPin)) { tip.hidden = true; return; }
  if (state.hoveredPin) {
    const e = state.hoveredPin.userData.event;
    tip.innerHTML = `<span class="tip-k">${esc(e.displayDate || fmtDate(e.start))} · ${esc(e.sig)}</span><b>${esc(e.title)}</b>${e.verified ? '' : '<span class="tip-warn">Not fully confirmed</span>'}`;
  } else {
    const s = state.sigs[state.hovered];
    tip.innerHTML = `<span class="tip-k">${esc(kindLabel(s))}</span><b>${esc(s.acronym)}</b><span>${esc(s.fullName)}</span><span class="tip-k">${s.activities.length} activities · ${s.videos.length} recordings${s.activeSeries ? ' · series listed' : ''}</span>`;
  }
  tip.hidden = false;
  placeTip();
}
function placeTip() {
  const tip = $('#tip');
  if (tip.hidden) return;
  const x = Math.min(lastPointer.x + 18, innerWidth - tip.offsetWidth - 12), y = Math.min(lastPointer.y + 18, innerHeight - tip.offsetHeight - 12);
  tip.style.transform = `translate(${x}px, ${y}px)`;
}

/* ---------- camera choreography (on a simulation clock, so tests can step it) ---------- */
let fly = null, simNow = 0;
function flyTo(pos, target, dur = 1.5) {
  if (!controls) return;
  if (reduceMotion) dur = 0.01;
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: simNow, dur: dur * 1000 };
}
function frameSector(i) {
  const c = sectorCentre(i);
  if (state.bendTarget > 0.5) {
    const th = c / R_IN, o = new THREE.Vector3(Math.sin(th), 0, -Math.cos(th));
    const mid = R_IN + DEPTH * 0.5, out = narrow() ? 27 : 19, up = narrow() ? 30 : 20;
    flyTo(o.clone().multiplyScalar(mid + out).add(new THREE.Vector3(0, up, 0)), o.clone().multiplyScalar(mid * 0.8).add(new THREE.Vector3(0, 0.5, 0)));
  } else {
    flyTo(new THREE.Vector3(c, 9.5, 15), new THREE.Vector3(c, 0.5, 0));
  }
}
function overview() {
  if (state.bendTarget > 0.5) flyTo(narrow() ? new THREE.Vector3(0, 46, 40) : new THREE.Vector3(0, 27, 36), new THREE.Vector3(0, 0, 0));
  else flyTo(narrow() ? new THREE.Vector3(0, 34, 78) : new THREE.Vector3(0, 19, 42), new THREE.Vector3(0, 0.5, 0));
}

/* ---------- selection & panel ---------- */
const panel = $('#panel'), body = $('#panel-body'), crumb = $('#panel-crumb');
function select(i, { open = true, fly: doFly = true } = {}) {
  state.selected = i;
  sectorLabels.forEach((o, k) => o.element.classList.toggle('is-selected', k === i));
  refreshArcs();
  if (i < 0) return;
  if (doFly) frameSector(i);
  if (open) openPanel('sig', i);
  history.replaceState(null, '', '#sig-' + encodeURIComponent(state.sigs[i].acronym));
}

function sigHeader(i) {
  const s = state.sigs[i], phrase = spectra.phrases[s.acronym];
  return `<figure class="voiceprint"><img src="${spectroImage(s.acronym, 4)}" alt="Spectrogram of the phrase “${esc(phrase || s.fullName)}”">` +
    `<figcaption>${phrase ? `“${esc(phrase)}” · ${spectra.durations[s.acronym]} s, synthetic voice. This is the shape of the ${esc(s.acronym)} territory: time runs along it, frequency rises outward, brightness is energy.` : 'This group was added after the landscape was built; its territory is a placeholder.'}</figcaption></figure>` +
    `<div class="stepper"><button type="button" data-step="-1" aria-label="Previous group">←</button><span>${i + 1} / ${N}</span><button type="button" data-step="1" aria-label="Next group">→</button></div>`;
}

function groupsView() {
  const card = (s, i) => `<li><button type="button" class="gcard${s._on ? '' : ' is-dim'}" data-sig="${i}"><img src="${spectroImage(s.acronym, 1)}" alt="" loading="lazy"><span class="gcard-acr">${esc(s.acronym)}</span><span class="gcard-name">${esc(s.fullName)}</span><span class="gcard-meta">${s.activities.length} activities · ${s.videos.length} recordings${s.activeSeries ? ' · series listed' : ''}</span></button></li>`;
  const topic = state.sigs.map((s, i) => [s, i]).filter(([s]) => s.kind !== 'language');
  const lang = state.sigs.map((s, i) => [s, i]).filter(([s]) => s.kind === 'language');
  return `<section class="ax-section"><p class="ax-eyebrow">The directory</p><h2>All ${N} groups</h2><p class="ax-note">Each card shows the voiceprint of the group’s territory. Choose one to fly there.</p>
    <h3 class="glist-h">Topic SIGs <span class="ax-count">${topic.length}</span></h3><ul class="glist">${topic.map(([s, i]) => card(s, i)).join('')}</ul>
    <h3 class="glist-h">Language SIGs <span class="ax-count">${lang.length}</span></h3><ul class="glist">${lang.map(([s, i]) => card(s, i)).join('')}</ul></section>`;
}

const CONCEPT = `<h3>How this landscape is made</h3><p>Each territory is a log-mel spectrogram of a short phrase naming the group’s field (for example “Speech prosody”), spoken by a synthetic voice on the computer that built this page. Time runs around the ring, frequency rises from 70 Hz at the inner edge to 7.6 kHz at the outer edge, and height is energy. The shapes are decorative: they picture the sound of each field’s name, not how active a group is. The directory content — activities, recordings, events — comes from the Atlas data and is marked with crystals, beams and calendar pins.</p><p><b>Listen</b> uses your microphone only inside this browser tab: the landscape follows your voice’s spectrum, and a small template matcher (log-mel features and dynamic time warping, the way isolated-word recognisers worked around 1980) tries to guess which field you said. Nothing is recorded or sent.</p>`;

function openPanel(view, arg) {
  state.panelOpen = true;
  document.body.classList.add('panel-open');
  panel.classList.add('is-open');
  let html = '', label = '';
  if (view === 'sig') { html = sigHeader(arg) + sigDetail(state.data, state.sigs[arg]); label = state.sigs[arg].acronym; }
  else if (view === 'groups') { html = groupsView(); label = 'Groups'; }
  else if (view === 'calendar') { html = eventsBlock(state.data); label = 'Calendar'; }
  else if (view === 'series') { html = seriesBlock(state.data); label = 'Series & archives'; }
  else if (view === 'library') { html = resourcesBlock(state.data); label = 'ISCA library'; }
  else if (view === 'about') { html = aboutBlock(state.data, { ...state.meta, concept: CONCEPT }); label = 'About'; }
  body.innerHTML = html;
  body.scrollTop = 0;
  crumb.textContent = label;
  document.querySelectorAll('.dock button').forEach(b => b.setAttribute('aria-current', String(b.dataset.view === view)));
  if (view !== 'sig') history.replaceState(null, '', '#' + view);
}
function closePanel() {
  state.panelOpen = false;
  document.body.classList.remove('panel-open');
  panel.classList.remove('is-open');
  document.querySelectorAll('.dock button').forEach(b => b.removeAttribute('aria-current'));
  history.replaceState(null, '', location.pathname + location.search);
}
body.addEventListener('click', e => {
  const card = e.target.closest('[data-sig]');
  if (card) { select(Number(card.dataset.sig)); return; }
  const step = e.target.closest('[data-step]');
  if (step && state.selected >= 0) select((state.selected + Number(step.dataset.step) + N) % N);
});
$('#panel-close').addEventListener('click', () => { closePanel(); select(-1); overview(); });
document.querySelectorAll('.dock button').forEach(b => b.addEventListener('click', () => {
  stopTour();
  if (state.panelOpen && b.getAttribute('aria-current') === 'true') { closePanel(); return; }
  openPanel(b.dataset.view);
}));

/* ---------- search & filters ---------- */
const chips = $('#chips');
chips.innerHTML = FILTERS.map(([id, label]) => `<button type="button" class="chip" data-filter="${id}" aria-pressed="${id === 'all'}">${label}</button>`).join('');
chips.addEventListener('click', e => {
  const b = e.target.closest('[data-filter]'); if (!b) return;
  state.filter = b.dataset.filter;
  chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
  applyFilters();
  if (state.panelOpen && crumb.textContent === 'Groups') openPanel('groups');
});
$('#search').addEventListener('input', e => { state.query = e.target.value; applyFilters(); });
$('#search').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const first = state.sigs.findIndex(s => s._on);
  if (first >= 0) select(first);
});

/* ---------- voice: speech synthesis for names, microphone for listening ---------- */
let speakTimer;
function speak(i) {
  if (!('speechSynthesis' in window)) return;
  clearTimeout(speakTimer);
  speakTimer = setTimeout(() => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(spectra.phrases[state.sigs[i].acronym] || state.sigs[i].fullName);
    u.lang = 'en-US'; u.rate = 0.95;
    speechSynthesis.speak(u);
  }, 180);
}
$('#btn-sound').addEventListener('click', e => {
  state.sound = !state.sound;
  e.currentTarget.setAttribute('aria-pressed', String(state.sound));
  if (!state.sound && 'speechSynthesis' in window) speechSynthesis.cancel();
  toast(state.sound ? 'Voice on: territories say their field when you hover.' : 'Voice off.');
});

const listener = new Listener(spectra, {
  onLevel: v => { $('#meter').style.transform = `scaleX(${Math.min(1, v * 2.2).toFixed(3)})`; },
  onState: (s, info) => {
    const text = $('#listen-text');
    if (s === 'listening') text.textContent = info && info.recogniser === false ? 'Listening on this device. The landscape follows your voice.' : 'Listening on this device. Say a field, e.g. “speech prosody”.';
    if (s === 'hearing') text.textContent = 'Hearing you…';
    if (s === 'thinking') text.textContent = 'Matching against twenty templates…';
  },
  onUtterance: ({ ranked, margin }) => {
    const [best, second, third] = ranked;
    const i = state.sigs.findIndex(s => s.acronym === best[0]);
    if (i < 0) return;
    const name = a => `${spectra.phrases[a]} (${a})`;
    if (margin > 0.06) {
      select(i);
      toast(`Closest template: ${name(best[0])}. Next: ${second[0]}, ${third[0]}.`, 6000);
    } else {
      toast(`Not sure — ${name(best[0])}, ${name(second[0])} or ${name(third[0])}?`, 6000);
      setHover(i);
    }
  },
});
async function toggleListen() {
  const btn = $('#btn-listen');
  if (listener.active) {
    listener.stop(); btn.setAttribute('aria-pressed', 'false'); $('#listen-hud').hidden = true;
    poolLabel?.element.classList.remove('is-live');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) { toast('This browser does not offer microphone access here.'); return; }
  try {
    await listener.start();
    btn.setAttribute('aria-pressed', 'true'); $('#listen-hud').hidden = false;
    poolLabel?.element.classList.add('is-live');
    stopTour();
  } catch {
    toast('Microphone permission was not granted. The rest of the atlas works without it.');
  }
}
$('#btn-listen').addEventListener('click', toggleListen);

$('#btn-unroll').addEventListener('click', e => {
  state.bendTarget = state.bendTarget > 0.5 ? 0 : 1;
  e.currentTarget.setAttribute('aria-pressed', String(state.bendTarget < 0.5));
  e.currentTarget.querySelector('.tool-label').textContent = state.bendTarget < 0.5 ? 'Roll up' : 'Unroll';
  state.selected >= 0 ? frameSector(state.selected) : overview();
  if (state.bendTarget < 0.5) toast('Unrolled: one long spectrogram, twenty phrases in a row. Low frequencies are nearest to you.', 5000);
});

/* ---------- guided tour ---------- */
function stopTour() {
  if (!state.tour) return;
  clearInterval(state.tour); state.tour = null;
  $('#btn-tour').setAttribute('aria-pressed', 'false');
}
$('#btn-tour').addEventListener('click', e => {
  if (state.tour) { stopTour(); return; }
  e.currentTarget.setAttribute('aria-pressed', 'true');
  let k = state.selected >= 0 ? state.selected : -1;
  const step = () => { k = (k + 1) % N; select(k, { open: !narrow() }); if (state.sound) speak(k); };
  step();
  state.tour = setInterval(step, 6500);
});

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- keyboard ---------- */
addEventListener('keydown', e => {
  const el = e.target instanceof Element ? e.target : null;
  if (el?.matches('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  else if (e.key === 'Escape') { if (state.panelOpen) { closePanel(); select(-1); overview(); } stopTour(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { stopTour(); select(((state.selected < 0 ? 0 : state.selected + (e.key === 'ArrowRight' ? 1 : -1)) + N) % N); }
  else if (e.key.toLowerCase() === 'u') $('#btn-unroll').click();
});

/* ---------- start ---------- */
applyFilters();
$('#legend').open = innerWidth >= 1200;
if (!webglOK) {
  document.body.classList.add('no-webgl');
  openPanel('groups');
  toast('3D is not available in this browser, so the directory is shown as a list.', 8000);
} else {
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  stage.appendChild(renderer.domElement);
  labels.setSize(innerWidth, innerHeight);
  labels.domElement.className = 'label-layer';
  document.body.appendChild(labels.domElement);

  scene.add(buildFloor(), buildTerrain());
  buildLabels(); buildCrystals(); buildBeams(); buildCalendar(); buildPool(); buildDust();

  controls = new OrbitControls(camera, labels.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.06;
  controls.minDistance = 8; controls.maxDistance = 95;
  controls.maxPolarAngle = Math.PI * 0.47; controls.minPolarAngle = 0.08;
  controls.autoRotate = !reduceMotion; controls.autoRotateSpeed = 0.35;
  controls.addEventListener('start', () => { state.lastInteraction = simNow; fly = null; stopTour(); $('#hint').classList.add('is-gone'); });

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.5, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // opening shot: from straight above (the ring reads as a mandala) down to the overview
  if (reduceMotion) { camera.position.set(0, 27, 36); }
  else { camera.position.set(0.01, 78, 0.01); $('#intro').classList.add('is-on'); setTimeout(() => $('#intro').classList.remove('is-on'), 2600); }
  controls.target.set(0, 0, 0);
  setTimeout(overview, reduceMotion ? 0 : 900);

  // picking: intersect the pointer ray with the terrain's mid-height plane
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9), hitP = new THREE.Vector3();
  const pinHits = cal.pins.map(p => p.children[2]);
  function pick(cx, cy) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (state.bend > 0.98) {
      const ph = ray.intersectObjects(pinHits, false)[0];
      if (ph) return { pin: ph.object.parent };
    }
    if (state.bend < 0.98 && state.bend > 0.02) return {};
    if (!ray.ray.intersectPlane(plane, hitP)) return {};
    let s, w;
    if (state.bend > 0.5) { const r = Math.hypot(hitP.x, hitP.z); w = r - R_IN; s = Math.atan2(hitP.x, -hitP.z) * R_IN; }
    else { s = hitP.x; w = DEPTH / 2 - hitP.z; }
    if (w < -0.6 || w > DEPTH + 0.8 || Math.abs(s) > L / 2) return {};
    return { sector: Math.min(N - 1, Math.max(0, Math.floor((s + L / 2) / SECTOR))) };
  }
  let down = null;
  labels.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  labels.domElement.addEventListener('pointermove', e => {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (e.buttons) return;
    const p = pick(e.clientX, e.clientY);
    const pin = p.pin || null;
    if (pin !== state.hoveredPin) { state.hoveredPin = pin; refreshArcs(); }
    setHover(pin ? -1 : (p.sector ?? -1));
    showTip();
  });
  labels.domElement.addEventListener('pointerleave', () => { state.hoveredPin = null; setHover(-1); refreshArcs(); });
  labels.domElement.addEventListener('pointerup', e => {
    if (e.target.closest('.sector-label, .pool-label')) return;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const p = pick(e.clientX, e.clientY);
    if (p.pin) {
      const ev = p.pin.userData.event, i = state.sigs.findIndex(s => s.acronym === ev.sig);
      if (i >= 0) select(i); else openPanel('calendar');
      toast(`${ev.displayDate || fmtDate(ev.start)} — ${ev.title}`, 5000);
    } else if (p.sector !== undefined) { stopTour(); select(p.sector); }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  });

  const tmp = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), eul = new THREE.Euler();
  const clock = new THREE.Clock();
  function frame(forcedDt) {
    const dt = forcedDt ?? Math.min(clock.getDelta(), 0.05);
    simNow += dt * 1000;
    const now = simNow, time = simNow / 1000;
    uniforms.uTime.value = time;
    // intro rise
    if (state.rise < 1) { state.rise = Math.min(1, state.rise + dt / 3.2); uniforms.uRise.value = ease(state.rise); }
    // bend animation
    const db = state.bendTarget - state.bend;
    if (Math.abs(db) > 1e-4) { state.bend += Math.sign(db) * Math.min(Math.abs(db), dt / (reduceMotion ? 0.05 : 2.2)); if (Math.abs(state.bendTarget - state.bend) < 1e-3) { state.bend = state.bendTarget; refreshArcs(); } }
    const bendE = ease(state.bend);
    uniforms.uBend.value = bendE;
    cal.group.visible = state.bend > 0.02;
    const flat = state.bend < 0.5;
    if (flat !== document.body.classList.contains('is-flat')) document.body.classList.toggle('is-flat', flat);
    cal.group.children.forEach(c => { if (c.material) { c.material.transparent = true; c.material.opacity = (c.material.userData.base ??= c.material.opacity) * clamp01((state.bend - 0.6) / 0.4); } });
    cal.months.forEach(o => { o.element.style.opacity = clamp01((state.bend - 0.7) / 0.3); });
    poolLabel.element.style.opacity = clamp01((state.bend - 0.7) / 0.3);
    // per-sector uniforms (hover glow, selection, filter dimming), eased
    const st = sectorState();
    state.sigs.forEach((s, i) => {
      const v = st[i];
      v.x += ((i === state.hovered ? 1 : 0) - v.x) * Math.min(1, dt * 10);
      v.y += ((i === state.selected ? 1 : 0) - v.y) * Math.min(1, dt * 6);
      const dimTarget = !s._on ? 1 : (state.selected >= 0 && i !== state.selected ? 0.42 : 0);
      v.z += (dimTarget - v.z) * Math.min(1, dt * 5);
    });
    // voice
    const lv = listener.level();
    state.voiceGain += ((lv ? 1 : 0) - state.voiceGain) * Math.min(1, dt * 3);
    uniforms.uVoiceGain.value = state.voiceGain;
    if (lv) for (let k = 0; k < lv.length; k++) uniforms.uVoice.value[k] = lv[k] * lv[k];
    // labels follow the bend
    sectorLabels.forEach((o, i) => {
      bendPos(sectorCentre(i), bendE * (DEPTH + 1.5) + (1 - bendE) * -1.6, 0.2, bendE, o.position);
      const d = o.position.distanceTo(camera.position);
      const depth = clamp01((d - 14) / 46);
      o.element.style.setProperty('--depth', depth.toFixed(3));
      const far = depth > 0.62 && i !== state.selected && i !== state.hovered;
      if (far !== o.element.classList.contains('is-far')) o.element.classList.toggle('is-far', far);
    });
    // crystals float above their territory
    crystalSlots.forEach((c, k) => {
      const cols = Math.min(4, c.n), row = Math.floor(c.j / cols), col = c.j % cols;
      const u = cols === 1 ? 0.5 : 0.22 + 0.56 * col / (cols - 1);
      bendPos(-L / 2 + (c.i + u) * SECTOR, DEPTH * (0.3 + 0.14 * row), H_MAX + 1.1 + 0.25 * Math.sin(time * 1.3 + k) + (c.i === state.selected ? 0.5 : 0), bendE, tmp);
      const dim = state.sigs[c.i]._on ? 1 : 0.35;
      eul.set(time * 0.6 + k, time * 0.8 + k * 0.3, 0); q.setFromEuler(eul); sc.setScalar(dim * (c.i === state.hovered ? 1.35 : 1));
      m4.compose(tmp, q, sc); crystals.setMatrixAt(k, m4);
    });
    if (crystals) crystals.instanceMatrix.needsUpdate = true;
    beams.forEach(b => { bendPos(sectorCentre(b.userData.i), DEPTH * 0.5, 0, bendE, b.position); b.material.uniforms.uDim.value = st[b.userData.i].z; });
    cal.pins.forEach(p => { p.userData.head.scale.setScalar(p === state.hoveredPin ? 1.8 : 1); });
    if (dust) dust.rotation.y = time * 0.01;
    // camera flight
    if (fly) {
      const k = Math.min(1, (now - fly.start) / fly.dur), e = ease(k);
      camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (k >= 1) fly = null;
    }
    controls.autoRotate = !reduceMotion && !fly && !state.panelOpen && !state.tour && now - state.lastInteraction > 12000;
    controls.update();
    // keep the selected territory visible beside the panel
    const shiftTarget = state.panelOpen && !narrow() ? Math.min(460, innerWidth * 0.36) / 2 : 0;
    state.viewShift += (shiftTarget - state.viewShift) * Math.min(1, dt * 4);
    if (Math.abs(state.viewShift) > 0.5) camera.setViewOffset(innerWidth, innerHeight, state.viewShift, 0, innerWidth, innerHeight);
    else camera.clearViewOffset();
    composer.render();
    labels.render(scene, camera);
  }
  renderer.setAnimationLoop(() => frame());
  advance = (sec, step = 1 / 30) => { for (let t = 0; t < sec; t += step) frame(step); };
}

// deep links: #sig-SProSIG, #calendar, #about …
const hash = decodeURIComponent(location.hash.slice(1));
if (hash.startsWith('sig-')) {
  const i = state.sigs.findIndex(s => s.acronym === hash.slice(4));
  if (i >= 0) setTimeout(() => select(i), reduceMotion || !webglOK ? 0 : 2600);
} else if (['groups', 'calendar', 'series', 'library', 'about'].includes(hash)) openPanel(hash);
document.documentElement.dataset.source = source;
// handle for console inspection while testing
window.__resonance = { state, uniforms, camera, get controls() { return controls; }, renderer, advance: (s, st) => advance(s, st) };
