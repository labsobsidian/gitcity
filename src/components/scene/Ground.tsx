"use client";

import { Grid } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { CELL } from "@/lib/city/generate";

interface Props {
  radius: number;
  /** Emit repeating scan pulses (while a repository is loading). */
  scanning: boolean;
  /** Changes when a new city is revealed, triggering one pulse. */
  pulseKey: string;
  reducedMotion: boolean;
}

/** Dark ground, a glowing coordinate grid, and expanding scan rings. */
export function Ground({ radius, scanning, pulseKey, reducedMotion }: Props) {
  const ring = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const start = useRef(-10);
  const lastKey = useRef("");
  const size = Math.max(600, radius * 14);
  const gridSize = Math.max(400, radius * 7);

  useFrame(({ clock }) => {
    const mesh = ring.current;
    const mat = material.current;
    if (!mesh || !mat) return;
    const now = clock.getElapsedTime();
    if (pulseKey !== lastKey.current) {
      lastKey.current = pulseKey;
      start.current = now;
    }
    const period = 1.8;
    let age = now - start.current;
    if (scanning && age > period) {
      start.current = now;
      age = 0;
    }
    const duration = scanning ? period : 2.6;
    const t = age / duration;
    if (reducedMotion || t < 0 || t > 1) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const r = 2 + t * radius * 1.6;
    mesh.scale.set(r, r, r);
    mat.opacity = (1 - t) * (1 - t) * 0.85;
  });

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.03} raycast={() => null}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#05090c" roughness={0.95} metalness={0.1} />
      </mesh>
      {/* Finite on purpose: drei's infiniteGrid scales the plane by fadeDistance,
          which loses float precision on large cities and erases the lines. */}
      <Grid
        position-y={-0.005}
        args={[gridSize, gridSize]}
        cellSize={CELL}
        cellThickness={0.55}
        cellColor="#154c47"
        sectionSize={CELL * 6}
        sectionThickness={1.1}
        sectionColor="#24a07f"
        fadeDistance={Math.max(240, radius * 3.2)}
        fadeStrength={1.4}
        fadeFrom={0}
        raycast={() => null}
      />
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.2} visible={false} raycast={() => null}>
        <ringGeometry args={[0.97, 1, 160]} />
        <meshBasicMaterial
          ref={material}
          color={new THREE.Color("#31E6B0").multiplyScalar(2.2)}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
