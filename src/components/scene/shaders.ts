/**
 * GLSL for buildings. One vertex shader drives every building part; the
 * fragment shader branches on a compile-time KIND:
 *   0 tower body (windows + neon edges)   1 rooftop block (edges only)
 *   2 spire / dome (glowing tip)          3 antenna mast (blinking beacon)
 *   4 helipad (landing ring)
 * The rise animation happens here too: each instance scales up from the
 * ground once uReveal passes its delay, so no per-frame CPU work is needed.
 */

export const buildingVertex = /* glsl */ `
uniform float uReveal;
uniform float uHover;
uniform float uSelected;
attribute float aBuilding;
attribute vec3 aColor;
attribute vec4 aParams; // x: seed, y: window style, z: reveal delay, w: cluster flag
varying vec3 vObj;
varying vec3 vScale;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vColor;
varying vec4 vParams;
varying float vHighlight;
varying float vGrow;
#include <fog_pars_vertex>

void main() {
  vec3 scale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  float t = clamp((uReveal - aParams.z) / 1.15, 0.0, 1.0);
  float grow = 1.0 - pow(1.0 - t, 3.0);
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  world.y *= max(grow, 0.0005);
  vWorld = world.xyz;
  vObj = position;
  vScale = scale;
  // Normal matrix of a scale+translate instance is 1/scale; instanceMatrix already applies scale once.
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * (normal / (scale * scale)));
  vColor = aColor;
  vParams = aParams;
  vGrow = grow;
  vHighlight = abs(aBuilding - uSelected) < 0.5 ? 2.0 : (abs(aBuilding - uHover) < 0.5 ? 1.0 : 0.0);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const buildingFragment = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uSelected;
varying vec3 vObj;
varying vec3 vScale;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vColor;
varying vec4 vParams;
varying float vHighlight;
varying float vGrow;
#include <fog_pars_fragment>

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 n = normalize(vNormalW);
  vec3 tint = vColor;
  float seed = vParams.x;
  float cluster = vParams.w;
  float revealAge = uReveal - vParams.z;

  // Dark glass body, lit by a cool sky and a low key light.
  vec3 sun = normalize(vec3(0.45, 0.8, 0.3));
  float diff = max(dot(n, sun), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 body = mix(vec3(0.022, 0.036, 0.048), tint * 0.12, 0.4);
  vec3 col = body * (0.5 + 0.75 * diff) + vec3(0.010, 0.022, 0.030) * sky;

  vec3 p = vObj * vScale; // meters, x/z centered, y from tier base
  float halfW = 0.5 * vScale.x;
  float halfD = 0.5 * vScale.z;
  float h = vScale.y;
  float edgeGlow = 0.0;
  float windows = 0.0;

#if KIND == 0 || KIND == 1
  float edgeDist;
  if (n.y > 0.5) {
    edgeDist = min(halfW - abs(p.x), halfD - abs(p.z));
  } else {
    bool sideX = abs(n.x) > 0.5;
    float u = sideX ? p.z : p.x;
    float halfU = sideX ? halfD : halfW;
    edgeDist = min(halfU - abs(u), h - p.y);
  #if KIND == 0
    if (cluster < 0.5) {
      float style = vParams.y;
      vec2 cellSize = style > 2.5 ? vec2(0.62, 0.78) : vec2(0.48, 0.62);
      vec2 g = vec2((u + halfU) / cellSize.x, p.y / cellSize.y);
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float wx = style < 0.5 || style > 2.5 ? step(0.22, f.x) * step(f.x, 0.78)
               : style < 1.5 ? 1.0
               : step(0.36, f.x) * step(f.x, 0.64);
      float wy = style < 1.5 ? step(0.3, f.y) * step(f.y, 0.74) : step(0.1, f.y);
      float inset = step(0.16, halfU - abs(u)) * step(0.3, h - p.y) * step(0.2, p.y);
      vec2 id = cell + vec2(seed * 913.0, n.x * 31.0 + n.z * 17.0);
      float litFrac = style > 2.5 ? 0.12 : 0.2 + 0.26 * fract(seed * 7.13);
      float rnd = hash12(id);
      // Lights come on shortly after the building finishes rising, then flicker very rarely.
      float on = step(hash12(id + 3.7) * 0.9, revealAge - 1.0);
      float flick = step(0.985, hash12(id + floor(uTime * 0.12 + rnd * 40.0)));
      float lit = step(rnd, litFrac);
      lit = abs(lit - flick) * on;
      windows = wx * wy * inset;
      vec3 glow = mix(tint, vec3(1.0), 0.18) * (0.9 + 1.1 * hash12(id + 9.1));
      // When window cells shrink below a few pixels, fade to their average so
      // distant towers read as dark glass with a soft inner light, not pastel noise.
      float cellPx = 1.0 / max(max(fwidth(g.x), fwidth(g.y)), 1e-4);
      float detail = smoothstep(4.0, 10.0, cellPx);
      vec3 near = mix(col, vec3(0.006, 0.01, 0.014), windows * 0.7) + windows * lit * glow;
      vec3 far = col + tint * litFrac * 0.14 * inset * on;
      col = mix(far, near, detail);
    } else {
      // Clusters read as dim data warehouses: horizontal louvers, no windows.
      float louver = step(0.5, fract(p.y * 2.2));
      col += tint * louver * 0.05;
    }
  #endif
  }
  float edgeWidth = cluster > 0.5 ? 0.05 : 0.06;
  // Keep outlines about a pixel wide or more at any distance.
  float aa = fwidth(edgeDist) * 1.2;
  float width = max(edgeWidth, aa);
  edgeGlow = 1.0 - smoothstep(0.0, width, edgeDist);
  // Widened (distant) edges get dimmer so thin towers don't fill in with outline color.
  float edgeStrength = (cluster > 0.5 ? 0.5 : (n.y > 0.5 ? 0.8 : 1.6)) * mix(0.35, 1.0, edgeWidth / width);
  col += tint * edgeGlow * edgeStrength;
  if (n.y > 0.5) col *= 0.75; // roofs stay dark so the silhouettes read from above
  // Neon street light spilling up the facade.
  col += tint * 0.18 * (1.0 - smoothstep(0.0, 0.9, vWorld.y)) * (1.0 - cluster * 0.6);
#elif KIND == 2
  float tip = pow(clamp(vObj.y, 0.0, 1.0), 2.5);
  col += tint * (0.2 + 2.6 * tip);
  edgeGlow = tip;
#elif KIND == 3
  col = tint * 0.35;
  if (vObj.y > 0.86) {
    float blink = step(0.55, fract(uTime * 0.7 + seed * 5.0));
    vec3 beacon = seed > 0.5 ? vec3(1.0, 0.18, 0.3) : vec3(0.85, 1.0, 1.0);
    col = beacon * (0.6 + 3.4 * blink);
  }
#elif KIND == 4
  if (n.y > 0.5) {
    float r = length(p.xz) / max(halfW, 0.001);
    float ring = smoothstep(0.66, 0.7, r) - smoothstep(0.8, 0.84, r);
    col += vec3(1.0, 0.72, 0.28) * ring * 1.8;
  }
#endif

  // Construction glow along the top while a building rises.
  col += tint * smoothstep(h - 0.5, h, p.y) * (1.0 - vGrow) * 2.5 * step(0.001, vGrow);

  if (vHighlight > 1.5) {
    float pulse = 0.65 + 0.35 * sin(uTime * 4.0);
    col += mix(tint, vec3(1.0), 0.4) * (0.12 + edgeGlow * 2.2 * pulse);
  } else if (vHighlight > 0.5) {
    col += mix(tint, vec3(1.0), 0.5) * (0.08 + edgeGlow * 1.4);
  } else if (uSelected > -0.5) {
    col *= 0.62;
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Neon outlines for district plates; each vertex fades in after its delay. */
export const lineVertex = /* glsl */ `
uniform float uReveal;
attribute vec3 aColor;
attribute float aDelay;
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vAlpha = smoothstep(aDelay, aDelay + 0.6, uReveal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const lineFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(vColor, vAlpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Traffic: points sliding along street segments, positioned entirely on the GPU. */
export const trafficVertex = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uReveal;
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aMotion; // x: speed (segments per second), y: phase
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  float t = fract(aMotion.y + uTime * aMotion.x);
  vec3 pos = mix(aStart, aEnd, t);
  vColor = aColor;
  vAlpha = smoothstep(1.5, 3.0, uReveal) * smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.94, 1.0, t));
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = 26.0 * uPixelRatio / max(-mvPosition.z, 1.0) + 1.0;
  #include <fog_vertex>
}
`;

export const trafficFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor * (1.0 + 2.0 * a), a * vAlpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
