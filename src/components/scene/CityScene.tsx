"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { memo, useMemo, useRef, useState, type MutableRefObject, type Ref } from "react";
import * as THREE from "three";
import type { CityProfile } from "@/lib/city/profile";
import type { CityModel } from "@/lib/city/types";
import { Searchlights, SkyDome, Weather } from "./Atmosphere";
import { CameraRig, type CameraApi } from "./CameraRig";
import { CityContent } from "./CityContent";
import { Ground } from "./Ground";
import { Hologram } from "./Hologram";
import type { HoverStore } from "./hoverStore";
import type { FlyState, Picker, Store } from "./input";
import { LabelProjector, type LabelRegistry } from "./labels";
import { themeFor, type SceneTheme } from "./theme";

export interface CitySceneProps {
  city: CityModel;
  /** Style, sky and signage; absent for cities generated without one. */
  profile: CityProfile | undefined;
  cityKey: string;
  selected: number | null;
  labelRegistry: LabelRegistry;
  autoRotate: boolean;
  scanning: boolean;
  reducedMotion: boolean;
  hoverStore: HoverStore;
  cameraRef: Ref<CameraApi | null>;
  flying: boolean;
  flyStore: Store<FlyState>;
  picker: MutableRefObject<Picker | null>;
  onSelect(index: number | null): void;
  onFocus(index: number): void;
}

/** Slowly orbiting colored lights give the plates and ground a living sheen. */
function Lighting({ radius, reducedMotion, theme }: { radius: number; reducedMotion: boolean; theme: SceneTheme }) {
  const a = useRef<THREE.PointLight>(null);
  const b = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (reducedMotion) return;
    const t = clock.getElapsedTime() * 0.08;
    a.current?.position.set(Math.cos(t) * radius * 0.6, radius * 0.35 + 20, Math.sin(t) * radius * 0.6);
    b.current?.position.set(Math.cos(t + Math.PI) * radius * 0.5, radius * 0.3 + 15, Math.sin(t + Math.PI) * radius * 0.5);
  });
  return (
    <>
      <ambientLight intensity={0.35} color={theme.sky.horizon} />
      <hemisphereLight args={[new THREE.Color(theme.sky.zenith).lerp(new THREE.Color(theme.accents[1]), 0.35), "#04070a", 0.55]} />
      <directionalLight position={[radius * 0.6, radius * 1.2, radius * 0.4]} intensity={0.7} color="#cdeeff" />
      <pointLight ref={a} color={theme.accents[0]} intensity={radius * 2.5} distance={radius * 2.2} decay={1.2} position={[radius * 0.6, radius * 0.35 + 20, 0]} />
      <pointLight ref={b} color={theme.accents[1]} intensity={radius * 2} distance={radius * 2} decay={1.2} position={[-radius * 0.5, radius * 0.3 + 15, 0]} />
    </>
  );
}

/**
 * Fog relative to the camera's distance from the city: the city stays clear at
 * any zoom (and on narrow screens), while the horizon still fades out.
 */
function FogRig({ city, near, far }: { city: CityModel; near: number; far: number }) {
  const center = useMemo(() => new THREE.Vector3(city.center.x, 0, city.center.z), [city]);
  useFrame(({ scene, camera }) => {
    const fog = scene.fog as THREE.Fog | null;
    if (!fog) return;
    const d = camera.position.distanceTo(center);
    fog.near = Math.max(near, d * 0.8);
    fog.far = Math.max(far, d * 2.2);
  });
  return null;
}

function Effects() {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={0.8} luminanceThreshold={0.78} luminanceSmoothing={0.18} radius={0.6} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.62} />
    </EffectComposer>
  );
}

export const CityScene = memo(function CityScene(props: CitySceneProps) {
  const { city, cityKey, reducedMotion, profile } = props;
  const [highQuality, setHighQuality] = useState(true);
  const [dpr, setDpr] = useState(1.5);
  const theme = useMemo(() => themeFor(profile), [profile]);
  const fogNear = Math.max(60, city.radius * theme.fog.near);
  const fogFar = Math.max(400, city.radius * theme.fog.far);

  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: !highQuality, powerPreference: "high-performance", alpha: false }}
      camera={{ fov: 45, near: 0.5, far: 4000, position: [120, 140, 120] }}
      onPointerMissed={() => {
        if (!props.flying) props.onSelect(null);
      }}
      onCreated={(state) => {
        // Dev-only handle for profiling from the browser console.
        if (process.env.NODE_ENV !== "production") (window as unknown as { __gitcity: unknown }).__gitcity = state;
      }}
      aria-label={`3D city of ${city.name}`}
    >
      <color attach="background" args={[theme.sky.horizon]} />
      <fog attach="fog" args={[theme.fog.color, fogNear, fogFar]} />
      <FogRig city={city} near={fogNear} far={fogFar} />
      <SkyDome theme={theme} />
      <PerformanceMonitor
        onDecline={() => {
          setDpr(1);
          setHighQuality(false);
        }}
        onIncline={() => {
          setDpr(Math.min(2, window.devicePixelRatio || 1));
          setHighQuality(true);
        }}
        flipflops={3}
        onFallback={() => {
          setDpr(1);
          setHighQuality(false);
        }}
      />
      <Lighting radius={city.radius} reducedMotion={reducedMotion} theme={theme} />
      <Ground
        radius={city.radius}
        scanning={props.scanning}
        pulseKey={cityKey}
        reducedMotion={reducedMotion}
        colors={{ ground: theme.ground, grid: theme.grid, pulse: theme.accents[0] }}
      />
      <Weather theme={theme} reducedMotion={reducedMotion} />
      <Searchlights theme={theme} city={city} reducedMotion={reducedMotion} />
      {profile && <Hologram key={`holo-${cityKey}`} profile={profile} city={city} theme={theme} reducedMotion={reducedMotion} />}
      <CityContent
        key={cityKey}
        city={city}
        theme={theme}
        selected={props.selected}
        reducedMotion={reducedMotion}
        flying={props.flying}
        hoverStore={props.hoverStore}
        picker={props.picker}
        onSelect={props.onSelect}
        onFocus={props.onFocus}
      />
      <CameraRig
        city={city}
        cityKey={cityKey}
        autoRotate={props.autoRotate}
        reducedMotion={reducedMotion}
        flying={props.flying}
        flyStore={props.flyStore}
        picker={props.picker}
        apiRef={props.cameraRef}
        onSelect={props.onSelect}
      />
      <LabelProjector registry={props.labelRegistry} />
      {highQuality && <Effects />}
    </Canvas>
  );
});
