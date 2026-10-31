// On the Record — the ISCA SIG Atlas as a small town pressed onto a spinning record.
// Twenty groups are twenty landmarks. Stacks of little records count each group's
// recording links, pennants mark upcoming dates, and an "on air" mast marks a listed
// seminar series. Drag the record to spin it; drop the tonearm to hear the tracklist.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  loadAtlas, esc, FILTERS, passesFilter, matchesQuery, kindLabel, sigDetail, eventsBlock,
  seriesBlock, resourcesBlock, aboutBlock, splitEvents, eventsFor, totals, fmtDate,
} from '../shared/atlas-core.js';
import { PAL, mat, WINDOW, BULB, ONAIR, GLOW, buildLandmark, buildCurator, tree, WORD_FOR_SPEECH, LANDMARK } from './models.js';

const $ = s => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const narrow = () => innerWidth < 760;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const TAU = Math.PI * 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const initialHash = location.hash;

const RECORD_R = 16, LABEL_R = 3.6, TOP = 0.92;
const RINGS = [{ r: 14.15, lot: 1.75, off: 0 }, { r: 9.6, lot: 1.72, off: Math.PI / 6 }, { r: 5.5, lot: 1.6, off: Math.PI / 12 }];
const LANE_R = 11.9, BUILD_SCALE = 1.18;
const ARM_BASE = new THREE.Vector3(17.4, 0, -12.6), ARM_LEN = 18.2, ARM_Y = 6.2;
const IDLE_SPIN = TAU / 150, PLAY_SPIN = TAU / 28;
const DAY = { bg: '#efe5d8', table: '#e3d3bf', hemi: 1.15, sun: 2.4, exposure: 1.0 };
const NIGHT = { bg: '#15110d', table: '#2a221b', hemi: 0.12, sun: 0.08, exposure: 1.15 };

const state = {
  data: null, meta: null, sigs: [], towns: [], selected: -1, hovered: -1, filter: 'all', query: '',
  spin: 0, spinVel: reduceMotion ? 0 : IDLE_SPIN, spinning: !reduceMotion, dragging: null, targetRot: null,
  playing: false, ring: 0, ringStart: 0, playingTown: -1, night: false, nightK: 0, sound: false,
  view: 'tracklist', sleeveOpen: !narrow(), viewShift: 0, armAngle: 0,
};

const { data, source, takenAt } = await loadAtlas();
state.data = data; state.meta = { source, takenAt };
state.sigs = data.sigs;
const T = totals(data);
// tracks (ring, angle, A1…/B1…) exist without 3D, so the tracklist also works when WebGL is missing
state.towns = (() => { const slots = layout(); return state.sigs.map((s, i) => ({ i, sig: s, ...slots[i], lift: 0, clayOn: false })); })();

let webglOK = true;

/* ---------- textures drawn on the fly ---------- */
function grooveTexture() {
  const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), mid = S / 2, scale = mid / RECORD_R;
  x.fillStyle = '#7a7a7a'; x.fillRect(0, 0, S, S);
  const smooth = [[LABEL_R, LABEL_R + 0.35], [RINGS[2].r + RINGS[2].lot + 0.2, RINGS[1].r - RINGS[1].lot - 0.2], [RINGS[1].r + RINGS[1].lot + 0.25, RINGS[0].r - RINGS[0].lot - 0.25], [RECORD_R - 0.4, RECORD_R]];
  for (let r = LABEL_R * scale; r < RECORD_R * scale; r += 1.6) {
    const rr = r / scale, isSmooth = smooth.some(([a, b]) => rr > a && rr < b);
    x.strokeStyle = isSmooth ? 'rgb(40,40,40)' : `rgb(${100 + Math.round(Math.random() * 90)},${100},${100})`;
    x.lineWidth = isSmooth ? 2 : 0.9;
    x.beginPath(); x.arc(mid, mid, r, 0, TAU); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

function labelTexture() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), m = S / 2;
  const g = x.createRadialGradient(m, m * 0.85, 40, m, m, m);
  g.addColorStop(0, '#f0663f'); g.addColorStop(1, '#c9431f');
  x.fillStyle = g; x.beginPath(); x.arc(m, m, m, 0, TAU); x.fill();
  x.strokeStyle = 'rgba(255,240,220,.55)'; x.lineWidth = 4; x.beginPath(); x.arc(m, m, m - 26, 0, TAU); x.stroke();
  // text around the rim
  const ring = 'ISCA SIG ATLAS  ·  ON THE RECORD  ·  AN INDEPENDENT DIRECTORY  ·  NOT AN OFFICIAL ISCA RELEASE  ·  CURATED BY XIAOJIN, AN AI AGENT  ·  ';
  x.fillStyle = '#fff3e3'; x.font = '600 30px "DM Mono", ui-monospace, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const chars = [...ring], step = TAU / chars.length;
  chars.forEach((ch, i) => { x.save(); x.translate(m, m); x.rotate(i * step); x.translate(0, -(m - 62)); x.fillText(ch, 0, 0); x.restore(); });
  x.fillStyle = '#fff6ea';
  x.font = 'italic 600 96px "Fraunces", Georgia, serif'; x.fillText('On the', m, m - 150);
  x.font = '700 150px "Fraunces", Georgia, serif'; x.fillText('Record', m, m - 40);
  x.font = '600 34px "DM Mono", ui-monospace, monospace';
  x.fillText(`${T.sigs} GROUPS  ·  ${T.recordings} RECORDINGS`, m, m + 80);
  x.fillText(`SIDE A · TOPICS   SIDE B · LANGUAGES`, m, m + 130);
  x.font = '600 30px "DM Mono", ui-monospace, monospace'; x.fillStyle = 'rgba(255,240,225,.8)';
  x.fillText('33⅓', m - 230, m + 10); x.fillText('RPM', m + 230, m + 10);
  x.fillStyle = '#1a1a1a'; x.beginPath(); x.arc(m, m, 26, 0, TAU); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function woodTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#7b4a2b'; x.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * 512, a = 0.04 + Math.random() * 0.1;
    x.strokeStyle = Math.random() < 0.5 ? `rgba(40,20,8,${a})` : `rgba(190,130,80,${a})`;
    x.lineWidth = 1 + Math.random() * 3;
    x.beginPath(); x.moveTo(0, y);
    for (let k = 0; k <= 1024; k += 64) x.lineTo(k, y + Math.sin(k * 0.01 + i) * 6);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ---------- scene ---------- */
// Construct the renderer inside the guard: this version of Three requires WebGL 2.
// A WebGL 1 probe or a successful probe followed by GPU allocation failure is insufficient.
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
catch { webglOK = false; }
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.5, 400);
let controls, composer, tiltH, tiltV, bloom;
const disc = new THREE.Group();          // everything that turns with the record
const hits = [];                          // invisible pick targets, one per town
let hemi, sun, lamp, table, recordMesh, arm, armPivot, beam, curator, stacks, stackLabels;

function buildWorld() {
  scene.background = new THREE.Color(DAY.bg);
  scene.fog = new THREE.Fog(DAY.bg, 80, 160);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  hemi = new THREE.HemisphereLight('#fff6ea', '#b39878', DAY.hemi);
  sun = new THREE.DirectionalLight('#fff0db', DAY.sun);
  sun.position.set(-20, 34, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 5, far: 90 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  lamp = new THREE.SpotLight('#ffc77d', 0, 0, 0.62, 0.7, 2);
  lamp.position.set(-14, 30, 12); lamp.target.position.set(0, 0, 0);
  lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0005;
  scene.add(hemi, sun, lamp, lamp.target);

  // table with a soft pool of light
  const tc = document.createElement('canvas'); tc.width = tc.height = 512;
  const tx = tc.getContext('2d'), tg = tx.createRadialGradient(256, 256, 30, 256, 256, 256);
  tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#c9b8a3');
  tx.fillStyle = tg; tx.fillRect(0, 0, 512, 512);
  const tt = new THREE.CanvasTexture(tc); tt.colorSpace = THREE.SRGBColorSpace;
  table = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ color: DAY.table, map: tt, roughness: 0.95 }));
  table.rotation.x = -Math.PI / 2; table.position.y = -2.2; table.receiveShadow = true;
  scene.add(table);

  // plinth, platter and its strobe dots
  const wood = woodTexture(); wood.repeat.set(2, 1);
  const plinth = new THREE.Mesh(new RoundedBoxGeometry(42, 2.2, 35, 4, 0.9), new THREE.MeshStandardMaterial({ color: '#ffffff', map: wood, roughness: 0.55, metalness: 0.05 }));
  plinth.position.set(1, -1.1, 0); plinth.castShadow = plinth.receiveShadow = true;
  scene.add(plinth);
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(16.5, 16.6, 0.7, 96), new THREE.MeshStandardMaterial({ color: '#cfcfcf', metalness: 0.9, roughness: 0.28 }));
  platter.position.y = 0.35; platter.castShadow = platter.receiveShadow = true;
  disc.add(platter);
  const dots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.05), mat('#3a3a3a'), 120);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * TAU;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    m4.compose(new THREE.Vector3(Math.sin(a) * 16.62, 0.36, Math.cos(a) * 16.62), q, new THREE.Vector3(1, 1, 1));
    dots.setMatrixAt(i, m4);
  }
  disc.add(dots);

  // the record
  const groove = grooveTexture();
  const vinyl = new THREE.MeshPhysicalMaterial({ color: '#0e0e10', roughness: 0.42, roughnessMap: groove, bumpMap: groove, bumpScale: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.28, metalness: 0.0 });
  recordMesh = new THREE.Mesh(new THREE.CylinderGeometry(RECORD_R, RECORD_R, 0.22, 128), [new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 }), vinyl, vinyl]);
  recordMesh.position.y = 0.81; recordMesh.castShadow = recordMesh.receiveShadow = true;
  disc.add(recordMesh);
  const label = new THREE.Mesh(new THREE.CircleGeometry(LABEL_R, 64), new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.75 }));
  label.rotation.x = -Math.PI / 2; label.position.y = TOP + 0.005; label.receiveShadow = true;
  disc.add(label);
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.7, 16), new THREE.MeshStandardMaterial({ color: '#dcdcdc', metalness: 0.95, roughness: 0.2 }));
  spindle.position.y = TOP + 0.3; spindle.castShadow = true;
  disc.add(spindle);
  scene.add(disc);

  buildTonearm();
  buildDetails();
}

function buildTonearm() {
  const chrome = new THREE.MeshStandardMaterial({ color: '#e3e3e3', metalness: 0.95, roughness: 0.18 });
  arm = new THREE.Group(); arm.position.copy(ARM_BASE);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.5, 32), new THREE.MeshStandardMaterial({ color: '#2b2b2b', metalness: 0.5, roughness: 0.4 }));
  base.position.y = 0.25;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, ARM_Y, 16), chrome);
  pillar.position.y = ARM_Y / 2;
  armPivot = new THREE.Group(); armPivot.position.y = ARM_Y;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, ARM_LEN, 12), chrome);
  tube.rotation.x = Math.PI / 2; tube.position.z = ARM_LEN / 2;
  const counter = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 24), new THREE.MeshStandardMaterial({ color: '#2b2b2b', metalness: 0.6, roughness: 0.35 }));
  counter.rotation.x = Math.PI / 2; counter.position.z = -1.6;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 1.5), new THREE.MeshStandardMaterial({ color: '#2b2b2b', metalness: 0.4, roughness: 0.4 }));
  shell.position.set(0, -0.15, ARM_LEN + 0.4);
  const cart = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 0.6), mat(PAL.tomato));
  cart.position.set(0, -0.42, ARM_LEN + 0.45);
  beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.22, ARM_Y - TOP - 0.6, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ff8a5c', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.position.set(0, -(ARM_Y - TOP - 0.6) / 2 - 0.6, ARM_LEN + 0.45);
  armPivot.add(tube, counter, shell, cart, beam);
  arm.add(base, pillar, armPivot);
  arm.traverse(m => { if (m.isMesh && m !== beam) { m.castShadow = true; m.receiveShadow = true; } });
  scene.add(arm);
  state.armAngle = restAngle();
  armPivot.rotation.y = state.armAngle;
}
// arm angle (about the pillar) whose needle sits at radius rho from the spindle
const needleAt = (a, out = new THREE.Vector3()) => out.set(ARM_BASE.x + ARM_LEN * Math.sin(a), TOP, ARM_BASE.z + ARM_LEN * Math.cos(a));
function angleForRadius(rho) {
  let lo = -0.94, hi = 0.05; // the needle arc is closest to the spindle at about -0.94 rad
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (needleAt(mid).length() > rho) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}
const restAngle = () => 0.12;

function buildDetails() {
  // speed knob, power lamp and an engraved plate on the plinth
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.5, 24), new THREE.MeshStandardMaterial({ color: '#e8e2d6', metalness: 0.4, roughness: 0.35 }));
  knob.position.set(-17.2, 0.25, 13.2); knob.castShadow = true;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshStandardMaterial({ color: '#8cf0b0', emissive: '#3fe08a', emissiveIntensity: 1.2 }));
  led.position.set(-14.6, 0.15, 14.1);
  const plateC = document.createElement('canvas'); plateC.width = 512; plateC.height = 96;
  const px = plateC.getContext('2d');
  px.fillStyle = '#d9cdb8'; px.fillRect(0, 0, 512, 96);
  px.fillStyle = '#4a3b2c'; px.font = '600 34px "DM Mono", ui-monospace, monospace'; px.textAlign = 'center'; px.textBaseline = 'middle';
  px.fillText('SIG ATLAS · MODEL 20', 256, 50);
  const pt = new THREE.CanvasTexture(plateC); pt.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2), new THREE.MeshStandardMaterial({ map: pt, metalness: 0.5, roughness: 0.4 }));
  plate.rotation.x = -Math.PI / 2; plate.position.set(13.5, 0.01, 14.6);
  scene.add(knob, led, plate);
}

/* ---------- towns ---------- */
function layout() {
  const topic = state.sigs.map((s, i) => i).filter(i => state.sigs[i].kind !== 'language');
  const lang = state.sigs.map((s, i) => i).filter(i => state.sigs[i].kind === 'language');
  const outerN = Math.ceil(topic.length * 0.57);
  const groups = [topic.slice(0, outerN), topic.slice(outerN), lang];
  const slots = [];
  groups.forEach((list, ring) => list.forEach((i, k) => slots[i] = { ring, phi: RINGS[ring].off + TAU * k / list.length }));
  let a = 0, b = 0;
  state.sigs.forEach((s, i) => { slots[i].track = s.kind === 'language' ? `B${++b}` : `A${++a}`; });
  return slots;
}

function buildTowns() {
  const nowUp = new Set(splitEvents(state.data.events).future.map(e => e.sig));
  const recGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.045, 20), labGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12);
  const total = state.sigs.reduce((n, s) => n + Math.min(s.videos.length, 14), 0);
  stacks = new THREE.InstancedMesh(recGeo, mat('#161616', { roughness: 0.35, flatShading: false }), Math.max(1, total));
  stackLabels = new THREE.InstancedMesh(labGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), Math.max(1, total));
  stacks.castShadow = stackLabels.castShadow = true;
  const labelColors = [PAL.tomato, PAL.mustard, PAL.teal, PAL.lilac, PAL.sky, PAL.pink].map(c => new THREE.Color(c));
  let n = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  state.towns.forEach(t0 => {
    const s = t0.sig, i = t0.i, { ring, phi } = t0, R = RINGS[ring];
    const town = new THREE.Group();
    town.position.set(Math.sin(phi) * R.r, TOP, Math.cos(phi) * R.r);
    town.rotation.y = phi;
    // grass lot with a path ring
    const lot = new THREE.Mesh(new THREE.CylinderGeometry(R.lot, R.lot + 0.06, 0.16, 40), mat(PAL.grass, { flatShading: false }));
    lot.position.y = 0.08; lot.receiveShadow = true; lot.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R.lot - 0.08, 0.05, 6, 40), mat(PAL.cream));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.17;
    town.add(lot, rim);
    const building = buildLandmark(s.acronym);
    building.scale.setScalar(BUILD_SCALE);
    building.position.y = 0.16;
    const holder = new THREE.Group(); holder.add(building);
    town.add(holder);
    // decor: a tree or two and a lamp post
    const decor = new THREE.Group();
    tree(decor, -R.lot * 0.72, -R.lot * 0.35, 0.8, i % 2 ? PAL.sage : PAL.grass);
    if (s.kind !== 'language') tree(decor, R.lot * 0.6, -R.lot * 0.55, 0.7);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5), mat(PAL.ink)); post.position.set(-R.lot * 0.75, 0.6, R.lot * 0.45);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), BULB); bulb.position.set(-R.lot * 0.75, 1.08, R.lot * 0.45);
    decor.add(post, bulb); decor.position.y = 0.16;
    decor.traverse(o => { if (o.isMesh) o.castShadow = true; });
    town.add(decor);
    // recording stack (counted, capped for height)
    const count = Math.min(s.videos.length, 14), sx = R.lot * 0.62, sz = R.lot * 0.5;
    for (let k = 0; k < count; k++) {
      const local = new THREE.Vector3(sx + (k % 2) * 0.03, 0.2 + k * 0.05, sz);
      town.updateMatrixWorld(true);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 0.4);
      const world = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), phi).add(town.position);
      m4.compose(world, q, one); stacks.setMatrixAt(n, m4);
      m4.compose(world.clone().add(new THREE.Vector3(0, 0.003, 0)), q, one); stackLabels.setMatrixAt(n, m4);
      stackLabels.setColorAt(n, labelColors[(i + k) % labelColors.length]);
      n++;
    }
    // pennant for an upcoming date
    let flag = null;
    if (nowUp.has(s.acronym)) {
      flag = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 5), mat(PAL.ink)); pole.position.y = 0.85;
      const tri = new THREE.Shape(); tri.moveTo(0, 0); tri.lineTo(0.6, -0.17); tri.lineTo(0, -0.34); tri.closePath();
      const cloth = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshStandardMaterial({ color: PAL.mustard, side: THREE.DoubleSide, roughness: 0.8 }));
      cloth.position.set(0.02, 1.68, 0);
      flag.add(pole, cloth); flag.position.set(R.lot * 0.15, 0.16, -R.lot * 0.78);
      flag.traverse(o => { if (o.isMesh) o.castShadow = true; });
      flag.userData.cloth = cloth;
      town.add(flag);
    }
    // "on air" mast for a listed seminar series
    let mast = null;
    if (s.activeSeries) {
      const bb = new THREE.Box3().setFromObject(building);
      mast = new THREE.Group();
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.8, 5), mat(PAL.slate)); rod.position.y = 0.4;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), ONAIR); tip.position.y = 0.85;
      mast.add(rod, tip);
      mast.position.set(-0.45, bb.max.y - 0.05, -0.2);
      town.add(mast);
    }
    // selection halo and pick target
    const halo = new THREE.Mesh(new THREE.TorusGeometry(R.lot + 0.18, 0.07, 8, 56), new THREE.MeshStandardMaterial({ color: PAL.tomato, emissive: PAL.tomato, emissiveIntensity: 0.6, transparent: true, opacity: 0 }));
    halo.rotation.x = Math.PI / 2; halo.position.y = 0.1;
    town.add(halo);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(R.lot, R.lot, 4.2, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 2; hit.userData.town = i;
    town.add(hit); hits.push(hit);
    // keep each mesh's own material so filtering can turn the town to clay and back
    holder.traverse(o => { if (o.isMesh) o.userData.mat = o.material; });
    disc.add(town);
    Object.assign(t0, { town, holder, building, halo, flag, mast });
  });
  stacks.count = stackLabels.count = n;
  if (stackLabels.instanceColor) stackLabels.instanceColor.needsUpdate = true;
  disc.add(stacks, stackLabels);
}

const CLAY = new THREE.MeshStandardMaterial({ color: '#cfc5b6', roughness: 0.9, flatShading: true });
function setClay(t, on) {
  if (t.clayOn === on) return;
  t.clayOn = on;
  t.holder.traverse(o => { if (o.isMesh && o.userData.mat) o.material = on ? CLAY : o.userData.mat; });
}

function buildCuratorWalker() {
  curator = buildCurator();
  curator.scale.setScalar(0.95);
  curator.userData.theta = 0.4;
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.7, 10), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.8; hit.userData.curator = true;
  curator.add(hit); hits.push(hit);
  disc.add(curator);
}

/* ---------- tilt-shift (two separable blur passes, sharp band across the record) ---------- */
const TiltShift = {
  uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uRes: { value: new THREE.Vector2(1, 1) }, uFocus: { value: 0.52 }, uRange: { value: 0.16 }, uAmount: { value: 2.2 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uDir, uRes; uniform float uFocus, uRange, uAmount; varying vec2 vUv;
    void main(){
      float d = abs(vUv.y - uFocus);
      float b = smoothstep(uRange, uRange + 0.32, d) * uAmount;
      vec4 s = vec4(0.0); float w = 0.0;
      for (int i = -4; i <= 4; i++) { float k = exp(-float(i * i) / 8.0); s += texture2D(tDiffuse, vUv + uDir * float(i) * b / uRes) * k; w += k; }
      gl_FragColor = s / w;
    }`,
};

/* ---------- camera ---------- */
let fly = null, simNow = 0;
function flyTo(pos, target, dur = 1.6) {
  if (!controls) return;
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: simNow, dur: (reduceMotion ? 0.01 : dur) * 1000 };
}
// fit the record into the part of the screen the sleeve leaves free
function overviewPose() {
  const sleeveW = state.sleeveOpen && !narrow() ? Math.min(430, innerWidth * 0.34) + 14 : 0;
  const f = Math.max(0.35, (innerWidth - sleeveW) / innerWidth);
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  const d = Math.max(narrow() ? 58 : 50, (narrow() ? 19 : 18.5) / (f * tanH));
  const dir = (narrow() ? new THREE.Vector3(0, 66, 50) : new THREE.Vector3(0, 40, 44)).normalize();
  const target = new THREE.Vector3(0, -0.5, narrow() ? 2.5 : 0.5);
  return [target.clone().add(dir.multiplyScalar(d)), target];
}
function overview() { const [p, t] = overviewPose(); flyTo(p, t); }
function frameTown(i) {
  const R = RINGS[state.towns[i].ring].r;
  if (narrow()) flyTo(new THREE.Vector3(0, 22, R + 26), new THREE.Vector3(0, 1.5, R - 3));
  else flyTo(new THREE.Vector3(0, 12.5, R + 17), new THREE.Vector3(0, 1.8, R - 1.5));
}

/* ---------- selection ---------- */
function bringToFront(i) {
  const t = state.towns[i];
  // rotate the record so this town faces the viewer (world angle 0 = +z)
  state.targetRot = state.spin + wrap(-t.phi - state.spin);
  if (reduceMotion) state.spin = state.targetRot;
}
function select(i, { open = true } = {}) {
  state.selected = i;
  if (i < 0) { state.targetRot = null; updateSpinButton(); return; }
  bringToFront(i);
  updateSpinButton();
  if (controls) frameTown(i);
  if (open) showView('sig', i);
}

/* ---------- sleeve (side panel) ---------- */
const sleeve = $('#sleeve'), sbody = $('#sleeve-body');
function trackRow(t) {
  const s = t.sig, on = s._on;
  return `<li><button type="button" class="track${on ? '' : ' is-dim'}${t.i === state.selected ? ' is-current' : ''}" data-town="${t.i}">
    <span class="track-no">${t.track}</span><span class="track-main"><b>${esc(s.acronym)}</b><span>${esc(s.fullName)}</span></span>
    <span class="track-len" title="${s.videos.length} recording links">${s.videos.length ? s.videos.length + ' rec' : '—'}</span></button></li>`;
}
function tracklist() {
  const matching = state.towns.filter(t => t.sig._on);
  const A = matching.filter(t => t.track.startsWith('A')), Bs = matching.filter(t => t.track.startsWith('B'));
  return `<section class="tracks"><p class="ax-eyebrow">Tracklist</p><h2>${state.sigs.length} groups, one disc</h2>
    <p class="ax-note">Each landmark is a Special Interest Group. Choose a track to spin it to the front.</p>
    ${A.length ? `<h3>Side A · Topic SIGs <span class="ax-count">${A.length}</span></h3><ol class="tracklist">${A.map(trackRow).join('')}</ol>` : ''}
    ${Bs.length ? `<h3>Side B · Language SIGs <span class="ax-count">${Bs.length}</span></h3><ol class="tracklist">${Bs.map(trackRow).join('')}</ol>` : ''}
    ${matching.length ? '' : '<p class="ax-empty" role="status">No groups match this search and filter.</p><button class="chip" type="button" data-clear-search>Clear search and filters</button>'}
    <p class="ax-fine">“rec” counts recording links in the directory.</p></section>`;
}
function linerHead(i) {
  const t = state.towns[i], s = t.sig, word = WORD_FOR_SPEECH[s.acronym], lm = LANDMARK[s.acronym];
  return `<div class="liner-head"><span class="liner-track">${t.track}</span><span class="liner-of">${esc(kindLabel(s))} · track ${t.track} of the disc</span>
    <div class="stepper"><button type="button" data-step="-1" aria-label="Previous track">←</button><button type="button" data-step="1" aria-label="Next track">→</button></div></div>
    <p class="liner-landmark">${lm ? `On the record: ${esc(lm)}.` : word ? `On the record: a pavilion signed “${esc(word)}”, the word for speech.` : 'On the record: a house for a newly listed group.'}</p>`;
}
const CONCEPT = `<h3>How to read the record</h3><p>The twenty Special Interest Groups are pressed onto one disc: Side A’s topic groups on the outer grooves, Side B’s language groups near the label. Each landmark is a playful picture of the field, not an official symbol. The stacks of little records count each group’s recording links in the directory; a yellow pennant means a dated event is coming up; a mast with a red light means a seminar series is currently listed.</p><p>The little robot walking the grooves is Xiaojin, the AI agent that collects and checks this directory every day.</p>`;
function showView(view, arg) {
  state.view = view;
  document.body.dataset.view = view;
  let html = '';
  if (view === 'sig') html = linerHead(arg) + sigDetail(state.data, state.sigs[arg]);
  else if (view === 'tracklist') html = tracklist();
  else if (view === 'calendar') html = eventsBlock(state.data);
  else if (view === 'series') html = seriesBlock(state.data);
  else if (view === 'library') html = resourcesBlock(state.data);
  else if (view === 'about') html = aboutBlock(state.data, { ...state.meta, concept: CONCEPT });
  sbody.innerHTML = html;
  sbody.scrollTop = 0;
  $('#sleeve-back').hidden = view === 'tracklist';
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-current', String(b.dataset.view === view || (view === 'sig' && b.dataset.view === 'tracklist'))));
  openSleeve(true);
  const hash = view === 'sig' ? '#sig-' + encodeURIComponent(state.sigs[arg].acronym) : view === 'tracklist' ? '' : '#' + view;
  history.replaceState(null, '', location.pathname + location.search + hash);
}
function openSleeve(open) {
  const changed = state.sleeveOpen !== open;
  state.sleeveOpen = open;
  if (changed && controls && state.selected < 0 && !state.playing) overview();
  document.body.classList.toggle('sleeve-open', open);
  $('#sleeve-toggle').setAttribute('aria-expanded', String(open));
  $('#sleeve-toggle').setAttribute('aria-label', open ? 'Close liner notes' : 'Open liner notes');
  sbody.inert = !open;
  $('.finder').inert = !open;
  $('.sleeve-bar').inert = !open;
  $('.tabs').inert = !open && !narrow();
}
sbody.addEventListener('click', e => {
  if (e.target.closest('[data-clear-search]')) { $('#search').value = ''; state.query = ''; chips.querySelector('[data-filter="all"]').click(); $('#search').focus(); return; }
  const tr = e.target.closest('[data-town]');
  if (tr) { stopPlay(); select(Number(tr.dataset.town)); return; }
  const st = e.target.closest('[data-step]');
  if (st && state.selected >= 0) select((state.selected + Number(st.dataset.step) + state.towns.length) % state.towns.length);
});
$('#sleeve-back').addEventListener('click', () => { select(-1); showView('tracklist'); overview(); history.replaceState(null, '', location.pathname + location.search); });
$('#sleeve-toggle').addEventListener('click', () => openSleeve(!state.sleeveOpen));
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.view === 'tracklist' && state.selected >= 0) { select(-1); overview(); }
  showView(b.dataset.view);
}));

/* ---------- search & filters ---------- */
const chips = $('#chips');
chips.innerHTML = FILTERS.map(([id, label]) => `<button type="button" class="chip" data-filter="${id}" aria-pressed="${id === 'all'}">${label}</button>`).join('');
function applyFilters() {
  let shown = 0;
  state.sigs.forEach(s => { s._on = passesFilter(s, state.filter) && matchesQuery(s, state.query); if (s._on) shown++; });
  $('#count').textContent = shown === state.sigs.length ? `${shown} groups on this disc` : `${shown} of ${state.sigs.length} groups`;
  if (state.view === 'tracklist') { const top = sbody.scrollTop; sbody.innerHTML = tracklist(); sbody.scrollTop = top; }
}
chips.addEventListener('click', e => {
  const b = e.target.closest('[data-filter]'); if (!b) return;
  state.filter = b.dataset.filter;
  chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
  applyFilters();
});
$('#search').addEventListener('input', e => { state.query = e.target.value; applyFilters(); });
$('#search').addEventListener('keydown', e => { if (e.key === 'Enter') { const i = state.sigs.findIndex(s => s._on); if (i >= 0) select(i); } });

/* ---------- play mode: the tonearm reads the tracks ring by ring ---------- */
const ticker = $('#ticker');
function startPlay() {
  if (!webglOK) return;
  if (state.view === 'sig') showView('tracklist');
  state.playing = true; state.ring = 0; state.ringStart = state.spin; state.playingTown = -1;
  state.targetRot = null; state.selected = -1;
  $('#btn-play').setAttribute('aria-pressed', 'true');
  $('#btn-play .tool-label').textContent = 'Lift arm';
  ticker.hidden = false;
  ticker.innerHTML = '<span class="tk-k">Now playing</span><b>Side A, outer grooves</b>';
  crackle(true);
  updateSpinButton();
  overview();
}
function stopPlay() {
  if (!state.playing) return;
  state.playing = false; state.playingTown = -1;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  $('#btn-play').setAttribute('aria-pressed', 'false');
  $('#btn-play .tool-label').textContent = 'Play';
  ticker.hidden = true;
  crackle(false);
  updateSpinButton();
}
$('#btn-play').addEventListener('click', () => state.playing ? stopPlay() : startPlay());
ticker.addEventListener('click', () => { if (state.playingTown >= 0) { const k = state.playingTown; stopPlay(); select(k); } });

$('#btn-lamp').addEventListener('click', e => {
  state.night = !state.night;
  e.currentTarget.setAttribute('aria-pressed', String(state.night));
  document.body.classList.toggle('is-night', state.night);
});
function updateSpinButton() {
  const moving = state.playing || (state.spinning && state.targetRot === null);
  $('#btn-spin').setAttribute('aria-pressed', String(!moving));
  $('#btn-spin').querySelector('.tool-label').textContent = moving ? 'Pause' : 'Spin';
  $('#btn-spin').setAttribute('aria-label', moving ? 'Pause the record' : 'Resume the record');
}
$('#btn-spin').addEventListener('click', () => {
  const moving = state.playing || (state.spinning && state.targetRot === null);
  stopPlay();
  state.spinning = !moving;
  state.spinVel = 0;
  if (state.spinning && state.selected >= 0) { select(-1); showView('tracklist'); overview(); }
  updateSpinButton();
});
$('#btn-voice').addEventListener('click', e => {
  state.sound = !state.sound;
  e.currentTarget.setAttribute('aria-pressed', String(state.sound));
  if (!state.sound) { if ('speechSynthesis' in window) speechSynthesis.cancel(); crackle(false); }
  else if (state.playing) crackle(true);
  toast(state.sound ? 'Sound on: the tonearm announces each track.' : 'Sound off.');
});

/* ---------- sound: a synthesised crackle and spoken track names (both optional) ---------- */
let audio = null;
function crackle(on) {
  if (!state.sound && on) return;
  if (!on) { audio?.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.2); return; }
  if (!audio) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * 0.012 + (Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.5 : 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(lp); lp.connect(gain); gain.connect(ctx.destination); src.start();
    audio = { ctx, gain };
  }
  audio.ctx.resume();
  audio.gain.gain.setTargetAtTime(0.35, audio.ctx.currentTime, 0.3);
}
function announce(t) {
  if (!state.sound || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`${t.track}. ${t.sig.fullName}.`);
  u.lang = 'en-US'; u.rate = 1;
  speechSynthesis.speak(u);
}

let toastTimer;
function toast(msg, ms = 3500) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ---------- tooltip ---------- */
let pointer = { x: 0, y: 0 };
function showTip() {
  const tip = $('#tip');
  if (coarse || state.dragging || (state.hovered < 0 && state.hovered !== 'curator')) { tip.hidden = true; return; }
  if (state.hovered === 'curator') tip.innerHTML = '<span class="tip-k">The curator</span><b>Xiaojin</b><span>The AI agent that collects and checks this directory every day. Click for how it works.</span>';
  else {
    const t = state.towns[state.hovered], s = t.sig, up = eventsFor(state.data, s.acronym).future.length;
    tip.innerHTML = `<span class="tip-k">${t.track} · ${esc(kindLabel(s))}</span><b>${esc(s.acronym)}</b><span>${esc(s.fullName)}</span><span class="tip-k">${s.videos.length} recordings · ${up} upcoming${s.activeSeries ? ' · on air' : ''}</span>`;
  }
  tip.hidden = false;
  const x = Math.min(pointer.x + 16, innerWidth - tip.offsetWidth - 10), y = Math.min(pointer.y + 16, innerHeight - tip.offsetHeight - 10);
  tip.style.transform = `translate(${x}px, ${y}px)`;
}

/* ---------- keyboard ---------- */
addEventListener('keydown', e => {
  const el = e.target instanceof Element ? e.target : null;
  if (el?.matches('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  const n = state.towns.length;
  if (e.key === '/') { e.preventDefault(); stopPlay(); select(-1); showView('tracklist'); overview(); $('#search').focus(); }
  else if (e.key === 'Escape') { stopPlay(); if (state.selected >= 0) { select(-1); showView('tracklist'); overview(); } }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { stopPlay(); select(((state.selected < 0 ? 0 : state.selected + (e.key === 'ArrowRight' ? 1 : -1)) + n) % n); }
  else if (webglOK && e.key === ' ' && !el?.closest('button, a, summary')) { e.preventDefault(); $('#btn-play').click(); }
  else if (webglOK && e.key.toLowerCase() === 'n') $('#btn-lamp').click();
});

/* ---------- start ---------- */
function showDirectoryFallback() {
  webglOK = false;
  renderer?.setAnimationLoop(null);
  stopPlay();
  document.body.classList.add('no-webgl');
  document.documentElement.dataset.webgl = 'fallback';
  openSleeve(true);
  const status = $('#render-status');
  status.textContent = '3D is unavailable. You can browse every group and resource in this list.';
  status.hidden = false;
}
applyFilters();
showView('tracklist');
openSleeve(!narrow());
updateSpinButton();
if (source === 'snapshot') {
  const status = $('#data-status');
  status.textContent = `Saved copy · ${fmtDate(takenAt)}. Live data is unavailable; dates may have changed.`;
  status.hidden = false;
}
$('.skip').addEventListener('click', e => {
  e.preventDefault(); showView('tracklist'); sbody.focus();
});
if (!webglOK) {
  showDirectoryFallback();
} else {
  try {
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse || narrow() ? 1.25 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DAY.exposure;
  $('#stage').appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); showDirectoryFallback(); });
  // the canvas textures (label, signs) use the page fonts, so wait briefly for them
  await Promise.race([Promise.all(['600 30px "DM Mono"', '700 150px "Fraunces"', 'italic 600 96px "Fraunces"', '600 64px "Bricolage Grotesque"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 1800))]);
  buildWorld();
  buildTowns();
  buildCuratorWalker();

  camera.fov = narrow() ? 42 : 30; camera.updateProjectionMatrix();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 12; controls.maxDistance = 180;
  controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.2;
  const [p0, t0] = overviewPose();
  camera.position.copy(p0).multiplyScalar(reduceMotion ? 1 : 1.45); controls.target.copy(t0);
  flyTo(p0, t0, 2.6);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  tiltH = new ShaderPass(TiltShift); tiltV = new ShaderPass(TiltShift);
  tiltV.uniforms.uDir.value.set(0, 1);
  if (!coarse) composer.addPass(tiltH), composer.addPass(tiltV);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0, 0.45, 0.8);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const setRes = () => { const w = innerWidth * renderer.getPixelRatio(), h = innerHeight * renderer.getPixelRatio(); tiltH.uniforms.uRes.value.set(w, h); tiltV.uniforms.uRes.value.set(w, h); };
  setRes();

  // picking + drag-to-spin
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), recordPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP), hitP = new THREE.Vector3();
  const toNdc = e => { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  const pickTown = e => {
    toNdc(e);
    const h = ray.intersectObjects(hits, false)[0];
    if (!h) return -1;
    return h.object.userData.curator ? 'curator' : h.object.userData.town;
  };
  const planeAngle = e => { toNdc(e); if (!ray.ray.intersectPlane(recordPlane, hitP)) return null; const r = Math.hypot(hitP.x, hitP.z); return r < RECORD_R + 0.5 ? Math.atan2(hitP.x, hitP.z) : null; };
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    const ang = planeAngle(e);
    // grab the vinyl itself (outside the label) to spin it; elsewhere the camera orbits
    if (ang !== null && pickTown(e) === -1 && Math.hypot(hitP.x, hitP.z) > LABEL_R) {
      state.dragging = { last: ang, vel: 0, lastT: performance.now() };
      controls.enabled = false;
      state.targetRot = null;
      renderer.domElement.setPointerCapture(e.pointerId);
      document.body.classList.add('is-grabbing');
    }
  });
  renderer.domElement.addEventListener('pointermove', e => {
    pointer = { x: e.clientX, y: e.clientY };
    if (state.dragging) {
      const ang = planeAngle(e);
      if (ang !== null) {
        const d = wrap(ang - state.dragging.last), now = performance.now(), dt = Math.max(1, now - state.dragging.lastT) / 1000;
        state.spin += d; state.dragging.vel = state.dragging.vel * 0.6 + (d / dt) * 0.4;
        state.dragging.last = ang; state.dragging.lastT = now;
      }
      return;
    }
    if (e.buttons) return;
    const h = pickTown(e);
    if (h !== state.hovered) {
      state.hovered = h;
      renderer.domElement.style.cursor = h === -1 ? (planeAngle(e) !== null ? 'grab' : '') : 'pointer';
    }
    showTip();
  });
  const endDrag = e => {
    if (state.dragging) {
      state.spinVel = THREE.MathUtils.clamp(state.dragging.vel, -6, 6);
      state.dragging = null; controls.enabled = true;
      document.body.classList.remove('is-grabbing');
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    }
  };
  renderer.domElement.addEventListener('pointerup', e => {
    const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 99;
    endDrag(e);
    if (moved > 6) return;
    const h = pickTown(e);
    if (h === 'curator') { showView('about'); return; }
    if (h >= 0) { stopPlay(); select(h); }
  });
  renderer.domElement.addEventListener('pointerleave', () => { state.hovered = -1; showTip(); });
  renderer.domElement.addEventListener('pointercancel', endDrag);

  addEventListener('resize', () => {
    camera.fov = narrow() ? 42 : 30;
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    if (state.selected < 0 && !state.playing) overview();
    renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); setRes();
  });

  const bg = new THREE.Color(), dayBg = new THREE.Color(DAY.bg), nightBg = new THREE.Color(NIGHT.bg);
  const dayTable = new THREE.Color(DAY.table), nightTable = new THREE.Color(NIGHT.table), needle = new THREE.Vector3();
  const clock = new THREE.Clock();
  function frame(forcedDt) {
    const dt = forcedDt ?? Math.min(clock.getDelta(), 0.05);
    simNow += dt * 1000;
    const time = reduceMotion ? 0 : simNow / 1000;

    // day / night
    state.nightK += ((state.night ? 1 : 0) - state.nightK) * Math.min(1, dt * 2.5);
    const k = state.nightK;
    bg.copy(dayBg).lerp(nightBg, k); scene.background.copy(bg); scene.fog.color.copy(bg);
    table.material.color.copy(dayTable).lerp(nightTable, k);
    hemi.intensity = THREE.MathUtils.lerp(DAY.hemi, NIGHT.hemi, k);
    sun.intensity = THREE.MathUtils.lerp(DAY.sun, NIGHT.sun, k);
    lamp.intensity = 1900 * k;
    renderer.toneMappingExposure = THREE.MathUtils.lerp(DAY.exposure, NIGHT.exposure, k);
    scene.environmentIntensity = THREE.MathUtils.lerp(0.55, 0.12, k);
    WINDOW.emissiveIntensity = 1.8 * k; BULB.emissiveIntensity = 0.15 + 2.6 * k;
    bloom.strength = 0.75 * k;
    bloom.enabled = k > 0.001;
    tiltH.enabled = tiltV.enabled = !coarse && !narrow();

    // record motion: drag > bring-to-front > play/idle spin
    if (!state.dragging) {
      if (state.targetRot !== null) {
        const d = state.targetRot - state.spin;
        state.spin += d * Math.min(1, dt * 3.2);
        state.spinVel = 0;
        if (Math.abs(d) < 1e-3) state.spin = state.targetRot;
      } else {
        const want = state.playing ? PLAY_SPIN : (state.spinning && state.hovered === -1 ? IDLE_SPIN : 0);
        state.spinVel += (want - state.spinVel) * Math.min(1, dt * (Math.abs(state.spinVel) > Math.abs(want) + 0.3 ? 0.9 : 1.6));
        state.spin += state.spinVel * dt;
      }
    }
    disc.rotation.y = state.spin;

    // tonearm: rest, or tracking one ring per revolution while playing
    let armTarget = restAngle();
    if (state.playing) {
      if (state.spin - state.ringStart > TAU) { state.ring++; state.ringStart = state.spin; state.playingTown = -1; if (state.ring > 2) stopPlay(); else ticker.innerHTML = `<span class="tk-k">Now playing</span><b>${state.ring === 1 ? 'Side A, inner grooves' : 'Side B, by the label'}</b>`; }
      if (state.playing) armTarget = angleForRadius(RINGS[state.ring].r);
    }
    state.armAngle += (armTarget - state.armAngle) * Math.min(1, dt * 2);
    armPivot.rotation.y = state.armAngle;
    const onRecord = state.playing && Math.abs(state.armAngle - armTarget) < 0.02;
    beam.material.opacity += ((onRecord ? 0.55 : 0) - beam.material.opacity) * Math.min(1, dt * 6);
    needleAt(state.armAngle, needle);
    const needlePhi = Math.atan2(needle.x, needle.z);
    let playingNow = -1;
    if (onRecord) state.towns.forEach(t => { if (t.ring === state.ring && Math.abs(wrap(t.phi + state.spin - needlePhi)) < 0.16) playingNow = t.i; });
    if (playingNow >= 0 && playingNow !== state.playingTown && state.playing) {
      state.playingTown = playingNow;
      if (playingNow >= 0) {
        const t = state.towns[playingNow];
        ticker.innerHTML = `<span class="tk-k">Now playing · ${t.track}</span><b>${esc(t.sig.acronym)}</b><span>${esc(t.sig.fullName)}</span><span class="tk-more">Open liner notes →</span>`;
        announce(t);
      }
    }

    // towns: lift on hover/selection/playing, clay when filtered out
    state.towns.forEach(t => {
      const focus = t.i === state.hovered || t.i === state.selected || t.i === state.playingTown;
      t.lift += ((focus ? 1 : 0) - t.lift) * Math.min(1, dt * 8);
      const bounce = t.i === state.hovered ? Math.abs(Math.sin(time * 6)) * 0.08 : 0;
      t.holder.position.y = t.lift * 0.35 + bounce;
      t.holder.scale.setScalar(1 + t.lift * 0.06);
      t.halo.material.opacity += (((t.i === state.selected || t.i === state.playingTown) ? 0.95 : 0) - t.halo.material.opacity) * Math.min(1, dt * 6);
      setClay(t, !t.sig._on);
      t.building.userData.anim?.(time + t.i);
      if (t.building.userData.beam) t.building.userData.beam.material.opacity = 0.05 + 0.4 * k;
      if (t.flag) t.flag.userData.cloth.rotation.y = Math.sin(time * 3 + t.i) * 0.35;
    });
    ONAIR.emissiveIntensity = 0.4 + (Math.sin(time * 4) > 0 ? 1.4 : 0);
    GLOW.emissiveIntensity = 0.45 + 0.35 * Math.sin(time * 2.5);

    // the curator walks the lane between the outer and middle grooves
    if (!reduceMotion) curator.userData.theta -= dt * 0.11;
    const th = curator.userData.theta;
    curator.position.set(Math.sin(th) * LANE_R, TOP, Math.cos(th) * LANE_R);
    curator.rotation.y = th - Math.PI / 2;
    curator.userData.legs.forEach((l, n) => { l.rotation.x = Math.sin(time * 7 + n * Math.PI) * 0.5; });
    curator.position.y = TOP + Math.abs(Math.sin(time * 7)) * 0.05;

    // camera
    if (fly) {
      const f = Math.min(1, (simNow - fly.start) / fly.dur), e = ease(f);
      camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (f >= 1) fly = null;
    }
    controls.update();
    // Keep the model clear when portrait framing moves the camera farther away.
    scene.fog.near = Math.max(80, camera.position.distanceTo(controls.target) + 36);
    scene.fog.far = scene.fog.near + 100;
    const shiftTarget = state.sleeveOpen && !narrow() ? Math.min(430, innerWidth * 0.34) / 2 : 0;
    state.viewShift += (shiftTarget - state.viewShift) * Math.min(1, dt * 4);
    if (Math.abs(state.viewShift) > 0.5) camera.setViewOffset(innerWidth, innerHeight, state.viewShift, 0, innerWidth, innerHeight);
    else camera.clearViewOffset();
    composer.render();
  }
  let lastRender = -Infinity;
  renderer.setAnimationLoop(now => {
    if (document.hidden || now - lastRender < 1000 / 30) return;
    lastRender = now;
    frame();
  });
  document.documentElement.dataset.webgl = 'ready';
  window.__record = { state, camera, renderer, get controls() { return controls; }, advance: (sec, step = 1 / 30) => { for (let t = 0; t < sec; t += step) frame(step); } };
  } catch (error) {
    console.warn('The 3D view could not start; the text directory remains available.', error);
    showDirectoryFallback();
  }
}

function restoreHash(rawHash) {
  let hash;
  try { hash = decodeURIComponent(rawHash.slice(1)); } catch { hash = ''; }
  stopPlay();
  const i = hash.startsWith('sig-') ? state.sigs.findIndex(s => s.acronym === hash.slice(4)) : -1;
  if (i >= 0) select(i);
  else if (['calendar', 'series', 'library', 'about'].includes(hash)) showView(hash);
  else { select(-1); showView('tracklist'); overview(); }
}
if (initialHash) restoreHash(initialHash);
addEventListener('hashchange', () => restoreHash(location.hash));
document.documentElement.dataset.source = source;
