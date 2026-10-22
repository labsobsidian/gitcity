"use client";

import { Home, Orbit, RotateLeft, RotateRight, Tag, ZoomIn, ZoomOut } from "./icons";

interface Props {
  showLabels: boolean;
  autoRotate: boolean;
  onZoom(direction: 1 | -1): void;
  onRotate(direction: 1 | -1): void;
  onReset(): void;
  onToggleLabels(): void;
  onToggleAutoRotate(): void;
}

export function ControlsDock(p: Props) {
  const buttons = [
    { label: "Zoom in (+)", icon: <ZoomIn />, onClick: () => p.onZoom(1) },
    { label: "Zoom out (−)", icon: <ZoomOut />, onClick: () => p.onZoom(-1) },
    { label: "Rotate left (Q)", icon: <RotateLeft />, onClick: () => p.onRotate(-1) },
    { label: "Rotate right (E)", icon: <RotateRight />, onClick: () => p.onRotate(1) },
    { label: "Reset camera (R)", icon: <Home />, onClick: p.onReset },
  ];
  return (
    <nav className="panel pointer-events-auto flex items-center gap-0.5 rounded-2xl p-1" aria-label="Camera controls">
      {buttons.map((b) => (
        <button key={b.label} type="button" className="icon-btn" title={b.label} aria-label={b.label} onClick={b.onClick}>
          {b.icon}
        </button>
      ))}
      <span className="mx-0.5 h-6 w-px bg-line" aria-hidden="true" />
      <button
        type="button"
        className="icon-btn"
        title="Toggle labels (L)"
        aria-label="Toggle labels"
        aria-pressed={p.showLabels}
        onClick={p.onToggleLabels}
      >
        <Tag />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Toggle auto-orbit (O)"
        aria-label="Toggle auto-orbit"
        aria-pressed={p.autoRotate}
        onClick={p.onToggleAutoRotate}
      >
        <Orbit />
      </button>
    </nav>
  );
}
