"use client";

/** Sky, weather and searchlights: the parts of a city's mood that move every frame. */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { seededRandom } from "@/lib/city/random";
import type { CityModel } from "@/lib/city/types";
import { beamFragment, beamVertex, skyFragment, skyVertex, weatherFragment, weatherVertex } from "./shaders";
import type { SceneTheme } from "./theme";

export function SkyDome({ theme }: { theme: SceneTheme }) {
  const mesh = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        uniforms: {
          uZenith: { value: new THREE.Color(theme.sky.zenith) },
          uHorizon: { value: new THREE.Color(theme.sky.horizon) },
          uGlow: { value: new THREE.Color(theme.sky.glow) },
          uGlowDir: { value: new THREE.Vector3(...theme.sky.glowDir) },
          uStars: { value: theme.sky.stars },
          uAurora: { value: theme.sky.aurora ? 1 : 0 },
          uMoon: { value: theme.sky.moon ? 1 : 0 },
          uTime: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [theme],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, dt) => {
    material.uniforms.uTime!.value += dt;
    // The dome rides with the camera so it's always infinitely far away.
    mesh.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={mesh} material={material} renderOrder={-100} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[100, 32, 16]} />
    </mesh>
  );
}

const WEATHER = {
  rain: { count: 5000, fall: 48, drift: 0.25, size: 150, height: 90, color: "#a9c8ff", opacity: 0.32, streak: 1.4, points: false, pointSize: 0 },
  snow: { count: 3200, fall: 3.2, drift: 1.6, size: 140, height: 80, color: "#f2f7ff", opacity: 0.85, streak: 0, points: true, pointSize: 0.5 },
  haze: { count: 1600, fall: -0.7, drift: 2.4, size: 160, height: 60, color: "#ffd9a8", opacity: 0.22, streak: 0, points: true, pointSize: 0.9 },
} as const;

/** Rain streaks, snowflakes or drifting haze motes in a box that wraps around the camera. */
export function Weather({ theme, reducedMotion }: { theme: SceneTheme; reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const kind = theme.weather === "clear" || reducedMotion ? null : theme.weather;
  const object = useMemo(() => {
    if (!kind) return null;
    const cfg = WEATHER[kind];
    const rnd = seededRandom(theme.seed ^ 0x77);
    const perDrop = cfg.points ? 1 : 2;
    const positions = new Float32Array(cfg.count * perDrop * 3);
    const seeds = new Float32Array(cfg.count * perDrop * 4);
    for (let i = 0; i < cfg.count; i++) {
      const sd = [rnd(), rnd(), rnd(), rnd()];
      for (let v = 0; v < perDrop; v++) {
        const k = i * perDrop + v;
        positions[k * 3 + 1] = v === 1 ? cfg.streak : 0;
        seeds.set(sd, k * 4);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    const tint = kind === "haze" ? new THREE.Color(cfg.color).lerp(new THREE.Color(theme.style.windowLight), 0.4) : new THREE.Color(cfg.color);
    const mat = new THREE.ShaderMaterial({
      vertexShader: weatherVertex,
      fragmentShader: weatherFragment,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uSize: { value: cfg.size },
        uHeight: { value: cfg.height },
        uFall: { value: cfg.fall },
        uDrift: { value: cfg.drift },
        uPixelRatio: { value: 1 },
        uPointSize: { value: cfg.pointSize },
        uColor: { value: tint },
        uOpacity: { value: cfg.opacity },
        uRound: { value: cfg.points ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const obj = cfg.points ? new THREE.Points(geo, mat) : new THREE.LineSegments(geo, mat);
    obj.frustumCulled = false;
    obj.raycast = () => {};
    return obj;
  }, [kind, theme]);
  useEffect(
    () => () => {
      if (!object) return;
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    },
    [object],
  );
  useFrame((_, dt) => {
    if (!object) return;
    const u = (object.material as THREE.ShaderMaterial).uniforms;
    u.uTime!.value += Math.min(dt, 0.1);
    (u.uCenter!.value as THREE.Vector3).copy(camera.position);
    u.uPixelRatio!.value = gl.getPixelRatio();
  });
  return object ? <primitive object={object} /> : null;
}

/** Sweeping searchlights around the city: more stars, more lights. */
export function Searchlights({ theme, city, reducedMotion }: { theme: SceneTheme; city: CityModel; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const beams = useMemo(() => {
    const n = theme.searchlights;
    if (!n) return [];
    const rnd = seededRandom(theme.seed ^ 0x3c);
    const length = Math.max(120, city.radius * 2.4);
    // Beam width follows the city's size so a tiny repo isn't swallowed by its own searchlights.
    const top = THREE.MathUtils.clamp(city.radius * 0.04, 0.9, 4.5);
    const geo = new THREE.CylinderGeometry(top, top * 0.14, 1, 20, 1, true).translate(0, 0.5, 0);
    return Array.from({ length: n }, (_, i) => {
      const angle = (i / n) * Math.PI * 2 + rnd() * 0.5;
      const dist = city.radius * 0.95;
      const color = new THREE.Color(i % 2 ? theme.accents[1] : "#e8f6ff");
      const mat = new THREE.ShaderMaterial({
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        uniforms: { uColor: { value: color }, uIntensity: { value: 0.24 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      return {
        geo,
        mat,
        x: city.center.x + Math.cos(angle) * dist,
        z: city.center.z + Math.sin(angle) * dist,
        length,
        phase: rnd() * Math.PI * 2,
        speed: 0.12 + rnd() * 0.15,
        tilt: 0.28 + rnd() * 0.25,
      };
    });
  }, [theme, city]);
  useEffect(
    () => () => {
      beams[0]?.geo.dispose();
      for (const b of beams) b.mat.dispose();
    },
    [beams],
  );
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = reducedMotion ? 0 : clock.getElapsedTime();
    g.children.forEach((child, i) => {
      const b = beams[i];
      if (!b) return;
      // Each light swings around its base, tilted away from vertical.
      child.rotation.set(Math.sin(t * b.speed + b.phase) * b.tilt, t * b.speed * 0.6 + b.phase, Math.cos(t * b.speed * 0.8 + b.phase) * b.tilt);
      (b.mat.uniforms.uTime!.value as number) = t;
    });
  });
  return (
    <group ref={group}>
      {beams.map((b, i) => (
        <mesh key={i} geometry={b.geo} material={b.mat} position={[b.x, 0, b.z]} scale={[1, b.length, 1]} frustumCulled={false} raycast={() => null} />
      ))}
    </group>
  );
}
