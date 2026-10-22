"use client";

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { CityModel } from "@/lib/city/types";
import { buildCityMeshes } from "./cityMeshes";
import type { HoverStore } from "./hoverStore";

interface Props {
  city: CityModel;
  selected: number | null;
  reducedMotion: boolean;
  hoverStore: HoverStore;
  onSelect(index: number | null): void;
}

/** The city itself: instanced buildings, plates, streets and traffic. Remounted per city. */
export function CityContent({ city, selected, reducedMotion, hoverStore, onSelect }: Props) {
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
    <group>
      <primitive
        object={meshes.group}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHover(buildingAt(e), e);
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => setHover(-1, e)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          // Ignore clicks that were really camera drags.
          if (e.delta > 6) return;
          const index = buildingAt(e);
          if (index < 0) return;
          e.stopPropagation();
          onSelect(index);
        }}
      />

    </group>
  );
}
