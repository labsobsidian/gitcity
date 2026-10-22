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
uniform vec3 uBody;
uniform vec3 uWindowLight;
uniform float uWindowMix;
uniform float uHueJitter;
uniform float uActivity;
uniform float uRuin;
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
  vec3 body = mix(uBody, tint * 0.12, 0.3);
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
      // 0 grid · 1 bands · 2 strips · 3 sparse · 4 dense micro-windows · 5 glass lattice
      float style = vParams.y;
      vec2 cellSize = style > 4.5 ? vec2(0.9, 0.9) : style > 3.5 ? vec2(0.3, 0.4) : style > 2.5 ? vec2(0.62, 0.78) : vec2(0.48, 0.62);
      vec2 g = vec2((u + halfU) / cellSize.x, p.y / cellSize.y);
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float wx = style < 0.5 || (style > 2.5 && style < 3.5) ? step(0.22, f.x) * step(f.x, 0.78)
               : style < 1.5 ? 1.0
               : style < 2.5 ? step(0.36, f.x) * step(f.x, 0.64)
               : style < 4.5 ? step(0.14, f.x) * step(f.x, 0.86)
               : step(0.05, f.x) * step(f.x, 0.95);
      float wy = style < 1.5 ? step(0.3, f.y) * step(f.y, 0.74)
               : style < 3.5 ? step(0.1, f.y)
               : style < 4.5 ? step(0.18, f.y) * step(f.y, 0.82)
               : step(0.05, f.y) * step(f.y, 0.95);
      float inset = step(0.16, halfU - abs(u)) * step(0.3, h - p.y) * step(0.2, p.y);
      vec2 id = cell + vec2(seed * 913.0, n.x * 31.0 + n.z * 17.0);
      float litFrac = style > 4.5 ? 0.55 : style > 3.5 ? 0.42 : style > 2.5 ? 0.12 : 0.2 + 0.26 * fract(seed * 7.13);
      // Busy repositories keep the lights on; dormant ones go dark. Ruins keep a few dying bulbs.
      litFrac *= mix(0.35, 1.15, uActivity) * (1.0 - 0.85 * uRuin);
      float rnd = hash12(id);
      // Lights come on shortly after the building finishes rising, then flicker very rarely.
      float on = step(hash12(id + 3.7) * 0.9, revealAge - 1.0);
      float flick = step(0.985 - 0.25 * uRuin, hash12(id + floor(uTime * (0.12 + uRuin * 2.0) + rnd * 40.0)));
      float lit = step(rnd, litFrac);
      lit = abs(lit - flick) * on;
      windows = wx * wy * inset;
      vec3 light = mix(tint, uWindowLight, uWindowMix);
      // Megablock signage chaos: some windows glow in random neon hues.
      float hueRoll = hash12(id + 17.3);
      vec3 neon = hueRoll < 0.33 ? vec3(1.0, 0.35, 0.65) : hueRoll < 0.66 ? vec3(0.35, 0.95, 1.0) : vec3(1.0, 0.85, 0.4);
      light = mix(light, neon, uHueJitter * step(0.6, hash12(id + 5.9)));
      vec3 glow = light * (0.9 + 1.1 * hash12(id + 9.1));
      if (style > 4.5) {
        // Greenhouse glass: a glowing interior seen through slim mullions.
        float interior = 0.35 + 0.65 * hash12(vec2(floor(p.y * 0.7), seed * 51.0));
        glow = light * interior * 0.55;
        lit = on * mix(0.4, 1.0, uActivity) * (1.0 - 0.8 * uRuin);
      }
      // When window cells shrink below a few pixels, fade to their average so
      // distant towers read as dark glass with a soft inner light, not pastel noise.
      float cellPx = 1.0 / max(max(fwidth(g.x), fwidth(g.y)), 1e-4);
      float detail = smoothstep(4.0, 10.0, cellPx);
      vec3 near = mix(col, vec3(0.006, 0.01, 0.014), windows * 0.7) + windows * lit * glow;
      vec3 far = col + light * litFrac * 0.14 * inset * on * (style > 4.5 ? 2.0 : 1.0);
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
  // Neon street light spilling up the facade (gone in ruins, where moss creeps up instead).
  col += tint * 0.18 * (1.0 - smoothstep(0.0, 0.9, vWorld.y)) * (1.0 - cluster * 0.6) * (1.0 - uRuin);
  float moss = uRuin * (1.0 - smoothstep(0.0, 6.0 + seed * 8.0, vWorld.y)) * step(0.35, hash12(floor(vWorld.xz * 3.0 + vWorld.y)));
  col = mix(col, vec3(0.04, 0.09, 0.03), moss * 0.85);
  col *= 1.0 - 0.45 * uRuin;
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
#elif KIND == 6
  // Rooftop props; vParams.y picks the variant: 0 plain · 1 smokestack · 2 solar · 3 garden.
  float variant = vParams.y;
  col = tint * (0.35 + 0.65 * diff) * 0.6 + vec3(0.01, 0.015, 0.02) * sky;
  if (variant > 0.5 && variant < 1.5) {
    float rim = smoothstep(0.86, 0.9, vObj.y) * (1.0 - smoothstep(0.96, 1.0, vObj.y));
    float flicker = 0.75 + 0.25 * sin(uTime * 7.0 + seed * 40.0);
    col += vec3(1.0, 0.42, 0.12) * rim * 2.6 * flicker * (1.0 - uRuin);
    col += vec3(1.0, 0.3, 0.1) * step(0.99, vObj.y) * 1.5 * (1.0 - uRuin);
  } else if (variant > 1.5 && variant < 2.5) {
    vec2 cells = fract(p.xz * 2.4);
    float line = 1.0 - step(0.08, cells.x) * step(cells.y, 0.92) * step(0.08, cells.y);
    col = mix(vec3(0.02, 0.05, 0.12), vec3(0.2, 0.55, 0.9), line * 0.6) * (0.6 + 0.6 * diff) + vec3(0.15, 0.35, 0.6) * pow(diff, 8.0);
  } else if (variant > 2.5) {
    float leaf = hash12(floor(vObj.xz * 14.0) + floor(vObj.y * 6.0));
    col = mix(vec3(0.02, 0.08, 0.03), vec3(0.08, 0.22, 0.08), leaf) * (0.5 + 0.7 * diff);
    float firefly = step(0.985, hash12(floor(vObj.xz * 30.0) + floor(uTime * 0.5)));
    col += vec3(0.7, 1.0, 0.4) * firefly * 2.0 * (1.0 - uRuin);
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

/** Sky dome: horizon gradient, sun/city glow, stars, optional moon and aurora. */
export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}
`;

export const skyFragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uGlowDir;
uniform float uStars;
uniform float uAurora;
uniform float uMoon;
uniform float uTime;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.05, 0.75, h), 0.7));
  // Glow from the sun below the horizon (or city light pollution).
  vec3 g = normalize(uGlowDir);
  float toward = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(g.x, 0.0, g.z))), 0.0);
  col += uGlow * pow(toward, 6.0) * (1.0 - smoothstep(0.0, 0.35, h)) * 0.9;
  col += uGlow * 0.12 * (1.0 - smoothstep(0.0, 0.2, abs(h)));
  // Stars above the haze line, twinkling.
  vec3 sp = floor(d * 380.0);
  float star = step(0.9975 - uStars * 0.0018, hash13(sp));
  float tw = 0.6 + 0.4 * sin(uTime * (1.5 + hash13(sp + 7.0) * 3.0) + hash13(sp) * 40.0);
  col += vec3(0.85, 0.92, 1.0) * star * tw * smoothstep(0.08, 0.35, h) * uStars;
  // Moon opposite the glow.
  vec3 moonDir = normalize(vec3(-g.x, 0.42, -g.z));
  float m = dot(d, moonDir);
  col += vec3(0.75, 0.85, 1.0) * uMoon * (smoothstep(0.9993, 0.9996, m) * 1.4 + pow(max(m, 0.0), 80.0) * 0.25);
  // Aurora ribbons for legendary repositories.
  if (uAurora > 0.5) {
    float band = sin(d.x * 6.0 + uTime * 0.05 + sin(d.z * 4.0 + uTime * 0.08) * 1.5);
    float a = smoothstep(0.2, 0.55, h) * (1.0 - smoothstep(0.55, 0.9, h)) * smoothstep(0.55, 1.0, band);
    col += mix(vec3(0.1, 0.9, 0.6), vec3(0.5, 0.3, 1.0), smoothstep(0.3, 0.7, h)) * a * 0.35;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Water: dark, slowly rippling, with streaks of reflected city light. */
export const waterVertex = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const waterFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uAccentA;
uniform vec3 uAccentB;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  vec2 p = vWorld.xz;
  // Gentle swell plus sparse glints of reflected city light; calm enough to sit behind the skyline.
  float swell = sin(p.x * 0.21 + uTime * 0.5) + sin(p.y * 0.17 - uTime * 0.4) + sin((p.x - p.y) * 0.11 + uTime * 0.3);
  vec3 col = uDeep * (0.9 + 0.05 * swell);
  float glint = pow(max(0.0, sin(p.x * 1.3 + swell * 2.0 + uTime * 0.9) * sin(p.y * 1.1 - swell * 1.7 + uTime * 0.7)), 24.0);
  col += mix(uAccentA, uAccentB, 0.5 + 0.5 * sin(p.x * 0.03 + p.y * 0.02)) * glint * 0.45;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Additive light beams (landmarks, searchlights): bright at the base, fading upward. */
export const beamVertex = /* glsl */ `
varying float vH;
varying vec3 vNormalV;
varying vec3 vView;
void main() {
  vH = position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

export const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying float vH;
varying vec3 vNormalV;
varying vec3 vView;
void main() {
  // Softer at grazing angles so the cylinder reads as a volume of light.
  float facing = abs(dot(normalize(vNormalV), normalize(vView)));
  float fade = pow(1.0 - clamp(vH, 0.0, 1.0), 1.6);
  float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + vH * 6.0);
  float a = fade * facing * uIntensity * pulse;
  gl_FragColor = vec4(uColor * a, a);
}
`;

/** Rain / snow / haze particles in a box that wraps around the camera. */
export const weatherVertex = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform float uSize;
uniform float uHeight;
uniform float uFall;
uniform float uDrift;
uniform float uPixelRatio;
uniform float uPointSize;
attribute vec4 aSeed; // xyz: position in [0,1), w: random
varying float vAlpha;
void main() {
  vec3 local = aSeed.xyz;
  // Fall and sway, then wrap into a box centered on the camera so the weather is always around you.
  float y = fract(local.y - uTime * uFall * (0.8 + 0.4 * aSeed.w) / uHeight);
  float sway = sin(uTime * 0.7 + aSeed.w * 30.0) * uDrift;
  vec3 world;
  world.x = uCenter.x + (fract(local.x - uCenter.x / uSize) - 0.5) * uSize + sway;
  world.z = uCenter.z + (fract(local.z - uCenter.z / uSize) - 0.5) * uSize + sway * 0.6;
  world.y = y * uHeight;
  // Streaks: the second vertex of each rain line sits slightly above the first.
  world.y += position.y;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPointSize * uPixelRatio / max(-mv.z, 1.0) * 30.0;
  vAlpha = smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.85, 1.0, y));
}
`;

export const weatherFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uRound;
varying float vAlpha;
void main() {
  float a = uOpacity * vAlpha;
  if (uRound > 0.5) {
    float d = length(gl_PointCoord - 0.5);
    a *= smoothstep(0.5, 0.1, d);
  }
  gl_FragColor = vec4(uColor * a, a);
}
`;

/** Hologram sign: a canvas texture tinted, scanlined and flickering. */
export const hologramVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const hologramFragment = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float scan = 0.75 + 0.25 * sin(vUv.y * 420.0 - uTime * 6.0);
  float flicker = 0.92 + 0.08 * step(0.97, fract(sin(floor(uTime * 12.0) * 91.7) * 43758.5));
  float edge = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
  vec3 col = mix(uColor, tex.rgb, 0.55) * (1.2 + tex.a);
  float a = tex.a * scan * flicker * edge * uOpacity;
  gl_FragColor = vec4(col * a, a);
}
`;
