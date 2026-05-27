"use client";

import {
  Geometry,
  GlProgram,
  Mesh,
  Shader,
  type TextureSource,
} from "pixi.js";

// Bump on every shader-source change so HMR evicts stale meshes.
// (Module-load console.log removed in the production-ready audit;
// the version constant is still useful as a code-side marker.)
const MOLOTOV_SHADER_VERSION = "v8-mesh-extended-wall-parity";
void MOLOTOV_SHADER_VERSION; // referenced for the doc; no runtime effect

// =============================================================================
// CS2-radar-style molotov / incendiary — single solid filled blob + central icon.
//
// All puff centres contribute to a metaball implicit field. Where the
// field exceeds a threshold the pixel is "inside" the fire zone and
// gets a flat solid fill. 
// At the exact detonation centre, a static ring icon is drawn (bright
// orange stroke, dark brown fill) to match the CS2 radar inferno marker.
//
// Team palette is set via a uniform so the same shader handles both
// T molotov and CT incendiary without recompiling.
// =============================================================================

const VERT_SRC = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vTextureCoord;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  vec3 pos = mvp * vec3(aPosition, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  vTextureCoord = aUV;
}
`;

const FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 fragColor;

uniform float uTime;
uniform float uSpread;     // 0..1 — fire growth (0 = pinpoint, 1 = full radius)
uniform float uBurnout;    // 1..0 — alpha multiplier as fire dies
uniform float uSeed;

uniform vec2 uFireWorld;
uniform float uSpriteSize;
uniform float uMapSize;
uniform sampler2D uWallMask;

// Team palette (passed from JS so the same shader serves both molotov + inc).
uniform vec3 uColorOuter;  // central icon inner fill (dark brown)
uniform vec3 uColorBody;   // main blob fill (muted orange)
uniform vec3 uColorCore;   // central icon stroke (bright orange)
uniform vec3 uColorEmber;  // (kept for uniform compat)

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

const float TAU = 6.28318530718;
const int N_PUFFS = 22;

// Ring layout — positions serve as metaball centres that fuse into
// one organic blob. Radii control contribution falloff.
void getPuff(int i, float seed, out vec2 center, out float radius, out float phase) {
  if (i == 0) {
    center = vec2(0.0, 0.0);
    radius = 0.13;
    phase = 0.0;
    return;
  }

  float fi = float(i);
  float ringR, ringCount, ringIndex, ringAngleOffset;

  if (i <= 6) {
    ringR = 0.18;  ringCount = 6.0;
    ringIndex = fi - 1.0;  ringAngleOffset = 0.0;
  } else if (i <= 13) {
    ringR = 0.30;  ringCount = 7.0;
    ringIndex = fi - 7.0;  ringAngleOffset = 0.225;
  } else {
    ringR = 0.42;  ringCount = 8.0;
    ringIndex = fi - 14.0;  ringAngleOffset = 0.0;
  }

  float angle = ringIndex * (TAU / ringCount) + ringAngleOffset
              + sin(seed * 0.91) * 0.087;
  center = vec2(cos(angle) * ringR, sin(angle) * ringR);
  radius = i <= 6 ? 0.12 : i <= 13 ? 0.11 : 0.10;
  phase = hash21(vec2(fi, seed * 0.31)) * TAU;
}

void main() {
  vec2 uv = vTextureCoord;
  vec2 centered = uv - 0.5;
  float distFromCenter = length(centered) * 2.0;

  // Discard threshold matches the smoke shader's outer-puff fix.
  // Ring-3 outer edge sits at distFromCenter ≈ 1.04, AA tail
  // extends a touch further. 1.40 lets that AA fade fully while
  // still discarding the four bare-mesh corners (corner max at
  // the ±0.6 mesh ≈ 1.70).
  if (distFromCenter > 1.40) discard;

  // Scaled spread frontier — same trick as the smoke's
  // bloomFront = uBloom * 1.45. At full spread (uSpread=1) the
  // frontier lands at 1.45, past every puff outer edge, so the
  // steady-state fire isn't being clipped by the spread
  // animation mask. Spread-in still reads identical (inner
  // puffs come up first; outer ring resolves marginally
  // faster).
  float spreadFront = uSpread * 1.45;
  float spreadBand = 0.06 + fwidth(distFromCenter);
  float spreadMask = 1.0 - smoothstep(spreadFront - spreadBand, spreadFront + spreadBand, distFromCenter);
  float aa = fwidth(centered.x) + fwidth(centered.y);

  // Per-puff MAX blending. Each puff is a soft disc with its own
  // radial gradient + flicker; at each fragment the brightest
  // covering puff wins. Replaces the v7 "metaball + central ring"
  // composite which read as a flat blob with a misplaced icon
  // sticker rather than fire. Form is preserved (same 22 puffs,
  // same ring radii) — only the rendering changes.
  vec3 bestColor = vec3(0.0);
  float bestAlpha = 0.0;

  for (int i = 0; i < N_PUFFS; i++) {
    vec2 c;
    float r;
    float phase;
    getPuff(i, uSeed, c, r, phase);

    // PER-PUFF WALL SAMPLING — fire doesn't burn through walls.
    // Same threshold the smoke shader uses (0.05, 0.50) so the
    // two visuals conform to walls the same way.
    vec2 puffWorld = uFireWorld + c * uSpriteSize;
    vec2 maskUV = puffWorld / uMapSize;
    float wallAlpha = textureLod(uWallMask, maskUV, 0.0).a;
    float wallVis = smoothstep(0.05, 0.50, wallAlpha);

    // Per-puff flicker — ±12 % alpha, ±4 % radius. Frequencies
    // staggered via the stable per-puff phase value so neighbouring
    // puffs don't pulse in lockstep.
    float flick = 0.88 + sin(uTime * 5.5 + phase) * 0.12;
    float radiusMod = 1.0 + sin(uTime * 4.3 + phase * 1.3) * 0.04;
    float rr = r * radiusMod;

    float d = length(centered - c);
    float puffAlpha = 1.0 - smoothstep(rr - aa * 1.2, rr + aa * 0.8, d);
    puffAlpha *= wallVis * flick;

    if (puffAlpha < 0.001) continue;

    // t is 0 at the puff centre, 1 at its outer edge — drives the
    // four-stop gradient ember → core → body → outer rim.
    float t = clamp(d / rr, 0.0, 1.0);
    vec3 col;
    if (t < 0.20) {
      col = mix(uColorEmber, uColorCore, t / 0.20);
    } else if (t < 0.50) {
      col = mix(uColorCore, uColorBody, (t - 0.20) / 0.30);
    } else {
      col = mix(uColorBody, uColorOuter, smoothstep(0.50, 1.0, t));
    }

    if (puffAlpha > bestAlpha) {
      bestAlpha = puffAlpha;
      bestColor = col;
    }
  }

  float finalAlpha = bestAlpha * spreadMask * uBurnout;
  // Slight gamma so the cluster doesn't go too dim at the edges
  // — matches the smoke shader's pow(.., 0.85) tone curve.
  finalAlpha = pow(finalAlpha, 0.85);

  // Premultiplied alpha — Pixi expects this so the RGB doesn't
  // bleed into background pixels where alpha = 0.
  vec3 outColor = bestColor * finalAlpha;
  fragColor = vec4(outColor, finalAlpha);
}
`;

// =============================================================================
// Geometry — shared centred unit quad. Identical to the smoke geometry
// but kept separate so each shader owns its own attribute layout in
// case the molotov layout diverges later.
// =============================================================================
let sharedGeometry: Geometry | null = null;

function getMolotovGeometry(): Geometry {
  if (!sharedGeometry) {
    // Quad extended to ±0.6 / aUV [-0.1, 1.1] — matches the smoke
    // shader's fix exactly. Ring-3 outer edge (0.42 + 0.10 = 0.52)
    // plus AA tail (~0.02) sits comfortably inside the new ±0.6
    // mesh, so the outer puffs don't get truncated by the quad
    // boundary. ``centered = uv - 0.5`` still equals ``aPosition``
    // at every vertex, so the world-space puff positions are
    // identical to before — only the rendered mesh box around the
    // cluster grows.
    sharedGeometry = new Geometry({
      attributes: {
        aPosition: new Float32Array([
          -0.6, -0.6,
           0.6, -0.6,
           0.6,  0.6,
          -0.6,  0.6,
        ]),
        aUV: new Float32Array([
          -0.1, -0.1,
           1.1, -0.1,
           1.1,  1.1,
          -0.1,  1.1,
        ]),
      },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
  }
  return sharedGeometry;
}

export type MolotovMesh = Mesh<Geometry, Shader>;

/**
 * Build a Mesh that renders one molotov / incendiary cluster.
 *
 * Team-specific colours are passed via ``updateMolotovMesh`` rather
 * than baked into the shader so a single GlProgram serves both
 * subtypes — Pixi's program cache then keeps the GPU-side state tiny.
 */
export function createMolotovMesh(wallMaskSource: TextureSource): MolotovMesh {
  const shader = Shader.from({
    gl: {
      vertex: VERT_SRC,
      fragment: FRAG_SRC,
    },
    resources: {
      molotovUniforms: {
        uTime: { value: 0, type: "f32" },
        uSpread: { value: 0, type: "f32" },
        uBurnout: { value: 1, type: "f32" },
        uSeed: { value: 0, type: "f32" },
        uFireWorld: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
        uSpriteSize: { value: 1, type: "f32" },
        uMapSize: { value: 1024, type: "f32" },
        uColorOuter: { value: new Float32Array([0.75, 0.18, 0.05]), type: "vec3<f32>" },
        uColorBody: { value: new Float32Array([1.00, 0.42, 0.10]), type: "vec3<f32>" },
        uColorCore: { value: new Float32Array([1.00, 0.78, 0.30]), type: "vec3<f32>" },
        uColorEmber: { value: new Float32Array([1.00, 0.96, 0.85]), type: "vec3<f32>" },
      },
      uWallMask: wallMaskSource,
    },
  });

  return new Mesh<Geometry, Shader>({
    geometry: getMolotovGeometry(),
    shader,
  });
}

/**
 * RGB triplet in 0..1 linear space — one entry per gradient stop.
 */
export type MolotovPalette = {
  outer: readonly [number, number, number];
  body: readonly [number, number, number];
  core: readonly [number, number, number];
  ember: readonly [number, number, number];
};

/**
 * CS2 team palettes — muted brownish-orange matching the radar style
 * plus the vibrant central ring icon.
 *
 * `body`  = solid blob fill
 * `core`  = central icon stroke (bright orange)
 * `outer` = central icon fill (dark brown)
 */
export const MOLOTOV_PALETTE: { t: MolotovPalette; ct: MolotovPalette } = {
  /** T molotov — warm terracotta-orange. */
  t: {
    outer: [0.40, 0.18, 0.08], // dark brown inner circle
    body: [0.63, 0.38, 0.22],  // muted blob
    core: [1.00, 0.45, 0.05],  // bright orange ring
    ember: [0.63, 0.38, 0.22],
  },
  /** CT incendiary — slightly warmer amber. */
  ct: {
    outer: [0.45, 0.22, 0.10], // dark brown inner circle
    body: [0.68, 0.42, 0.24],  // muted blob
    core: [1.00, 0.55, 0.10],  // bright amber-orange ring
    ember: [0.68, 0.42, 0.24],
  },
};

export function updateMolotovMesh(
  mesh: MolotovMesh,
  time: number,
  spread: number,
  burnout: number,
  seed: number,
  fireWorldX: number,
  fireWorldY: number,
  spriteSize: number,
  mapSize: number,
  palette: MolotovPalette,
): void {
  mesh.position.set(fireWorldX, fireWorldY);
  mesh.scale.set(spriteSize, spriteSize);

  const u = (mesh.shader!.resources.molotovUniforms as {
    uniforms: Record<string, number | Float32Array>;
  }).uniforms;
  u.uTime = time;
  u.uSpread = spread;
  u.uBurnout = burnout;
  u.uSeed = seed;
  const world = u.uFireWorld as Float32Array;
  world[0] = fireWorldX;
  world[1] = fireWorldY;
  u.uSpriteSize = spriteSize;
  u.uMapSize = mapSize;
  // Palette uniforms — copy into the existing Float32Array buffers
  // so Pixi's uniform-group hot path doesn't allocate.
  const outer = u.uColorOuter as Float32Array;
  outer[0] = palette.outer[0];
  outer[1] = palette.outer[1];
  outer[2] = palette.outer[2];
  const body = u.uColorBody as Float32Array;
  body[0] = palette.body[0];
  body[1] = palette.body[1];
  body[2] = palette.body[2];
  const core = u.uColorCore as Float32Array;
  core[0] = palette.core[0];
  core[1] = palette.core[1];
  core[2] = palette.core[2];
  const ember = u.uColorEmber as Float32Array;
  ember[0] = palette.ember[0];
  ember[1] = palette.ember[1];
  ember[2] = palette.ember[2];
}

// Re-exported only so existing imports keep type-checking.
export { GlProgram };
