/**
 * Turns a CityModel (plus its theme) into a handful of GPU-instanced meshes.
 * Built imperatively (not as thousands of JSX nodes) so a 15k-building city
 * is a few dozen draw calls, and so everything can be disposed in one place.
 */
import * as THREE from "three";
import { languageOf } from "@/lib/languages";
import { LANDMARK_INFO } from "@/lib/city/profile";
import { seededRandom } from "@/lib/city/random";
import type { Building, CityModel } from "@/lib/city/types";
import {
  beamFragment,
  beamVertex,
  buildingFragment,
  buildingVertex,
  lineFragment,
  lineVertex,
  trafficFragment,
  trafficVertex,
  waterFragment,
  waterVertex,
} from "./shaders";
import type { SceneTheme } from "./theme";

export interface CityUniforms {
  uTime: THREE.IUniform<number>;
  uReveal: THREE.IUniform<number>;
  uHover: THREE.IUniform<number>;
  uSelected: THREE.IUniform<number>;
  uPixelRatio: THREE.IUniform<number>;
}

export interface CityMeshes {
  group: THREE.Group;
  /** Pickable tower bodies; `bodyToBuilding[instanceId]` gives the building index. */
  bodies: THREE.InstancedMesh;
  bodyToBuilding: Int32Array;
  uniforms: CityUniforms;
  /** Seconds until the last building has risen and lit up. */
  revealDuration: number;
  dispose(): void;
}

const ROOT_LIFT = 1.2; // plates extend below ground so islands rise out of the water
const NO_BUILDING = -9; // aBuilding for decorative instances (never hovered or selected)

function fogUniforms() {
  return {
    fogColor: { value: new THREE.Color() },
    fogNear: { value: 1 },
    fogFar: { value: 2000 },
    fogDensity: { value: 0.00025 },
  };
}

function buildingMaterial(kind: number, uniforms: CityUniforms, theme: SceneTheme) {
  const style = theme.style;
  return new THREE.ShaderMaterial({
    vertexShader: buildingVertex,
    fragmentShader: buildingFragment,
    defines: { KIND: kind },
    uniforms: {
      ...uniforms,
      uBody: { value: new THREE.Color(style.body) },
      uWindowLight: { value: new THREE.Color(style.windowLight) },
      uWindowMix: { value: style.windowMix },
      uHueJitter: { value: style.windowHueJitter },
      uActivity: { value: theme.activity },
      uRuin: { value: theme.ruined ? 1 : 0 },
      ...fogUniforms(),
    },
    fog: true,
  });
}

/** Unit geometries with their base on y = 0 and unit extents, so instance scale = real size. */
function unitGeometries() {
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // Square pyramid whose base exactly covers a unit square.
  const spire = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const dome = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1);
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 20).translate(0, 0.5, 0);
  return { box, spire, dome, cylinder };
}

interface InstanceSpec {
  building: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotX?: number;
  rotY?: number;
  /** Overrides the building's language color. */
  color?: THREE.Color;
  /** Overrides params: [seed, variant/window style, delay, cluster]. */
  params?: [number, number, number, number];
}

function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  specs: InstanceSpec[],
  color: Float32Array,
  params: Float32Array,
) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, specs.length));
  mesh.count = specs.length;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const aBuilding = new Float32Array(specs.length);
  const aColor = new Float32Array(specs.length * 3);
  const aParams = new Float32Array(specs.length * 4);
  specs.forEach((spec, i) => {
    q.setFromEuler(e.set(spec.rotX ?? 0, spec.rotY ?? 0, 0));
    m.compose(p.set(spec.x, spec.y, spec.z), q, s.set(Math.max(spec.sx, 1e-3), Math.max(spec.sy, 1e-3), Math.max(spec.sz, 1e-3)));
    mesh.setMatrixAt(i, m);
    const b = spec.building;
    aBuilding[i] = b;
    if (spec.color) aColor.set([spec.color.r, spec.color.g, spec.color.b], i * 3);
    else if (b >= 0) aColor.set(color.subarray(b * 3, b * 3 + 3), i * 3);
    if (spec.params) aParams.set(spec.params, i * 4);
    else if (b >= 0) aParams.set(params.subarray(b * 4, b * 4 + 4), i * 4);
  });
  // Instanced attributes live on a per-mesh geometry clone so meshes can share unit shapes.
  const geo = geometry.clone();
  geo.setAttribute("aBuilding", new THREE.InstancedBufferAttribute(aBuilding, 1));
  geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(aColor, 3));
  geo.setAttribute("aParams", new THREE.InstancedBufferAttribute(aParams, 4));
  mesh.geometry = geo;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return { mesh, aBuilding };
}

const PROP_COLORS = {
  stack: new THREE.Color("#2b2522"),
  tank: new THREE.Color("#3a3f46"),
  solar: new THREE.Color("#0d2240"),
  garden: new THREE.Color("#1f5a2a"),
};

/** Rooftop ornaments for one building, by roof kind. */
function roofSpecs(b: Building, delay: number, out: Record<string, InstanceSpec[]>) {
  const top = b.tiers[b.tiers.length - 1]!;
  const roofY = b.baseY + top.y + top.height;
  const side = Math.min(top.width, top.depth);
  const rnd = seededRandom(Math.floor(b.seed * 1e9) ^ 0x2f);
  const prop = (variant: number): [number, number, number, number] => [b.seed, variant, delay, 0];
  switch (b.roof) {
    case "spire":
      out.spire!.push({ building: b.index, x: b.x, y: roofY, z: b.z, sx: top.width * 0.9, sy: b.roofHeight, sz: top.depth * 0.9 });
      break;
    case "pyramid":
      out.spire!.push({ building: b.index, x: b.x, y: roofY, z: b.z, sx: top.width * 0.98, sy: b.roofHeight, sz: top.depth * 0.98 });
      break;
    case "dome":
      out.dome!.push({ building: b.index, x: b.x, y: roofY, z: b.z, sx: side * 0.8, sy: b.roofHeight, sz: side * 0.8 });
      break;
    case "crown":
      out.cap!.push({ building: b.index, x: b.x, y: roofY, z: b.z, sx: top.width * 0.55, sy: b.roofHeight, sz: top.depth * 0.55 });
      break;
    case "helipad":
      out.pad!.push({ building: b.index, x: b.x, y: roofY, z: b.z, sx: side * 0.82, sy: b.roofHeight, sz: side * 0.82 });
      break;
    case "antenna": {
      const offset = (b.seed - 0.5) * top.width * 0.4;
      out.cap!.push({ building: b.index, x: b.x, y: roofY, z: b.z, sx: top.width * 0.35, sy: 0.35, sz: top.depth * 0.35 });
      out.mast!.push({ building: b.index, x: b.x + offset * 0.3, y: roofY, z: b.z, sx: 0.09, sy: b.roofHeight, sz: 0.09 });
      break;
    }
    case "smokestack": {
      const count = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < count; i++) {
        const r = side * (0.1 + 0.08 * rnd());
        const ox = (rnd() - 0.5) * (top.width - r * 2) * 0.8;
        const oz = (rnd() - 0.5) * (top.depth - r * 2) * 0.8;
        const h = b.roofHeight * (0.6 + 0.4 * rnd());
        out.prop!.push({ building: b.index, x: b.x + ox, y: roofY, z: b.z + oz, sx: r * 2, sy: h, sz: r * 2, color: PROP_COLORS.stack, params: prop(1) });
      }
      break;
    }
    case "tanks": {
      const count = 1 + Math.floor(rnd() * 2);
      for (let i = 0; i < count; i++) {
        const r = side * (0.14 + 0.06 * rnd());
        const ox = (rnd() - 0.5) * (top.width - r * 2) * 0.7;
        const oz = (rnd() - 0.5) * (top.depth - r * 2) * 0.7;
        out.prop!.push({ building: b.index, x: b.x + ox, y: roofY, z: b.z + oz, sx: r * 2, sy: b.roofHeight, sz: r * 2, color: PROP_COLORS.tank, params: prop(0) });
      }
      break;
    }
    case "solar":
      out.prop!.push({
        building: b.index, x: b.x, y: roofY + 0.18, z: b.z, sx: top.width * 0.82, sy: 0.06, sz: top.depth * 0.7,
        rotX: -0.32, color: PROP_COLORS.solar, params: prop(2),
      });
      break;
    case "garden":
      out.prop!.push({
        building: b.index, x: b.x, y: roofY, z: b.z, sx: top.width * 0.86, sy: b.roofHeight, sz: top.depth * 0.86,
        color: PROP_COLORS.garden, params: prop(3),
      });
      break;
    default:
      break;
  }
}

export function buildCityMeshes(city: CityModel, theme: SceneTheme, options: { reducedMotion: boolean }): CityMeshes {
  const uniforms: CityUniforms = {
    uTime: { value: 0 },
    uReveal: { value: options.reducedMotion ? 1000 : -0.25 },
    uHover: { value: -1 },
    uSelected: { value: -1 },
    uPixelRatio: { value: 1 },
  };
  const group = new THREE.Group();
  group.name = "city";
  const disposables: { dispose(): void }[] = [];
  const geos = unitGeometries();
  disposables.push(...Object.values(geos));
  const accentA = new THREE.Color(theme.accents[0]);
  const accentB = new THREE.Color(theme.accents[1]);
  const c = new THREE.Color();

  // Reveal order: districts light up from the center outward, buildings rise shortly after.
  const radius = Math.max(city.radius, 1);
  const districtDelay = city.districts.map((d) => {
    const top = d.topLevel >= 0 ? city.districts[d.topLevel]! : d;
    const cx = top.rect.x + top.rect.w / 2 - city.center.x;
    const cz = top.rect.z + top.rect.d / 2 - city.center.z;
    return 0.15 + 1.7 * Math.min(1, Math.hypot(cx, cz) / radius) + 0.15 * Math.min(d.depth, 4);
  });

  const color = new Float32Array(city.buildings.length * 3);
  const params = new Float32Array(city.buildings.length * 4);
  for (const b of city.buildings) {
    c.set(b.cluster ? "#4b6275" : languageOf(b.language).color);
    color.set([c.r, c.g, c.b], b.index * 3);
    const delay = districtDelay[b.districtIndex]! + 0.25 + 0.55 * b.seed;
    params.set([b.seed, b.windowStyle, delay, b.cluster ? 1 : 0], b.index * 4);
  }
  let lastDelay = 0;
  for (let i = 0; i < city.buildings.length; i++) lastDelay = Math.max(lastDelay, params[i * 4 + 2]!);
  const revealDuration = lastDelay + 2.4;

  // --- Buildings ------------------------------------------------------------
  const specs: Record<string, InstanceSpec[]> = { body: [], cap: [], spire: [], dome: [], mast: [], pad: [], prop: [] };
  for (const b of city.buildings) {
    for (const tier of b.tiers) {
      specs.body!.push({ building: b.index, x: b.x, y: b.baseY + tier.y, z: b.z, sx: tier.width, sy: tier.height, sz: tier.depth });
    }
    roofSpecs(b, params[b.index * 4 + 2]!, specs);
  }

  // Suburbs: one small settlement per few forks, out past the ring road (decorative).
  if (theme.suburbs > 0) {
    const rnd = seededRandom(theme.seed ^ 0x5b);
    const dim = accentB.clone().multiplyScalar(0.55);
    const scale = THREE.MathUtils.clamp(city.radius / 90, 0.35, 1); // small cities get small villages
    for (let k = 0; k < theme.suburbs; k++) {
      const angle = (k / theme.suburbs) * Math.PI * 2 + rnd() * 0.4;
      const dist = city.radius * (1.25 + rnd() * 0.5) + 20 * scale;
      const cx = city.center.x + Math.cos(angle) * dist;
      const cz = city.center.z + Math.sin(angle) * dist;
      const count = 6 + Math.floor(rnd() * 14);
      for (let i = 0; i < count; i++) {
        const w = (1.6 + rnd() * 2.4) * scale;
        const h = (1 + rnd() * 5) * scale;
        specs.body!.push({
          building: NO_BUILDING,
          x: cx + (rnd() - 0.5) * 22 * scale,
          y: 0,
          z: cz + (rnd() - 0.5) * 22 * scale,
          sx: w,
          sy: h,
          sz: w * (0.7 + rnd() * 0.6),
          color: dim,
          params: [rnd(), Math.floor(rnd() * 4), lastDelay + rnd() * 1.2, 0],
        });
      }
    }
  }

  const materials = [0, 1, 2, 3, 4, 6].map((kind) => buildingMaterial(kind, uniforms, theme));
  disposables.push(...materials);
  const [bodyMat, capMat, glowMat, mastMat, padMat, propMat] = materials as [THREE.ShaderMaterial, ...THREE.ShaderMaterial[]];
  const bodies = instanced(geos.box, bodyMat, specs.body!, color, params);
  bodies.mesh.name = "bodies";
  // Props split by shape: cylinders (tanks, smokestacks), panels (solar), domes (gardens).
  const propSpecs = specs.prop!;
  const parts = [
    instanced(geos.box, capMat!, specs.cap!, color, params),
    instanced(geos.spire, glowMat!, specs.spire!, color, params),
    instanced(geos.dome, glowMat!, specs.dome!, color, params),
    instanced(geos.box, mastMat!, specs.mast!, color, params),
    instanced(geos.cylinder, padMat!, specs.pad!, color, params),
    instanced(geos.cylinder, propMat!, propSpecs.filter((s) => s.params?.[1] === 0 || s.params?.[1] === 1), color, params),
    instanced(geos.box, propMat!, propSpecs.filter((s) => s.params?.[1] === 2), color, params),
    instanced(geos.dome, propMat!, propSpecs.filter((s) => s.params?.[1] === 3), color, params),
  ];
  for (const part of [bodies, ...parts]) {
    group.add(part.mesh);
    disposables.push(part.mesh.geometry, part.mesh);
  }
  for (const part of parts) part.mesh.raycast = () => {};

  // --- Ground, district plates and water --------------------------------------
  const plateMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.25 });
  disposables.push(plateMaterial);
  const plateRects: { rect: CityModel["bounds"]; top: number; color: THREE.Color }[] = [];
  const rootColor = new THREE.Color(theme.plate).multiplyScalar(0.7);
  for (const g of city.ground) plateRects.push({ rect: g, top: 0.06, color: rootColor });
  for (const d of city.districts) {
    if (d.depth === 0 || d.virtual) continue;
    const tint = new THREE.Color(theme.plate).lerp(new THREE.Color(languageOf(d.dominantLanguage).color), 0.018 + 0.006 * Math.min(d.depth, 3));
    plateRects.push({ rect: d.rect, top: d.elevation + 0.06, color: tint });
  }
  if (city.plaza) {
    const r = city.plaza.radius;
    plateRects.push({ rect: { x: city.plaza.x - r * 0.62, z: city.plaza.z - r * 0.62, w: r * 1.24, d: r * 1.24 }, top: 0.1, color: new THREE.Color(theme.plate).multiplyScalar(1.4) });
  }
  const plates = new THREE.InstancedMesh(geos.box, plateMaterial, Math.max(1, plateRects.length));
  plates.count = plateRects.length;
  const m = new THREE.Matrix4();
  plateRects.forEach(({ rect, top, color: col }, i) => {
    m.makeScale(Math.max(rect.w, 1e-3), top + ROOT_LIFT, Math.max(rect.d, 1e-3));
    m.setPosition(rect.x + rect.w / 2, -ROOT_LIFT, rect.z + rect.d / 2);
    plates.setMatrixAt(i, m);
    plates.setColorAt(i, col);
  });
  plates.instanceMatrix.needsUpdate = true;
  plates.computeBoundingSphere();
  plates.raycast = () => {};
  group.add(plates);

  const waterUniforms = {
    uTime: uniforms.uTime,
    uDeep: { value: new THREE.Color(theme.ground).lerp(accentB, 0.06) },
    uAccentA: { value: accentA.clone().multiplyScalar(0.8) },
    uAccentB: { value: accentB.clone().multiplyScalar(0.8) },
    ...fogUniforms(),
  };
  for (const w of city.water) {
    const geo = new THREE.PlaneGeometry(w.w, w.d, 1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({ vertexShader: waterVertex, fragmentShader: waterFragment, uniforms: waterUniforms, fog: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(w.x + w.w / 2, -0.35, w.z + w.d / 2);
    mesh.raycast = () => {};
    group.add(mesh);
    disposables.push(geo, mat);
  }

  // Bridges: decks plus neon rails.
  if (city.bridges.length) {
    const deckSpecs = city.bridges.map((b) => {
      const len = Math.hypot(b.x2 - b.x1, b.z2 - b.z1);
      return { b, len, angle: Math.atan2(b.z2 - b.z1, b.x2 - b.x1) };
    });
    const decks = new THREE.InstancedMesh(geos.box, plateMaterial, deckSpecs.length);
    const q = new THREE.Quaternion();
    deckSpecs.forEach(({ b, len, angle }, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
      m.compose(new THREE.Vector3((b.x1 + b.x2) / 2, -0.15, (b.z1 + b.z2) / 2), q, new THREE.Vector3(len, 0.42, b.width));
      decks.setMatrixAt(i, m);
      decks.setColorAt(i, new THREE.Color(theme.plate).multiplyScalar(1.3));
    });
    decks.instanceMatrix.needsUpdate = true;
    decks.computeBoundingSphere();
    decks.raycast = () => {};
    group.add(decks);
    disposables.push(decks);
  }

  // --- District outlines (neon streets) and bridge rails ---------------------
  const outlined = city.districts.filter((d) => d.depth > 0 && !d.virtual && d.rect.w > 0.2 && d.rect.d > 0.2);
  const segs: number[] = [];
  const segColors: number[] = [];
  const segDelay: number[] = [];
  const slate = new THREE.Color("#3b5566");
  const landmarkColor = (kind: keyof typeof LANDMARK_INFO) => new THREE.Color(LANDMARK_INFO[kind].color);
  for (const d of outlined) {
    const y = d.elevation + 0.075;
    const { x, z, w, d: dd } = d.rect;
    const corners = [[x, z], [x + w, z], [x + w, z], [x + w, z + dd], [x + w, z + dd], [x, z + dd], [x, z + dd], [x, z]];
    const isTop = d.depth === 1 || (d.parent >= 0 && city.districts[d.parent]!.virtual);
    const base = d.landmark ? landmarkColor(d.landmark) : isTop ? accentA : d.depth === 2 ? accentB : slate;
    const strength = d.landmark ? 1.9 : isTop ? 1.6 : d.depth === 2 ? 0.9 : 0.55;
    for (const [cx, cz] of corners) {
      segs.push(cx!, y, cz!);
      segColors.push(base.r * strength, base.g * strength, base.b * strength);
      segDelay.push(districtDelay[d.index]!);
    }
  }
  for (const b of city.bridges) {
    const len = Math.hypot(b.x2 - b.x1, b.z2 - b.z1) || 1;
    const nx = (-(b.z2 - b.z1) / len) * (b.width / 2);
    const nz = ((b.x2 - b.x1) / len) * (b.width / 2);
    for (const side of [1, -1]) {
      segs.push(b.x1 + nx * side, 0.05, b.z1 + nz * side, b.x2 + nx * side, 0.05, b.z2 + nz * side);
      for (let k = 0; k < 2; k++) {
        segColors.push(accentB.r * 1.4, accentB.g * 1.4, accentB.b * 1.4);
        segDelay.push(0.6);
      }
    }
  }
  if (city.plaza) {
    const { x, z, radius: r } = city.plaza;
    for (const rr of [r * 0.62, r * 0.42]) {
      const n = 48;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2;
        const a1 = ((k + 1) / n) * Math.PI * 2;
        segs.push(x + Math.cos(a0) * rr, 0.13, z + Math.sin(a0) * rr, x + Math.cos(a1) * rr, 0.13, z + Math.sin(a1) * rr);
        for (let j = 0; j < 2; j++) {
          segColors.push(accentA.r * 1.5, accentA.g * 1.5, accentA.b * 1.5);
          segDelay.push(0.2);
        }
      }
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
  lineGeo.setAttribute("aColor", new THREE.Float32BufferAttribute(segColors, 3));
  lineGeo.setAttribute("aDelay", new THREE.Float32BufferAttribute(segDelay, 1));
  const lineMat = new THREE.ShaderMaterial({
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    uniforms: { uReveal: uniforms.uReveal, ...fogUniforms() },
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.raycast = () => {};
  group.add(lines);
  disposables.push(lineGeo, lineMat);

  // --- Landmark beams --------------------------------------------------------
  const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, true).translate(0, 0.5, 0);
  disposables.push(beamGeo);
  const beamHeight = Math.max(80, city.maxHeight * 3);
  for (const l of city.landmarks) {
    const info = LANDMARK_INFO[l.kind];
    const mat = new THREE.ShaderMaterial({
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      uniforms: { uColor: { value: new THREE.Color(info.color) }, uIntensity: { value: theme.ruined ? 0.15 : 0.55 }, uTime: uniforms.uTime },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const b = l.building !== undefined ? city.buildings[l.building] : undefined;
    const width = b ? Math.max(0.8, Math.min(b.width, b.depth) * 0.45) : 2.4;
    const beam = new THREE.Mesh(beamGeo, mat);
    beam.position.set(l.x, l.y, l.z);
    beam.scale.set(width, beamHeight, width);
    beam.raycast = () => {};
    beam.renderOrder = 2;
    group.add(beam);
    disposables.push(mat);
  }

  // --- Traffic ---------------------------------------------------------------
  const lanes: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  for (const s of city.streets) {
    const dx = s.x2 - s.x1;
    const dz = s.z2 - s.z1;
    const len = Math.hypot(dx, dz);
    if (len < 4) continue;
    const nx = (-dz / len) * 0.55;
    const nz = (dx / len) * 0.55;
    const y = 0.14;
    // Two lanes in opposite directions.
    lanes.push({ a: new THREE.Vector3(s.x1 + nx, y, s.z1 + nz), b: new THREE.Vector3(s.x2 + nx, y, s.z2 + nz) });
    lanes.push({ a: new THREE.Vector3(s.x2 - nx, y, s.z2 - nz), b: new THREE.Vector3(s.x1 - nx, y, s.z1 - nz) });
  }
  const palette = [accentA, accentB, new THREE.Color("#ffb547"), new THREE.Color("#e8f6ff"), new THREE.Color("#ff4d8d")];
  const cars: number[][] = [];
  let carSeed = 1;
  const rnd = () => ((carSeed = (carSeed * 16807) % 2147483647) / 2147483647);
  // Busy repositories have rush-hour traffic; dormant ones a trickle.
  const maxCars = Math.round(1600 * theme.activity);
  const totalLength = lanes.reduce((n, l) => n + l.a.distanceTo(l.b), 0);
  const density = Math.min((1 / 9) * theme.activity, maxCars / Math.max(totalLength, 1));
  for (const lane of lanes) {
    const len = lane.a.distanceTo(lane.b);
    const count = Math.round(len * density + rnd() * 0.6);
    for (let k = 0; k < count; k++) {
      const speed = (5 + rnd() * 7) / len;
      const col = palette[Math.floor(rnd() * palette.length)]!;
      cars.push([lane.a.x, lane.a.y, lane.a.z, lane.b.x, lane.b.y, lane.b.z, speed, rnd(), col.r, col.g, col.b]);
    }
  }
  const trafficGeo = new THREE.BufferGeometry();
  const aStart = new Float32Array(cars.length * 3);
  const aEnd = new Float32Array(cars.length * 3);
  const aMotion = new Float32Array(cars.length * 2);
  const aCarColor = new Float32Array(cars.length * 3);
  cars.forEach((car, i) => {
    aStart.set(car.slice(0, 3), i * 3);
    aEnd.set(car.slice(3, 6), i * 3);
    aMotion.set(car.slice(6, 8), i * 2);
    aCarColor.set(car.slice(8, 11), i * 3);
  });
  trafficGeo.setAttribute("position", new THREE.BufferAttribute(aStart.slice(), 3));
  trafficGeo.setAttribute("aStart", new THREE.BufferAttribute(aStart, 3));
  trafficGeo.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 3));
  trafficGeo.setAttribute("aMotion", new THREE.BufferAttribute(aMotion, 2));
  trafficGeo.setAttribute("aColor", new THREE.BufferAttribute(aCarColor, 3));
  trafficGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(city.center.x, 0, city.center.z), city.radius + 10);
  const trafficMat = new THREE.ShaderMaterial({
    vertexShader: trafficVertex,
    fragmentShader: trafficFragment,
    uniforms: { uTime: uniforms.uTime, uReveal: uniforms.uReveal, uPixelRatio: uniforms.uPixelRatio, ...fogUniforms() },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const traffic = new THREE.Points(trafficGeo, trafficMat);
  traffic.name = "traffic";
  traffic.visible = !options.reducedMotion && !theme.ruined && cars.length > 0;
  traffic.raycast = () => {};
  group.add(traffic);
  disposables.push(trafficGeo, trafficMat);

  return {
    group,
    bodies: bodies.mesh,
    bodyToBuilding: Int32Array.from(bodies.aBuilding),
    uniforms,
    revealDuration,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
