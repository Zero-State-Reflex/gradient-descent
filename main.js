import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ── Config ──────────────────────────────────────────────────────────────
const SURFACE_SIZE = 8;
const SURFACE_RES = 400;
const LEARNING_RATE = 0.035;
const NUM_PARTICLES = 6;
const TRAIL_LENGTH = 300;

// ── Wait for user click (required for audio) ────────────────────────────
const soundPrompt = document.getElementById('sound-prompt');
let started = false;

let introTime = 0;
const INTRO_DURATION = 4.5; // seconds for camera descent
let introComplete = false;

soundPrompt.addEventListener('click', () => {
  soundPrompt.style.display = 'none';
  if (!started) {
    started = true;
    introTime = 0;
    introComplete = false;
    initAudio();
    playIntroSweep();
  }
});

// ── Scene setup ─────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000510, 0.035);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
// Start high above, looking straight down — will descend on intro
camera.position.set(0, 35, 0);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

// ── Orbit Controls ──────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;
controls.target.set(0, 1, 0);
controls.minDistance = 4;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.85;
controls.update();

// ── Post-processing ─────────────────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight), 1.5, 0.4, 0.15
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ── Loss function: Enhanced with sharper valleys & more terrain detail ──
function lossFunction(x, z) {
  const scale = 1.2;
  const sx = x * scale, sz = z * scale;

  // Base: Styblinski-Tang
  const st = (sx ** 4 - 16 * sx ** 2 + 5 * sx + sz ** 4 - 16 * sz ** 2 + 5 * sz) / 2;

  // Sharp valleys using abs (V-shaped cuts)
  const valley1 = -1.8 * Math.exp(-Math.abs(sx + sz) * 1.5) * Math.exp(-((sx - sz) ** 2) * 0.1);
  const valley2 = -1.4 * Math.exp(-Math.abs(sx - 1.0) * 2.0) * Math.exp(-sz * sz * 0.15);
  const valley3 = -1.2 * Math.exp(-Math.abs(sz + 0.5) * 2.0) * Math.exp(-sx * sx * 0.15);

  // Ravine: a narrow diagonal channel
  const diag = (sx - sz) * 0.707;
  const ravine = -2.0 * Math.exp(-diag * diag * 4.0) * Math.exp(-((sx + sz) ** 2) * 0.02);

  // Deep pits (local minima)
  const pit1 = -3.0 * Math.exp(-((sx + 2.8) ** 2 + (sz + 2.8) ** 2) * 1.5);
  const pit2 = -2.5 * Math.exp(-((sx - 2.5) ** 2 + (sz + 1.5) ** 2) * 1.2);
  const pit3 = -2.0 * Math.exp(-((sx + 1.0) ** 2 + (sz - 3.0) ** 2) * 1.0);

  // Ridges
  const ridge1 = 1.5 * Math.exp(-((sx - 2) ** 2) * 3) * Math.pow(Math.cos(sz * 2), 2);
  const ridge2 = 1.2 * Math.exp(-((sz + 2) ** 2) * 3) * Math.pow(Math.cos(sx * 1.5), 2);

  // Fine detail: high-freq ripples that show in the surface
  const detail = 0.15 * Math.sin(sx * 5) * Math.cos(sz * 5)
    + 0.08 * Math.sin(sx * 8 + sz * 3) * Math.cos(sz * 7 - sx * 2);

  // Terracing effect in valleys — creates stepped look
  const raw = st / 40 + 2;
  const terraced = Math.round(raw * 3) / 3;
  const base = raw * 0.7 + terraced * 0.3;

  return base + valley1 + valley2 + valley3 + ravine + pit1 + pit2 + pit3
    + ridge1 + ridge2 + detail;
}

function gradient(x, z) {
  const h = 0.001;
  const dfdx = (lossFunction(x + h, z) - lossFunction(x - h, z)) / (2 * h);
  const dfdz = (lossFunction(x, z + h) - lossFunction(x, z - h)) / (2 * h);
  return [dfdx, dfdz];
}

// ── Surface mesh (higher res for valley detail) ─────────────────────────
const surfaceGeo = new THREE.PlaneGeometry(SURFACE_SIZE * 2, SURFACE_SIZE * 2, SURFACE_RES, SURFACE_RES);
surfaceGeo.rotateX(-Math.PI / 2);

const positions = surfaceGeo.attributes.position;
let yMin = Infinity, yMax = -Infinity;
for (let i = 0; i < positions.count; i++) {
  const x = positions.getX(i);
  const z = positions.getZ(i);
  const y = lossFunction(x, z);
  positions.setY(i, y);
  yMin = Math.min(yMin, y);
  yMax = Math.max(yMax, y);
}
surfaceGeo.computeVertexNormals();

// Color the surface by height — deeper palette with valley emphasis
const colors = new Float32Array(positions.count * 3);
for (let i = 0; i < positions.count; i++) {
  const y = positions.getY(i);
  const t = (y - yMin) / (yMax - yMin);

  const c = new THREE.Color();
  if (t < 0.1) {
    // Deep valley: glowing indigo/magenta
    c.lerpColors(new THREE.Color(0x1a0030), new THREE.Color(0x3a1070), t / 0.1);
  } else if (t < 0.25) {
    c.lerpColors(new THREE.Color(0x3a1070), new THREE.Color(0x0a2a6a), (t - 0.1) / 0.15);
  } else if (t < 0.45) {
    c.lerpColors(new THREE.Color(0x0a2a6a), new THREE.Color(0x1a5aaa), (t - 0.25) / 0.2);
  } else if (t < 0.65) {
    c.lerpColors(new THREE.Color(0x1a5aaa), new THREE.Color(0x2d8cf0), (t - 0.45) / 0.2);
  } else if (t < 0.82) {
    c.lerpColors(new THREE.Color(0x2d8cf0), new THREE.Color(0x60e0ff), (t - 0.65) / 0.17);
  } else {
    c.lerpColors(new THREE.Color(0x60e0ff), new THREE.Color(0xeeffff), (t - 0.82) / 0.18);
  }
  colors[i * 3] = c.r;
  colors[i * 3 + 1] = c.g;
  colors[i * 3 + 2] = c.b;
}
surfaceGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

// Compute curvature-based AO approximation — darken concave areas (valleys)
const normals = surfaceGeo.attributes.normal;
const aoFactor = new Float32Array(positions.count);
const side = SURFACE_RES + 1;
for (let i = 0; i < positions.count; i++) {
  const ix = i % side;
  const iz = Math.floor(i / side);
  if (ix === 0 || ix === side - 1 || iz === 0 || iz === side - 1) {
    aoFactor[i] = 1.0;
    continue;
  }
  // Compare normal with neighbors to estimate concavity
  const ny = normals.getY(i);
  const nyL = normals.getY(i - 1);
  const nyR = normals.getY(i + 1);
  const nyU = normals.getY(i - side);
  const nyD = normals.getY(i + side);
  const curvature = (nyL + nyR + nyU + nyD) / 4 - ny;
  // Negative curvature = concave = valley
  aoFactor[i] = Math.max(0.35, 1.0 + curvature * 8);
}

// Apply AO to vertex colors
for (let i = 0; i < positions.count; i++) {
  colors[i * 3] *= aoFactor[i];
  colors[i * 3 + 1] *= aoFactor[i];
  colors[i * 3 + 2] *= aoFactor[i];
}
surfaceGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

const surfaceMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  metalness: 0.35,
  roughness: 0.35,
  wireframe: false,
  transparent: true,
  opacity: 0.9,
  side: THREE.DoubleSide,
});
const surface = new THREE.Mesh(surfaceGeo, surfaceMat);
scene.add(surface);


// ── Valley glow: point lights in the deepest pits ───────────────────────
const valleyGlow1 = new THREE.PointLight(0x6622cc, 2.0, 5);
valleyGlow1.position.set(-2.8 / 1.2, yMin + 0.3, -2.8 / 1.2);
scene.add(valleyGlow1);

const valleyGlow2 = new THREE.PointLight(0x4422aa, 1.5, 4);
valleyGlow2.position.set(2.5 / 1.2, lossFunction(2.5 / 1.2, -1.5 / 1.2) + 0.3, -1.5 / 1.2);
scene.add(valleyGlow2);

const valleyGlow3 = new THREE.PointLight(0x3333bb, 1.2, 4);
valleyGlow3.position.set(-1.0 / 1.2, lossFunction(-1.0 / 1.2, 3.0 / 1.2) + 0.3, 3.0 / 1.2);
scene.add(valleyGlow3);

// ── Grid floor ──────────────────────────────────────────────────────────
const gridHelper = new THREE.GridHelper(20, 40, 0x112244, 0x0a0a2a);
gridHelper.position.y = yMin - 0.5;
scene.add(gridHelper);

// ── Lighting ────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x1a1a4a, 0.8));

const keyLight = new THREE.DirectionalLight(0x88bbff, 2.0);
keyLight.position.set(5, 10, 5);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xff6633, 1.2);
rimLight.position.set(-5, 6, -5);
scene.add(rimLight);

// Extended red glow — point lights spread across the surface
const redGlow1 = new THREE.PointLight(0xff4422, 2.5, 18);
redGlow1.position.set(-6, 4, -6);
scene.add(redGlow1);

const redGlow2 = new THREE.PointLight(0xff5533, 1.8, 15);
redGlow2.position.set(-3, 2, -8);
scene.add(redGlow2);

const redGlow3 = new THREE.PointLight(0xff3311, 1.5, 12);
redGlow3.position.set(-8, 3, -3);
scene.add(redGlow3);

const fillLight = new THREE.PointLight(0x4466ff, 1.5, 20);
fillLight.position.set(0, 8, 0);
scene.add(fillLight);

// Extra valley-highlight light from below
const underLight = new THREE.PointLight(0x2211aa, 1.0, 15);
underLight.position.set(0, yMin - 1, 0);
scene.add(underLight);

// ── Trail shader material (fading points) ───────────────────────────────
const trailVertexShader = `
  attribute float alpha;
  attribute float size;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const trailFragmentShader = `
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.2, 0.0, d);
    vec3 col = color * glow + vec3(1.0) * core * 0.3;
    gl_FragColor = vec4(col, vAlpha * glow);
  }
`;

// ── Particle system (gradient descent balls) ────────────────────────────
const particleColors = [0xff4466, 0x44ff88, 0x4488ff, 0xffaa22, 0xcc44ff, 0x44ffee];

class DescentParticle {
  constructor(color, startX, startZ) {
    this.x = startX;
    this.z = startZ;
    this.y = lossFunction(this.x, this.z);
    this.vx = 0;
    this.vz = 0;
    this.momentum = 0.9;
    this.iteration = 0;
    this.converged = false;
    this.color = color;

    // Glowing sphere
    const geo = new THREE.SphereGeometry(0.1, 32, 32);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.5,
      metalness: 0.8,
      roughness: 0.1,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    scene.add(this.mesh);

    this.light = new THREE.PointLight(color, 2.0, 4);
    scene.add(this.light);

    // Fading trail using custom shader points
    this.trailPositions = [];
    this.trailGeo = new THREE.BufferGeometry();
    const posArr = new Float32Array(TRAIL_LENGTH * 3);
    const alphaArr = new Float32Array(TRAIL_LENGTH);
    const sizeArr = new Float32Array(TRAIL_LENGTH);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    this.trailGeo.setAttribute('alpha', new THREE.BufferAttribute(alphaArr, 1));
    this.trailGeo.setAttribute('size', new THREE.BufferAttribute(sizeArr, 1));
    this.trailGeo.setDrawRange(0, 0);

    const c = new THREE.Color(color);
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: c } },
      vertexShader: trailVertexShader,
      fragmentShader: trailFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.trail = new THREE.Points(this.trailGeo, this.trailMat);
    scene.add(this.trail);
  }

  step() {
    if (this.converged) return;

    const [gx, gz] = gradient(this.x, this.z);
    const gradMag = Math.sqrt(gx * gx + gz * gz);

    this.vx = this.momentum * this.vx - LEARNING_RATE * gx;
    this.vz = this.momentum * this.vz - LEARNING_RATE * gz;

    this.vx += (Math.random() - 0.5) * 0.002;
    this.vz += (Math.random() - 0.5) * 0.002;

    this.x += this.vx;
    this.z += this.vz;

    this.x = Math.max(-SURFACE_SIZE, Math.min(SURFACE_SIZE, this.x));
    this.z = Math.max(-SURFACE_SIZE, Math.min(SURFACE_SIZE, this.z));

    this.y = lossFunction(this.x, this.z);
    this.iteration++;

    if (gradMag < 0.01 && this.iteration > 50) {
      this.converged = true;
    }

    this.trailPositions.push({ x: this.x, y: this.y + 0.06, z: this.z });
    if (this.trailPositions.length > TRAIL_LENGTH) {
      this.trailPositions.shift();
    }
  }

  updateVisuals() {
    this.mesh.position.set(this.x, this.y + 0.14, this.z);
    this.light.position.copy(this.mesh.position);
    this.light.position.y += 0.3;

    const pulse = 1 + 0.2 * Math.sin(performance.now() * 0.005 + this.x);
    this.mesh.scale.setScalar(pulse);
    this.light.intensity = 1.5 + 0.8 * pulse;

    const speed = Math.sqrt(this.vx ** 2 + this.vz ** 2);
    this.mesh.material.emissiveIntensity = 2.0 + speed * 25;

    // Update trail buffer
    const count = this.trailPositions.length;
    const posAttr = this.trailGeo.attributes.position;
    const alphaAttr = this.trailGeo.attributes.alpha;
    const sizeAttr = this.trailGeo.attributes.size;

    for (let i = 0; i < count; i++) {
      const p = this.trailPositions[i];
      posAttr.array[i * 3] = p.x;
      posAttr.array[i * 3 + 1] = p.y;
      posAttr.array[i * 3 + 2] = p.z;

      // Fade: 0 at tail, 1 at head
      const t = i / Math.max(1, count - 1);
      // Exponential fade for more visible recent trail
      alphaAttr.array[i] = Math.pow(t, 1.5) * 0.9;
      // Size: smaller at tail, bigger near head
      sizeAttr.array[i] = 0.5 + t * 3.5;
    }

    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    this.trailGeo.setDrawRange(0, count);
  }

  reset(startX, startZ) {
    this.x = startX;
    this.z = startZ;
    this.y = lossFunction(this.x, this.z);
    this.vx = 0;
    this.vz = 0;
    this.iteration = 0;
    this.converged = false;
    this.trailPositions = [];
    this.trailGeo.setDrawRange(0, 0);
  }
}

// ── Spawn particles ─────────────────────────────────────────────────────
let particles = [];

function spawnParticles() {
  particles.forEach(p => {
    scene.remove(p.mesh);
    scene.remove(p.light);
    scene.remove(p.trail);
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
    p.trailGeo.dispose();
    p.trailMat.dispose();
  });
  particles = [];

  const starts = [
    [-5, -5], [5, 5], [-5, 5], [5, -5], [0, 6], [-6, 0]
  ];
  for (let i = 0; i < NUM_PARTICLES; i++) {
    const [sx, sz] = starts[i];
    const jx = sx + (Math.random() - 0.5) * 2;
    const jz = sz + (Math.random() - 0.5) * 2;
    particles.push(new DescentParticle(particleColors[i], jx, jz));
  }
}

spawnParticles();

// ── Floating particles (ambient atmosphere) ─────────────────────────────
const dustCount = 500;
const dustGeo = new THREE.BufferGeometry();
const dustPositions = new Float32Array(dustCount * 3);
const dustSizes = new Float32Array(dustCount);
for (let i = 0; i < dustCount; i++) {
  dustPositions[i * 3] = (Math.random() - 0.5) * 20;
  dustPositions[i * 3 + 1] = Math.random() * 10 - 2;
  dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 20;
  dustSizes[i] = Math.random() * 3 + 1;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
dustGeo.setAttribute('size', new THREE.BufferAttribute(dustSizes, 1));

const dustMat = new THREE.PointsMaterial({
  color: 0x4488ff,
  size: 0.03,
  transparent: true,
  opacity: 0.4,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);

// ── Tron grid on surface ────────────────────────────────────────────────
const tronGridRes = 128;
const tronGeo = new THREE.PlaneGeometry(SURFACE_SIZE * 2, SURFACE_SIZE * 2, tronGridRes, tronGridRes);
tronGeo.rotateX(-Math.PI / 2);
const tronPos = tronGeo.attributes.position;
for (let i = 0; i < tronPos.count; i++) {
  tronPos.setY(i, lossFunction(tronPos.getX(i), tronPos.getZ(i)) + 0.03);
}
tronGeo.computeVertexNormals();
const tronMat = new THREE.MeshBasicMaterial({
  color: 0x4488ff,
  wireframe: true,
  transparent: true,
  opacity: 0.1,
});
scene.add(new THREE.Mesh(tronGeo, tronMat));

// ── Arrow helpers showing gradient at grid points ───────────────────────
function createGradientField() {
  const group = new THREE.Group();
  const spacing = 2;
  for (let x = -SURFACE_SIZE + 1; x < SURFACE_SIZE; x += spacing) {
    for (let z = -SURFACE_SIZE + 1; z < SURFACE_SIZE; z += spacing) {
      const [gx, gz] = gradient(x, z);
      const mag = Math.sqrt(gx * gx + gz * gz);
      if (mag < 0.1) continue;

      const y = lossFunction(x, z);
      const dir = new THREE.Vector3(-gx, 0, -gz).normalize();
      const len = Math.min(mag * 0.3, 0.8);
      const arrow = new THREE.ArrowHelper(
        dir, new THREE.Vector3(x, y + 0.15, z),
        len, 0x334488, 0.12, 0.08
      );
      arrow.line.material.transparent = true;
      arrow.line.material.opacity = 0.2;
      arrow.cone.material.transparent = true;
      arrow.cone.material.opacity = 0.2;
      group.add(arrow);
    }
  }
  scene.add(group);
}
createGradientField();

// ════════════════════════════════════════════════════════════════════════
// ── INTRO DESCENT SYNTH ───────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

function playIntroSweep() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const dur = INTRO_DURATION;

  // Layer 1: descending pitch sweep — 150Hz down to deep sub
  const sweep = audioCtx.createOscillator();
  sweep.type = 'sawtooth';
  sweep.frequency.setValueAtTime(150, now);
  sweep.frequency.exponentialRampToValueAtTime(25, now + dur);

  const sweepGain = audioCtx.createGain();
  sweepGain.gain.setValueAtTime(0, now);
  sweepGain.gain.linearRampToValueAtTime(0.07, now + 0.3);
  sweepGain.gain.setValueAtTime(0.07, now + dur * 0.6);
  sweepGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

  const sweepFilter = audioCtx.createBiquadFilter();
  sweepFilter.type = 'lowpass';
  sweepFilter.Q.value = 3;
  sweepFilter.frequency.setValueAtTime(500, now);
  sweepFilter.frequency.exponentialRampToValueAtTime(80, now + dur);

  sweep.connect(sweepGain).connect(sweepFilter).connect(masterGain);
  sweep.start(now);
  sweep.stop(now + dur + 0.5);

  // Layer 2: sine a fifth above tracking the descent
  const sweep2 = audioCtx.createOscillator();
  sweep2.type = 'sine';
  sweep2.frequency.setValueAtTime(225, now);
  sweep2.frequency.exponentialRampToValueAtTime(37, now + dur);

  const sweep2Gain = audioCtx.createGain();
  sweep2Gain.gain.setValueAtTime(0, now);
  sweep2Gain.gain.linearRampToValueAtTime(0.04, now + 0.5);
  sweep2Gain.gain.setValueAtTime(0.04, now + dur * 0.5);
  sweep2Gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

  sweep2.connect(sweep2Gain).connect(sweepFilter);
  sweep2.start(now);
  sweep2.stop(now + dur + 0.5);

  // Layer 3: sub bass rise at the end (landing thud)
  const sub = audioCtx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(30, now + dur * 0.7);
  sub.frequency.linearRampToValueAtTime(55, now + dur);

  const subGain = audioCtx.createGain();
  subGain.gain.setValueAtTime(0, now);
  subGain.gain.setValueAtTime(0, now + dur * 0.6);
  subGain.gain.linearRampToValueAtTime(0.1, now + dur * 0.85);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + dur + 1);

  sub.connect(subGain).connect(masterGain);
  sub.start(now + dur * 0.6);
  sub.stop(now + dur + 1.5);

  // Layer 4: filtered noise whoosh
  const noiseLen = audioCtx.sampleRate * dur;
  const noiseBuf = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) {
    noiseData[i] = (Math.random() * 2 - 1);
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuf;

  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.Q.value = 2;
  noiseFilter.frequency.setValueAtTime(350, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(40, now + dur);

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0, now);
  noiseGain.gain.linearRampToValueAtTime(0.015, now + 0.2);
  noiseGain.gain.setValueAtTime(0.015, now + dur * 0.4);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

  noise.connect(noiseFilter).connect(noiseGain).connect(masterGain);
  noise.start(now);
  noise.stop(now + dur + 0.5);

  // Layer 5: descending shimmer (low, detuned pair)
  const shimmer1 = audioCtx.createOscillator();
  shimmer1.type = 'triangle';
  shimmer1.frequency.setValueAtTime(120, now);
  shimmer1.frequency.exponentialRampToValueAtTime(30, now + dur);

  const shimmer2 = audioCtx.createOscillator();
  shimmer2.type = 'triangle';
  shimmer2.frequency.setValueAtTime(120 * 1.005, now);
  shimmer2.frequency.exponentialRampToValueAtTime(30 * 1.005, now + dur);

  const shimmerGain = audioCtx.createGain();
  shimmerGain.gain.setValueAtTime(0, now);
  shimmerGain.gain.linearRampToValueAtTime(0.02, now + 0.8);
  shimmerGain.gain.setValueAtTime(0.02, now + dur * 0.5);
  shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + dur + 1);

  shimmer1.connect(shimmerGain).connect(sweepFilter);
  shimmer2.connect(shimmerGain);
  shimmer1.start(now);
  shimmer2.start(now);
  shimmer1.stop(now + dur + 1.5);
  shimmer2.stop(now + dur + 1.5);
}

// ════════════════════════════════════════════════════════════════════════
// ── DEEP SYNTH ENGINE (Web Audio API) ─────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

let audioCtx, masterGain, muted = false;

function initAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.72;

  // ── Long reverb (6 seconds) ───────────────────────────────────────
  const convolver = audioCtx.createConvolver();
  const reverbLen = audioCtx.sampleRate * 6;
  const reverbBuf = audioCtx.createBuffer(2, reverbLen, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = reverbBuf.getChannelData(ch);
    for (let i = 0; i < reverbLen; i++) {
      // Long tail with early reflections
      const early = i < audioCtx.sampleRate * 0.1 ? Math.random() * 0.5 : 0;
      data[i] = ((Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 2.8))) + early * Math.exp(-i / (audioCtx.sampleRate * 0.05));
    }
  }
  convolver.buffer = reverbBuf;

  const reverbGain = audioCtx.createGain();
  reverbGain.gain.value = 0.55; // heavy wet mix
  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.45;

  masterGain.connect(dryGain).connect(audioCtx.destination);
  masterGain.connect(convolver).connect(reverbGain).connect(audioCtx.destination);

  // ── Deep drone: root + fifth + octave + higher harmonics ────────────
  const droneFreqs = [
    { f: 55, type: 'sine', vol: 0.055 },         // A1 root
    { f: 55 * 1.002, type: 'sine', vol: 0.045 }, // A1 detuned chorus
    { f: 82.41, type: 'sine', vol: 0.035 },      // E2 perfect fifth
    { f: 82.41 * 0.998, type: 'sine', vol: 0.028 }, // E2 detuned
    { f: 110, type: 'triangle', vol: 0.03 },     // A2 octave
    { f: 110 * 1.003, type: 'sine', vol: 0.022 }, // A2 detuned
    { f: 164.81, type: 'sine', vol: 0.018 },     // E3 fifth octave
    { f: 220, type: 'sine', vol: 0.012 },        // A3 second octave
    { f: 220 * 1.005, type: 'triangle', vol: 0.008 }, // A3 detuned shimmer
    { f: 329.63, type: 'sine', vol: 0.006 },     // E4 high fifth
    { f: 440, type: 'sine', vol: 0.004 },        // A4 air
  ];

  droneFreqs.forEach((d, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = d.type;
    osc.frequency.value = d.f;

    const gain = audioCtx.createGain();
    gain.gain.value = d.vol;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200 + i * 60;
    filter.Q.value = 0.7;

    // Very slow LFO on volume for breathing
    const lfo = audioCtx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.02 + i * 0.008;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = d.vol * 0.3;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();

    // Slow filter sweep
    const filterLfo = audioCtx.createOscillator();
    filterLfo.type = 'sine';
    filterLfo.frequency.value = 0.03 + i * 0.005;
    const filterLfoGain = audioCtx.createGain();
    filterLfoGain.gain.value = 80;
    filterLfo.connect(filterLfoGain).connect(filter.frequency);
    filterLfo.start();

    osc.connect(gain).connect(filter).connect(masterGain);
    osc.start();
  });

  // ── Deep synth note player ────────────────────────────────────────
  // Warm, soft voice: sine + triangle layers, gentle filtering
  function playSynthNote(freq, time, duration, vel) {
    const now = audioCtx.currentTime + time;
    const attack = Math.min(duration * 0.4, 5);
    const release = Math.min(duration * 0.5, 7);

    // Layer 1: warm triangle (main body, softer than saw)
    const tri1 = audioCtx.createOscillator();
    tri1.type = 'triangle';
    tri1.frequency.value = freq;

    // Layer 2: sine for purity
    const sine = audioCtx.createOscillator();
    sine.type = 'sine';
    sine.frequency.value = freq;

    // Layer 3: detuned sine for gentle chorus
    const sine2 = audioCtx.createOscillator();
    sine2.type = 'sine';
    sine2.frequency.value = freq * 1.004;

    // Layer 4: sub octave sine
    const sub = audioCtx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq * 0.5;

    const amp = 0.022 * vel;

    const triGain = audioCtx.createGain();
    triGain.gain.setValueAtTime(0, now);
    triGain.gain.linearRampToValueAtTime(amp * 0.5, now + attack);
    triGain.gain.setValueAtTime(amp * 0.5, now + duration - release);
    triGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const sineGain = audioCtx.createGain();
    sineGain.gain.setValueAtTime(0, now);
    sineGain.gain.linearRampToValueAtTime(amp, now + attack);
    sineGain.gain.setValueAtTime(amp, now + duration - release);
    sineGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const sine2Gain = audioCtx.createGain();
    sine2Gain.gain.setValueAtTime(0, now);
    sine2Gain.gain.linearRampToValueAtTime(amp * 0.4, now + attack);
    sine2Gain.gain.setValueAtTime(amp * 0.4, now + duration - release);
    sine2Gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const subGain = audioCtx.createGain();
    subGain.gain.setValueAtTime(0, now);
    subGain.gain.linearRampToValueAtTime(amp * 0.5, now + attack);
    subGain.gain.setValueAtTime(amp * 0.5, now + duration - release);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    // Gentle low-pass filter — warm, no resonance
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(120, now);
    filter.frequency.linearRampToValueAtTime(500 + freq * 1.2, now + attack * 1.2);
    filter.frequency.linearRampToValueAtTime(200, now + duration);

    const mix = audioCtx.createGain();
    tri1.connect(triGain).connect(mix);
    sine.connect(sineGain).connect(mix);
    sine2.connect(sine2Gain).connect(mix);
    sub.connect(subGain).connect(mix);
    mix.connect(filter).connect(masterGain);

    tri1.start(now);
    sine.start(now);
    sine2.start(now);
    sub.start(now);
    tri1.stop(now + duration + 1);
    sine.stop(now + duration + 1);
    sine2.stop(now + duration + 1);
    sub.stop(now + duration + 1);
  }

  // ── Warm pad progression ─────────────────────────────────────────
  // Consonant chords: Am - Fmaj7 - Cmaj - Em7 - Dm9 - Am
  const warmChords = [
    [55, 65.41, 82.41, 110],           // Am: A1 + C2 + E2 + A2
    [43.65, 55, 65.41, 82.41],         // Fmaj7: F1 + A1 + C2 + E2
    [65.41, 82.41, 98, 130.81],        // C: C2 + E2 + G2 + C3
    [82.41, 98, 123.47, 146.83],       // Em7: E2 + G2 + B2 + D3
    [73.42, 87.31, 110, 130.81],       // Dm9: D2 + F2 + A2 + C3
    [55, 65.41, 82.41, 130.81],        // Am(add9): A1 + C2 + E2 + C3
  ];

  function schedulePads() {
    const cycleDuration = 60; // long, meditative
    const chordDur = cycleDuration / warmChords.length;
    warmChords.forEach((chord, i) => {
      chord.forEach(freq => {
        playSynthNote(freq, i * chordDur, chordDur * 1.5, 0.6 + Math.random() * 0.3);
      });
    });
    setTimeout(schedulePads, cycleDuration * 1000);
  }
  schedulePads();

  // ── Soft melodic notes: pentatonic minor (always consonant) ────────
  // A minor pentatonic across two octaves — every combination sounds good
  const deepScale = [
    55, 65.41, 73.42, 82.41, 98,       // A1 C2 D2 E2 G2
    110, 130.81, 146.83, 164.81, 196,   // A2 C3 D3 E3 G3
  ];

  function scheduleDeepNote() {
    const interval = 5 + Math.random() * 8;
    if (particles.length > 0 && !muted) {
      const p = particles[Math.floor(Math.random() * particles.length)];
      const normalizedLoss = Math.max(0, Math.min(1, (p.y - yMin) / (yMax - yMin)));
      const noteIdx = Math.floor((1 - normalizedLoss) * (deepScale.length - 1));
      const freq = deepScale[noteIdx];
      const duration = 8 + Math.random() * 12; // 8-20 second notes
      const vel = 0.25 + (1 - normalizedLoss) * 0.45;
      playSynthNote(freq, 0, duration, vel);

      // Sometimes add a perfect fifth or octave harmony
      if (Math.random() > 0.55) {
        const harmonyOptions = [1.5, 2.0, 1.333]; // fifth, octave, fourth
        const ratio = harmonyOptions[Math.floor(Math.random() * harmonyOptions.length)];
        playSynthNote(freq * ratio, 1 + Math.random() * 3, duration * 0.7, vel * 0.35);
      }
    }
    setTimeout(scheduleDeepNote, interval * 1000);
  }
  setTimeout(scheduleDeepNote, 3000);

  // ── Sub bass pulse: tied to convergence ───────────────────────────
  function subPulse() {
    if (muted || !audioCtx) { setTimeout(subPulse, 5000); return; }

    const convergedCount = particles.filter(p => p.converged).length;
    if (convergedCount > 0) {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 30 + convergedCount * 3;
      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.05, now + 2);
      gain.gain.linearRampToValueAtTime(0, now + 6);
      osc.connect(gain).connect(masterGain);
      osc.start(now);
      osc.stop(now + 7);
    }
    setTimeout(subPulse, 5000 + Math.random() * 4000);
  }
  setTimeout(subPulse, 6000);

  // ── Texture: very slow filtered noise washes ──────────────────────
  function noiseWash() {
    if (muted || !audioCtx) { setTimeout(noiseWash, 12000); return; }

    const bufferSize = audioCtx.sampleRate * 6;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    const now = audioCtx.currentTime;
    filter.frequency.setValueAtTime(60, now);
    filter.frequency.linearRampToValueAtTime(400, now + 3);
    filter.frequency.linearRampToValueAtTime(80, now + 6);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.006, now + 2);
    gain.gain.linearRampToValueAtTime(0, now + 6);

    source.connect(filter).connect(gain).connect(masterGain);
    source.start(now);
    source.stop(now + 7);

    setTimeout(noiseWash, 10000 + Math.random() * 15000);
  }
  setTimeout(noiseWash, 5000);
}

// ── Volume UI ───────────────────────────────────────────────────────────
const speakerBtn = document.getElementById('speaker-btn');
const iconOn = document.getElementById('icon-on');
const iconOff = document.getElementById('icon-off');
const volumeSlider = document.getElementById('volume-slider');
let savedVolume = 60;

function updateIcons() {
  iconOn.style.display = muted ? 'none' : 'block';
  iconOff.style.display = muted ? 'block' : 'none';
}

function setVolume(val, fromSlider) {
  if (!masterGain) return;
  const v = val / 100 * 0.72; // map 0-100 to 0-0.72
  masterGain.gain.linearRampToValueAtTime(v, audioCtx.currentTime + 0.1);
  if (!fromSlider) volumeSlider.value = val;
  muted = val === 0;
  updateIcons();
}

speakerBtn.addEventListener('click', () => {
  if (muted) {
    // Unmute: restore saved volume
    const restore = savedVolume > 0 ? savedVolume : 60;
    volumeSlider.value = restore;
    setVolume(restore, false);
  } else {
    // Mute: save current volume, set to 0
    savedVolume = parseInt(volumeSlider.value);
    volumeSlider.value = 0;
    setVolume(0, false);
  }
});

volumeSlider.addEventListener('input', () => {
  const val = parseInt(volumeSlider.value);
  if (val > 0) savedVolume = val;
  setVolume(val, true);
});

// Keyboard shortcut still works
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') {
    speakerBtn.click();
  }
});

// ── Restart on double-click (single click is now orbit) ─────────────────
window.addEventListener('dblclick', (e) => {
  if (e.target === soundPrompt || soundPrompt.contains(e.target)) return;
  spawnParticles();
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ── Stats display ───────────────────────────────────────────────────────
const statsEl = document.getElementById('stats');

function updateStats() {
  const p = particles[0];
  if (!p) return;
  const [gx, gz] = gradient(p.x, p.z);
  const gradMag = Math.sqrt(gx * gx + gz * gz);
  statsEl.innerHTML = `
    iteration: ${p.iteration}<br>
    loss: ${p.y.toFixed(4)}<br>
    |grad|: ${gradMag.toFixed(4)}<br>
    lr: ${LEARNING_RATE}<br>
    momentum: ${p.momentum}<br>
    ${p.converged ? '<span style="color:#44ff88">converged</span>' : 'descending...'}
  `;
}

// ── Model insight panel ─────────────────────────────────────────────────
const nnCanvas = document.getElementById('nn-canvas');
const nnCtx = nnCanvas ? nnCanvas.getContext('2d') : null;
const mLoss = document.getElementById('m-loss');
const mGrad = document.getElementById('m-grad');
const mConf = document.getElementById('m-conf');
const mIter = document.getElementById('m-iter');
const confBar = document.getElementById('confidence-bar');
const stepEls = [1,2,3,4,5,6].map(i => document.getElementById('step-' + i));
let currentStep = 0;

// Neural network layout: 3 layers
const nnLayers = [4, 6, 3]; // input, hidden, output
const nnWeights = []; // will store animated weight values

// Initialize random weights
for (let l = 0; l < nnLayers.length - 1; l++) {
  const layerWeights = [];
  for (let i = 0; i < nnLayers[l]; i++) {
    for (let j = 0; j < nnLayers[l + 1]; j++) {
      layerWeights.push(Math.random() * 2 - 1);
    }
  }
  nnWeights.push(layerWeights);
}

function drawNeuralNetwork(t, p) {
  if (!nnCtx) return;
  const W = nnCanvas.width;
  const H = nnCanvas.height;
  nnCtx.clearRect(0, 0, W, H);

  const normalizedLoss = p ? Math.max(0, Math.min(1, (p.y - yMin) / (yMax - yMin))) : 1;
  const confidence = 1 - normalizedLoss;
  const speed = p ? Math.sqrt(p.vx ** 2 + p.vz ** 2) : 0;

  // Node positions
  const layerX = nnLayers.map((_, i) => 60 + i * (W - 120) / (nnLayers.length - 1));
  const nodePositions = [];

  for (let l = 0; l < nnLayers.length; l++) {
    const nodes = [];
    const count = nnLayers[l];
    for (let n = 0; n < count; n++) {
      const y = (H / (count + 1)) * (n + 1);
      nodes.push({ x: layerX[l], y });
    }
    nodePositions.push(nodes);
  }

  // Update weights based on particle state
  if (p && !p.converged) {
    for (let l = 0; l < nnWeights.length; l++) {
      for (let w = 0; w < nnWeights[l].length; w++) {
        // Weights drift toward stability as loss decreases
        nnWeights[l][w] += (Math.random() - 0.5) * speed * 8;
        nnWeights[l][w] *= 0.995; // slow decay toward 0
        nnWeights[l][w] = Math.max(-1, Math.min(1, nnWeights[l][w]));
      }
    }
  }

  // Draw connections with weight-based coloring
  for (let l = 0; l < nnLayers.length - 1; l++) {
    let wIdx = 0;
    for (let i = 0; i < nnLayers[l]; i++) {
      for (let j = 0; j < nnLayers[l + 1]; j++) {
        const from = nodePositions[l][i];
        const to = nodePositions[l + 1][j];
        const w = nnWeights[l][wIdx++];

        // Color: positive = cyan, negative = red-ish, alpha by magnitude
        const mag = Math.abs(w);
        const alpha = 0.08 + mag * 0.35;
        if (w >= 0) {
          nnCtx.strokeStyle = `rgba(100,200,255,${alpha})`;
        } else {
          nnCtx.strokeStyle = `rgba(255,100,100,${alpha})`;
        }
        nnCtx.lineWidth = 0.5 + mag * 2;
        nnCtx.beginPath();
        nnCtx.moveTo(from.x, from.y);
        nnCtx.lineTo(to.x, to.y);
        nnCtx.stroke();
      }
    }
  }

  // Draw nodes
  for (let l = 0; l < nnLayers.length; l++) {
    for (let n = 0; n < nodePositions[l].length; n++) {
      const { x, y } = nodePositions[l][n];

      // Activation: output layer glows with confidence, others pulse
      let activation;
      if (l === nnLayers.length - 1) {
        // Output layer: brightest node = model's "choice"
        activation = (n === 0) ? confidence : (1 - confidence) * 0.3;
      } else {
        activation = 0.3 + 0.4 * Math.sin(t * 2 + l * 1.5 + n * 0.8) + confidence * 0.3;
      }

      // Glow
      const grd = nnCtx.createRadialGradient(x, y, 0, x, y, 14);
      grd.addColorStop(0, `rgba(100,200,255,${activation * 0.4})`);
      grd.addColorStop(1, 'rgba(100,200,255,0)');
      nnCtx.fillStyle = grd;
      nnCtx.beginPath();
      nnCtx.arc(x, y, 14, 0, Math.PI * 2);
      nnCtx.fill();

      // Core
      nnCtx.fillStyle = `rgba(100,200,255,${0.3 + activation * 0.7})`;
      nnCtx.beginPath();
      nnCtx.arc(x, y, 4, 0, Math.PI * 2);
      nnCtx.fill();

      // Bright center for high activation
      if (activation > 0.6) {
        nnCtx.fillStyle = `rgba(255,255,255,${(activation - 0.6) * 1.5})`;
        nnCtx.beginPath();
        nnCtx.arc(x, y, 2, 0, Math.PI * 2);
        nnCtx.fill();
      }
    }
  }

  // Layer labels
  nnCtx.font = '16px SF Mono, Fira Code, monospace';
  nnCtx.fillStyle = 'rgba(255,255,255,0.15)';
  nnCtx.textAlign = 'center';
  const labels = ['input', 'hidden', 'output'];
  for (let l = 0; l < nnLayers.length; l++) {
    nnCtx.fillText(labels[l], layerX[l], H - 8);
  }
}

function setActiveStep(stepNum) {
  if (stepNum === currentStep) return;
  currentStep = stepNum;
  stepEls.forEach((el, i) => {
    if (!el) return;
    const num = i + 1;
    el.classList.remove('active', 'done');
    if (num < stepNum) el.classList.add('done');
    else if (num === stepNum) el.classList.add('active');
  });
}

function updateModelPanel(t) {
  const p = particles[0];
  if (!p) return;

  const [gx, gz] = gradient(p.x, p.z);
  const gradMag = Math.sqrt(gx * gx + gz * gz);
  const normalizedLoss = Math.max(0, Math.min(1, (p.y - yMin) / (yMax - yMin)));
  const confidence = ((1 - normalizedLoss) * 100);

  // Update stats
  if (mLoss) mLoss.textContent = p.y.toFixed(3);
  if (mGrad) mGrad.textContent = gradMag.toFixed(3);
  if (mConf) mConf.textContent = confidence.toFixed(0) + '%';
  if (mIter) mIter.textContent = p.iteration;
  if (confBar) confBar.style.width = confidence + '%';

  // Determine active step based on particle state
  if (p.converged) {
    setActiveStep(6);
  } else if (gradMag < 0.1) {
    setActiveStep(5);
  } else if (p.iteration > 20 && gradMag < 1.5) {
    setActiveStep(4);
  } else if (p.iteration > 5) {
    setActiveStep(3);
  } else if (p.iteration > 0) {
    setActiveStep(2);
  } else {
    setActiveStep(1);
  }

  // Draw neural network
  drawNeuralNetwork(t, p);
}

// ── Animation loop ──────────────────────────────────────────────────────
const clock = new THREE.Clock();
let stepAccumulator = 0;
const STEP_INTERVAL = 0.05;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  // ── Intro camera descent ──────────────────────────────────────────
  if (started && !introComplete) {
    introTime += dt;
    const progress = Math.min(introTime / INTRO_DURATION, 1);
    // Smooth ease-out curve
    const ease = 1 - Math.pow(1 - progress, 3);

    // Descend from high above to the orbit position
    const startY = 35;
    const endY = 7;
    const startDist = 0.1; // almost directly above
    const endDist = 12;

    const currentY = startY + (endY - startY) * ease;
    const currentDist = startDist + (endDist - startDist) * ease;
    const angle = ease * 0.8; // slight rotation during descent

    camera.position.set(
      Math.sin(angle) * currentDist,
      currentY,
      Math.cos(angle) * currentDist
    );
    camera.lookAt(0, 1, 0);

    // Bloom intensifies during descent
    bloom.strength = 2.0 - ease * 0.7;

    if (progress >= 1) {
      introComplete = true;
      // Hand off to OrbitControls at current position
      controls.target.set(0, 1, 0);
      controls.update();
    }
  }

  // Only step particles after intro
  if (introComplete || !started) {
    stepAccumulator += dt;
    while (stepAccumulator >= STEP_INTERVAL) {
      stepAccumulator -= STEP_INTERVAL;
      particles.forEach(p => p.step());
    }
  }
  particles.forEach(p => p.updateVisuals());

  // OrbitControls only after intro
  if (introComplete) {
    controls.update();
  }

  // Animate dust
  const dPos = dust.geometry.attributes.position;
  for (let i = 0; i < dustCount; i++) {
    dPos.array[i * 3 + 1] += Math.sin(t + i) * 0.002;
    if (dPos.array[i * 3 + 1] > 8) dPos.array[i * 3 + 1] = -2;
  }
  dPos.needsUpdate = true;

  // Pulse valley glows
  valleyGlow1.intensity = 2.0 + Math.sin(t * 0.3) * 0.8;
  valleyGlow2.intensity = 1.5 + Math.sin(t * 0.4 + 1) * 0.6;
  valleyGlow3.intensity = 1.2 + Math.sin(t * 0.35 + 2) * 0.5;

  // Bloom pulse
  bloom.strength = 1.3 + 0.3 * Math.sin(t * 0.5);

  updateStats();
  updateModelPanel(t);
  composer.render();
}

animate();
