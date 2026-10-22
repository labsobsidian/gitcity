"use client";

import { Home, Keyboard, Orbit, Plane, RotateLeft, RotateRight, Tag, ZoomIn, ZoomOut } from "./icons";

interface Props {
  showLabels: boolean;
  autoRotate: boolean;
  flying: boolean;
  helpOpen: boolean;
  onZoom(direction: 1 | -1): void;
  onRotate(direction: 1 | -1): void;
  onReset(): void;
  onToggleLabels(): void;
  onToggleAutoRotate(): void;
  onToggleFly(): void;
  onToggleHelp(): void;
}

export function ControlsDock(p: Props) {
  const buttons = [
    { label: "Zoom in (Z)", icon: <ZoomIn />, onClick: () => p.onZoom(1) },
    { label: "Zoom out (X)", icon: <ZoomOut />, onClick: () => p.onZoom(-1) },
    { label: "Rotate left (Q)", icon: <RotateLeft />, onClick: () => p.onRotate(-1) },
    { label: "Rotate right (E)", icon: <RotateRight />, onClick: () => p.onRotate(1) },
    { label: "Reset camera (H)", icon: <Home />, onClick: p.onReset },
  ];
  return (
    <nav className="panel pointer-events-auto flex items-center gap-0.5 rounded-2xl p-1" aria-label="Camera controls">
      {buttons.map((b) => (
        <button key={b.label} type="button" className="icon-btn" title={b.label} aria-label={b.label} onClick={b.onClick} disabled={p.flying}>
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
      {/* Mouse + keyboard only: hidden on touch-first devices. */}
      <span className="mx-0.5 h-6 w-px bg-line max-sm:hidden [@media(hover:none)]:hidden" aria-hidden="true" />
      <button
        type="button"
        className="icon-btn max-sm:hidden [@media(hover:none)]:hidden"
        title={p.flying ? "Land (F)" : "Fly mode (F)"}
        aria-label={p.flying ? "Land" : "Fly mode"}
        aria-pressed={p.flying}
        onClick={p.onToggleFly}
      >
        <Plane />
      </button>
      <button
        type="button"
        className="icon-btn max-sm:hidden [@media(hover:none)]:hidden"
        title="Controls (?)"
        aria-label="Show controls"
        aria-pressed={p.helpOpen}
        onClick={p.onToggleHelp}
      >
        <Keyboard />
      </button>
    </nav>
  );
}
