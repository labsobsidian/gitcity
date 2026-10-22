"use client";

/**
 * Shared input plumbing for camera controls: held-key tracking, the fly-mode
 * HUD store, and center-of-screen picking provided by the city meshes.
 */
import { useEffect, useRef } from "react";
import type * as THREE from "three";

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** Physical keys (KeyboardEvent.code) that steer the camera; their browser defaults are suppressed. */
export const CAMERA_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyZ", "KeyX", "KeyT", "KeyG", "KeyC",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight",
  "Equal", "Minus", "NumpadAdd", "NumpadSubtract", "ControlLeft",
]);

/**
 * Tracks which keys are held, by physical position (`code`), so WASD works on
 * any keyboard layout. Ignores keys typed into inputs and clears on blur so a
 * key released outside the window doesn't stick.
 */
export function useHeldKeys() {
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const held = keys.current;
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!CAMERA_KEYS.has(e.code)) return;
      held.add(e.code);
      // Space would "click" a focused button and arrows could scroll.
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => held.delete(e.code);
    const clear = () => held.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);
  return keys;
}

export interface FlyState {
  /** Mouse is captured (pointer lock) and steers the camera. */
  locked: boolean;
  /** Speed multiplier set with the scroll wheel. */
  speedFactor: number;
  /** Current speed in meters per second. */
  speed: number;
  altitude: number;
  /** Building under the crosshair, or -1. */
  aim: number;
}

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const key of Object.keys(patch) as (keyof T)[]) {
        if (patch[key] !== state[key]) changed = true;
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const createFlyStore = () => createStore<FlyState>({ locked: false, speedFactor: 1, speed: 0, altitude: 0, aim: -1 });

/** Implemented by the city meshes: returns the building index hit by the ray (and highlights it), or -1. */
export interface Picker {
  pick(ray: THREE.Raycaster): number;
  clearHighlight(): void;
}
