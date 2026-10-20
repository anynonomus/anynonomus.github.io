import * as THREE from 'three';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import * as sfx from './audio.js';

// Court units are metres, FIBA-ish. Rim centre sits over the origin; the far baseline is at z = 26.4.
const RIM = new THREE.Vector3(0, 3.05, 0);
const RIM_R = 0.225, TUBE = 0.018, BALL_R = 0.12;
const BOARD_Z = -0.375, GRAV = 9.8;
const HOLD = new THREE.Vector3(0, 1.72, 4.9);
const SHOWCASE = new THREE.Vector3(1.6, 1.3, 9.2);
const CENTER = new THREE.Vector3(0, 0, 12.425);
const ORANGE = '#ff7a1a', VIOLET = '#7c5cff', GOLD = '#ffc94d';
const KIT = [0xff7a1a, 0x7c5cff, 0xffffff, 0xff7a1a, 0x7c5cff, 0x2b2350, 0xffc94d, 0x3fd0c9, 0xe8e8f0, 0xff4f6d];
const SKIN = [0xf1c7a5, 0xdcab86, 0xc08a63, 0x8d5a3b, 0xe8b996, 0x6b4430];

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function rrect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function fitText(g, text, maxW, size, font = 'Anton') {
  let s = size;
  do { g.font = `${s}px ${font}, Impact, sans-serif`; s -= 4; } while (g.measureText(text).width > maxW && s > 10);
}

// ---------- textures ----------
function ballTextures() {
  const W = 1024, H = 512;
  const [c, g] = canvas(W, H), [bc, bg] = canvas(W, H);
  const img = g.createImageData(W, H), bimg = bg.createImageData(W, H);
  const w = 0.015;
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - y / H) * Math.PI, cl = Math.cos(lat), py = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      const px = cl * Math.cos(lon), pz = cl * Math.sin(lon);
      const d = Math.min(Math.abs(py), Math.abs(px), Math.abs(Math.abs(pz) - 0.72) * 1.1);
      const seam = Math.max(0, Math.min(1, (w - d) / 0.005 + 0.5));
      const grain = Math.random() * 0.14 + (Math.random() < 0.1 ? 0.12 : 0);
      const i = (y * W + x) * 4;
      img.data[i] = (226 - grain * 70) * (1 - seam) + 22 * seam;
      img.data[i + 1] = (94 - grain * 34) * (1 - seam) + 14 * seam;
      img.data[i + 2] = (30 - grain * 14) * (1 - seam) + 10 * seam;
      img.data[i + 3] = 255;
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = Math.min(255, (1 - seam) * (190 + grain * 420));
      bimg.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0); bg.putImageData(bimg, 0, 0);
  const map = new THREE.CanvasTexture(c), bump = new THREE.CanvasTexture(bc);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = bump.anisotropy = 4;
  return { map, bump };
}

// Hardwood court, drawn once for the planks, redrawn on top for personal paint.
function makeCourt(aniso) {
  const S = 76.8, W = 20 * S, H = 34 * S;
  const [wood, wg] = canvas(W, H);
  const X = (m) => (m + 10) * S, Z = (m) => (m + 4) * S;
  wg.fillStyle = '#b8783f'; wg.fillRect(0, 0, W, H);
  const pw = 0.075 * S;
  for (let x = 0; x < W; x += pw) {
    let z = -Math.random() * 4 * S;
    while (z < H) {
      const len = rand(1.2, 3.6) * S;
      wg.fillStyle = `hsl(${rand(26, 33)}, ${rand(52, 62)}%, ${rand(50, 60)}%)`;
      wg.fillRect(x, z, pw - 1, len - 1.5);
      z += len;
    }
  }
  wg.globalAlpha = 0.08;
  for (let i = 0; i < 2600; i++) {
    wg.fillStyle = Math.random() < 0.5 ? '#5a3214' : '#ffe2b8';
    wg.fillRect(Math.random() * W, Math.random() * H, 1, rand(12, 80));
  }
  wg.globalAlpha = 1;
  const [c, g] = canvas(W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso;

  function draw(name, number) {
    g.drawImage(wood, 0, 0);
    // out of bounds apron
    g.fillStyle = '#21114a';
    g.fillRect(0, 0, W, Z(-1.575)); g.fillRect(0, Z(26.425), W, H - Z(26.425));
    g.fillRect(0, 0, X(-7.5), H); g.fillRect(X(7.5), 0, W - X(7.5), H);
    for (const [zb, dir] of [[-1.575, 1], [26.425, -1]]) {
      const zr = zb + dir * 1.575;
      g.fillStyle = 'rgba(40, 20, 90, 0.16)';
      g.beginPath(); g.moveTo(X(6.6), Z(zb)); g.lineTo(X(6.6), Z(zr + dir * 1.416));
      dir > 0 ? g.arc(X(0), Z(zr), 6.75 * S, 0.2112, Math.PI - 0.2112) : g.arc(X(0), Z(zr), 6.75 * S, -0.2112, -Math.PI + 0.2112, true);
      g.lineTo(X(-6.6), Z(zb)); g.closePath(); g.fill();
      g.fillStyle = 'rgba(92, 52, 220, 0.92)';
      g.fillRect(X(-2.45), dir > 0 ? Z(zb) : Z(zb - 5.8), 4.9 * S, 5.8 * S);
    }
    g.fillStyle = 'rgba(255, 122, 26, 0.92)';
    g.beginPath(); g.arc(X(0), Z(12.425), 1.8 * S, 0, Math.PI * 2); g.fill();
    // lines
    g.strokeStyle = '#ffffff'; g.lineWidth = 0.05 * S;
    g.strokeRect(X(-7.5), Z(-1.575), 15 * S, 28 * S);
    g.beginPath(); g.moveTo(X(-7.5), Z(12.425)); g.lineTo(X(7.5), Z(12.425)); g.stroke();
    g.beginPath(); g.arc(X(0), Z(12.425), 1.8 * S, 0, Math.PI * 2); g.stroke();
    for (const [zb, dir] of [[-1.575, 1], [26.425, -1]]) {
      const zr = zb + dir * 1.575, zf = zb + dir * 5.8;
      g.strokeRect(X(-2.45), Math.min(Z(zb), Z(zf)), 4.9 * S, 5.8 * S);
      g.beginPath(); g.arc(X(0), Z(zf), 1.8 * S, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(X(6.6), Z(zb)); g.lineTo(X(6.6), Z(zr + dir * 1.416));
      dir > 0 ? g.arc(X(0), Z(zr), 6.75 * S, 0.2112, Math.PI - 0.2112) : g.arc(X(0), Z(zr), 6.75 * S, -0.2112, -Math.PI + 0.2112, true);
      g.lineTo(X(-6.6), Z(zb)); g.stroke();
      g.beginPath(); dir > 0 ? g.arc(X(0), Z(zr), 1.25 * S, 0, Math.PI) : g.arc(X(0), Z(zr), 1.25 * S, Math.PI, Math.PI * 2); g.stroke();
    }
    // centre logo + painted words
    g.save(); g.translate(X(0), Z(12.425));
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(g, number ? `#${number}` : 'GAME DAY', 2.6 * S, 1.6 * S);
    g.fillText(number ? `#${number}` : 'GAME DAY', 0, 0.05 * S);
    g.restore();
    const word = (text, x, z, rot, size, color = 'rgba(255,255,255,0.92)') => {
      g.save(); g.translate(X(x), Z(z)); g.rotate(rot);
      g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, text, 12 * S, size * S);
      g.fillText(text, 0, 0); g.restore();
    };
    const big = name ? name.toUpperCase() : 'GAME DAY';
    word(big, 0, -2.85, 0, 1.6);
    word(big, 0, 27.7, Math.PI, 1.6);
    word(name ? `${big} #${number}` : 'GAME DAY', -8.75, 12.4, Math.PI / 2, 1.0, ORANGE);
    word(name ? 'MVP · STATES BOUND' : 'LET\'S GO', 8.75, 12.4, -Math.PI / 2, 1.0, '#c7b8ff');
    tex.needsUpdate = true;
  }
  draw();
  return { tex, draw };
}

function radialTexture(stops) {
  const [c, g] = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => r.addColorStop(o, col));
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function beamTexture() {
  const [c, g] = canvas(4, 256);
  const l = g.createLinearGradient(0, 0, 0, 256);
  l.addColorStop(0, '#fff'); l.addColorStop(0.35, '#777'); l.addColorStop(1, '#000');
  g.fillStyle = l; g.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}

// shader hook: crowd members hop, cheer and do the wave on the GPU
function crowdify(mat, u) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float aPhase;\nattribute float aAngle;\nuniform float uTime;\nuniform float uExcite;\nuniform float uWave;\nuniform float uWaveAmp;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float hop = 0.02 * sin(uTime * 2.3 + aPhase * 6.2831);
        hop += uExcite * max(0.0, sin(uTime * 11.0 + aPhase * 17.0)) * 0.26;
        float dw = mod(aAngle - uWave + 3.14159, 6.28318) - 3.14159;
        hop += exp(-dw * dw * 9.0) * uWaveAmp * 0.6;
        transformed.y += hop;`);
  };
}

export class Court {
  constructor(el) {
    this.on = {};
    this.clock = new THREE.Clock();
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: el, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color('#06051a');
    s.fog = new THREE.FogExp2('#08061c', 0.022);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 140);
    this.camPos = new THREE.Vector3(); this.camTarget = new THREE.Vector3();
    this.u = { uTime: { value: 0 }, uExcite: { value: 0 }, uWave: { value: 0 }, uWaveAmp: { value: 0 } };
    this.excite = 0; this.waveAmp = 0;

    this.buildLights();
    this.court = makeCourt(r.capabilities.getMaxAnisotropy());
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 34),
      new THREE.MeshStandardMaterial({ map: this.court.tex, roughness: 0.34, metalness: 0.0, envMapIntensity: 0.8 }));
    floor.rotation.x = -Math.PI / 2; floor.position.z = 13;
    floor.receiveShadow = true;
    s.add(floor);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: '#0a0716', roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, 13);
    s.add(ground);

    this.hoop = this.buildHoop();
    const far = this.hoop.clone(); far.rotation.y = Math.PI; far.position.z = 24.85;
    s.add(this.hoop, far);
    this.buildBall();
    this.buildNet();
    this.buildStands();
    this.buildBoards();
    this.buildRig();
    this.buildAtmosphere();
    this.buildConfetti();
    this.captureEnvironment();

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(s, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.state = 'idle';
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector2(0.4, 0.15);
    this.misses = 0;
    this.shooting = false;
    this.bindInput(el);
    this.resize();
    addEventListener('resize', () => this.resize());
    this.setLock();
    r.setAnimationLoop(() => this.frame());
    document.addEventListener('visibilitychange', () => r.setAnimationLoop(document.hidden ? null : () => this.frame()));
  }

  // ---------- building ----------
  buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#6c5cc4', '#2a1606', 0.55));
    const key = this.key = new THREE.SpotLight('#fff1e0', 2.5, 0, 0.62, 0.65, 0);
    key.position.set(0, 15, 6); key.target.position.set(0, 0, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004;
    key.shadow.camera.near = 5; key.shadow.camera.far = 30;
    s.add(key, key.target);
    [[-6, 14, 14, '#e6dcff'], [6, 14, 14, '#ffe6cf'], [0, 14, 22, '#ffffff']].forEach(([x, y, z, c]) => {
      const sp = new THREE.SpotLight(c, 1.6, 0, 0.7, 0.8, 0);
      sp.position.set(x, y, z); sp.target.position.set(x * 0.3, 0, z - 4);
      s.add(sp, sp.target);
    });
    const fill = new THREE.DirectionalLight('#b9a8ff', 0.6);
    fill.position.set(-6, 8, 16); s.add(fill);
    // showcase light for the riddle screen
    this.show = new THREE.SpotLight('#fff3e6', 6, 0, 0.32, 0.7, 0);
    this.show.position.set(SHOWCASE.x + 0.5, 6.5, SHOWCASE.z + 1.5);
    this.show.target.position.copy(SHOWCASE);
    s.add(this.show, this.show.target);
  }

  buildHoop() {
    const g = new THREE.Group();
    const white = new THREE.MeshPhysicalMaterial({ color: '#f4f2fb', roughness: 0.25, clearcoat: 0.8 });
    const pad = new THREE.MeshPhysicalMaterial({ color: '#3a1f99', roughness: 0.55, clearcoat: 0.3 });
    const steel = new THREE.MeshStandardMaterial({ color: '#2a2740', roughness: 0.35, metalness: 0.8 });
    const orange = new THREE.MeshPhysicalMaterial({ color: '#ff5a12', roughness: 0.3, metalness: 0.45, clearcoat: 0.6, emissive: '#ff3a00', emissiveIntensity: 0.12 });
    const add = (geo, mat, x, y, z, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; g.add(m); return m; };
    add(new THREE.BoxGeometry(1.4, 1.1, 2.2), pad, 0, 0.55, -2.9);
    add(new THREE.BoxGeometry(0.34, 2.6, 0.34), pad, 0, 2.2, -2.9);
    add(new THREE.BoxGeometry(0.18, 0.22, 2.4), steel, 0, 3.55, -1.65);
    add(new THREE.BoxGeometry(0.12, 1.2, 0.12), steel, 0, 3.0, -1.75);
    const glass = add(new THREE.BoxGeometry(1.8, 1.05, 0.03),
      new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, roughness: 0.02, clearcoat: 1, envMapIntensity: 2 }), 0, 3.425, BOARD_Z - 0.015, false);
    glass.renderOrder = 3;
    const bar = (w, h, x, y, mat, z = BOARD_Z - 0.015, d = 0.05) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    bar(1.86, 0.05, 0, 3.95, white); bar(1.86, 0.05, 0, 2.9, white);
    bar(0.05, 1.1, -0.93, 3.425, white); bar(0.05, 1.1, 0.93, 3.425, white);
    bar(1.86, 0.12, 0, 2.86, pad, BOARD_Z - 0.015, 0.1);
    const z = BOARD_Z + 0.002, t = 0.034, lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    bar(0.59, t, 0, 3.55, lineMat, z, 0.01); bar(0.59, t, 0, 3.1, lineMat, z, 0.01);
    bar(t, 0.45, -0.295, 3.325, lineMat, z, 0.01); bar(t, 0.45, 0.295, 3.325, lineMat, z, 0.01);
    const rim = add(new THREE.TorusGeometry(RIM_R, TUBE, 16, 64), orange, RIM.x, RIM.y, RIM.z);
    rim.rotation.x = Math.PI / 2;
    bar(0.14, 0.04, 0, 3.035, orange, -0.3, 0.16);
    return g;
  }

  buildNet() {
    const N = 14, K = 5, pts = [];
    for (let k = 0; k < K; k++) {
      const f = k / (K - 1), r = RIM_R - (RIM_R - 0.13) * Math.pow(f, 0.8);
      for (let i = 0; i < N; i++) {
        const a = ((i + (k % 2) * 0.5) / N) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, RIM.y - 0.012 - f * 0.42, Math.sin(a) * r));
      }
    }
    const segs = [];
    for (let k = 0; k < K - 1; k++) for (let i = 0; i < N; i++) {
      const j = k % 2 ? (i + 1) % N : (i - 1 + N) % N;
      segs.push([k * N + i, (k + 1) * N + i], [k * N + i, (k + 1) * N + j]);
    }
    this.net = {
      base: pts, cur: pts.map((p) => p.clone()), segs, K, N, t: 9, amp: 0, sway: new THREE.Vector2(),
      mesh: new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0055, 0.0055, 1, 5, 1, true),
        new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.15 }), segs.length),
    };
    this.scene.add(this.net.mesh);
    this.updateNet(0, true);
  }

  updateNet(dt, force) {
    const n = this.net, b = this.ball.position;
    n.t += dt;
    const ballIn = b.y < RIM.y + 0.1 && b.y > RIM.y - 0.6 && Math.hypot(b.x, b.z) < RIM_R + 0.05;
    if (!force && n.t > 3 && !ballIn) return;
    const decay = Math.exp(-3.2 * n.t), wob = Math.sin(n.t * 15) * decay;
    n.base.forEach((p, idx) => {
      const k = Math.floor(idx / n.N), f = k / (n.K - 1), c = n.cur[idx];
      c.copy(p);
      c.y -= n.amp * f * (0.5 * decay + 0.5 * Math.max(0, wob));
      c.x += n.sway.x * f * wob; c.z += n.sway.y * f * wob;
      const squeeze = 1 - n.amp * 0.6 * f * decay;
      c.x *= squeeze; c.z *= squeeze;
      if (ballIn && k > 0) {
        const dx = c.x - b.x, dz = c.z - b.z, dy = c.y - b.y, d = Math.hypot(dx, dz);
        const reach = BALL_R * Math.sqrt(Math.max(0, 1 - (dy / (BALL_R * 1.4)) ** 2)) + 0.012;
        if (d < reach && d > 1e-4) { c.x = b.x + (dx / d) * reach; c.z = b.z + (dz / d) * reach; }
      }
    });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(), mid = new THREE.Vector3(), sc = new THREE.Vector3();
    n.segs.forEach(([a, bb], i) => {
      dir.subVectors(n.cur[bb], n.cur[a]);
      const len = dir.length();
      q.setFromUnitVectors(up, dir.normalize());
      mid.addVectors(n.cur[a], n.cur[bb]).multiplyScalar(0.5);
      m.compose(mid, q, sc.set(1, len, 1));
      n.mesh.setMatrixAt(i, m);
    });
    n.mesh.instanceMatrix.needsUpdate = true;
  }

  buildBall() {
    const { map, bump } = ballTextures();
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 64, 48),
      new THREE.MeshPhysicalMaterial({ map, bumpMap: bump, bumpScale: 1.4, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);
  }

  buildStands() {
    const ROWS = 9, rowD = 0.85, rise = 0.46, gap = 0.62;
    // [axis origin, along-axis start/end, outward direction]
    const sides = [
      { ox: -10, dir: [-1, 0], from: -5.2, to: 31.6, alongZ: true },
      { ox: 10, dir: [1, 0], from: -5.2, to: 31.6, alongZ: true },
      { oz: -5.2, dir: [0, -1], from: -10, to: 10, alongZ: false },
      { oz: 31.6, dir: [0, 1], from: -10, to: 10, alongZ: false },
    ];
    const stepMat = new THREE.MeshStandardMaterial({ color: '#16122e', roughness: 0.85 });
    const people = [];
    sides.forEach((sd) => {
      const len = sd.to - sd.from, mid = (sd.to + sd.from) / 2;
      for (let r = 0; r < ROWS; r++) {
        const h = 0.62 + r * rise, out = r * rowD + rowD / 2;
        const step = new THREE.Mesh(new THREE.BoxGeometry(sd.alongZ ? rowD : len, h, sd.alongZ ? len : rowD), stepMat);
        if (sd.alongZ) step.position.set(sd.ox + sd.dir[0] * out, h / 2, mid);
        else step.position.set(mid, h / 2, sd.oz + sd.dir[1] * out);
        this.scene.add(step);
        for (let a = sd.from + gap / 2 + (r % 2) * 0.2; a < sd.to; a += gap) {
          if (Math.random() < 0.07) continue;
          const x = sd.alongZ ? sd.ox + sd.dir[0] * out : a, z = sd.alongZ ? a : sd.oz + sd.dir[1] * out;
          people.push({ x, z, y: h, face: Math.atan2(-sd.dir[0], -sd.dir[1]) });
        }
      }
    });
    const n = people.length;
    const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.19, 0.34, 3, 7),
      new THREE.MeshStandardMaterial({ roughness: 0.75 }), n);
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.125, 10, 8),
      new THREE.MeshStandardMaterial({ roughness: 0.6 }), n);
    const phase = new Float32Array(n), angle = new Float32Array(n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), e = new THREE.Euler();
    const signers = [];
    people.forEach((p, i) => {
      phase[i] = Math.random();
      angle[i] = Math.atan2(p.x, p.z - CENTER.z);
      const sc = rand(0.92, 1.08);
      q.setFromEuler(e.set(0, p.face, 0));
      m.compose(new THREE.Vector3(p.x, p.y + 0.36 * sc, p.z), q, new THREE.Vector3(sc, sc, sc));
      body.setMatrixAt(i, m); body.setColorAt(i, c.set(pick(KIT)));
      m.compose(new THREE.Vector3(p.x, p.y + 0.78 * sc, p.z), q, new THREE.Vector3(sc, sc, sc));
      head.setMatrixAt(i, m); head.setColorAt(i, c.set(pick(SKIN)));
      if (Math.random() < 0.13) signers.push({ ...p, phase: phase[i], angle: angle[i] });
    });
    for (const mesh of [body, head]) {
      mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      mesh.geometry.setAttribute('aAngle', new THREE.InstancedBufferAttribute(angle, 1));
      crowdify(mesh.material, this.u);
      this.scene.add(mesh);
    }
    this.crowdCount = n;

    // fan signs: one instanced mesh per design so each can carry its own texture
    this.signs = [];
    const designs = 6;
    for (let d = 0; d < designs; d++) {
      const mine = signers.filter((_, i) => i % designs === d);
      const [cv] = canvas(512, 300);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.6, side: THREE.DoubleSide });
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.95, 0.56), mat, Math.max(1, mine.length));
      const ph = new Float32Array(mine.length || 1), an = new Float32Array(mine.length || 1);
      mine.forEach((p, i) => {
        ph[i] = p.phase; an[i] = p.angle;
        q.setFromEuler(e.set(-0.18, p.face, rand(-0.12, 0.12), 'YXZ'));
        m.compose(new THREE.Vector3(p.x, p.y + 1.32, p.z), q, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, m);
      });
      mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
      mesh.geometry.setAttribute('aAngle', new THREE.InstancedBufferAttribute(an, 1));
      crowdify(mat, this.u);
      this.scene.add(mesh);
      this.signs.push({ canvas: cv, tex });
    }
    this.drawSigns();
    this.flashPositions = people.filter(() => Math.random() < 0.18).map((p) => new THREE.Vector3(p.x, p.y + 1.0, p.z));
  }

  drawSigns(name, number) {
    const list = name
      ? [[`GO ${name}!`, '#ffffff', ORANGE], [`${name} #${number}`, ORANGE, '#ffffff'], ['MVP', VIOLET, '#ffffff'],
        ['STATES BOUND', GOLD, '#1a1240'], [`#${number}`, '#111022', ORANGE], [`${name} 🏀`, '#ffffff', VIOLET]]
      : [['LET\'S GO!', '#ffffff', ORANGE], ['DEFENSE', ORANGE, '#ffffff'], ['🏀🏀🏀', VIOLET, '#ffffff'],
        ['MAKE NOISE', GOLD, '#1a1240'], ['GAME DAY', '#111022', ORANGE], ['WOOO', '#ffffff', VIOLET]];
    this.signs.forEach(({ canvas: cv, tex }, i) => {
      const g = cv.getContext('2d'), [text, bg, fg] = list[i];
      g.clearRect(0, 0, 512, 300);
      rrect(g, 6, 6, 500, 288, 26); g.fillStyle = bg; g.fill();
      g.lineWidth = 10; g.strokeStyle = fg; g.stroke();
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, text, 450, 170);
      g.fillText(text, 256, 160);
      tex.needsUpdate = true;
    });
  }

  buildBoards() {
    // scrolling LED ribbon along the front of every stand
    const [lc, lg] = canvas(2048, 96);
    this.led = { canvas: lc, g: lg, tex: new THREE.CanvasTexture(lc) };
    this.led.tex.colorSpace = THREE.SRGBColorSpace;
    this.led.tex.wrapS = THREE.RepeatWrapping;
    const ledMat = new THREE.MeshBasicMaterial({ map: this.led.tex, toneMapped: false });
    ledMat.color.setScalar(1.8);
    const band = (w, x, z, ry) => {
      const t = this.led.tex.clone(); t.repeat.set(w / 12, 1);
      const mm = ledMat.clone(); mm.map = t;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.42), mm);
      mesh.position.set(x, 0.33, z); mesh.rotation.y = ry;
      this.scene.add(mesh);
      return t;
    };
    this.ledTex = [band(36.8, -9.99, 13.2, Math.PI / 2), band(36.8, 9.99, 13.2, -Math.PI / 2), band(20, 0, -5.19, 0), band(20, 0, 31.59, Math.PI)];

    // centre-hung scoreboard
    const j = this.jumbo = new THREE.Group();
    j.position.set(0, 12.2, CENTER.z);
    const frame = new THREE.MeshStandardMaterial({ color: '#141226', roughness: 0.4, metalness: 0.7 });
    j.add(new THREE.Mesh(new THREE.BoxGeometry(5.4, 3.0, 5.4), frame));
    const [jc, jg] = canvas(1024, 560);
    this.jumboCanvas = { c: jc, g: jg, tex: new THREE.CanvasTexture(jc) };
    this.jumboCanvas.tex.colorSpace = THREE.SRGBColorSpace;
    const screenMat = new THREE.MeshBasicMaterial({ map: this.jumboCanvas.tex, toneMapped: false });
    screenMat.color.setScalar(1.25);
    for (let k = 0; k < 4; k++) {
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 2.72), screenMat);
      const a = (k * Math.PI) / 2;
      sc.position.set(Math.sin(a) * 2.71, 0, Math.cos(a) * 2.71); sc.rotation.y = a;
      j.add(sc);
    }
    [[1.62, ORANGE]].forEach(([y, col]) => {
      const ringMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
      ringMat.color.multiplyScalar(1.3);
      const ring = new THREE.Mesh(new THREE.BoxGeometry(5.46, 0.1, 5.46), ringMat);
      ring.position.y = y; j.add(ring);
    });
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 8), frame);
    cable.position.y = 5.4; j.add(cable);
    this.scene.add(j);

    // end-wall screen, visible behind the hoop while shooting
    const [ec, eg] = canvas(1024, 400);
    this.endCanvas = { c: ec, g: eg, tex: new THREE.CanvasTexture(ec) };
    this.endCanvas.tex.colorSpace = THREE.SRGBColorSpace;
    const endMat = new THREE.MeshBasicMaterial({ map: this.endCanvas.tex, toneMapped: false });
    endMat.color.setScalar(1.15);
    const end = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.5), endMat);
    end.position.set(0, 8.4, -13.6);
    this.scene.add(end);
    const endFrame = new THREE.Mesh(new THREE.BoxGeometry(9.4, 3.9, 0.3), frame);
    endFrame.position.set(0, 8.4, -13.8); this.scene.add(endFrame);

    this.board = { name: '', number: '', n: 0, total: 0, line: 'WELCOME TO THE ARENA' };
    this.drawBoards();
  }

  drawBoards() {
    const b = this.board;
    const big = b.name ? b.name.toUpperCase() : 'GAME DAY';
    const draw = ({ g, tex }, W, H) => {
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#120c33'); bg.addColorStop(1, '#05040f');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.035)';
      for (let x = 0; x < W; x += 6) g.fillRect(x, 0, 1, H);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ffb36b'; fitText(g, b.line, W * 0.86, H * 0.11);
      g.fillText(b.line, W / 2, H * 0.17);
      const grad = g.createLinearGradient(0, H * 0.3, 0, H * 0.7);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#c9b8ff');
      g.fillStyle = grad; fitText(g, (b.number ? `#${b.number}  ` : '') + big, W * 0.9, H * 0.36);
      g.fillText((b.number ? `#${b.number}  ` : '') + big, W / 2, H * 0.5);
      if (b.total) {
        g.fillStyle = '#ff7a1a'; fitText(g, `BUCKETS  ${b.n} / ${b.total}`, W * 0.8, H * 0.13);
        g.fillText(`BUCKETS  ${b.n} / ${b.total}`, W / 2, H * 0.84);
      }
      tex.needsUpdate = true;
    };
    draw(this.jumboCanvas, 1024, 560);
    draw(this.endCanvas, 1024, 400);
    const { g, tex } = this.led;
    g.fillStyle = '#050410'; g.fillRect(0, 0, 2048, 96);
    const items = b.name ? [`${big} #${b.number}`, 'MVP', 'GAME DAY', 'STATES BOUND', `GO ${big}`] : ['GAME DAY', 'WELCOME', 'LET\'S GO', 'GAME DAY', 'MAKE SOME NOISE'];
    g.textBaseline = 'middle'; g.font = '64px Anton, Impact, sans-serif';
    let x = 20;
    items.forEach((t, i) => {
      g.fillStyle = i % 2 ? '#c9b8ff' : '#ff8a2a';
      g.fillText(t, x, 50); x += g.measureText(t).width + 40;
      g.fillStyle = '#ffffff'; g.fillText('●', x, 50); x += 70;
    });
    tex.needsUpdate = true;
    this.ledTex?.forEach((t) => { t.needsUpdate = true; });
  }

  buildRig() {
    // truss of light panels over the court; bloom makes them glow
    const panel = new THREE.MeshBasicMaterial({ color: '#fff4e6', toneMapped: false });
    panel.color.multiplyScalar(4);
    const truss = new THREE.MeshStandardMaterial({ color: '#1b1830', metalness: 0.7, roughness: 0.4 });
    const geo = new THREE.BoxGeometry(0.7, 0.12, 0.45);
    const spots = [];
    for (let i = 0; i < 9; i++) for (const x of [-7, 7]) spots.push([x, 15.5, -3 + i * 3.6]);
    for (const z of [-4, 30]) for (let i = 0; i < 5; i++) spots.push([-6 + i * 3, 15.5, z]);
    const inst = new THREE.InstancedMesh(geo, panel, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, y, z], i) => inst.setMatrixAt(i, m.makeTranslation(x, y, z)));
    this.scene.add(inst);
    for (const x of [-7, 7]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 34), truss);
      beam.position.set(x, 15.75, 13); this.scene.add(beam);
    }

    const tex = beamTexture();
    this.beams = [ORANGE, '#ffffff', VIOLET, '#ffffff', ORANGE, VIOLET].map((c, i) => {
      const mat = new THREE.MeshBasicMaterial({ color: c, alphaMap: tex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 15, 40, 1, true), mat);
      cone.geometry.translate(0, -7.5, 0);
      cone.position.set(i % 2 ? 7 : -7, 15.4, -1 + i * 4.6);
      cone.userData = { phase: i * 1.3 };
      this.scene.add(cone);
      return cone;
    });
    this.beamLevel = 0; this.beamTarget = 0;
  }

  buildAtmosphere() {
    // dust drifting through the light
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([rand(-9, 9), rand(0.5, 14), rand(-4, 30)], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.06, map: radialTexture([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]),
      transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffe9d6',
    }));
    this.scene.add(this.dust);

    // phone camera flashes popping in the stands
    const fp = this.flashPositions, fpos = new Float32Array(fp.length * 3), fph = new Float32Array(fp.length);
    fp.forEach((p, i) => { fpos.set([p.x, p.y, p.z], i * 3); fph[i] = Math.random(); });
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    fg.setAttribute('aPhase', new THREE.BufferAttribute(fph, 1));
    this.flashes = new THREE.Points(fg, new THREE.ShaderMaterial({
      uniforms: { uTime: this.u.uTime, uExcite: this.u.uExcite, uPx: { value: 1 } },
      vertexShader: `attribute float aPhase; uniform float uTime; uniform float uExcite; uniform float uPx; varying float vF;
        void main() {
          float rate = 0.35 + aPhase * 0.5 + uExcite * 1.5;
          vF = pow(max(0.0, sin(uTime * rate + aPhase * 97.0)), 180.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = vF * 26.0 * uPx * (10.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vF; void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(3.0) * vF, smoothstep(0.5, 0.0, d) * vF); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.flashes);
  }

  buildConfetti() {
    const n = 420;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.05, 0.085),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.35, metalness: 0.4 }), n);
    const c = new THREE.Color(), cols = [ORANGE, VIOLET, GOLD, '#ffffff', '#ff4f6d', '#3fd0c9'];
    for (let i = 0; i < n; i++) mesh.setColorAt(i, c.set(cols[i % cols.length]));
    mesh.frustumCulled = false;
    this.confetti = { mesh, n, p: [], v: [], r: [], w: [], life: new Float32Array(n), next: 0 };
    for (let i = 0; i < n; i++) {
      this.confetti.p.push(new THREE.Vector3()); this.confetti.v.push(new THREE.Vector3());
      this.confetti.r.push(new THREE.Euler()); this.confetti.w.push(new THREE.Vector3());
    }
    this.scene.add(mesh);
    this.updateConfetti(0, true);
  }

  captureEnvironment() {
    // reflections come from the arena itself, so the floor and rim mirror the lights
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.1, 120, rt);
    cam.position.set(0, 2, 8);
    this.ball.visible = false; this.confetti.mesh.visible = false;
    cam.update(this.renderer, this.scene);
    this.ball.visible = true; this.confetti.mesh.visible = true;
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromCubemap(rt.texture).texture;
    this.scene.environmentIntensity = 0.9;
    rt.dispose(); pm.dispose();
  }

  // ---------- personal touches, applied after the riddle ----------
  personalize(name, number, total) {
    this.court.draw(name, number);
    this.drawSigns(name.toUpperCase(), number);
    Object.assign(this.board, { name, number, total, line: 'TONIGHT\'S STARTING LINEUP' });
    this.drawBoards();
  }

  setScore(n, line) {
    this.board.n = n;
    if (line) this.board.line = line;
    this.drawBoards();
  }

  burst(origin, count = 140, spread = 1) {
    const C = this.confetti;
    for (let k = 0; k < count; k++) {
      const i = C.next; C.next = (C.next + 1) % C.n;
      C.p[i].copy(origin).add(new THREE.Vector3(rand(-0.4, 0.4), rand(0, 0.4), rand(-0.4, 0.4)));
      C.v[i].set(rand(-2.4, 2.4) * spread, rand(2.5, 6), rand(-1.4, 2.6) * spread);
      C.r[i].set(rand(0, 6), rand(0, 6), rand(0, 6));
      C.w[i].set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      C.life[i] = rand(2.8, 4.4);
    }
  }

  updateConfetti(dt, force) {
    const C = this.confetti, m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let any = force;
    for (let i = 0; i < C.n; i++) {
      if (C.life[i] <= 0 && !force) continue;
      any = true;
      C.life[i] -= dt;
      const v = C.v[i];
      v.y -= 3.2 * dt; v.multiplyScalar(1 - 1.6 * dt);
      v.x += Math.sin((C.life[i] + i) * 5) * 0.6 * dt;
      C.p[i].addScaledVector(v, dt);
      if (C.p[i].y < 0.01) { C.p[i].y = 0.01; v.set(0, 0, 0); }
      else C.r[i].set(C.r[i].x + C.w[i].x * dt, C.r[i].y + C.w[i].y * dt, C.r[i].z + C.w[i].z * dt);
      const alive = C.life[i] > 0 ? Math.min(1, C.life[i] * 2) : 0;
      m.compose(C.p[i], q.setFromEuler(C.r[i]), s.setScalar(alive));
      C.mesh.setMatrixAt(i, m);
    }
    if (any) C.mesh.instanceMatrix.needsUpdate = true;
  }

  resize() {
    const w = innerWidth, h = innerHeight, px = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(px);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * px * 0.5, h * px * 0.5);
    this.flashes.material.uniforms.uPx.value = px * h / 800;
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.6 ? 54 : 46;
    this.camera.updateProjectionMatrix();
  }

  // ---------- camera ----------
  tween(pos, target, dur = 1.6) {
    this.orbit = null;
    const p0 = this.camPos.clone(), t0 = this.camTarget.clone();
    return new Promise((done) => { this.camAnim = { p0, t0, p1: pos.clone(), t1: target.clone(), t: 0, dur, done }; });
  }

  // free look: she can drag the arena around; it drifts on its own when left alone
  look(target, radius, height, a) {
    this.camAnim = null;
    this.orbit = { target: target.clone(), radius, height, a, va: 0, vh: 0, idle: 0 };
  }

  setCam(pos, target) {
    this.camAnim = null; this.orbit = null;
    this.camPos.copy(pos); this.camTarget.copy(target);
  }

  // ---------- modes ----------
  setLock() {
    this.state = 'lock';
    this.ball.position.copy(SHOWCASE);
    this.setCam(new THREE.Vector3(1.6, 1.1, 10.1), new THREE.Vector3(1.6, 1.16, 8.6));
    this.beamTarget = 0.35;
  }

  async reveal() {
    this.state = 'drop';
    this.vel.set(0, 0.6, -0.35);
    this.beamTarget = 1;
    this.waveAmp = 1;
    const a = 0.55, target = new THREE.Vector3(0, 2.4, 10), radius = 17, height = 6.8;
    await this.tween(new THREE.Vector3(Math.sin(a) * radius, height, target.z + Math.cos(a) * radius), target, 2.8);
    this.look(target, radius, height, a);
  }

  async toGame() {
    this.state = 'carry';
    this.waveAmp = 0;
    this.carry = { from: this.ball.position.clone(), t: 0 };
    this.beamTarget = 0.4;
    await this.tween(new THREE.Vector3(0, 2.28, 7.0), new THREE.Vector3(0, 2.86, 0), 1.9);
    this.state = 'hold';
  }

  async toLocker() {
    this.state = 'drop';
    this.vel.set(0.4, 1.5, -0.6);
    this.beamTarget = 0.8;
    const target = new THREE.Vector3(0, 2.6, 10), a = 0.9;
    await this.tween(new THREE.Vector3(Math.sin(a) * 15, 6, target.z + Math.cos(a) * 15), target, 1.9);
    this.look(target, 15, 6, a);
  }

  // ball back in her hands, ready for the next shot
  resetBall() {
    this.state = 'hold';
    this.ball.position.copy(HOLD);
    this.popIn = 0; this.ball.scale.setScalar(0.001);
  }

  celebrate(big = false) {
    this.burst(RIM.clone().add(new THREE.Vector3(0, 0.3, 0.6)), big ? 320 : 140, big ? 1.7 : 1);
    this.flash = 1;
    this.excite = big ? 1.4 : 1;
  }

  introBurst() {
    this.burst(new THREE.Vector3(0, 3, 9), 300, 2.4);
    this.burst(new THREE.Vector3(0, 9, CENTER.z), 120, 2.4);
    this.flash = 1;
    this.excite = 1.2;
  }

  // ---------- input ----------
  bindInput(el) {
    let start = null, last = null;
    el.addEventListener('pointerdown', (e) => {
      start = last = { x: e.clientX, y: e.clientY, t: performance.now() };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.state === 'lock') this.spin.set(dy * 0.012, dx * 0.012);
      else if (this.orbit) {
        const o = this.orbit;
        o.va = -dx * 0.006; o.vh = dy * 0.03; o.idle = 0;
        this.on.look?.();
      }
      if (this.state === 'hold' && this.shooting) this.drag = { x: e.clientX - start.x, y: e.clientY - start.y };
    });
    const end = (e) => {
      if (!start) return;
      if (this.state === 'hold' && this.shooting) this.shoot(e.clientX - start.x, e.clientY - start.y);
      start = null; this.drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { start = null; this.drag = null; });
  }

  shoot(dx, dy) {
    const up = -dy;
    if (up < 36) return;
    const power = up / innerHeight;
    const pe = power - 0.3;
    let ex = (dx / up) * 1.1;
    let ez = pe * (Math.abs(pe) < 0.12 ? 0.55 : 1.25);
    const assist = [0.5, 0.34, 0.16, 0][Math.min(this.misses, 3)];
    ex = ex * assist + rand(-0.012, 0.012);
    ez = ez * assist + rand(-0.012, 0.012);
    const target = RIM.clone().add(new THREE.Vector3(ex, 0, ez));
    const T = 1.15, p = this.ball.position;
    this.vel.set((target.x - p.x) / T, (target.y - p.y + 0.5 * GRAV * T * T) / T, (target.z - p.z) / T);
    this.shot = { t: 0, rim: 0, board: 0, floor: 0, scored: false, prevY: p.y, lastHit: 0 };
    this.state = 'flight';
    sfx.whoosh();
    this.on.shot?.();
  }

  stepBall(h) {
    const p = this.ball.position, v = this.vel, s = this.shot;
    v.y -= GRAV * h;
    p.addScaledVector(v, h);
    s.t += h;

    const rx = p.x - RIM.x, rz = p.z - RIM.z, rr = Math.hypot(rx, rz) || 1e-6;
    const cp = new THREE.Vector3(RIM.x + (rx / rr) * RIM_R, RIM.y, RIM.z + (rz / rr) * RIM_R);
    const d = p.clone().sub(cp), dist = d.length();
    if (dist < BALL_R + TUBE) {
      const n = d.divideScalar(dist), vn = v.dot(n);
      p.copy(cp).addScaledVector(n, BALL_R + TUBE);
      if (vn < 0) {
        v.addScaledVector(n, -1.55 * vn).multiplyScalar(0.86);
        if (s.t - s.lastHit > 0.06) { sfx.rim(Math.min(1, -vn / 3)); s.lastHit = s.t; s.rim++; }
      }
    }
    if (p.z - BALL_R < BOARD_Z && p.z > BOARD_Z - 0.2 && Math.abs(p.x) < 0.92 && p.y > 2.88 && p.y < 3.97 && v.z < 0) {
      p.z = BOARD_Z + BALL_R;
      sfx.board(Math.min(1, -v.z / 4));
      v.z *= -0.52; v.x *= 0.85; v.y *= 0.9;
      s.board++;
    }
    if (p.y < BALL_R) {
      p.y = BALL_R;
      if (v.y < -0.5) sfx.bounce(Math.min(1, -v.y / 6));
      v.y = -v.y * 0.66; v.x *= 0.88; v.z *= 0.88;
      s.floor++;
    }
    if (!s.scored && s.prevY >= RIM.y && p.y < RIM.y && Math.hypot(p.x - RIM.x, p.z - RIM.z) < RIM_R) {
      s.scored = true;
      const kind = s.board ? 'bank' : s.rim ? 'rim' : 'swish';
      if (kind === 'swish') sfx.swish(); else setTimeout(sfx.swish, 40);
      this.net.t = 0; this.net.amp = kind === 'swish' ? 0.09 : 0.06;
      this.net.sway.set(v.x * 0.02, v.z * 0.02);
      this.misses = 0;
      this.on.score?.(kind);
    }
    s.prevY = p.y;
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20), t = this.clock.elapsedTime;
    const b = this.ball;

    if (this.state === 'lock') {
      b.position.set(SHOWCASE.x, SHOWCASE.y + Math.sin(t * 1.6) * 0.025, SHOWCASE.z);
      b.rotation.x += this.spin.x * dt * 2; b.rotation.y += this.spin.y * dt * 2 + dt * 0.25;
      this.spin.multiplyScalar(1 - 1.2 * dt);
    } else if (this.state === 'drop') {
      this.vel.y -= GRAV * dt;
      b.position.addScaledVector(this.vel, dt);
      if (b.position.y < BALL_R) {
        b.position.y = BALL_R;
        if (this.vel.y < -0.8) sfx.bounce(Math.min(1, -this.vel.y / 5));
        this.vel.y = Math.max(-this.vel.y * 0.8, 3.6);
        this.vel.x *= 0.5; this.vel.z *= 0.5;
      }
      b.rotation.x -= dt * 3;
    } else if (this.state === 'carry') {
      const c = this.carry; c.t = Math.min(1, c.t + dt / 1.7);
      const e = ease(c.t);
      b.position.lerpVectors(c.from, HOLD, e);
      b.position.y += Math.sin(e * Math.PI) * 0.9;
      b.rotation.x -= dt * 6;
    } else if (this.state === 'hold') {
      const tx = HOLD.x + (this.drag ? THREE.MathUtils.clamp(this.drag.x * 0.0012, -0.25, 0.25) : 0);
      const ty = HOLD.y + (this.drag ? THREE.MathUtils.clamp(-this.drag.y * 0.0009, -0.1, 0.35) : Math.sin(t * 2.2) * 0.02);
      b.position.x += (tx - b.position.x) * Math.min(1, dt * 18);
      b.position.y += (ty - b.position.y) * Math.min(1, dt * 18);
      b.position.z = HOLD.z;
      if (this.popIn !== undefined) { this.popIn = Math.min(1, this.popIn + dt * 3); b.scale.setScalar(Math.max(0.001, ease(this.popIn))); }
      b.rotation.y += dt * 0.4;
    } else if (this.state === 'flight') {
      const steps = 8;
      for (let i = 0; i < steps; i++) this.stepBall(dt / steps);
      b.rotation.x -= dt * 9;
      const s = this.shot;
      if (s.t > 3.4 || s.floor >= 3 || Math.abs(b.position.x) > 9 || b.position.z > 10) {
        if (!s.scored) { this.misses++; this.on.miss?.(s.rim || s.board ? 'rim' : 'air'); }
        this.state = 'hold';
        b.position.copy(HOLD);
        this.popIn = 0; b.scale.setScalar(0.001);
      }
    }

    // camera
    if (this.camAnim) {
      const a = this.camAnim; a.t = Math.min(1, a.t + dt / a.dur);
      const e = ease(a.t);
      this.camPos.lerpVectors(a.p0, a.p1, e);
      this.camPos.y += Math.sin(e * Math.PI) * 0.8;
      this.camTarget.lerpVectors(a.t0, a.t1, e);
      if (a.t >= 1) { this.camAnim = null; a.done(); }
    } else if (this.orbit) {
      const o = this.orbit;
      o.idle += dt;
      const auto = o.idle > 2.5 ? 0.05 * Math.min(1, (o.idle - 2.5) / 2) : 0;
      o.a += o.va + auto * dt;
      o.height = THREE.MathUtils.clamp(o.height + o.vh, 1.6, 14);
      o.va *= 0.92; o.vh *= 0.88;
      this.camPos.set(o.target.x + Math.sin(o.a) * o.radius, o.height, o.target.z + Math.cos(o.a) * o.radius);
      this.camTarget.copy(o.target);
    }
    const sway = this.state === 'hold' || this.state === 'flight' ? 1 : 0.3;
    this.camera.position.copy(this.camPos).add(new THREE.Vector3(Math.sin(t * 0.35) * 0.04 * sway, Math.sin(t * 0.5) * 0.025 * sway, 0));
    this.camera.lookAt(this.camTarget);

    // arena life
    this.u.uTime.value = t;
    this.excite = Math.max(0, this.excite - dt * 0.45);
    this.u.uExcite.value += (Math.min(1, this.excite) - this.u.uExcite.value) * Math.min(1, dt * 6);
    this.u.uWaveAmp.value += (this.waveAmp - this.u.uWaveAmp.value) * Math.min(1, dt * 1.5);
    this.u.uWave.value = (t * 1.6) % (Math.PI * 2);
    this.ledTex.forEach((tx) => { tx.offset.x = (t * 0.06) % 1; });
    this.jumbo.rotation.y = Math.sin(t * 0.1) * 0.05;
    this.dust.rotation.y = t * 0.01;
    this.show.intensity += ((this.state === 'lock' ? 6 : 0) - this.show.intensity) * Math.min(1, dt * 2);
    this.beamLevel += (this.beamTarget - this.beamLevel) * Math.min(1, dt * 1.5);
    this.flash = Math.max(0, (this.flash || 0) - dt * 1.2);
    this.beams.forEach((m) => {
      const u = m.userData;
      m.rotation.z = Math.sin(t * 0.4 + u.phase) * 0.45;
      m.rotation.x = Math.cos(t * 0.3 + u.phase) * 0.3;
      m.material.opacity = 0.07 * this.beamLevel + this.flash * 0.08;
      m.visible = m.material.opacity > 0.002;
    });

    this.updateNet(dt);
    this.updateConfetti(dt);
    this.composer.render(dt);
    this.adapt(dt);
  }

  // step resolution down on phones that can't keep up, never back up (no flicker)
  adapt(dt) {
    const q = this.perf ||= { t: 0, n: 0 };
    q.t += dt; q.n++;
    if (q.t < 2.5) return;
    const fps = q.n / q.t, px = this.renderer.getPixelRatio();
    q.t = 0; q.n = 0;
    if (fps < 42 && px > 1) {
      this.renderer.setPixelRatio(Math.max(1, px - 0.25));
      this.resize();
    }
  }
}
