"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useMemo, useRef, type MutableRefObject, type Ref } from "react";
import * as THREE from "three";
import type { Building, CityModel } from "@/lib/city/types";
import { useHeldKeys, type FlyState, type Picker, type Store } from "./input";

export interface CameraApi {
  reset(): void;
  zoom(direction: 1 | -1): void;
  rotate(direction: 1 | -1): void;
  focus(building: Building): void;
  /** Swing the orbit over a ground point (district landmarks). */
  lookAt(x: number, z: number): void;
}

interface Props {
  city: CityModel;
  cityKey: string;
  autoRotate: boolean;
  reducedMotion: boolean;
  /** Drone-style free flight (mouse look + WASD) instead of orbiting. */
  flying: boolean;
  flyStore: Store<FlyState>;
  picker: MutableRefObject<Picker | null>;
  apiRef: Ref<CameraApi | null>;
  onSelect(index: number | null): void;
}

const POLAR = 0.95; // radians from straight down
const AZIMUTH = Math.PI / 4;
const MAX_ORBIT_POLAR = Math.PI / 2 - 0.08;
const LOOK_SENSITIVITY = 0.0022; // radians per pixel
const MAX_PITCH = 1.5;
const MIN_ALTITUDE = 0.6;

function homePose(city: CityModel, fovDeg: number, aspect: number) {
  const fov = (fovDeg * Math.PI) / 180;
  // Fit the city's footprint horizontally and vertically.
  const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
  // Portrait screens crop the sides a little rather than shrinking the city to a speck.
  const fit = city.radius / Math.sin(Math.max(Math.min(fov, horizontalFov), fov * 0.6) / 2);
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

const axis = (keys: Set<string>, plus: string[], minus: string[]) =>
  (plus.some((k) => keys.has(k)) ? 1 : 0) - (minus.some((k) => keys.has(k)) ? 1 : 0);

export function CameraRig({ city, cityKey, autoRotate, reducedMotion, flying, flyStore, picker, apiRef, onSelect }: Props) {
  const controls = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const lastInteraction = useRef(0);
  const boundary = useRef<THREE.Box3 | undefined>(undefined);
  const keys = useHeldKeys();

  // Fly-mode state lives in refs: it changes every frame and must not re-render.
  const fly = useRef({ yaw: 0, pitch: 0, velocity: new THREE.Vector3(), dragging: false, lastHud: 0, lastAim: 0 });
  const tmp = useMemo(
    () => ({
      euler: new THREE.Euler(0, 0, 0, "YXZ"),
      dir: new THREE.Vector3(),
      right: new THREE.Vector3(),
      desired: new THREE.Vector3(),
      target: new THREE.Vector3(),
      ray: new THREE.Raycaster(),
    }),
    [],
  );

  // On wide screens the stats panel covers the left edge; shift the projection
  // center right so the city sits in the visible area. Picking and labels use the
  // same projection matrix, so they stay aligned. Flight needs a true center for the crosshair.
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const { width, height } = size;
    const shift = !flying && width >= 1024 ? Math.min(190, width * 0.13) : 0;
    if (shift) camera.setViewOffset(width, height, -shift, 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size, flying]);

  // Keep clipping planes and limits proportional to the city.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    camera.far = Math.max(2000, city.radius * 12);
    camera.near = Math.max(0.3, city.radius / 2000);
    camera.updateProjectionMatrix();
    c.minDistance = 4;
    c.maxDistance = Math.max(200, city.radius * 5);
    c.maxPolarAngle = MAX_ORBIT_POLAR;
    c.dollyToCursor = true;
    // Keep the orbit point over the city so panning (mouse or WASD) can't lose it.
    const margin = Math.max(8, city.radius * 0.08);
    boundary.current = new THREE.Box3(
        new THREE.Vector3(city.bounds.x - margin, 0, city.bounds.z - margin),
      new THREE.Vector3(city.bounds.x + city.bounds.w + margin, Math.max(10, city.maxHeight), city.bounds.z + city.bounds.d + margin),
    );
    if (!flying) c.setBoundary(boundary.current);
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

  // Enter / leave flight. CameraControls rewrites the camera every frame even
  // when disabled, so during flight we drive it with setLookAt each frame
  // (input disabled, tilt limits lifted) and hand back a sensible orbit on exit.
  useEffect(() => {
    const c = controls.current;
    if (!c || !flying) return;
    const canvas = gl.domElement;
    const f = fly.current;
    tmp.euler.setFromQuaternion(camera.quaternion, "YXZ");
    f.yaw = tmp.euler.y;
    f.pitch = THREE.MathUtils.clamp(tmp.euler.x, -MAX_PITCH, MAX_PITCH);
    f.velocity.set(0, 0, 0);
    c.enabled = false;
    c.minPolarAngle = 0.001;
    c.maxPolarAngle = Math.PI - 0.001;
    c.minDistance = 0.01;
    c.setBoundary(); // the orbit boundary would clamp the look target mid-flight
    flyStore.set({ locked: false, aim: -1 });

    const locked = () => document.pointerLockElement === canvas;
    const look = (dx: number, dy: number) => {
      f.yaw -= dx * LOOK_SENSITIVITY;
      f.pitch = THREE.MathUtils.clamp(f.pitch - dy * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (locked()) {
        // Crosshair click inspects whatever building is in the sights.
        const aim = flyStore.get().aim;
        if (aim >= 0) onSelect(aim);
        return;
      }
      f.dragging = true; // drag-to-look fallback if pointer lock is refused
      const request = canvas.requestPointerLock?.() as Promise<void> | undefined;
      request?.catch?.(() => undefined);
    };
    const onMove = (e: PointerEvent) => {
      if (locked() || f.dragging) look(e.movementX, e.movementY);
    };
    const onUp = () => {
      f.dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = THREE.MathUtils.clamp(flyStore.get().speedFactor * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.2, 6);
      flyStore.set({ speedFactor: Math.round(factor * 100) / 100 });
    };
    const onLockChange = () => flyStore.set({ locked: locked() });

    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("pointerlockchange", onLockChange);
    const prevCursor = canvas.style.cursor;
    canvas.style.cursor = "crosshair";

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      document.removeEventListener("pointerlockchange", onLockChange);
      canvas.style.cursor = prevCursor;
      if (locked()) document.exitPointerLock();
      picker.current?.clearHighlight();
      flyStore.set({ locked: false, aim: -1, speed: 0 });

      // Land: orbit around the point we were looking at (ground hit, or straight ahead).
      const pos = camera.position;
      tmp.dir.set(0, 0, -1).applyEuler(tmp.euler.set(f.pitch, f.yaw, 0, "YXZ"));
      if (tmp.dir.y < -0.08) {
        const t = Math.min(-pos.y / tmp.dir.y, city.radius * 2);
        tmp.target.copy(pos).addScaledVector(tmp.dir, t);
      } else {
        tmp.dir.y = 0;
        tmp.dir.normalize();
        tmp.target.copy(pos).addScaledVector(tmp.dir, Math.max(30, pos.y * 1.5));
        tmp.target.y = 0;
      }
      c.minPolarAngle = 0;
      c.maxPolarAngle = MAX_ORBIT_POLAR;
      c.minDistance = 4;
      c.setBoundary(boundary.current);
      c.enabled = true;
      void c.setLookAt(pos.x, Math.max(pos.y, 2), pos.z, tmp.target.x, tmp.target.y, tmp.target.z, false);
      lastInteraction.current = performance.now();
    };
  }, [flying, camera, gl, city, flyStore, picker, onSelect, tmp]);

  useImperativeHandle(
    apiRef,
    () => ({
      reset() {
        const c = controls.current;
        if (!c || flying) return;
        const fov = "fov" in camera ? (camera as { fov: number }).fov : 45;
        const { position: p, target: t } = homePose(city, fov, size.width / Math.max(size.height, 1));
        lastInteraction.current = performance.now();
        void c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, !reducedMotion);
      },
      zoom(direction) {
        const c = controls.current;
        if (!c || flying) return;
        lastInteraction.current = performance.now();
        void c.dolly(direction * c.distance * 0.28, !reducedMotion);
      },
      rotate(direction) {
        const c = controls.current;
        if (!c || flying) return;
        lastInteraction.current = performance.now();
        void c.rotate(direction * (Math.PI / 6), 0, !reducedMotion);
      },
      focus(b) {
        const c = controls.current;
        if (!c || flying) return;
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
      lookAt(x, z) {
        const c = controls.current;
        if (!c || flying) return;
        lastInteraction.current = performance.now();
        const d = Math.max(45, Math.min(c.distance, city.radius * 0.9));
        const azimuth = c.azimuthAngle;
        void c.setLookAt(x + d * 0.6 * Math.sin(azimuth), d * 0.75, z + d * 0.6 * Math.cos(azimuth), x, 0, z, !reducedMotion);
      },
    }),
    [camera, city, size, reducedMotion, flying],
  );

  useFrame((_, rawDelta) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(rawDelta, 0.05);
    const held = keys.current;
    const boost = held.has("ShiftLeft") || held.has("ShiftRight") ? 3 : 1;

    if (flying) {
      const f = fly.current;
      const forward = axis(held, ["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]);
      const strafe = axis(held, ["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]);
      const lift = axis(held, ["Space", "KeyE"], ["KeyC", "KeyQ", "ControlLeft"]);
      tmp.euler.set(f.pitch, f.yaw, 0, "YXZ");
      tmp.dir.set(0, 0, -1).applyEuler(tmp.euler);
      tmp.right.set(1, 0, 0).applyEuler(tmp.euler.set(0, f.yaw, 0, "YXZ"));
      tmp.desired.set(0, 0, 0).addScaledVector(tmp.dir, forward).addScaledVector(tmp.right, strafe);
      tmp.desired.y += lift;
      if (tmp.desired.lengthSq() > 1) tmp.desired.normalize();
      const cruise = THREE.MathUtils.clamp(city.radius * 0.22, 10, 140) * flyStore.get().speedFactor * boost;
      tmp.desired.multiplyScalar(cruise);
      // Ease toward the desired velocity so starts and stops feel like a drone, not a teleport.
      f.velocity.lerp(tmp.desired, reducedMotion ? 1 : 1 - Math.exp(-dt * 6));

      const pos = camera.position.clone().addScaledVector(f.velocity, dt);
      pos.y = Math.max(pos.y, MIN_ALTITUDE);
      // Keep the drone within reach of the city.
      const limit = city.radius * 4;
      const fromCenter = Math.hypot(pos.x - city.center.x, pos.z - city.center.z);
      if (fromCenter > limit) {
        pos.x = city.center.x + ((pos.x - city.center.x) / fromCenter) * limit;
        pos.z = city.center.z + ((pos.z - city.center.z) / fromCenter) * limit;
      }
      pos.y = Math.min(pos.y, Math.max(200, city.radius * 3));
      tmp.target.copy(pos).addScaledVector(tmp.dir, 10);
      void c.setLookAt(pos.x, pos.y, pos.z, tmp.target.x, tmp.target.y, tmp.target.z, false);

      const now = performance.now();
      if (now - f.lastAim > 90) {
        f.lastAim = now;
        tmp.ray.set(pos, tmp.dir);
        tmp.ray.far = city.radius * 3;
        flyStore.set({ aim: picker.current?.pick(tmp.ray) ?? -1 });
      }
      if (now - f.lastHud > 150) {
        f.lastHud = now;
        flyStore.set({ speed: Math.round(f.velocity.length()), altitude: Math.round(pos.y) });
      }
      return;
    }

    // Explore mode: continuous keyboard steering on top of the mouse orbit controls.
    const forward = axis(held, ["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]);
    const strafe = axis(held, ["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]);
    const turn = axis(held, ["KeyE"], ["KeyQ"]);
    const tilt = axis(held, ["KeyG"], ["KeyT"]);
    const zoom = axis(held, ["KeyZ", "Equal", "NumpadAdd"], ["KeyX", "Minus", "NumpadSubtract"]);
    if (forward || strafe || turn || tilt || zoom) {
      lastInteraction.current = performance.now();
      const move = c.distance * 0.45 * dt * boost;
      if (forward) void c.forward(forward * move, false);
      if (strafe) void c.truck(strafe * move, 0, false);
      // Same direction as the dock's rotate buttons (Q = rotate(-1)).
      if (turn || tilt) void c.rotate(turn * 1.6 * dt * boost, tilt * 0.9 * dt, false);
      if (zoom) void c.dolly(zoom * c.distance * (1 - Math.exp(-1.6 * dt * boost)), false);
      return;
    }

    if (!autoRotate || reducedMotion) return;
    // Drift slowly once the visitor has left the controls alone for a few seconds.
    if (performance.now() - lastInteraction.current < 4000) return;
    void c.rotate(dt * 0.045, 0, false);
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
