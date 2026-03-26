import * as THREE from 'three';
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

soundPrompt.addEventListener('click', () => {
  soundPrompt.style.display = 'none';
  if (!started) {
    started = true;
    initAudio();
  }
});

// ── Scene setup ─────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000510, 0.035);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(8, 7, 8);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

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

// ── Wireframe overlay ───────────────────────────────────────────────────
const wireGeo = new THREE.PlaneGeometry(SURFACE_SIZE * 2, SURFACE_SIZE * 2, 80, 80);
wireGeo.rotateX(-Math.PI / 2);
const wirePos = wireGeo.attributes.position;
for (let i = 0; i < wirePos.count; i++) {
  wirePos.setY(i, lossFunction(wirePos.getX(i), wirePos.getZ(i)) + 0.01);
}
wireGeo.computeVertexNormals();
const wireMat = new THREE.MeshBasicMaterial({
  color: 0x4488ff,
  wireframe: true,
  transparent: true,
  opacity: 0.06,
});
scene.add(new THREE.Mesh(wireGeo, wireMat));

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

const rimLight = new THREE.DirectionalLight(0xff6633, 0.8);
rimLight.position.set(-5, 3, -5);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0x4466ff, 1.5, 20);
fillLight.position.set(0, 8, 0);
scene.add(fillLight);

// Extra valley-highlight light from below
const underLight = new THREE.PointLight(0x2211aa, 1.0, 15);
underLight.position.set(0, yMin - 1, 0);
scene.add(underLight);

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

    const geo = new THREE.SphereGeometry(0.08, 32, 32);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2,
      metalness: 0.8,
      roughness: 0.1,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    scene.add(this.mesh);

    this.light = new THREE.PointLight(color, 1.5, 3);
    scene.add(this.light);

    this.trailPositions = [];
    const trailGeo = new THREE.BufferGeometry();
    const trailMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      linewidth: 2,
    });
    this.trail = new THREE.Line(trailGeo, trailMat);
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

    this.trailPositions.push(new THREE.Vector3(this.x, this.y + 0.05, this.z));
    if (this.trailPositions.length > TRAIL_LENGTH) {
      this.trailPositions.shift();
    }
  }

  updateVisuals() {
    this.mesh.position.set(this.x, this.y + 0.12, this.z);
    this.light.position.copy(this.mesh.position);
    this.light.position.y += 0.3;

    const pulse = 1 + 0.15 * Math.sin(performance.now() * 0.005 + this.x);
    this.mesh.scale.setScalar(pulse);
    this.light.intensity = 1.0 + 0.5 * pulse;

    const speed = Math.sqrt(this.vx ** 2 + this.vz ** 2);
    this.mesh.material.emissiveIntensity = 1.5 + speed * 20;

    if (this.trailPositions.length > 1) {
      const geo = new THREE.BufferGeometry().setFromPoints(this.trailPositions);
      this.trail.geometry.dispose();
      this.trail.geometry = geo;
    }
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
    p.trail.geometry.dispose();
    p.trail.material.dispose();
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

// ── Contour lines on surface ────────────────────────────────────────────
function createContourLines() {
  const contourGroup = new THREE.Group();
  const levels = 18;
  for (let l = 0; l < levels; l++) {
    const targetY = yMin + (l + 1) * (yMax - yMin) / (levels + 1);
    const points = [];
    const res = 250;
    const step = (SURFACE_SIZE * 2) / res;

    for (let ix = 0; ix < res; ix++) {
      for (let iz = 0; iz < res; iz++) {
        const x = -SURFACE_SIZE + ix * step;
        const z = -SURFACE_SIZE + iz * step;
        const y00 = lossFunction(x, z);
        const y10 = lossFunction(x + step, z);
        const y01 = lossFunction(x, z + step);

        if ((y00 - targetY) * (y10 - targetY) < 0) {
          const t = (targetY - y00) / (y10 - y00);
          points.push(new THREE.Vector3(x + t * step, targetY + 0.02, z));
        }
        if ((y00 - targetY) * (y01 - targetY) < 0) {
          const t = (targetY - y00) / (y01 - y00);
          points.push(new THREE.Vector3(x, targetY + 0.02, z + t * step));
        }
      }
    }

    if (points.length > 0) {
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const tNorm = l / levels;
      const color = new THREE.Color().lerpColors(
        new THREE.Color(0x2a0a6a), new THREE.Color(0x60e0ff), tNorm
      );
      const mat = new THREE.PointsMaterial({
        color,
        size: 0.012,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      contourGroup.add(new THREE.Points(geo, mat));
    }
  }
  scene.add(contourGroup);
}
createContourLines();

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
// ── AMBIENT MUSIC ENGINE (Web Audio API) ───────────────────────────────
// ════════════════════════════════════════════════════════════════════════

let audioCtx, masterGain, muted = false;

function initAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.6;

  // ── Reverb via convolver ──────────────────────────────────────────
  const convolver = audioCtx.createConvolver();
  const reverbLen = audioCtx.sampleRate * 4;
  const reverbBuf = audioCtx.createBuffer(2, reverbLen, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = reverbBuf.getChannelData(ch);
    for (let i = 0; i < reverbLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 1.8));
    }
  }
  convolver.buffer = reverbBuf;

  const reverbGain = audioCtx.createGain();
  reverbGain.gain.value = 0.3;
  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 0.7;

  masterGain.connect(dryGain).connect(audioCtx.destination);
  masterGain.connect(convolver).connect(reverbGain).connect(audioCtx.destination);

  // ── Drone layer: stacked detuned oscillators ──────────────────────
  const droneNotes = [55, 82.41, 110, 164.81]; // A1, E2, A2, E3
  droneNotes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const osc2 = audioCtx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.002; // slight detune for chorus

    const gain = audioCtx.createGain();
    gain.gain.value = 0.04 / (i + 1);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400 + i * 100;
    filter.Q.value = 1;

    // Slow LFO on filter
    const lfo = audioCtx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05 + i * 0.02;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 150;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(filter).connect(masterGain);
    osc.start();
    osc2.start();
  });

  // ── Pad layer: slow evolving chords ───────────────────────────────
  function createPad(freqs, startTime, duration) {
    freqs.forEach(freq => {
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const osc2 = audioCtx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 0.998;

      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime + startTime;
      const attack = duration * 0.3;
      const release = duration * 0.4;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.015, now + attack);
      gain.gain.setValueAtTime(0.015, now + duration - release);
      gain.gain.linearRampToValueAtTime(0, now + duration);

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      filter.Q.value = 2;
      filter.frequency.setValueAtTime(300, now);
      filter.frequency.linearRampToValueAtTime(1200, now + duration * 0.5);
      filter.frequency.linearRampToValueAtTime(400, now + duration);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(filter).connect(masterGain);
      osc.start(now);
      osc2.start(now);
      osc.stop(now + duration + 0.1);
      osc2.stop(now + duration + 0.1);
    });
  }

  // Chord progression: Am - Fmaj7 - C - Em
  const chords = [
    [220, 261.63, 329.63],        // Am
    [174.61, 220, 261.63, 329.63], // Fmaj7
    [261.63, 329.63, 392],         // C
    [164.81, 246.94, 329.63],      // Em
  ];

  function schedulePads() {
    const cycleDuration = 32; // seconds per full progression
    const chordDur = cycleDuration / chords.length;
    chords.forEach((chord, i) => {
      createPad(chord, i * chordDur, chordDur * 1.3); // overlap
    });
    setTimeout(schedulePads, cycleDuration * 1000);
  }
  schedulePads();

  // ── Bell/chime layer: generative melodic pings ────────────────────
  function playBell(freq, time, vel) {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    // Harmonics for bell timbre
    const osc2 = audioCtx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.756; // inharmonic partial

    const osc3 = audioCtx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.value = freq * 5.404;

    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime + time;
    const amp = 0.02 * vel;
    gain.gain.setValueAtTime(amp, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 4);

    const gain2 = audioCtx.createGain();
    gain2.gain.setValueAtTime(amp * 0.3, now);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 2);

    const gain3 = audioCtx.createGain();
    gain3.gain.setValueAtTime(amp * 0.1, now);
    gain3.gain.exponentialRampToValueAtTime(0.0001, now + 1);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 200;

    osc.connect(gain).connect(filter).connect(masterGain);
    osc2.connect(gain2).connect(filter);
    osc3.connect(gain3).connect(filter);

    osc.start(now);
    osc2.start(now);
    osc3.start(now);
    osc.stop(now + 5);
    osc2.stop(now + 3);
    osc3.stop(now + 2);
  }

  // Pentatonic scale notes mapped to particle loss values
  const bellScale = [440, 523.25, 659.25, 783.99, 880, 1046.5, 1318.5];

  function scheduleBells() {
    const interval = 1.5 + Math.random() * 3;
    if (particles.length > 0 && !muted) {
      const p = particles[Math.floor(Math.random() * particles.length)];
      const normalizedLoss = Math.max(0, Math.min(1, (p.y - yMin) / (yMax - yMin)));
      const noteIdx = Math.floor(normalizedLoss * (bellScale.length - 1));
      const vel = 0.3 + (1 - normalizedLoss) * 0.7;
      playBell(bellScale[noteIdx], 0, vel);

      // Sometimes add a harmony note
      if (Math.random() > 0.5) {
        const harmIdx = Math.min(bellScale.length - 1, noteIdx + 2);
        playBell(bellScale[harmIdx], 0.15 + Math.random() * 0.3, vel * 0.5);
      }
    }
    setTimeout(scheduleBells, interval * 1000);
  }
  setTimeout(scheduleBells, 2000);

  // ── Sub bass pulse: tied to convergence ───────────────────────────
  function subPulse() {
    if (muted || !audioCtx) { setTimeout(subPulse, 4000); return; }

    const convergedCount = particles.filter(p => p.converged).length;
    if (convergedCount > 0) {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 40 + convergedCount * 5;
      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.06, now + 1);
      gain.gain.linearRampToValueAtTime(0, now + 3);
      osc.connect(gain).connect(masterGain);
      osc.start(now);
      osc.stop(now + 3.5);
    }

    setTimeout(subPulse, 3000 + Math.random() * 2000);
  }
  setTimeout(subPulse, 5000);

  // ── Texture layer: filtered noise swooshes ────────────────────────
  function noiseSwish() {
    if (muted || !audioCtx) { setTimeout(noiseSwish, 8000); return; }

    const bufferSize = audioCtx.sampleRate * 3;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 15;
    const now = audioCtx.currentTime;
    filter.frequency.setValueAtTime(200, now);
    filter.frequency.exponentialRampToValueAtTime(2000, now + 1.5);
    filter.frequency.exponentialRampToValueAtTime(300, now + 3);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.008, now + 0.5);
    gain.gain.linearRampToValueAtTime(0, now + 3);

    source.connect(filter).connect(gain).connect(masterGain);
    source.start(now);
    source.stop(now + 3.5);

    setTimeout(noiseSwish, 6000 + Math.random() * 10000);
  }
  setTimeout(noiseSwish, 3000);
}

// ── Mute toggle ─────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') {
    muted = !muted;
    if (masterGain) {
      masterGain.gain.linearRampToValueAtTime(
        muted ? 0 : 0.6, audioCtx.currentTime + 0.3
      );
    }
  }
});

// ── Camera controls ─────────────────────────────────────────────────────
let cameraAngle = 0.6;
let cameraHeight = 7;
let cameraDistance = 12;
let targetDistance = 12;

window.addEventListener('wheel', (e) => {
  targetDistance += e.deltaY * 0.01;
  targetDistance = Math.max(5, Math.min(25, targetDistance));
});

window.addEventListener('click', (e) => {
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

// ── Animation loop ──────────────────────────────────────────────────────
const clock = new THREE.Clock();
let stepAccumulator = 0;
const STEP_INTERVAL = 0.05;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  stepAccumulator += dt;
  while (stepAccumulator >= STEP_INTERVAL) {
    stepAccumulator -= STEP_INTERVAL;
    particles.forEach(p => p.step());
  }
  particles.forEach(p => p.updateVisuals());

  // Camera orbit
  cameraAngle += dt * 0.08;
  cameraDistance += (targetDistance - cameraDistance) * 0.05;
  const camY = cameraHeight + Math.sin(t * 0.15) * 1.5;
  camera.position.set(
    Math.cos(cameraAngle) * cameraDistance,
    camY,
    Math.sin(cameraAngle) * cameraDistance
  );
  camera.lookAt(0, 1, 0);

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
  composer.render();
}

animate();
