"use client";

import {
  Geometry,
  GlProgram,
  Mesh,
  Shader,
  type TextureSource,
} from "pixi.js";

// Bump this whenever the shader source changes so HMR evicts stale meshes.
// (The module-load console.log was a dev-iteration helper and removed in
// the production-ready audit — version still useful as a code-side marker.)
const SMOKE_SHADER_VERSION = "v17-jittered-outer-ring";
void SMOKE_SHADER_VERSION; // referenced for the doc; no runtime effect

// =============================================================================
// CS2.CAM smoke shader, rendered as a Mesh (NOT a Sprite + Filter).
//
// The previous Filter-based approach suffered from a subtle bug at
// high zoom + pan: Pixi's filter system intersects the filter's
// render target with the viewport. When the sprite extended past
// the visible area (or in some intermediate cases), the filter
// output got CROPPED, and `vTextureCoord` no longer mapped UV [0,1]
// onto the full sprite. That made the puff cluster appear to drift
// inside the sprite as the camera moved or zoomed — the "smoke
// moves with the camera" bug.
//
// A Mesh ignores the viewport-intersection step. Its UVs come
// straight from vertex attributes, so they're stable regardless of
// what the camera does. We use a 4-vertex centred quad: positions
// [-0.5, +0.5], UVs [0, 1].
//
// Visual: cluster of ~18 small solid discs scattered inside the
// smoke radius via golden-angle (phyllotactic) spiral, with per-puff
// wall mask sampling so the cluster conforms to walkable geometry.
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
uniform float uBloom;
uniform float uDissipate;
uniform float uSeed;

// World-space transform — converts puff centres (mesh-local
// [-0.5, +0.5]) to wall-mask UVs.
uniform vec2 uSmokeWorld;   // smoke centre in viewport (world) coords
uniform float uSpriteSize;  // mesh side length in viewport coords
uniform float uMapSize;     // wall mask is mapSize x mapSize

uniform sampler2D uWallMask;

// HE-in-smoke 'hole' effect (CS2 mechanic — when an HE detonates
// inside / next to a smoke, the cloud visibly opens up and reforms
// over ~2.5 s). All three uniforms come from the JS side; the
// shader just carves an alpha hole at uHoleCenter with radius
// uHoleRadius, ramping by uHoleStrength.
//   - uHoleCenter   : world coords of the HE detonation point
//   - uHoleRadius   : current radius of the hole in world units
//   - uHoleStrength : 0..1 (0 = no effect, 1 = fully open hole)
// When no HE is active, JS passes uHoleStrength = 0 which makes
// the mix(1.0, hole, 0.0) line below a no-op.
uniform vec2 uHoleCenter;
uniform float uHoleRadius;
uniform float uHoleStrength;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

const float TAU = 6.28318530718;
const int N_PUFFS = 25;

// Defined-shape smoke cluster.
//
// Every smoke now renders with the SAME deterministic puff layout — a
// dense, near-circular fill of the 120 u radius. Identical smokes in
// identical spots look identical (the cs2.cam behaviour); variation
// between smokes comes from where they LAND, not from per-smoke RNG.
//
// Layout: 1 centre puff + 3 concentric rings (6 + 8 + 10 puffs) =
// 25 puffs total. Rings are stepped at 0.16 / 0.30 / 0.44 (mesh-local
// half-extent ≤ 0.5) so the outermost puffs touch the bounding circle
// of the mesh and the smoke visually fills its full defined size when
// unobstructed. Per-puff radius ≈ 0.135–0.155 produces overlapping
// discs across the entire surface — no visible gaps between puffs.
//
// 'seed' is still accepted as a parameter so the per-smoke uniform
// stays compatible, but it only nudges the angular offset of each
// ring by a few degrees — JUST enough that two smokes in the same
// place aren't pixel-perfect clones, without changing the recognisable
// outline.
void getPuff(int i, float seed, out vec2 center, out float radius) {
  // Centre puff — fills the core so the cluster reads as a solid
  // disc, not a doughnut.
  if (i == 0) {
    center = vec2(0.0, 0.0);
    radius = 0.155;
    return;
  }

  float fi = float(i);

  // Ring assignment. We branch on the puff index so each ring has a
  // distinct radius + slice count + angular offset. The compiler
  // unrolls these branches inside the 'for' loop in main() because
  // the loop trip count is constant.
  float ringR;
  float ringCount;
  float ringIndex;          // 0..ringCount-1 within the ring
  float ringAngleOffset;    // base angle so adjacent rings interlock

  if (i <= 6) {
    // Ring 1: 6 puffs at r=0.16
    ringR = 0.16;
    ringCount = 6.0;
    ringIndex = fi - 1.0;
    ringAngleOffset = 0.0;
  } else if (i <= 14) {
    // Ring 2: 8 puffs at r=0.30 — offset by half a slice so puffs
    // sit BETWEEN ring-1 puffs (denser silhouette).
    ringR = 0.30;
    ringCount = 8.0;
    ringIndex = fi - 7.0;
    ringAngleOffset = 0.19635;
  } else {
    // Ring 3: 10 puffs at r ≈ 0.44 — outermost ring.
    ringR = 0.44;
    ringCount = 10.0;
    ringIndex = fi - 15.0;
    ringAngleOffset = 0.0;
  }

  // Even angular spacing within the ring + a TINY seed-driven
  // rotation (≤ 5°) so adjacent smokes aren't pixel-perfect clones
  // without breaking the recognisable shape.
  float angle = ringIndex * (TAU / ringCount) + ringAngleOffset
              + sin(seed * 0.91) * 0.087;

  // Ring-3 radial jitter — instead of placing the outer puffs on a
  // perfect circle at exactly r=0.44, we push each puff in or out by
  // up to ±0.075. The displacement is a deterministic mix of the
  // puff index and the per-smoke seed, so identical smokes look
  // identical but different smokes have different bump patterns.
  // Result: the cluster silhouette is NO LONGER a perfect circle —
  // it has 3-5 visible bumps sticking out further than others, and
  // a few indentations where puffs sat back. This matches the
  // 'chunky outline' the user marked in red on the reference shot.
  //
  // Inner rings stay symmetric — they barely affect the silhouette
  // anyway because the outer ring covers them, so adding jitter
  // there would only break the dense-fill quality of the interior.
  if (i > 14) {
    float jitter = sin(ringIndex * 1.731 + seed * 0.73)
                 + 0.55 * sin(ringIndex * 2.917 + seed * 1.21);
    ringR += jitter * 0.045;  // ≈ ±0.07 in practice
  }

  center = vec2(cos(angle) * ringR, sin(angle) * ringR);
  // Slightly bigger puffs on the inner rings — gaps between angular
  // slices are smaller in the inner rings so puffs can be larger
  // without overlapping the centre.
  radius = i <= 6 ? 0.155 : i <= 14 ? 0.145 : 0.135;
}

void main() {
  // The mesh is a centred unit quad: vTextureCoord is [0, 1] across
  // the mesh. The "centered" vector below is the position in centred [-0.5, 0.5]
  // coords — the same coordinate system the puff positions use.
  vec2 uv = vTextureCoord;
  vec2 centered = uv - 0.5;
  float distFromCenter = length(centered) * 2.0;

  // Discard the corner pixels — anything well past the puff bounding
  // ring is empty mesh real estate. Threshold pushed to 1.40 so the
  // outermost ring (puff outer edge at distFromCenter = 1.15) has a
  // generous 0.25 of AA / soft-edge headroom. The previous 1.15
  // threshold hard-cut the AA fade of every outer puff, which read
  // as sharp truncations on the cluster silhouette ("puffs cortados
  // en seco" in the user's feedback). Mesh corner max is sqrt(2) ≈
  // 1.414, so 1.40 still discards the four bare-mesh corners.
  if (distFromCenter > 1.40) discard;

  // Bloom-in frontier: clips visible area while the smoke is still
  // expanding in the first ~1.2 s after detonate. uBloom is scaled
  // by 1.45 so at full bloom (uBloom=1) the frontier sits at 1.45 —
  // past every puff outer edge — which means the smoke shape
  // settles AT FULL VISIBILITY everywhere instead of having its
  // outer puffs still clipped by the lingering frontier the way the
  // previous (uBloom=1, frontier=1.0+band) version did. Bloom
  // timing reads essentially identical because the inner puffs
  // (ring 1 + ring 2) still appear in the same order; only the
  // outermost ring fades in marginally faster. Band widens with
  // fwidth so the frontier itself stays soft at any zoom.
  float bloomFront = uBloom * 1.45;
  float bloomBand = 0.05 + fwidth(distFromCenter);
  float expansionMask = 1.0 - smoothstep(bloomFront - bloomBand, bloomFront + bloomBand, distFromCenter);

  // Screen-space AA band width — same idea as bloomBand, but driven
  // by both centered.x and centered.y so puff edges look like a
  // consistent ~1.5 screen-pixel-wide soft edge at any zoom.
  float aa = fwidth(centered.x) + fwidth(centered.y);

  float maxAlpha = 0.0;
  vec3 weightedColor = vec3(0.0);
  float colorWeight = 0.0;

  for (int i = 0; i < N_PUFFS; i++) {
    vec2 c;
    float r;
    getPuff(i, uSeed, c, r);

    // PER-PUFF WALL SAMPLING.
    // Convert the puff centre (mesh-local) to viewport coords, then
    // to wall-mask UV. textureLod(.., 0.0) forces mip 0 so the sample
    // is byte-identical at any zoom (no mip-level drift).
    //
    // Threshold widened from (0.30, 0.80) → (0.05, 0.50) so a puff
    // whose centre lands JUST outside the walkable area still renders
    // partially. The nav-mesh that drives the mask is more
    // conservative than the visual wall edge in the radar image —
    // strict thresholds left a 1-2 px gap between the smoke and the
    // wall. The softer threshold lets the soft puff edges blend into
    // the visual wall without leaking through it (alpha 0 is still
    // hard-zero, so true wall regions remain blocked).
    vec2 puffWorld = uSmokeWorld + c * uSpriteSize;
    vec2 maskUV = puffWorld / uMapSize;
    float wallAlpha = textureLod(uWallMask, maskUV, 0.0).a;
    float wallVis = smoothstep(0.05, 0.50, wallAlpha);

    // PER-PUFF DISC ALPHA + BRIGHTNESS.
    // Reverted to plain Euclidean distance (= round puffs). The
    // user wants each puff to STAY a circle — it's the OVERALL
    // outline of the cluster that should be non-circular, which
    // is handled by the per-puff radial jitter in getPuff()
    // (Ring 3 now has each puff at a slightly different distance
    // from the smoke centre, so the outer perimeter bumps in and
    // out instead of tracing a perfect circle).
    float d = length(centered - c);
    float puffAlpha = 1.0 - smoothstep(-aa, aa, d - r);
    puffAlpha *= wallVis;

    // HE-CARVED HOLE.
    // If an HE detonated inside this smoke recently, fade out puffs
    // that fall inside the hole radius. smoothstep from half the
    // radius to the full radius gives a soft edge so the smoke
    // doesn't pop a sharp ring. mix(1.0, hole, uHoleStrength) means
    // uHoleStrength=0 is a no-op (no HE active) and =1 fully applies
    // the hole.
    float puffDistToHole = length(puffWorld - uHoleCenter);
    float hole = smoothstep(uHoleRadius * 0.55, uHoleRadius, puffDistToHole);
    puffAlpha *= mix(1.0, hole, uHoleStrength);

    float t = clamp(d / r, 0.0, 1.0);
    // Darker palette than the original v11 (0.94 → 0.74) — the user
    // asked for the smoke to read a touch heavier on the radar. Centre
    // ~0.82 (#d1d1d1) and rim ~0.60 (#999999) so the puffs still feel
    // like solid CS2 smoke without going so dark they bleed into the
    // dark map background.
    float brightness = 0.82 - 0.22 * t * t;

    maxAlpha = max(maxAlpha, puffAlpha);
    weightedColor += vec3(brightness) * puffAlpha;
    colorWeight += puffAlpha;
  }

  vec3 smokeColor = weightedColor / max(colorWeight, 0.0001);
  float smokeAlpha = maxAlpha;

  float finalAlpha = smokeAlpha * expansionMask * uDissipate;
  finalAlpha = pow(finalAlpha, 0.75);

  fragColor = vec4(smokeColor, finalAlpha);
}
`;

// =============================================================================
// Geometry: centred unit quad. The mesh's scale (set per-smoke) turns
// this into a quad of (spriteSize × spriteSize) world units, centred
// on the smoke's world position.
//
// One Geometry instance is shared by every smoke Mesh — Pixi handles
// per-mesh transform via the uTransformMatrix uniform, so sharing
// geometry is safe and saves GPU memory.
// =============================================================================
let sharedGeometry: Geometry | null = null;

function getSmokeGeometry(): Geometry {
  if (!sharedGeometry) {
    // Quad extended 20 % past the original ±0.5 bounds so the
    // outer ring of puffs (centre 0.44 + radius 0.135 → outer
    // edge 0.575 in centred space) has actual fragment coverage
    // for its full circle. The previous ±0.5 mesh literally
    // didn't rasterise fragments beyond 0.5 — the outer puff
    // edges weren't being clipped by the discard or the
    // expansionMask, they simply weren't reaching the fragment
    // shader at all.
    //
    // The aUV range is shifted to match (-0.1 .. 1.1) so that
    // ``centered = uv - 0.5`` still equals ``aPosition`` at
    // every vertex. That keeps the world-space puff positions
    // identical (each puff at ``c × spriteSize`` from smoke
    // centre) — the only thing that changes is that the
    // rendered mesh now covers a slightly bigger box around
    // those puffs.
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

/**
 * Build a Mesh that renders one smoke cluster via the custom shader.
 *
 * Each smoke gets its own Shader instance so uniforms (time, bloom,
 * dissipate, seed, world transform) can be updated independently.
 * The GlProgram is shared internally by Pixi's program cache, so
 * spawning many smoke meshes does not recompile the shader.
 *
 * The wall mask texture must already be loaded — pass
 * ``Texture.WHITE.source`` as a fallback if it isn't yet (the smoke
 * will then render without wall conformance until the real mask is
 * available).
 */
export type SmokeMesh = Mesh<Geometry, Shader>;

export function createSmokeMesh(wallMaskSource: TextureSource): SmokeMesh {
  const shader = Shader.from({
    gl: {
      vertex: VERT_SRC,
      fragment: FRAG_SRC,
    },
    resources: {
      smokeUniforms: {
        uTime: { value: 0, type: "f32" },
        uBloom: { value: 0, type: "f32" },
        uDissipate: { value: 1, type: "f32" },
        uSeed: { value: 0, type: "f32" },
        uSmokeWorld: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
        uSpriteSize: { value: 1, type: "f32" },
        uMapSize: { value: 1024, type: "f32" },
        uHoleCenter: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
        uHoleRadius: { value: 1, type: "f32" },
        uHoleStrength: { value: 0, type: "f32" },
      },
      uWallMask: wallMaskSource,
    },
  });

  return new Mesh<Geometry, Shader>({
    geometry: getSmokeGeometry(),
    shader,
  });
}

/**
 * Optional HE-in-smoke "hole" effect — passed by the renderer when
 * an HE grenade detonated inside / next to this smoke recently. All
 * coords are in viewport (radar) world units; ``strength`` ramps
 * 0 → 1 → 0 over ~2.5 s and the renderer is responsible for the
 * animation. Pass ``null`` (or omit) for smokes without an active
 * hole — the shader treats it as a no-op.
 */
export interface SmokeHole {
  centerX: number;
  centerY: number;
  radius: number;
  strength: number;
}

/**
 * Update the per-smoke uniforms. Called every frame from the main
 * dynamic-redraw effect with the current playback time, bloom
 * progress, and world-space transform.
 */
export function updateSmokeMesh(
  mesh: SmokeMesh,
  time: number,
  bloom: number,
  dissipate: number,
  seed: number,
  smokeWorldX: number,
  smokeWorldY: number,
  spriteSize: number,
  mapSize: number,
  hole: SmokeHole | null = null,
): void {
  // Place + size the mesh: a unit quad centred at origin, scaled by
  // spriteSize and translated to the smoke world position.
  mesh.position.set(smokeWorldX, smokeWorldY);
  mesh.scale.set(spriteSize, spriteSize);

  // Update shader uniforms. The smokeUniforms resource is a struct
  // whose ``uniforms`` field holds the actual mutable values.
  const u = (mesh.shader!.resources.smokeUniforms as {
    uniforms: Record<string, number | Float32Array>;
  }).uniforms;
  u.uTime = time;
  u.uBloom = bloom;
  u.uDissipate = dissipate;
  u.uSeed = seed;
  const world = u.uSmokeWorld as Float32Array;
  world[0] = smokeWorldX;
  world[1] = smokeWorldY;
  u.uSpriteSize = spriteSize;
  u.uMapSize = mapSize;
  // Hole uniforms — when ``hole`` is null we set strength=0 so the
  // shader mix() collapses to a no-op. Center / radius default to
  // safe values that wouldn't accidentally affect anything if a
  // shader bug ever ignored the strength gate.
  const holeCenter = u.uHoleCenter as Float32Array;
  if (hole) {
    holeCenter[0] = hole.centerX;
    holeCenter[1] = hole.centerY;
    u.uHoleRadius = Math.max(0.001, hole.radius);
    u.uHoleStrength = Math.max(0, Math.min(1, hole.strength));
  } else {
    holeCenter[0] = 0;
    holeCenter[1] = 0;
    u.uHoleRadius = 1;
    u.uHoleStrength = 0;
  }
}

// =============================================================================
// Legacy filter-based API kept as a no-op fallback so any stale call
// sites elsewhere don't break the build. New code should call
// createSmokeMesh / updateSmokeMesh.
//
// Re-exported only so existing imports keep type-checking. They are
// implemented in terms of the Mesh API to avoid duplicating shader
// work — the Mesh return wraps a Sprite-shaped object that the caller
// will position via x/y/width/height assignments like before.
// =============================================================================
export { GlProgram };
