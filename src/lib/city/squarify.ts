/**
 * Squarified treemap (Bruls, Huizing & van Wijk). Splits `rect` into one
 * rectangle per weight, areas proportional to weights, aspect ratios close
 * to 1. Output order matches input order. Callers should pass weights sorted
 * descending for the best aspect ratios.
 */
import type { Rect } from "./types";

export function squarify(weights: readonly number[], rect: Rect): Rect[] {
  const out: Rect[] = new Array(weights.length);
  if (weights.length === 0) return out;
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0 || rect.w <= 0 || rect.d <= 0) {
    for (let i = 0; i < weights.length; i++) out[i] = { x: rect.x, z: rect.z, w: 0, d: 0 };
    return out;
  }
  const scale = (rect.w * rect.d) / total;
  const areas = weights.map((w) => Math.max(0, w) * scale);

  let free: Rect = { ...rect };
  let row: number[] = [];

  const worst = (indices: number[], side: number) => {
    let sum = 0;
    let min = Infinity;
    let max = 0;
    for (const i of indices) {
      const a = areas[i]!;
      sum += a;
      if (a < min) min = a;
      if (a > max) max = a;
    }
    if (sum === 0 || min === 0) return Infinity;
    const s2 = sum * sum;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  };

  const layoutRow = (indices: number[], last: boolean) => {
    const sum = indices.reduce((acc, i) => acc + areas[i]!, 0);
    if (free.w >= free.d) {
      // Column along the left edge.
      const colW = last ? free.w : Math.min(free.w, sum / free.d);
      let z = free.z;
      indices.forEach((i, k) => {
        const d = k === indices.length - 1 ? free.z + free.d - z : (areas[i]! / sum) * free.d;
        out[i] = { x: free.x, z, w: colW, d };
        z += d;
      });
      free = { x: free.x + colW, z: free.z, w: free.w - colW, d: free.d };
    } else {
      // Row along the top edge.
      const rowD = last ? free.d : Math.min(free.d, sum / free.w);
      let x = free.x;
      indices.forEach((i, k) => {
        const w = k === indices.length - 1 ? free.x + free.w - x : (areas[i]! / sum) * free.w;
        out[i] = { x, z: free.z, w, d: rowD };
        x += w;
      });
      free = { x: free.x, z: free.z + rowD, w: free.w, d: free.d - rowD };
    }
  };

  for (let i = 0; i < areas.length; i++) {
    const side = Math.min(free.w, free.d);
    const candidate = [...row, i];
    if (row.length === 0 || worst(candidate, side) <= worst(row, side)) {
      row = candidate;
    } else {
      layoutRow(row, false);
      row = [i];
    }
  }
  layoutRow(row, true);
  return out;
}
