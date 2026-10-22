"use client";

/**
 * Floating hologram over the city: repository name, owner avatar, stars and
 * topics, drawn into a canvas texture and billboarded toward the camera.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CityProfile } from "@/lib/city/profile";
import type { CityModel } from "@/lib/city/types";
import { formatCount } from "@/lib/format";
import { beamFragment, beamVertex, hologramFragment, hologramVertex } from "./shaders";
import type { SceneTheme } from "./theme";

const W = 1024;
const H = 288;

function draw(ctx: CanvasRenderingContext2D, profile: CityProfile, accent: string, avatar: HTMLImageElement | null) {
  const { signage } = profile;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  ctx.clearRect(0, 0, W, H);
  // Frame.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.65;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = accent;
  ctx.fillRect(6, 6, W - 12, H - 12);
  ctx.globalAlpha = 1;

  let x = 40;
  if (avatar) {
    const size = 200;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, H / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, x, H / 2 - size / 2, size, size);
    ctx.restore();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x + size / 2, H / 2, size / 2 + 4, 0, Math.PI * 2);
    ctx.stroke();
    x += size + 36;
  }
  const maxWidth = W - x - 40;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  let titleSize = 104;
  ctx.font = `700 ${titleSize}px ${family}`;
  while (ctx.measureText(signage.title).width > maxWidth && titleSize > 40) {
    titleSize -= 6;
    ctx.font = `700 ${titleSize}px ${family}`;
  }
  ctx.fillText(signage.title, x, 128);
  ctx.font = `500 38px ${family}`;
  ctx.fillStyle = accent;
  const stats = `${signage.owner}${signage.stars ? `  ★ ${formatCount(signage.stars)}` : ""}${signage.forks ? `  ⑂ ${formatCount(signage.forks)}` : ""}`;
  ctx.fillText(stats, x, 186, maxWidth);
  if (signage.topics.length) {
    ctx.font = `400 30px ${family}`;
    ctx.fillStyle = "#d8f6ff";
    ctx.fillText(signage.topics.map((t) => `#${t}`).join("  "), x, 238, maxWidth);
  }
}

export function Hologram({ profile, city, theme, reducedMotion }: { profile: CityProfile; city: CityModel; theme: SceneTheme; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const accent = theme.accents[0];

  const { texture, material, canvas } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.ShaderMaterial({
      vertexShader: hologramVertex,
      fragmentShader: hologramFragment,
      uniforms: {
        uMap: { value: texture },
        uColor: { value: new THREE.Color(accent) },
        uTime: { value: 0 },
        uOpacity: { value: theme.ruined ? 0.35 : 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    return { texture, material, canvas };
  }, [accent, theme.ruined]);

  // Draw once fonts are ready, and again when the avatar arrives.
  useEffect(() => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    const render = (avatar: HTMLImageElement | null) => {
      if (cancelled) return;
      draw(ctx, profile, accent, avatar);
      texture.needsUpdate = true;
    };
    render(null);
    void document.fonts?.ready.then(() => render(null));
    if (profile.signage.avatarUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => render(img);
      img.src = profile.signage.avatarUrl;
    }
    return () => {
      cancelled = true;
    };
  }, [canvas, texture, profile, accent]);

  useEffect(
    () => () => {
      texture.dispose();
      material.dispose();
    },
    [texture, material],
  );

  const pillar = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        uniforms: { uColor: { value: new THREE.Color(accent) }, uIntensity: { value: 0.45 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [accent],
  );
  const pillarGeo = useMemo(() => new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, true).translate(0, 0.5, 0), []);
  useEffect(
    () => () => {
      pillar.dispose();
      pillarGeo.dispose();
    },
    [pillar, pillarGeo],
  );

  const width = THREE.MathUtils.clamp(city.radius * 0.42, 24, 120);
  const height = (width * H) / W;
  const hub = city.plaza ?? { x: city.center.x, z: city.center.z, radius: 0 };
  // Over a plaza it hovers mid-height; over a dense grid it floats above the skyline.
  const y = city.plaza ? Math.max(18, city.maxHeight * 0.55) + height : city.maxHeight + 10 + height / 2;

  useFrame((_, dt) => {
    material.uniforms.uTime!.value += dt;
    pillar.uniforms.uTime!.value += dt;
    const g = group.current;
    if (!g) return;
    // Billboard around the vertical axis, plus a slow bob.
    g.rotation.y = Math.atan2(camera.position.x - hub.x, camera.position.z - hub.z);
    g.position.y = y + (reducedMotion ? 0 : Math.sin(material.uniforms.uTime!.value * 0.6) * 0.8);
  });

  return (
    <>
      <group ref={group} position={[hub.x, y, hub.z]}>
        <mesh material={material} renderOrder={3} raycast={() => null}>
          <planeGeometry args={[width, height]} />
        </mesh>
      </group>
      {city.plaza && (
        <mesh
          position={[hub.x, 0, hub.z]}
          scale={[3, y - height / 2, 3]}
          geometry={pillarGeo}
          material={pillar}
          raycast={() => null}
          renderOrder={2}
        />
      )}
    </>
  );
}
