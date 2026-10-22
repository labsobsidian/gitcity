/**
 * Hover state lives outside React state so pointer moves over the city don't
 * re-render the scene tree — only the tooltip subscribes to it.
 */
export interface HoverState {
  index: number;
  x: number;
  y: number;
}

export interface HoverStore {
  get(): HoverState | null;
  set(next: HoverState | null): void;
  subscribe(listener: () => void): () => void;
}

export function createHoverStore(): HoverStore {
  let state: HoverState | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      if (next === state || (next && state && next.index === state.index && next.x === state.x && next.y === state.y)) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
