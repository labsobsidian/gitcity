"use client";

import * as THREE from "three";
import type { LabelRegistry, LabelSpec } from "../scene/labels";

/** DOM side of the label system; positions are written by <LabelProjector> every frame. */
export function LabelLayer({ labels, registry }: { labels: LabelSpec[]; registry: LabelRegistry }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {labels.map((label, i) => (
        <div
          key={label.id}
          className="absolute left-0 top-0"
          style={{ visibility: "hidden" }}
          ref={(el) => {
            if (!el) return;
            // Selected first, then in list order (the list is already sorted by importance).
            const priority = label.kind === "selected" ? 1e6 : labels.length - i;
            registry.elements.set(label.id, { el, position: new THREE.Vector3(...label.position), priority });
            return () => {
              registry.elements.delete(label.id);
            };
          }}
        >
          <div className={`city-label city-label--${label.kind}`}>
            {label.text}
            {label.meta && <span>{label.meta}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
