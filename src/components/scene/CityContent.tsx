"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { CityModel } from "@/lib/city/types";
import { buildCityMeshes } from "./cityMeshes";
import type { HoverStore } from "./hoverStore";
import type { Picker } from "./input";

interface Props {
  city: CityModel;
  selected: number | null;
  reducedMotion: boolean;
  /** In flight the mouse steers the camera, so pointer hover/click on buildings is off (the crosshair picks instead). */
  flying: boolean;
  hoverStore: HoverStore;
  picker: MutableRefObject<Picker | null>;
  onSelect(index: number | null): void;
  onFocus(index: number): void;
}

/** The city itself: instanced buildings, plates, streets and traffic. Remounted per city. */
export function CityContent({ city, selected, reducedMotion, flying, hoverStore, picker, onSelect, onFocus }: Props) {
  const meshes = useMemo(() => buildCityMeshes(city, { reducedMotion }), [city, reducedMotion]);
  const hovered = useRef<number>(-1);

  useEffect(() => () => meshes.dispose(), [meshes]);
  useEffect(() => {
    meshes.uniforms.uSelected.value = selected ?? -1;
  }, [meshes, selected]);
  useEffect(
    () => () => {
      hoverStore.set(null);
      document.body.style.cursor = "";
    },
    [hoverStore],
  );

  // Center-of-screen picking for the flight crosshair.
  useEffect(() => {
    picker.current = {
      pick(ray) {
        const hit = ray.intersectObject(meshes.bodies, false)[0];
        const index = hit?.instanceId !== undefined ? (meshes.bodyToBuilding[hit.instanceId] ?? -1) : -1;
        meshes.uniforms.uHover.value = index;
        return index;
      },
      clearHighlight() {
        meshes.uniforms.uHover.value = -1;
      },
    };
    return () => {
      picker.current = null;
    };
  }, [meshes, picker]);

  // Entering flight drops any pointer hover state.
  useEffect(() => {
    if (!flying) return;
    hovered.current = -1;
    hoverStore.set(null);
    document.body.style.cursor = "";
  }, [flying, hoverStore]);

  useFrame((state, delta) => {
    const u = meshes.uniforms;
    // Clamp delta so a backgrounded tab doesn't skip the whole reveal.
    const dt = Math.min(delta, 1 / 20);
    u.uTime.value += dt;
    if (!reducedMotion && u.uReveal.value < meshes.revealDuration + 5) u.uReveal.value += dt;
    u.uPixelRatio.value = state.gl.getPixelRatio();
  });

  const buildingAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (e.object !== meshes.bodies || e.instanceId === undefined) return -1;
    return meshes.bodyToBuilding[e.instanceId] ?? -1;
  };

  const setHover = (index: number, e: ThreeEvent<PointerEvent>) => {
    if (index !== hovered.current) {
      hovered.current = index;
      meshes.uniforms.uHover.value = index;
      document.body.style.cursor = index >= 0 ? "pointer" : "";
    }
    hoverStore.set(index >= 0 ? { index, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } : null);
  };

  return (
    <primitive
      object={meshes.group}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        if (flying) return;
        e.stopPropagation();
        setHover(buildingAt(e), e);
      }}
      onPointerOut={(e: ThreeEvent<PointerEvent>) => {
        if (!flying) setHover(-1, e);
      }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        // Ignore clicks that were really camera drags.
        if (flying || e.delta > 6) return;
        const index = buildingAt(e);
        if (index < 0) return;
        e.stopPropagation();
        onSelect(index);
      }}
      onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
        if (flying) return;
        const index = buildingAt(e);
        if (index < 0) return;
        e.stopPropagation();
        onFocus(index);
      }}
    />
  );
}
