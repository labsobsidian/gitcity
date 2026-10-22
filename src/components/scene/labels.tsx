"use client";

/**
 * Lightweight 3D-anchored labels: plain DOM elements positioned each frame
 * from projected world coordinates. Cheaper than one React root per label,
 * and it keeps labels underneath the UI panels in normal DOM order.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { LANDMARK_INFO } from "@/lib/city/profile";
import type { CityModel } from "@/lib/city/types";

export interface LabelSpec {
  id: string;
  kind: "district" | "tower" | "selected" | "landmark";
  text: string;
  color?: string;
  meta?: string;
  position: [number, number, number];
}

export interface LabelEntry {
  el: HTMLElement;
  position: THREE.Vector3;
  /** Higher wins when labels collide on screen. */
  priority: number;
  /** Cached element size (measured once; label text never changes). */
  size?: { w: number; h: number };
}

export interface LabelRegistry {
  elements: Map<string, LabelEntry>;
}

export function createLabelRegistry(): LabelRegistry {
  return { elements: new Map() };
}

const MAX_DISTRICT_LABELS = 18;
const MAX_TOWER_LABELS = 4;

export function cityLabels(city: CityModel, selected: number | null, showLabels: boolean): LabelSpec[] {
  const out: LabelSpec[] = [];
  if (showLabels) {
    // Only districts with enough ground to carry a label; small repos also label second-level districts.
    const cityArea = city.bounds.w * city.bounds.d;
    // Islands spread out of a monorepo folder count as top-level; the grouping folder itself has no ground.
    const topLevel = city.districts.filter((d) => !d.virtual && (d.depth === 1 || (d.parent >= 0 && city.districts[d.parent]!.virtual)));
    const candidates = (topLevel.length < 6 ? city.districts.filter((d) => !d.virtual && (d.depth === 1 || d.depth === 2)) : topLevel).filter(
      (d) => d.depth === 1 || (d.rect.w * d.rect.d) / cityArea > 0.04,
    );
    for (const d of [...candidates].sort((a, b) => b.rect.w * b.rect.d - a.rect.w * a.rect.d).slice(0, MAX_DISTRICT_LABELS)) {
      out.push({
        id: `d${d.index}`,
        kind: "district",
        text: d.name,
        meta: d.buildingCount.toLocaleString("en-US"),
        position: [d.rect.x + d.rect.w / 2, d.elevation + 0.5, d.rect.z + d.rect.d / 2],
      });
    }
    for (const l of city.landmarks) {
      const info = LANDMARK_INFO[l.kind];
      out.push({
        id: `l${l.kind}`,
        kind: "landmark",
        text: info.name,
        meta: l.building !== undefined ? city.buildings[l.building]!.name : undefined,
        color: info.color,
        position: [l.x, l.y + (l.building !== undefined ? 2.2 : 1.2), l.z],
      });
    }
    const landmarkBuildings = new Set(city.landmarks.map((l) => l.building));
    const towers = city.buildings
      .filter((b) => !b.cluster && !landmarkBuildings.has(b.index))
      .sort((a, b) => b.height - a.height)
      .slice(0, MAX_TOWER_LABELS);
    for (const b of towers) {
      if (b.index === selected) continue;
      out.push({ id: `b${b.index}`, kind: "tower", text: b.name, position: [b.x, b.baseY + b.height + b.roofHeight + 1.2, b.z] });
    }
  }
  const s = selected !== null ? city.buildings[selected] : undefined;
  if (s) out.push({ id: "selected", kind: "selected", text: s.name, position: [s.x, s.baseY + s.height + s.roofHeight + 1.4, s.z] });
  return out;
}

/** Lives inside the Canvas; moves the registered DOM labels to their projected screen positions. */
export function LabelProjector({ registry }: { registry: LabelRegistry }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const entries = [...registry.elements.values()].sort((a, b) => b.priority - a.priority);
    for (const entry of entries) {
      const { el, position } = entry;
      v.copy(position).project(camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
        el.style.visibility = "hidden";
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      if (!entry.size) entry.size = { w: el.offsetWidth + 6, h: el.offsetHeight + 4 };
      const box = { x: x - entry.size.w / 2, y: y - entry.size.h / 2, w: entry.size.w, h: entry.size.h };
      // Skip labels that would overlap a more important one already on screen.
      if (placed.some((p) => box.x < p.x + p.w && p.x < box.x + box.w && box.y < p.y + p.h && p.y < box.y + box.h)) {
        el.style.visibility = "hidden";
        continue;
      }
      placed.push(box);
      el.style.visibility = "visible";
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
  });
  return null;
}
