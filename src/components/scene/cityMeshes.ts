/**
 * Turns a CityModel into a handful of GPU-instanced meshes. Built
 * imperatively (not as thousands of JSX nodes) so a 15k-building city is
 * ~10 draw calls, and so everything can be disposed in one place.
 */
import * as THREE from "three";
import { languageOf } from "@/lib/languages";
import type { Building, CityModel } from "@/lib/city/types";
import { buildingFragment, buildingVertex, lineFragment, lineVertex, trafficFragment, trafficVertex } from "./shaders";

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

const PLATE_COLOR = new THREE.Color("#0a1218");
const ROOT_COLOR = new THREE.Color("#070d12");
const EMERALD = new THREE.Color("#31E6B0");
const CYAN = new THREE.Color("#31BDE6");
const SLATE = new THREE.Color("#3b5566");

function fogUniforms() {
  return {
    fogColor: { value: new THREE.Color() },
    fogNear: { value: 1 },
    fogFar: { value: 2000 },
    fogDensity: { value: 0.00025 },
  };
}

function buildingMaterial(kind: number, uniforms: CityUniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: buildingVertex,
    fragmentShader: buildingFragment,
    defines: { KIND: kind },
    uniforms: { ...uniforms, ...fogUniforms() },
    fog: true,
  });
}

/** Unit geometries with their base on y = 0 and unit extents, so instance scale = real size. */
function unitGeometries() {
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // Square pyramid whose base exactly covers a unit square.
  const spire = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const dome = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1);
  const pad = new THREE.CylinderGeometry(0.5, 0.5, 1, 24).translate(0, 0.5, 0);
  return { box, spire, dome, pad };
}

interface InstanceSpec {
  building: Building;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, specs: InstanceSpec[], perBuilding: Float32Array[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, specs.length));
  mesh.count = specs.length;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const [color, params] = perBuilding as [Float32Array, Float32Array];
  const aBuilding = new Float32Array(specs.length);
  const aColor = new Float32Array(specs.length * 3);
  const aParams = new Float32Array(specs.length * 4);
  specs.forEach((spec, i) => {
    m.compose(p.set(spec.x, spec.y, spec.z), q, s.set(Math.max(spec.sx, 1e-3), Math.max(spec.sy, 1e-3), Math.max(spec.sz, 1e-3)));
    mesh.setMatrixAt(i, m);
    const b = spec.building.index;
    aBuilding[i] = b;
    aColor.set(color.subarray(b * 3, b * 3 + 3), i * 3);
    aParams.set(params.subarray(b * 4, b * 4 + 4), i * 4);
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

export function buildCityMeshes(city: CityModel, options: { reducedMotion: boolean }): CityMeshes {
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
  const c = new THREE.Color();
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
  const bodySpecs: InstanceSpec[] = [];
  const capSpecs: InstanceSpec[] = [];
  const spireSpecs: InstanceSpec[] = [];
  const domeSpecs: InstanceSpec[] = [];
  const mastSpecs: InstanceSpec[] = [];
  const padSpecs: InstanceSpec[] = [];
  for (const b of city.buildings) {
    for (const tier of b.tiers) {
      bodySpecs.push({ building: b, x: b.x, y: b.baseY + tier.y, z: b.z, sx: tier.width, sy: tier.height, sz: tier.depth });
    }
    const top = b.tiers[b.tiers.length - 1]!;
    const roofY = b.baseY + top.y + top.height;
    const side = Math.min(top.width, top.depth);
    switch (b.roof) {
      case "spire":
        spireSpecs.push({ building: b, x: b.x, y: roofY, z: b.z, sx: top.width * 0.9, sy: b.roofHeight, sz: top.depth * 0.9 });
        break;
      case "dome":
        domeSpecs.push({ building: b, x: b.x, y: roofY, z: b.z, sx: side * 0.8, sy: b.roofHeight, sz: side * 0.8 });
        break;
      case "crown":
        capSpecs.push({ building: b, x: b.x, y: roofY, z: b.z, sx: top.width * 0.55, sy: b.roofHeight, sz: top.depth * 0.55 });
        break;
      case "helipad":
        padSpecs.push({ building: b, x: b.x, y: roofY, z: b.z, sx: side * 0.82, sy: b.roofHeight, sz: side * 0.82 });
        break;
      case "antenna": {
        const offset = (b.seed - 0.5) * top.width * 0.4;
        capSpecs.push({ building: b, x: b.x, y: roofY, z: b.z, sx: top.width * 0.35, sy: 0.35, sz: top.depth * 0.35 });
        mastSpecs.push({ building: b, x: b.x + offset * 0.3, y: roofY, z: b.z, sx: 0.09, sy: b.roofHeight, sz: 0.09 });
        break;
      }
      default:
        break;
    }
  }

  const materials = [0, 1, 2, 3, 4].map((kind) => buildingMaterial(kind, uniforms));
  disposables.push(...materials);
  const per = [color, params];
  const bodies = instanced(geos.box, materials[0]!, bodySpecs, per);
  bodies.mesh.name = "bodies";
  const parts = [
    instanced(geos.box, materials[1]!, capSpecs, per),
    instanced(geos.spire, materials[2]!, spireSpecs, per),
    instanced(geos.dome, materials[2]!, domeSpecs, per),
    instanced(geos.box, materials[3]!, mastSpecs, per),
    instanced(geos.pad, materials[4]!, padSpecs, per),
  ];
  for (const part of [bodies, ...parts]) {
    group.add(part.mesh);
    disposables.push(part.mesh.geometry, part.mesh);
  }
  for (const part of parts) part.mesh.raycast = () => {};

  // --- District plates ------------------------------------------------------
  const plateMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.25 });
  disposables.push(plateMaterial);
  const plates = new THREE.InstancedMesh(geos.box, plateMaterial, city.districts.length);
  const m = new THREE.Matrix4();
  city.districts.forEach((d, i) => {
    const thickness = d.elevation + 0.06;
    m.makeScale(Math.max(d.rect.w, 1e-3), thickness, Math.max(d.rect.d, 1e-3));
    m.setPosition(d.rect.x + d.rect.w / 2, 0, d.rect.z + d.rect.d / 2);
    plates.setMatrixAt(i, m);
    if (d.depth === 0) c.copy(ROOT_COLOR);
    else c.copy(PLATE_COLOR).lerp(new THREE.Color(languageOf(d.dominantLanguage).color), 0.018 + 0.006 * Math.min(d.depth, 3));
    plates.setColorAt(i, c);
  });
  plates.instanceMatrix.needsUpdate = true;
  plates.computeBoundingSphere();
  plates.raycast = () => {};
  plates.receiveShadow = false;
  group.add(plates);

  // --- District outlines (neon streets) -------------------------------------
  const outlined = city.districts.filter((d) => d.depth > 0 && d.rect.w > 0.2 && d.rect.d > 0.2);
  const linePos = new Float32Array(outlined.length * 8 * 3);
  const lineColor = new Float32Array(outlined.length * 8 * 3);
  const lineDelay = new Float32Array(outlined.length * 8);
  outlined.forEach((d, i) => {
    const y = d.elevation + 0.075;
    const { x, z, w, d: dd } = d.rect;
    const corners = [
      [x, z], [x + w, z], [x + w, z], [x + w, z + dd], [x + w, z + dd], [x, z + dd], [x, z + dd], [x, z],
    ];
    const base = d.depth === 1 ? EMERALD : d.depth === 2 ? CYAN : SLATE;
    const strength = d.depth === 1 ? 1.6 : d.depth === 2 ? 0.9 : 0.55;
    corners.forEach(([cx, cz], k) => {
      linePos.set([cx!, y, cz!], (i * 8 + k) * 3);
      lineColor.set([base.r * strength, base.g * strength, base.b * strength], (i * 8 + k) * 3);
      lineDelay[i * 8 + k] = districtDelay[d.index]!;
    });
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute("aColor", new THREE.BufferAttribute(lineColor, 3));
  lineGeo.setAttribute("aDelay", new THREE.BufferAttribute(lineDelay, 1));
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

  // --- Traffic ---------------------------------------------------------------
  const lanes: { a: THREE.Vector3; b: THREE.Vector3; level: number }[] = [];
  for (const s of city.streets) {
    const dx = s.x2 - s.x1;
    const dz = s.z2 - s.z1;
    const len = Math.hypot(dx, dz);
    if (len < 4) continue;
    const nx = (-dz / len) * 0.55;
    const nz = (dx / len) * 0.55;
    const y = 0.14;
    // Two lanes in opposite directions.
    lanes.push({ a: new THREE.Vector3(s.x1 + nx, y, s.z1 + nz), b: new THREE.Vector3(s.x2 + nx, y, s.z2 + nz), level: s.level });
    lanes.push({ a: new THREE.Vector3(s.x2 - nx, y, s.z2 - nz), b: new THREE.Vector3(s.x1 - nx, y, s.z1 - nz), level: s.level });
  }
  const palette = [EMERALD, CYAN, new THREE.Color("#ffb547"), new THREE.Color("#e8f6ff"), new THREE.Color("#ff4d8d")];
  const cars: number[][] = [];
  let carSeed = 1;
  const rnd = () => ((carSeed = (carSeed * 16807) % 2147483647) / 2147483647);
  const maxCars = 1600;
  const totalLength = lanes.reduce((n, l) => n + l.a.distanceTo(l.b), 0);
  const density = Math.min(1 / 9, maxCars / Math.max(totalLength, 1));
  for (const lane of lanes) {
    const len = lane.a.distanceTo(lane.b);
    const count = Math.max(1, Math.round(len * density));
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
  traffic.visible = !options.reducedMotion;
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
