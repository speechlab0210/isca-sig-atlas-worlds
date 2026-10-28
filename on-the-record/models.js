// Low-poly buildings for "On the Record". One small landmark per SIG, built from
// primitives so the page needs no model files. Every builder returns a Group whose
// front faces +z and whose footprint fits in about 2.4 x 2.4 units.
import * as THREE from 'three';

export const PAL = {
  cream: '#f3e8d4', white: '#fbf6ec', terracotta: '#d8774a', tomato: '#e0522d', mustard: '#e8b246',
  sage: '#9db596', teal: '#3d8c86', sky: '#8fc2da', navy: '#2e4866', lilac: '#b7a1d4', pink: '#eea59f',
  brown: '#8a5b3d', grass: '#a6c486', stone: '#d2c9ba', ink: '#2b2622', gold: '#d6a03a', glass: '#cfe8ef',
  jade: '#79b8a0', plum: '#8e5f8f', red: '#c8442f', slate: '#6c7a89',
};

const cache = new Map();
export const mat = (color, opts = {}) => {
  const key = color + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, flatShading: true, ...opts }));
  return cache.get(key);
};
// shared window material: dark by day, lit at night (main.js changes emissiveIntensity)
export const WINDOW = new THREE.MeshStandardMaterial({ color: '#33475a', emissive: '#ffcf7a', emissiveIntensity: 0, roughness: 0.3, metalness: 0.1 });
export const BULB = new THREE.MeshStandardMaterial({ color: '#fff1c9', emissive: '#ffcc66', emissiveIntensity: 0.15, roughness: 0.4 });
export const GLOW = new THREE.MeshStandardMaterial({ color: '#7fe0d6', emissive: '#4fd8c8', emissiveIntensity: 0.6, roughness: 0.4 });
export const ONAIR = new THREE.MeshStandardMaterial({ color: '#ff5a3c', emissive: '#ff3b1f', emissiveIntensity: 1.2, roughness: 0.4 });

function add(g, mesh, x = 0, y = 0, z = 0) {
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}
export const box = (g, w, h, d, m, x = 0, y = 0, z = 0) => add(g, new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y + h / 2, z);
export const cyl = (g, rt, rb, h, m, x = 0, y = 0, z = 0, seg = 16) => add(g, new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m), x, y + h / 2, z);
const sphere = (g, r, m, x = 0, y = 0, z = 0, w = 12, h = 8) => add(g, new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m), x, y, z);

function prismGeo(w, h, d) {
  // triangular gable along x, ridge height h, depth d
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  return geo;
}
const gable = (g, w, h, d, m, x = 0, y = 0, z = 0) => add(g, new THREE.Mesh(prismGeo(w, h, d), m), x, y, z);

function windowsOn(g, w, h, z, rows, cols, y0, x0 = 0, size = 0.2) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = x0 - w / 2 + (c + 0.5) * (w / cols), y = y0 + (r + 0.5) * (h / rows);
    box(g, size, size * 1.25, 0.04, WINDOW, x, y - size * 0.6, z);
  }
}

export function tree(g, x, z, s = 1, tone = PAL.sage) {
  cyl(g, 0.06 * s, 0.08 * s, 0.35 * s, mat(PAL.brown), x, 0, z, 6);
  add(g, new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 * s, 0), mat(tone)), x, 0.55 * s, z);
}

export function textTexture(text, { w = 512, h = 128, bg = '#fbf6ec', fg = '#2b2622', font = '600 64px "Bricolage Grotesque", "Segoe UI", sans-serif', border = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  if (border) { x.strokeStyle = border; x.lineWidth = h * 0.06; x.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1); }
  x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  let size = parseInt(font.match(/(\d+)px/)[1], 10);
  while (x.measureText(text).width > w * 0.86 && size > 12) { size -= 2; x.font = font.replace(/\d+px/, size + 'px'); }
  x.fillText(text, w / 2, h / 2 + h * 0.03);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// a little sign on two posts, readable from the front
export function sign(g, text, { x = 0, z = 1.25, y = 0, w = 1.3, h = 0.36, bg = PAL.white, fg = PAL.ink, post = PAL.brown, font } = {}) {
  cyl(g, 0.03, 0.03, y + 0.2, mat(post), x - w * 0.4, 0, z, 5);
  cyl(g, 0.03, 0.03, y + 0.2, mat(post), x + w * 0.4, 0, z, 5);
  const tex = textTexture(text, { w: 512, h: Math.round(512 * h / w), bg, fg, font });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), [mat(bg), mat(bg), mat(bg), mat(bg), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), mat(bg)]);
  add(g, m, x, y + 0.2 + h / 2, z);
  return m;
}

/* ---------------- the twenty landmarks ---------------- */
const B = {};

B.SynSIG = g => { // speech synthesis: a tower topped with a gramophone horn
  cyl(g, 0.62, 0.72, 2.1, mat(PAL.cream));
  cyl(g, 0.66, 0.66, 0.14, mat(PAL.gold, { metalness: 0.6, roughness: 0.35 }), 0, 1.5);
  windowsOn(g, 0.6, 0.9, 0.66, 2, 2, 0.4);
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.07, 1.25, 24, 1, true), mat(PAL.gold, { metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide, flatShading: false }));
  horn.rotation.x = Math.PI / 2 - 0.55;
  add(g, horn, 0, 2.75, 0.35);
  cyl(g, 0.12, 0.12, 0.35, mat(PAL.gold, { metalness: 0.7, roughness: 0.3 }), 0, 2.05, 0);
  const rings = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.5 + i * 0.32, 0.025, 6, 32), new THREE.MeshStandardMaterial({ color: PAL.gold, transparent: true, opacity: 0.6, emissive: PAL.gold, emissiveIntensity: 0.2 }));
    r.userData.wave = i;
    rings.add(r);
  }
  rings.position.set(0, 3.3, 0.95); rings.rotation.x = -0.55;
  g.add(rings);
  g.userData.anim = (t) => rings.children.forEach(r => { const k = (t * 0.6 + r.userData.wave / 3) % 1; r.scale.setScalar(0.6 + k * 1.2); r.material.opacity = 0.7 * (1 - k); });
};

B.AVISA = g => { // auditory-visual speech: a cinema whose screen shows a speaking mouth
  box(g, 2.0, 1.35, 1.4, mat(PAL.pink));
  box(g, 2.1, 0.2, 1.5, mat(PAL.mustard), 0, 1.35);
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = '#1d1a2a'; x.fillRect(0, 0, 256, 160);
  x.fillStyle = '#e04b5a'; x.beginPath(); x.ellipse(128, 84, 70, 34, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#3a0f1a'; x.beginPath(); x.ellipse(128, 86, 48, 14, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.fillRect(96, 74, 64, 7);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.92), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35 }));
  add(g, screen, 0, 0.78, 0.711);
  // the eye on the roof
  sphere(g, 0.36, mat(PAL.white, { flatShading: false }), 0, 1.86, 0.1, 18, 12);
  const iris = new THREE.Mesh(new THREE.CircleGeometry(0.17, 18), mat(PAL.navy));
  add(g, iris, 0, 1.88, 0.455);
  for (let i = -1; i <= 1; i += 2) cyl(g, 0.05, 0.05, 0.12, BULB, i * 0.85, 1.55, 0.72, 8);
  g.userData.anim = (t) => { screen.scale.y = 1; iris.position.x = Math.sin(t * 0.7) * 0.1; };
};

B.SIGUL = g => { // under-resourced languages: a greenhouse where small languages grow
  const glass = new THREE.MeshStandardMaterial({ color: PAL.glass, transparent: true, opacity: 0.38, roughness: 0.1, metalness: 0.1 });
  box(g, 2.0, 0.9, 1.4, glass, 0, 0.12);
  gable(g, 2.0, 0.7, 1.4, glass, 0, 1.02, 0);
  box(g, 2.1, 0.12, 1.5, mat(PAL.white));
  for (const x of [-1, 0, 1]) box(g, 0.05, 0.9, 1.42, mat(PAL.white), x, 0.12);
  for (let i = 0; i < 6; i++) {
    const x = -0.7 + (i % 3) * 0.7, z = i < 3 ? -0.3 : 0.3;
    cyl(g, 0.13, 0.1, 0.2, mat(PAL.terracotta), x, 0.12, z, 8);
    add(g, new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.38, 5), mat(PAL.grass)), x, 0.5, z);
  }
  for (const [x, z] of [[1.25, 0.9], [-1.2, 1.0], [0.9, -1.05]]) add(g, new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), mat(PAL.grass)), x, 0.15, z);
};

B.SpLC = g => { // speaker & language characterisation: a bureau with a magnifying glass
  box(g, 1.5, 1.9, 1.3, mat(PAL.navy));
  box(g, 1.6, 0.12, 1.4, mat(PAL.cream), 0, 1.9);
  windowsOn(g, 1.3, 1.4, 0.66, 3, 3, 0.35);
  const lens = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 8, 28), mat(PAL.gold, { metalness: 0.6, roughness: 0.3 }));
  const glassD = new THREE.Mesh(new THREE.CircleGeometry(0.52, 28), new THREE.MeshStandardMaterial({ color: '#d9f2ff', transparent: true, opacity: 0.45, roughness: 0.05, side: THREE.DoubleSide }));
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.85, 8), mat(PAL.brown));
  handle.position.set(0, -0.95, 0);
  lens.add(rim, glassD, handle);
  lens.position.set(0.95, 1.25, 0.75); lens.rotation.set(0, -0.5, -0.45);
  lens.traverse(m => { m.castShadow = true; });
  g.add(lens);
  g.userData.anim = (t) => { lens.rotation.z = -0.45 + Math.sin(t * 0.8) * 0.08; };
};

B.SProSIG = g => { // prosody: a bandstand whose roof is a pitch contour
  cyl(g, 1.15, 1.2, 0.18, mat(PAL.cream), 0, 0, 0, 24);
  const f0 = [0.35, 0.55, 0.85, 1.1, 1.2, 1.05, 0.7, 0.9, 0.6, 0.4];
  f0.forEach((h, i) => {
    const x = -0.95 + i * 0.21;
    box(g, 0.16, 0.9 + h, 0.16, mat(i % 2 ? PAL.lilac : PAL.plum), x, 0.18, -0.35);
  });
  const contour = new THREE.CatmullRomCurve3(f0.map((h, i) => new THREE.Vector3(-0.95 + i * 0.21, 1.2 + h, -0.35)));
  add(g, new THREE.Mesh(new THREE.TubeGeometry(contour, 40, 0.05, 6, false), mat(PAL.mustard, { emissive: PAL.mustard, emissiveIntensity: 0.25 })));
  for (const x of [-0.8, 0.8]) cyl(g, 0.05, 0.05, 0.9, mat(PAL.white), x, 0.18, 0.55, 6);
  box(g, 1.8, 0.08, 0.5, mat(PAL.lilac), 0, 1.06, 0.45);
};

B.SIGdial = g => { // discourse & dialogue: a café with two speech bubbles in conversation
  box(g, 1.7, 1.25, 1.2, mat(PAL.terracotta));
  windowsOn(g, 1.4, 0.7, 0.61, 1, 3, 0.35, 0, 0.3);
  for (let i = 0; i < 7; i++) {
    const s = box(g, 0.25, 0.06, 0.6, mat(i % 2 ? PAL.white : PAL.teal), -0.75 + i * 0.25, 1.05, 0.85);
    s.rotation.x = 0.35;
  }
  box(g, 1.8, 0.14, 1.3, mat(PAL.cream), 0, 1.25);
  for (const x of [-0.55, 0.55]) {
    cyl(g, 0.2, 0.2, 0.04, mat(PAL.white), x, 0.42, 1.25, 12);
    cyl(g, 0.03, 0.03, 0.42, mat(PAL.ink), x, 0, 1.25, 6);
  }
  const bubble = (color, x, y) => {
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), mat(color, { flatShading: false }));
    body.scale.set(1.35, 0.9, 0.5);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 6), mat(color));
    tail.position.set(x < 0 ? 0.18 : -0.18, -0.28, 0); tail.rotation.z = x < 0 ? 0.6 : -0.6;
    b.add(body, tail); b.position.set(x, y, 0.2);
    b.traverse(m => { m.castShadow = true; });
    g.add(b);
    return b;
  };
  const a = bubble(PAL.white, -0.45, 2.05), c = bubble(PAL.mustard, 0.5, 2.25);
  g.userData.anim = (t) => { a.position.y = 2.05 + Math.max(0, Math.sin(t * 2)) * 0.18; c.position.y = 2.25 + Math.max(0, Math.sin(t * 2 + Math.PI)) * 0.18; };
};

B.SLaTE = g => { // education: a schoolhouse with a bell tower
  box(g, 1.9, 1.05, 1.3, mat(PAL.red));
  gable(g, 2.1, 0.75, 1.45, mat(PAL.ink), 0, 1.05, 0);
  windowsOn(g, 1.6, 0.6, 0.66, 1, 4, 0.3, 0, 0.22);
  box(g, 0.45, 0.6, 0.45, mat(PAL.white), 0, 1.55);
  add(g, new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.5, 4), mat(PAL.ink)), 0, 2.4, 0).rotation.y = Math.PI / 4;
  const bell = add(g, new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.6), mat(PAL.gold, { metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide })), 0, 1.95, 0);
  box(g, 0.7, 0.42, 0.05, mat('#2f4a3c'), 0.55, 0.25, 0.68);
  g.userData.anim = (t) => { bell.rotation.z = Math.sin(t * 3) * 0.25; };
};

B.SIGML = g => { // machine learning: a lab with a neural network on the roof
  box(g, 1.7, 1.4, 1.5, mat(PAL.white));
  box(g, 1.75, 0.1, 1.55, mat(PAL.teal), 0, 1.4);
  windowsOn(g, 1.5, 1.0, 0.76, 2, 4, 0.25, 0, 0.18);
  const layers = [[-0.55, 3], [0, 4], [0.55, 2]], nodes = [];
  layers.forEach(([x, n]) => { for (let i = 0; i < n; i++) nodes.push(sphere(g, 0.1, GLOW, x, 1.75 + (i - (n - 1) / 2) * 0.32, 0)); });
  const link = mat(PAL.slate);
  for (let a = 0; a < nodes.length; a++) for (let b = 0; b < nodes.length; b++) {
    const pa = nodes[a].position, pb = nodes[b].position;
    if (!(pb.x - pa.x > 0.4 && pb.x - pa.x < 0.7)) continue;
    const len = pa.distanceTo(pb), m = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 4), link);
    m.position.copy(pa).add(pb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pb.clone().sub(pa).normalize());
    g.add(m);
  }
  box(g, 0.08, 0.6, 0.08, mat(PAL.slate), -0.55, 1.5);
  box(g, 0.08, 0.6, 0.08, mat(PAL.slate), 0.55, 1.5);
};

B.SLPAT = g => { // assistive technologies: an access centre with a gentle ramp and a wide round door
  box(g, 1.7, 1.3, 1.3, mat(PAL.sage));
  box(g, 1.8, 0.12, 1.4, mat(PAL.cream), 0, 1.3);
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 24, 1, false, 0, Math.PI), mat(PAL.mustard));
  door.rotation.set(Math.PI / 2, 0, Math.PI / 2); add(g, door, 0.25, 0.02, 0.66);
  const ramp = box(g, 1.3, 0.06, 0.5, mat(PAL.stone), -0.45, 0.12, 1.0);
  ramp.rotation.z = 0.12;
  for (const x of [-1.05, 0.15]) cyl(g, 0.025, 0.025, 0.45, mat(PAL.ink), x, 0, 1.22, 5);
  box(g, 1.25, 0.03, 0.03, mat(PAL.ink), -0.45, 0.48, 1.22).rotation.z = 0.12;
  windowsOn(g, 1.4, 0.5, 0.66, 1, 2, 0.75, -0.25, 0.26);
};

B['SIG-HIST'] = g => { // history: a museum with a phonograph on show
  box(g, 2.0, 0.12, 1.5, mat(PAL.stone));
  box(g, 1.85, 0.12, 1.35, mat(PAL.stone), 0, 0.12);
  box(g, 1.7, 1.0, 1.0, mat(PAL.cream), 0, 0.24, -0.15);
  for (let i = 0; i < 4; i++) cyl(g, 0.08, 0.09, 1.0, mat(PAL.white), -0.66 + i * 0.44, 0.24, 0.5, 10);
  box(g, 1.85, 0.14, 1.3, mat(PAL.white), 0, 1.24);
  gable(g, 1.85, 0.42, 1.3, mat(PAL.cream), 0, 1.38, 0);
  cyl(g, 0.15, 0.18, 0.3, mat(PAL.brown), 0, 0, 1.05, 8);
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.03, 0.5, 16, 1, true), mat(PAL.gold, { metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide, flatShading: false }));
  horn.rotation.x = -1.0; add(g, horn, 0, 0.55, 1.15);
};

B['SIG-CHILD'] = g => { // child-computer interaction: a playground with a friendly robot
  const slide = box(g, 0.45, 0.06, 1.4, mat(PAL.sky), -0.55, 0.45, 0.2);
  slide.rotation.x = -0.55;
  box(g, 0.5, 0.9, 0.5, mat(PAL.mustard), -0.55, 0, -0.65);
  for (const x of [0.35, 1.05]) { const l = box(g, 0.06, 1.1, 0.06, mat(PAL.red), x, 0, -0.2); l.rotation.z = x < 0.7 ? 0.12 : -0.12; }
  box(g, 0.8, 0.06, 0.06, mat(PAL.red), 0.7, 1.07, -0.2);
  const seat = box(g, 0.25, 0.04, 0.16, mat(PAL.teal), 0.7, 0.35, -0.2);
  const colors = [PAL.tomato, PAL.teal, PAL.mustard, PAL.lilac];
  [[0.3, 0, 0.75], [0.62, 0, 0.75], [0.46, 0.3, 0.75], [0.95, 0, 0.6]].forEach(([x, y, z], i) => box(g, 0.28, 0.28, 0.28, mat(colors[i]), x, y, z).rotation.y = i * 0.3);
  // tiny robot friend
  box(g, 0.28, 0.3, 0.22, mat(PAL.white), -0.2, 0, 0.95);
  const head = box(g, 0.3, 0.22, 0.24, mat(PAL.white), -0.2, 0.3, 0.95);
  for (const x of [-0.27, -0.13]) sphere(g, 0.03, GLOW, x, 0.42, 1.08, 6, 4);
  g.userData.anim = (t) => { seat.position.z = -0.2 + Math.sin(t * 2.2) * 0.12; head.rotation.y = Math.sin(t * 1.3) * 0.4; };
};

B['SIG-RoSP'] = g => { // robust speech: a lighthouse that keeps working in any weather
  add(g, new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 0), mat(PAL.stone)), 0, 0.2, 0).scale.set(1.3, 0.5, 1.2);
  for (let i = 0; i < 5; i++) cyl(g, 0.5 - i * 0.05, 0.55 - i * 0.05, 0.42, mat(i % 2 ? PAL.white : PAL.red), 0, 0.4 + i * 0.42, 0, 18);
  const lamp = cyl(g, 0.3, 0.3, 0.38, BULB, 0, 2.5, 0, 12);
  add(g, new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.35, 12), mat(PAL.red)), 0, 3.05, 0);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.2, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.rotation.z = Math.PI / 2; beam.position.set(1.6, 0, 0);
  const pivot = new THREE.Group(); pivot.position.set(0, 2.69, 0); pivot.add(beam); g.add(pivot);
  g.userData.anim = (t) => { pivot.rotation.y = t * 1.2; };
  g.userData.lamp = lamp;
  g.userData.beam = beam; // brighter at night (main.js)
};

B['SIG-SPSC'] = g => { // security & privacy: a vault with a padlock
  box(g, 1.8, 1.35, 1.4, mat(PAL.slate));
  box(g, 1.9, 0.16, 1.5, mat(PAL.navy), 0, 1.35);
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 24), mat('#b9c2cc', { metalness: 0.7, roughness: 0.35 }));
  door.rotation.x = Math.PI / 2; add(g, door, 0, 0.68, 0.72);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 20), mat(PAL.gold, { metalness: 0.7, roughness: 0.3 }));
  add(g, wheel, 0, 0.68, 0.8);
  for (let i = 0; i < 3; i++) { const s = box(g, 0.44, 0.03, 0.03, mat(PAL.gold, { metalness: 0.7 }), 0, 0.665, 0.8); s.rotation.z = i * Math.PI / 3; }
  box(g, 0.5, 0.42, 0.22, mat(PAL.gold, { metalness: 0.6, roughness: 0.35 }), 0, 1.51, 0);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 8, 18, Math.PI), mat('#c9ced4', { metalness: 0.8, roughness: 0.3 }));
  add(g, shackle, 0, 1.93, 0);
  g.userData.anim = (t) => { wheel.rotation.z = t * 0.5; };
};

B['SIG-SLT'] = g => { // spoken language translation: a bridge between two houses
  const water = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.04, 2.2), mat(PAL.sky, { roughness: 0.2 }));
  add(g, water, 0, 0.02, 0);
  box(g, 0.8, 0.9, 0.9, mat(PAL.mustard), -0.95, 0, 0);
  gable(g, 0.95, 0.4, 1.0, mat(PAL.terracotta), -0.95, 0.9, 0).rotation.y = Math.PI / 2;
  box(g, 0.8, 1.15, 0.9, mat(PAL.sky), 0.95, 0, 0);
  box(g, 0.9, 0.12, 1.0, mat(PAL.navy), 0.95, 1.15);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 6, 18, Math.PI), mat(PAL.white));
  add(g, arch, 0, 0.2, 0.15);
  box(g, 1.3, 0.05, 0.3, mat(PAL.white), 0, 0.82, 0.15);
  windowsOn(g, 0.6, 0.5, 0.46, 1, 2, 0.25, -0.95, 0.18);
  windowsOn(g, 0.6, 0.7, 0.46, 2, 2, 0.25, 0.95, 0.18);
  const word = (txt, x, y, bg) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.28), new THREE.MeshStandardMaterial({ map: textTexture(txt, { w: 256, h: 144, bg, font: '700 80px "Segoe UI", sans-serif' }), roughness: 0.8 }));
    add(g, m, x, y, 0.5);
    return m;
  };
  const a = word('Hello', -0.95, 1.65, PAL.white), b = word('Hola', 0.95, 1.65, PAL.white);
  g.userData.anim = (t) => { a.position.y = 1.65 + Math.sin(t * 1.6) * 0.06; b.position.y = 1.65 + Math.sin(t * 1.6 + 1.5) * 0.06; };
};

// language SIGs share an open pavilion; each roof and colour differs, and the sign shows the word
// for "speech" in the group's language(s)
function pavilion(g, { color, roof, word, font }) {
  cyl(g, 1.05, 1.1, 0.16, mat(PAL.cream), 0, 0, 0, 24);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cyl(g, 0.06, 0.07, 1.15, mat(PAL.white), Math.sin(a) * 0.8, 0.16, Math.cos(a) * 0.8, 8); }
  cyl(g, 0.95, 0.95, 0.14, mat(color), 0, 1.31, 0, 24);
  const top = 1.45;
  if (roof === 'dome') add(g, new THREE.Mesh(new THREE.SphereGeometry(0.85, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(color)), 0, top, 0);
  else if (roof === 'cone') add(g, new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.9, 18), mat(color)), 0, top + 0.45, 0);
  else if (roof === 'pyramid') add(g, new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.85, 4), mat(color)), 0, top + 0.42, 0).rotation.y = Math.PI / 4;
  else if (roof === 'steps') { for (let i = 0; i < 3; i++) cyl(g, 0.85 - i * 0.24, 0.85 - i * 0.24, 0.2, mat(color), 0, top + i * 0.2, 0, 18); }
  else if (roof === 'arch') { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 16, 1, false, 0, Math.PI), mat(color)); a.rotation.z = Math.PI / 2; add(g, a, 0, top, 0); }
  else add(g, new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.85, 0.3, 18), mat(color)), 0, top + 0.15, 0);
  cyl(g, 0.05, 0.05, 0.3, mat(PAL.gold, { metalness: 0.6 }), 0, top + (roof === 'cone' ? 0.85 : roof === 'pyramid' ? 0.8 : 0.75), 0, 6);
  sign(g, word, { z: 1.15, w: 1.4, h: 0.42, bg: PAL.white, fg: PAL.ink, font: font || '600 76px "Segoe UI", "Noto Sans", sans-serif' });
  tree(g, -0.95, -0.7, 0.9); tree(g, 0.9, -0.85, 0.8, PAL.grass);
}
B['SIG-CSLP'] = g => pavilion(g, { color: PAL.jade, roof: 'dome', word: '語音', font: '600 80px "Microsoft JhengHei", "PingFang TC", "Noto Sans CJK TC", "Noto Sans TC", sans-serif' });
B.AFCP = g => pavilion(g, { color: PAL.sky, roof: 'cone', word: 'Parole' });
B.AISV = g => pavilion(g, { color: PAL.terracotta, roof: 'arch', word: 'Voce' });
B['SIG-IL'] = g => pavilion(g, { color: PAL.mustard, roof: 'flat', word: 'Habla · Fala · Parla' });
B['SIG-ILSP'] = g => pavilion(g, { color: PAL.pink, roof: 'steps', word: 'वाणी', font: '600 80px "Nirmala UI", "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif' });
B.SIGRU = g => pavilion(g, { color: PAL.lilac, roof: 'pyramid', word: 'Речь' });

function generic(g) {
  box(g, 1.5, 1.2, 1.2, mat(PAL.cream));
  gable(g, 1.7, 0.6, 1.35, mat(PAL.terracotta), 0, 1.2, 0);
  windowsOn(g, 1.2, 0.6, 0.61, 1, 3, 0.35);
}

export const WORD_FOR_SPEECH = { 'SIG-CSLP': '語音', AFCP: 'Parole', AISV: 'Voce', 'SIG-IL': 'Habla · Fala · Parla', 'SIG-ILSP': 'वाणी', SIGRU: 'Речь' };
export const LANDMARK = {
  SynSIG: 'a tower topped with a gramophone horn', AVISA: 'a cinema showing a speaking mouth', SIGUL: 'a greenhouse where small languages grow',
  SpLC: 'a bureau with a magnifying glass', SProSIG: 'a bandstand whose roof is a pitch contour', SIGdial: 'a café with two speech bubbles taking turns',
  SLaTE: 'a schoolhouse with a bell tower', SIGML: 'a lab with a neural network on the roof', SLPAT: 'an access centre with a ramp and a wide door',
  'SIG-HIST': 'a museum with a phonograph on show', 'SIG-CHILD': 'a playground with a robot friend', 'SIG-RoSP': 'a lighthouse that works in any weather',
  'SIG-SPSC': 'a vault with a padlock', 'SIG-SLT': 'a bridge between two houses that say hello differently',
};

export function buildLandmark(acronym) {
  const g = new THREE.Group();
  (B[acronym] || generic)(g);
  return g;
}

// Xiaojin, the AI agent that keeps the directory, as a small walking robot carrying a record
export function buildCurator() {
  const g = new THREE.Group();
  const shell = mat(PAL.white, { flatShading: false, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.25, 4, 10), shell); body.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), shell); head.position.y = 1.02;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10, -Math.PI / 2.6, Math.PI / 1.3, Math.PI / 3, Math.PI / 3), mat(PAL.ink, { flatShading: false, roughness: 0.2 }));
  visor.position.set(0, 1.02, 0.05);
  const eyes = [-0.07, 0.07].map(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), GLOW); e.position.set(x, 1.05, 0.23); return e; });
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5), mat(PAL.slate)); antenna.position.y = 1.35;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), ONAIR); tip.position.y = 1.47;
  const legs = [-0.1, 0.1].map(x => { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), mat(PAL.slate)); l.position.set(x, 0.15, 0); return l; });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 24), mat('#141414', { roughness: 0.3 }));
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 16), mat(PAL.tomato));
  const rec = new THREE.Group(); rec.add(disc, label); rec.position.set(0, 0.7, 0.3); rec.rotation.x = Math.PI / 2.4;
  g.add(body, head, visor, ...eyes, antenna, tip, ...legs, rec);
  g.traverse(m => { m.castShadow = true; });
  g.userData.legs = legs;
  return g;
}
