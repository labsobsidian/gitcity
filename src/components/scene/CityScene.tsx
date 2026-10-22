"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { memo, useRef, useState, type Ref } from "react";
import * as THREE from "three";
import type { CityModel } from "@/lib/city/types";
import { CameraRig, type CameraApi } from "./CameraRig";
import { CityContent } from "./CityContent";
import { Ground } from "./Ground";
import type { HoverStore } from "./hoverStore";
import { LabelProjector, type LabelRegistry } from "./labels";

export interface CitySceneProps {
  city: CityModel;
  cityKey: string;
  selected: number | null;
  labelRegistry: LabelRegistry;
  autoRotate: boolean;
  scanning: boolean;
  reducedMotion: boolean;
  hoverStore: HoverStore;
  cameraRef: Ref<CameraApi | null>;
  onSelect(index: number | null): void;
}

/** Slowly orbiting colored lights give the plates and ground a living sheen. */
function Lighting({ radius, reducedMotion }: { radius: number; reducedMotion: boolean }) {
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
      <ambientLight intensity={0.35} color="#6fa8c4" />
      <hemisphereLight args={["#2b6d8a", "#04070a", 0.55]} />
      <directionalLight position={[radius * 0.6, radius * 1.2, radius * 0.4]} intensity={0.7} color="#cdeeff" />
      <pointLight ref={a} color="#31E6B0" intensity={radius * 2.5} distance={radius * 2.2} decay={1.2} position={[radius * 0.6, radius * 0.35 + 20, 0]} />
      <pointLight ref={b} color="#8b5cf6" intensity={radius * 2} distance={radius * 2} decay={1.2} position={[-radius * 0.5, radius * 0.3 + 15, 0]} />
    </>
  );
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
  const { city, cityKey, reducedMotion } = props;
  const [highQuality, setHighQuality] = useState(true);
  const [dpr, setDpr] = useState(1.5);
  const fogNear = Math.max(80, city.radius * 1.4);
  const fogFar = Math.max(500, city.radius * 5.5);

  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: !highQuality, powerPreference: "high-performance", alpha: false }}
      camera={{ fov: 45, near: 0.5, far: 4000, position: [120, 140, 120] }}
      onPointerMissed={() => props.onSelect(null)}
      onCreated={(state) => {
        // Dev-only handle for profiling from the browser console.
        if (process.env.NODE_ENV !== "production") (window as unknown as { __gitcity: unknown }).__gitcity = state;
      }}
      aria-label={`3D city of ${city.name}`}
    >
      <color attach="background" args={["#080D12"]} />
      <fog attach="fog" args={["#080D12", fogNear, fogFar]} />
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
      <Lighting radius={city.radius} reducedMotion={reducedMotion} />
      <Ground radius={city.radius} scanning={props.scanning} pulseKey={cityKey} reducedMotion={reducedMotion} />
      <CityContent
        key={cityKey}
        city={city}
        selected={props.selected}
        reducedMotion={reducedMotion}
        hoverStore={props.hoverStore}
        onSelect={props.onSelect}
      />
      <CameraRig city={city} cityKey={cityKey} autoRotate={props.autoRotate} reducedMotion={reducedMotion} apiRef={props.cameraRef} />
      <LabelProjector registry={props.labelRegistry} />
      {highQuality && <Effects />}
    </Canvas>
  );
});
