import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ── Config ──────────────────────────────────────────────────────────────
const SURFACE_SIZE = 8;
const SURFACE_RES = 256;
const LEARNING_RATE = 0.035;
const NUM_PARTICLES = 6;
const TRAIL_LENGTH = 300;

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
  new THREE.Vector2(innerWidth, innerHeight), 1.5, 0.4, 0.2
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ── Loss function: Styblinski-Tang (shifted) + interesting minima ───────
function lossFunction(x, z) {
  const scale = 1.2;
  const sx = x * scale, sz = z * scale;
  const st = (sx ** 4 - 16 * sx ** 2 + 5 * sx + sz ** 4 - 16 * sz ** 2 + 5 * sz) / 2;
  const bump = 2.0 * Math.exp(-((sx - 1.5) ** 2 + (sz - 1.5) ** 2) * 0.8);
  const ripple = 0.3 * Math.sin(sx * 3) * Math.cos(sz * 3);
  return (st / 40 + 2) + bump + ripple;
}

function gradient(x, z) {
  const h = 0.001;
  const dfdx = (lossFunction(x + h, z) - lossFunction(x - h, z)) / (2 * h);
  const dfdz = (lossFunction(x, z + h) - lossFunction(x, z - h)) / (2 * h);
  return [dfdx, dfdz];
}

// ── Surface mesh ────────────────────────────────────────────────────────
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

// Color the surface by height
const colors = new Float32Array(positions.count * 3);
for (let i = 0; i < positions.count; i++) {
  const y = positions.getY(i);
  const t = (y - yMin) / (yMax - yMin);

  const c = new THREE.Color();
  if (t < 0.25) {
    c.lerpColors(new THREE.Color(0x0a0a3e), new THREE.Color(0x1a3a8a), t / 0.25);
  } else if (t < 0.5) {
    c.lerpColors(new THREE.Color(0x1a3a8a), new THREE.Color(0x2d8cf0), (t - 0.25) / 0.25);
  } else if (t < 0.75) {
    c.lerpColors(new THREE.Color(0x2d8cf0), new THREE.Color(0x60e0ff), (t - 0.5) / 0.25);
  } else {
    c.lerpColors(new THREE.Color(0x60e0ff), new THREE.Color(0xffffff), (t - 0.75) / 0.25);
  }
  colors[i * 3] = c.r;
  colors[i * 3 + 1] = c.g;
  colors[i * 3 + 2] = c.b;
}
surfaceGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

const surfaceMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  metalness: 0.3,
  roughness: 0.4,
  wireframe: false,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
});
const surface = new THREE.Mesh(surfaceGeo, surfaceMat);
scene.add(surface);

// ── Wireframe overlay ───────────────────────────────────────────────────
const wireGeo = new THREE.PlaneGeometry(SURFACE_SIZE * 2, SURFACE_SIZE * 2, 64, 64);
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

    // Point light on particle
    this.light = new THREE.PointLight(color, 1.5, 3);
    scene.add(this.light);

    // Trail
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

    // Momentum-based update
    this.vx = this.momentum * this.vx - LEARNING_RATE * gx;
    this.vz = this.momentum * this.vz - LEARNING_RATE * gz;

    // Add small noise for visual interest
    this.vx += (Math.random() - 0.5) * 0.002;
    this.vz += (Math.random() - 0.5) * 0.002;

    this.x += this.vx;
    this.z += this.vz;

    // Clamp to surface bounds
    this.x = Math.max(-SURFACE_SIZE, Math.min(SURFACE_SIZE, this.x));
    this.z = Math.max(-SURFACE_SIZE, Math.min(SURFACE_SIZE, this.z));

    this.y = lossFunction(this.x, this.z);
    this.iteration++;

    if (gradMag < 0.01 && this.iteration > 50) {
      this.converged = true;
    }

    // Update trail
    this.trailPositions.push(new THREE.Vector3(this.x, this.y + 0.05, this.z));
    if (this.trailPositions.length > TRAIL_LENGTH) {
      this.trailPositions.shift();
    }
  }

  updateVisuals() {
    // Smooth ball position
    this.mesh.position.set(this.x, this.y + 0.12, this.z);
    this.light.position.copy(this.mesh.position);
    this.light.position.y += 0.3;

    // Pulse effect
    const pulse = 1 + 0.15 * Math.sin(performance.now() * 0.005 + this.x);
    this.mesh.scale.setScalar(pulse);
    this.light.intensity = 1.0 + 0.5 * pulse;

    // Emissive intensity based on speed
    const speed = Math.sqrt(this.vx ** 2 + this.vz ** 2);
    this.mesh.material.emissiveIntensity = 1.5 + speed * 20;

    // Update trail geometry
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
  const levels = 12;
  for (let l = 0; l < levels; l++) {
    const targetY = yMin + (l + 1) * (yMax - yMin) / (levels + 1);
    const points = [];
    const res = 200;
    const step = (SURFACE_SIZE * 2) / res;

    for (let ix = 0; ix < res; ix++) {
      for (let iz = 0; iz < res; iz++) {
        const x = -SURFACE_SIZE + ix * step;
        const z = -SURFACE_SIZE + iz * step;
        const y00 = lossFunction(x, z);
        const y10 = lossFunction(x + step, z);
        const y01 = lossFunction(x, z + step);

        // Simple marching: check edge crossings
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
        new THREE.Color(0x0a2a6a), new THREE.Color(0x60e0ff), tNorm
      );
      const mat = new THREE.PointsMaterial({
        color,
        size: 0.015,
        transparent: true,
        opacity: 0.35,
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

// ── Camera controls ─────────────────────────────────────────────────────
let cameraAngle = 0.6;
let cameraHeight = 7;
let cameraDistance = 12;
let targetDistance = 12;
let autoRotate = true;

window.addEventListener('wheel', (e) => {
  targetDistance += e.deltaY * 0.01;
  targetDistance = Math.max(5, Math.min(25, targetDistance));
});

window.addEventListener('click', () => {
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
const STEP_INTERVAL = 0.05; // seconds between gradient steps

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();

  // Gradient descent steps at fixed interval
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

  // Bloom pulse
  bloom.strength = 1.3 + 0.3 * Math.sin(t * 0.5);

  updateStats();
  composer.render();
}

animate();
