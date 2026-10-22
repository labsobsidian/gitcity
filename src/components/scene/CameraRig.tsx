"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import * as THREE from "three";
import type { Building, CityModel } from "@/lib/city/types";

export interface CameraApi {
  reset(): void;
  zoom(direction: 1 | -1): void;
  rotate(direction: 1 | -1): void;
  focus(building: Building): void;
}

interface Props {
  city: CityModel;
  cityKey: string;
  autoRotate: boolean;
  reducedMotion: boolean;
  apiRef: Ref<CameraApi | null>;
}

const POLAR = 0.95; // radians from straight down
const AZIMUTH = Math.PI / 4;

function homePose(city: CityModel, fovDeg: number, aspect: number) {
  const fov = (fovDeg * Math.PI) / 180;
  // Fit the city's footprint horizontally and vertically.
  const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
  const fit = city.radius / Math.sin(Math.min(fov, horizontalFov) / 2);
  const distance = Math.max(30, fit * 0.78 + city.maxHeight * 0.4);
  const target = { x: city.center.x, y: Math.min(city.maxHeight * 0.12, 3), z: city.center.z };
  return {
    target,
    distance,
    position: {
      x: target.x + distance * Math.sin(POLAR) * Math.sin(AZIMUTH),
      y: target.y + distance * Math.cos(POLAR),
      z: target.z + distance * Math.sin(POLAR) * Math.cos(AZIMUTH),
    },
  };
}

export function CameraRig({ city, cityKey, autoRotate, reducedMotion, apiRef }: Props) {
  const controls = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const lastInteraction = useRef(0);

  // On wide screens the stats panel covers the left edge; shift the projection
  // center right so the city sits in the visible area. Picking and labels use the
  // same projection matrix, so they stay aligned.
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const { width, height } = size;
    const shift = width >= 1024 ? Math.min(190, width * 0.13) : 0;
    if (shift) camera.setViewOffset(width, height, -shift, 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size]);

  // Keep clipping planes and limits proportional to the city.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    camera.far = Math.max(2000, city.radius * 12);
    camera.near = Math.max(0.3, city.radius / 2000);
    camera.updateProjectionMatrix();
    c.minDistance = 4;
    c.maxDistance = Math.max(200, city.radius * 5);
    c.maxPolarAngle = Math.PI / 2 - 0.08;
    c.dollyToCursor = true;
    c.smoothTime = reducedMotion ? 0 : 0.35;
    c.draggingSmoothTime = reducedMotion ? 0 : 0.12;
  }, [camera, city, reducedMotion]);

  // Reveal: swoop in from high above whenever a new city arrives.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const fov = "fov" in camera ? (camera as { fov: number }).fov : 45;
    const home = homePose(city, fov, size.width / Math.max(size.height, 1));
    const { position: p, target: t } = home;
    if (reducedMotion) {
      void c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false);
      return;
    }
    const prevSmooth = c.smoothTime;
    c.smoothTime = 1.1;
    void c.setLookAt(t.x - home.distance * 0.9, home.distance * 1.5, t.z + home.distance * 1.3, t.x, 0, t.z, false);
    void c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, true).then(() => {
      c.smoothTime = prevSmooth;
    });
    // Size changes shouldn't replay the reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityKey]);

  useImperativeHandle(
    apiRef,
    () => ({
      reset() {
        const c = controls.current;
        if (!c) return;
        const fov = "fov" in camera ? (camera as { fov: number }).fov : 45;
        const { position: p, target: t } = homePose(city, fov, size.width / Math.max(size.height, 1));
        lastInteraction.current = performance.now();
        void c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, !reducedMotion);
      },
      zoom(direction) {
        const c = controls.current;
        if (!c) return;
        lastInteraction.current = performance.now();
        void c.dolly(direction * c.distance * 0.28, !reducedMotion);
      },
      rotate(direction) {
        const c = controls.current;
        if (!c) return;
        lastInteraction.current = performance.now();
        void c.rotate(direction * (Math.PI / 6), 0, !reducedMotion);
      },
      focus(b) {
        const c = controls.current;
        if (!c) return;
        lastInteraction.current = performance.now();
        const top = b.baseY + b.height + b.roofHeight;
        const distance = Math.max(14, top * 2.2, b.width * 6);
        const azimuth = c.azimuthAngle;
        void c.setLookAt(
          b.x + distance * 0.75 * Math.sin(azimuth),
          top * 0.6 + distance * 0.55,
          b.z + distance * 0.75 * Math.cos(azimuth),
          b.x,
          top * 0.45,
          b.z,
          !reducedMotion,
        );
      },
    }),
    [camera, city, size, reducedMotion],
  );

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c || !autoRotate || reducedMotion) return;
    // Drift slowly once the visitor has left the controls alone for a few seconds.
    if (performance.now() - lastInteraction.current < 4000) return;
    void c.rotate(delta * 0.045, 0, false);
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      onStart={() => {
        lastInteraction.current = performance.now();
      }}
      onEnd={() => {
        lastInteraction.current = performance.now();
      }}
    />
  );
}
