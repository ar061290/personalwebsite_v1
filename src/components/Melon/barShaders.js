// ─────────────────────────────────────────────────────────────
//  WGSL for the dark theme's chocolate bar: the user's GLB (barModel.js) with its own textures.
//  One opaque pass into the same MSAA target as the jelly, then the same composite (renderer.js).
//  Same dynamic vertex buffer and uniform block as the melon (shaders.js: struct U, 84 floats); the
//  bar reads keyDir, misc.x (exposure) and the facet sweep (facet0 / facet1, slots 76–83), and keeps
//  its glTF material factors in two of the melon's colour slots:
//    flesh (36) = baseColorFactor · fleshDeep (40) = (metallicFactor, roughnessFactor, normal scale, 0)
//  Bindings: 0 uniforms · 1 base colour (sRGB texture: sampled linear) · 2 metal-roughness
//  (G = roughness, B = metalness) · 3 tangent-space normal map · 4 the glTF sampler (mipmapped) ·
//  5 the soft body's particles (position + cofactor rows of the local deformation, renderer.js).
//  The vertex shader skins: position = Σ wₖ xₖ, normal = Σ wₖ cofₖ · n (the file's normal, turned by
//  the deformation around it).
//
//  The file has no tangents, so the normal map rides a cotangent frame built per pixel from the screen
//  derivatives of the DEFORMED position and the UV (Schüler 2013): it follows the soft body's every
//  squish with no tangent skinning. Lit like a product shot on black, for the pose the bar is shown in
//  (framing.js BAR_VIEW: lying on its back as in the file, seen from the front right, above): an
//  overhead softbox just behind it whose edge lays a gradient over the flat tops, a tall strip at the
//  back left and a warm kicker at the back right that draw the edges and groove walls, a low card in
//  front for a sheen on the front wall, a glossy coat over a warm diffuse with a reddish terminator;
//  the milky filling (the bright texels) scatters.
// ─────────────────────────────────────────────────────────────
import { WGSL_COMMON, WGSL_FACET } from './shaders.js'

// light rig, in the rest frame: y = up off the table (the bar's top), the camera in front (−z), to
// the right (−x) and above
export const BAR_LIGHT = {
  keyDir: (() => {
    const d = [-0.3, 0.85, -0.45]
    const l = Math.hypot(...d)
    return d.map((v) => v / l)
  })(),
  key: 1.2,
  exposure: 1.0,
}

export const WGSL_BAR = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var baseTex: texture_2d<f32>;
@group(0) @binding(2) var mrTex: texture_2d<f32>;
@group(0) @binding(3) var nrmTex: texture_2d<f32>;
@group(0) @binding(4) var texSamp: sampler;
struct Part { x: vec4f, c0: vec4f, c1: vec4f, c2: vec4f };
@group(0) @binding(5) var<storage, read> parts: array<Part>;
` + WGSL_FACET + /* wgsl */ `
const CHOC_SSS = vec3f(1.0, 0.42, 0.22);   // what the chocolate's own scattering tints the terminator
const GLOSS = 0.66;                        // tempered shine: the file's roughness, a touch glossier

struct VIn { @location(0) rest: vec3f, @location(1) uv: vec2f, @location(2) n0: vec3f, @location(3) j: vec4u, @location(4) w: vec4f };
struct VOut { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) rest: vec3f, @location(3) uv: vec2f };
fn turned(q: Part, n: vec3f) -> vec3f { return vec3f(dot(q.c0.xyz, n), dot(q.c1.xyz, n), dot(q.c2.xyz, n)); }
@vertex fn vsBar(v: VIn) -> VOut {
  let a = parts[v.j.x];
  let b = parts[v.j.y];
  let c = parts[v.j.z];
  let d = parts[v.j.w];
  let p = a.x.xyz * v.w.x + b.x.xyz * v.w.y + c.x.xyz * v.w.z + d.x.xyz * v.w.w;
  var o: VOut;
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.wp = p;
  o.n = turned(a, v.n0) * v.w.x + turned(b, v.n0) * v.w.y + turned(c, v.n0) * v.w.z + turned(d, v.n0) * v.w.w;
  o.rest = v.rest;
  o.uv = v.uv;
  return o;
}

// the melon's post (shaders.js toDisplay): Khronos PBR Neutral + sRGB
fn neutralB(c0: vec3f) -> vec3f {
  let startC = 0.8 - 0.04;
  let desat = 0.15;
  let x = min(c0.r, min(c0.g, c0.b));
  let off = select(0.04, x - 6.25 * x * x, x < 0.08);
  var c = c0 - off;
  let peak = max(c.r, max(c.g, c.b));
  if (peak < startC) { return c; }
  let d = 1.0 - startC;
  let np = 1.0 - d * d / (peak + d - startC);
  c *= np / peak;
  let g = 1.0 - 1.0 / (desat * (peak - np) + 1.0);
  return mix(c, vec3f(np), g);
}
fn oetfB(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

// tangent-space normal → world, on the cotangent frame (∇u, ∇v) of the surface under this pixel.
// ∇u = (dPy × N · du/dx + N × dPx · du/dy) / det with det = dPx · (dPy × N); the frame is scaled by its
// longer axis, and det's sign fixes the screen's handedness (WebGPU's y runs down).
fn normalMapped(N: vec3f, dPx: vec3f, dPy: vec3f, dUx: vec2f, dUy: vec2f, tn: vec3f) -> vec3f {
  let r1 = cross(dPy, N);
  let r2 = cross(N, dPx);
  let det = dot(dPx, r1);
  let T = r1 * dUx.x + r2 * dUy.x;
  let B = r1 * dUx.y + r2 * dUy.y;
  let m = max(dot(T, T), dot(B, B));
  if (m < 1e-30 || abs(det) < 1e-30) { return N; }
  let s = sign(det) * inverseSqrt(m);
  // glTF's normal maps are +Y up in the image while v runs down it: green turns round
  return normalize(T * (s * tn.x) - B * (s * tn.y) + N * tn.z);
}

// the dark studio (rest frame, y up): see the header
fn barEnv(d: vec3f, rough: f32) -> vec3f {
  let b = 0.015 + rough * 0.6;
  var col = mix(vec3f(0.01, 0.008, 0.006), vec3f(0.028, 0.024, 0.022), smoothstep(-0.3, 0.7, d.y));
  col += vec3f(1.0, 0.97, 0.93) * 1.9 * softbox(d, normalize(vec3f(0.12, 0.8, 0.62)), vec3f(0.0, 0.0, 1.0), vec2f(0.5, 0.2), b);
  col += vec3f(1.0, 0.96, 0.9) * 2.6 * softbox(d, normalize(vec3f(0.9, 0.45, 0.35)), vec3f(0.0, 1.0, 0.0), vec2f(0.07, 0.6), b);
  col += vec3f(1.0, 0.78, 0.58) * 1.6 * softbox(d, normalize(vec3f(-0.85, 0.35, 0.5)), vec3f(0.0, 1.0, 0.0), vec2f(0.12, 0.5), b);
  col += vec3f(1.0, 0.95, 0.9) * 1.4 * softbox(d, normalize(vec3f(0.3, -0.45, -0.85)), vec3f(0.0, 1.0, 0.0), vec2f(0.8, 0.25), b * 1.4 + 0.08);
  return col;
}

@fragment fn fsBar(i: VOut) -> @location(0) vec4f {
  let P = i.wp;
  let V = normalize(u.camPos.xyz - P);
  // screen derivatives and the (implicit-LOD) texture reads first, in uniform control flow
  let dPx = dpdxFine(P);
  let dPy = dpdyFine(P);
  let dUx = dpdxFine(i.uv);
  let dUy = dpdyFine(i.uv);
  let baseS = textureSample(baseTex, texSamp, i.uv) * u.flesh;
  let mrS = textureSample(mrTex, texSamp, i.uv);
  let nS = textureSample(nrmTex, texSamp, i.uv).xyz * 2.0 - 1.0;

  var N = normalMapped(normalize(i.n), dPx, dPy, dUx, dUy, vec3f(nS.xy * u.fleshDeep.z, nS.z));
  // a mapped normal may not face further from the eye than the surface already does
  let e = dot(N, V);
  if (e < 0.02) { N = normalize(N + V * (0.02 - e)); }
  var fa = 0.0;
  if (u.facet0.x > 0.0 && u.facet0.x < 1.0) {
    let fsw = facetSweep(N, V, P, i.rest);
    N = fsw.xyz;
    fa = fsw.w;
  }

  let base = baseS.rgb;
  let metal = clamp(mrS.b * u.fleshDeep.x, 0.0, 1.0);
  // the milky filling: the bright texels
  let creamW = smoothstep(0.3, 0.65, dot(base, vec3f(0.2126, 0.7152, 0.0722)));
  let rough = clamp(mrS.g * u.fleshDeep.y, 0.05, 1.0) * mix(GLOSS, 1.0, creamW) * (1.0 - FACET_SHARPEN * fa);
  let NdV = max(dot(N, V), 1e-3);
  let L = u.keyDir.xyz;
  let key = u.keyDir.w;
  let NdL = dot(N, L);

  // ── chocolate: warm diffuse with a reddish terminator (its own scattering) ──
  let wrapC = clamp((NdL + 0.45) / 1.45, 0.0, 1.0);
  let hemi = mix(vec3f(0.03, 0.026, 0.024), vec3f(0.17, 0.158, 0.15), clamp(N.y * 0.5 + 0.5, 0.0, 1.0))
           + vec3f(0.07, 0.065, 0.06) * clamp(-N.z, 0.0, 1.0);
  let chocDiff = base * (hemi + key * (max(NdL, 0.0) * 0.75 + CHOC_SSS * wrapC * wrapC * 0.35));
  // ── filling: soft and milky, light diffuses deep into it (a broad wrap, a strong milky ambient) ──
  let wrapF = clamp((NdL + 0.8) / 1.8, 0.0, 1.0);
  let creamDiff = base * (vec3f(0.42, 0.4, 0.37) + hemi + key * (0.5 * wrapF + 0.2 * max(NdL, 0.0)) * vec3f(1.0, 0.97, 0.92));
  let diff = mix(chocDiff, creamDiff, creamW) * (1.0 - metal);

  // ── the glossy coat ──
  let F0 = mix(vec3f(mix(mix(0.048, 0.02, creamW), FACET_F0, fa)), base, metal);
  let Fr = F0 + (max(vec3f(1.0 - rough), F0) - F0) * pow(1.0 - NdV, 5.0);
  let env = barEnv(reflect(-V, N), rough);
  let spec = ggx(N, V, L, max(rough, 0.12)) * key * vec3f(1.0, 0.96, 0.9);
  let col = diff * (1.0 - Fr) + env * Fr + spec * (F0 / 0.04) * 0.9 * (1.0 - 0.6 * creamW);

  let o = oetfB(clamp(neutralB(max(col * u.misc.x, vec3f(0.0))), vec3f(0.0), vec3f(1.0)));
  return vec4f(clamp(o + (hash3(vec3f(i.pos.xy, 1.0)) - 0.5) / 255.0, vec3f(0.0), vec3f(1.0)), 1.0);
}
`
