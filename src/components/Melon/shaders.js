// ─────────────────────────────────────────────────────────────
//  WGSL (ported from the "Melon Jelly" artifact)
//  Passes: scene (seeds + bubbles over the refraction backing) ·
//          jelly back-face depth · jelly (refraction / absorption /
//          scattering / Fresnel, tone mapped per sample) · composite.
//  Removed: floor, key shadow map, contact AO, knife, mesh overlay.
// ─────────────────────────────────────────────────────────────

// Uniform block, 76 floats (304 bytes). Offsets in floats:
//  0 viewProj · 16 camPos · 20 camFwd · 24 keyDir · 28 screen · 32 vp
//  36 flesh · 40 fleshDeep · 44 pale · 48 skin · 52 stripe · 56 seed
//  60 shape · 64 misc · 68 bg · 72 backing
export const UBO_FLOATS = 76

const WGSL_COMMON = /* wgsl */ `
struct U {
  viewProj: mat4x4f,
  camPos: vec4f,     // xyz
  camFwd: vec4f,
  keyDir: vec4f,     // xyz toward light, w = intensity
  screen: vec4f,     // render texture w, h, 1/w, 1/h
  vp: vec4f,         // xy: rendered area / texture size, zw: full canvas / texture size
  flesh: vec4f,      // transmission tint of the flesh
  fleshDeep: vec4f,  // scattering albedo of the flesh
  pale: vec4f,
  skin: vec4f,
  stripe: vec4f,
  seed: vec4f,
  shape: vec4f,      // T, Ro, skinDepth, paleDepth
  misc: vec4f,       // exposure
  bg: vec4f,         // the studio: ambient light and reflections
  backing: vec4f,    // display-referred colour of the refraction backing
};

const PI = 3.14159265;

fn hash3(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash3(i + vec3f(0,0,0)), hash3(i + vec3f(1,0,0)), u.x), mix(hash3(i + vec3f(0,1,0)), hash3(i + vec3f(1,1,0)), u.x), u.y);
  let b = mix(mix(hash3(i + vec3f(0,0,1)), hash3(i + vec3f(1,0,1)), u.x), mix(hash3(i + vec3f(0,1,1)), hash3(i + vec3f(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
fn fbm(p: vec3f) -> f32 {
  return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.13 + 7.1) + 0.15 * vnoise(p * 4.37 + 3.3);
}

// rounded rectangle softbox seen along direction d
fn softbox(d: vec3f, c: vec3f, up: vec3f, size: vec2f, blur: f32) -> f32 {
  let cd = dot(d, c);
  if (cd <= 0.0) { return 0.0; }
  let t1 = normalize(cross(up, c));
  let t2 = cross(c, t1);
  let uv = vec2f(dot(d, t1), dot(d, t2)) / cd;
  let q = abs(uv) - size;
  let sd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - 0.04;
  return 1.0 - smoothstep(-blur, blur, sd);
}

// procedural photo studio: pale cyclorama, overhead softbox, back-left strip, front-right fill card
fn studioEnv(d: vec3f, rough: f32, bg: vec3f) -> vec3f {
  let b = 0.012 + rough * 0.55;
  let y = d.y;
  var col = mix(bg * 0.62, bg * 1.05, smoothstep(-0.35, 0.25, y));
  col += bg * 0.55 * (1.0 - smoothstep(0.0, 0.3, abs(y + 0.08)));
  col = mix(col, bg * 0.8, smoothstep(0.3, 1.0, y));
  col += vec3f(1.0, 0.985, 0.96) * 3.2 * softbox(d, normalize(vec3f(0.05, 1.0, -0.15)), vec3f(0.0, 0.0, 1.0), vec2f(0.55, 0.32), b);
  col += vec3f(1.0, 0.98, 0.95) * 3.0 * softbox(d, normalize(vec3f(-0.42, 0.34, -0.8)), vec3f(0.0, 1.0, 0.0), vec2f(0.7, 0.06), b);
  col += vec3f(1.0, 0.97, 0.93) * 4.0 * softbox(d, normalize(vec3f(-0.8, 0.38, -0.2)), vec3f(0.0, 1.0, 0.0), vec2f(0.08, 0.55), b);
  col += vec3f(0.95, 0.97, 1.0) * 1.2 * softbox(d, normalize(vec3f(0.85, 0.3, 0.55)), vec3f(0.0, 1.0, 0.0), vec2f(0.45, 0.5), b * 1.3);
  return col;
}

fn ggx(N: vec3f, V: vec3f, L: vec3f, rough: f32) -> f32 {
  let H = normalize(V + L);
  let a = max(rough * rough, 0.002);
  let a2 = a * a;
  let NdH = max(dot(N, H), 0.0);
  let NdL = max(dot(N, L), 0.0);
  let NdV = max(dot(N, V), 1e-3);
  let dd = NdH * NdH * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * dd * dd);
  let k = a * 0.5;
  let G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  return D * G / max(4.0 * NdL * NdV, 1e-3) * NdL;
}

fn linearDepth(p: vec3f) -> f32 { return dot(p - u.camPos.xyz, u.camFwd.xyz); }
`

// ── scene: seeds + bubbles (the backing itself is the clear colour) ──
export const WGSL_SCENE = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;

struct VIn { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) rest: vec3f, @location(3) mat: f32 };
struct VOut { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) rest: vec3f, @location(3) mat: f32 };
@vertex fn vsMesh(v: VIn) -> VOut {
  var o: VOut;
  o.pos = u.viewProj * vec4f(v.p, 1.0);
  o.wp = v.p; o.n = v.n; o.rest = v.rest; o.mat = v.mat;
  return o;
}

@fragment fn fsProps(i: VOut) -> @location(0) vec4f {
  let N = normalize(i.n);
  let V = normalize(u.camPos.xyz - i.wp);
  let NdV = max(dot(N, V), 1e-3);
  let L = u.keyDir.xyz;
  var col: vec3f;
  if (i.mat < 1.5) {
    // seed: dark, lacquered, faint warm brown where it thins out
    let fres = 0.05 + 0.95 * pow(1.0 - NdV, 5.0);
    let n1 = vnoise(i.rest * 90.0);
    var base = u.seed.rgb * (0.8 + 0.4 * n1);
    let rim = pow(1.0 - NdV, 2.0);
    base += vec3f(0.09, 0.035, 0.015) * rim;
    let dif = max(dot(N, L), 0.0) * 0.5 + 0.35;
    let env = studioEnv(reflect(-V, N), 0.22, u.bg.rgb);
    // seeds sit just under the jelly skin, so the jelly supplies the gloss; keep the seed itself matte-dark
    col = base * dif + min(env, vec3f(0.5)) * fres * 0.06;
  } else {
    // air bubble: soft and low-contrast, a lighter pocket with a faint rim and one pin-point highlight
    let rim = pow(1.0 - NdV, 2.0);
    col = mix(vec3f(0.9, 0.84, 0.82), vec3f(0.62, 0.55, 0.55), rim) + vec3f(ggx(N, V, L, 0.08)) * 0.5;
  }
  return vec4f(col, linearDepth(i.wp));
}
`

// ── back faces → linear depth (for view-ray thickness) ──
export const WGSL_BACK = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
struct VIn { @location(0) p: vec3f };
struct VOut { @builtin(position) pos: vec4f, @location(0) wp: vec3f };
@vertex fn vs(v: VIn) -> VOut { var o: VOut; o.pos = u.viewProj * vec4f(v.p, 1.0); o.wp = v.p; return o; }
@fragment fn fs(i: VOut) -> @location(0) vec4f { return vec4f(linearDepth(i.wp), 0.0, 0.0, 1.0); }
`

// ── the jelly itself ──
export const WGSL_JELLY = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var backTex: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;

struct VIn { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) rest: vec3f, @location(3) mat: f32 };
struct VOut { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) rest: vec3f };
@vertex fn vsJelly(v: VIn) -> VOut {
  var o: VOut;
  o.pos = u.viewProj * vec4f(v.p, 1.0);
  o.wp = v.p; o.n = v.n; o.rest = v.rest;
  return o;
}

// world point → render-texture uv
fn toUV(p: vec3f) -> vec2f {
  let c = u.viewProj * vec4f(p, 1.0);
  let n = c.xy / c.w;
  return vec2f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5) * u.vp.xy;
}

// ── post (from the artifact): exposure, Khronos PBR Neutral tone mapping, sRGB ──
fn neutral(c0: vec3f) -> vec3f {
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
fn oetf(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

// HDR colour (as the artifact composed it over its backing) → premultiplied display colour.
// The neutral share m of the light that passes straight through the jelly to the backing is
// handed to the page instead: alpha = 1 − m, and the backing's display colour is taken out.
// On a page the colour of the backing this is exactly the artifact; on white, thin jelly
// lets the real page (fluid, stickers) through — no dark fringe at the rims.
fn toDisplay(col: vec3f, through: vec3f, fc: vec2f) -> vec4f {
  let s = oetf(clamp(neutral(max(col * u.misc.x, vec3f(0.0))), vec3f(0.0), vec3f(1.0)));
  let b = u.backing.rgb;
  var m = min(through.r, min(through.g, through.b));
  m = clamp(min(m, min(s.r / b.r, min(s.g / b.g, s.b / b.b))), 0.0, 1.0);
  let a = 1.0 - m;
  var o = s - b * m;
  o += (hash3(vec3f(fc, 1.0)) - 0.5) / 255.0;
  return vec4f(clamp(o, vec3f(0.0), vec3f(a)), a);
}

@fragment fn fsJelly(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var N = normalize(i.n);
  if (!ff) { N = -N; }
  let P = i.wp;
  let V = normalize(u.camPos.xyz - P);
  let L = u.keyDir.xyz;
  let key = u.keyDir.w;
  let NdV = max(dot(N, V), 1e-3);

  // ── material regions from rest-space coordinates (they deform with the body) ──
  let Q = i.rest;
  let Ro = u.shape.y;
  let r = length(Q.xz);
  let th = atan2(Q.x, Q.z);
  let wob = (fbm(vec3f(th * 9.0, Q.y * 3.0, 1.7)) - 0.5);
  let depth = Ro - r + wob * 0.018;
  let skinW = 1.0 - smoothstep(u.shape.z - 0.008, u.shape.z + 0.01, depth);
  let paleEdge = u.shape.w + wob * 0.035;
  let paleW = (1.0 - smoothstep(paleEdge - 0.035, paleEdge + 0.035, depth)) * (1.0 - skinW);
  let fleshW = 1.0 - skinW - paleW;

  // irregular stripes running across the rind, pole to pole
  let sn = fbm(vec3f(th * 5.0, Q.y * 2.2, 3.0));
  let stripeF = sin(th * 34.0 + sn * 7.0 + fbm(vec3f(th * 22.0, Q.y * 7.0, 9.0)) * 2.5);
  let stripe = smoothstep(-0.05, 0.35, stripeF) * smoothstep(0.1, 0.02, depth);
  let speck = smoothstep(0.62, 0.8, vnoise(vec3f(th * 160.0, Q.y * 40.0, 2.0)));
  var skinCol = mix(u.skin.rgb, u.stripe.rgb, clamp(stripe + speck * 0.35, 0.0, 1.0));
  // the cut face shows a lighter green inner skin band
  skinCol = mix(skinCol, mix(u.skin.rgb, u.pale.rgb, 0.35), smoothstep(0.02, 0.07, depth) * 0.6);

  // ── thickness along the view ray ──
  let uv = i.pos.xy * u.screen.zw;
  let pix = vec2i(i.pos.xy);
  let fz = linearDepth(P);
  let bz = textureLoad(backTex, pix, 0).r;
  let sz = textureLoad(sceneTex, pix, 0).a;
  let cosv = max(dot(-V, u.camFwd.xyz), 0.35);
  let thick = clamp((min(bz, sz) - fz) / cosv, 0.0, 3.0);
  let thickBack = clamp((bz - fz) / cosv, 0.0, 3.0);

  // internal texture: soft crystalline grain radiating from the heart of the melon
  let grain = fbm(vec3f(r * 26.0, th * 18.0, Q.y * 14.0));
  let grain2 = vnoise(Q * 55.0);
  let dens = 1.0 + (grain - 0.5) * 0.5 + (grain2 - 0.5) * 0.18;

  // ── absorption / scattering coefficients per material ──
  let fleshT = clamp(u.flesh.rgb, vec3f(0.002), vec3f(0.999));
  let sigF = -log(fleshT) * 3.4 * dens;
  let paleT = clamp(u.pale.rgb, vec3f(0.01), vec3f(0.999));
  let sigP = -log(paleT) * 2.0 + vec3f(0.5);
  let sigS = -log(clamp(u.skin.rgb, vec3f(0.002), vec3f(0.99))) * 3.5 + vec3f(2.0);
  let sigma = sigF * fleshW + sigP * paleW + sigS * skinW;
  let scatK = 1.7 * fleshW + 4.5 * paleW + 26.0 * skinW;
  let rough = mix(mix(0.1, 0.2, paleW), 0.14 + stripe * 0.04, skinW);

  // ── refraction: bend the view ray into the jelly, find where it leaves ──
  let ior = 1.42;
  let Rr = refract(-V, N, 1.0 / ior);
  let exitP = P + Rr * min(thickBack, 0.9) * 0.55;
  var ruv = toUV(exitP);
  ruv = mix(uv, ruv, 0.85);
  // a little diffusion inside the candy blurs what lies behind
  let blurR = (0.001 + 0.007 * min(thick, 1.0)) * (0.6 + scatK * 0.02);
  let lim = u.vp.xy - u.screen.zw;
  // each tap is absorbed over its own path length (to a seed, a bubble or out through the back)
  var transmitted = vec3f(0.0);
  var through = vec3f(0.0);
  var pathL = 0.0;
  for (var k = 0; k < 7; k++) {
    let a = f32(k) * 0.8976 + 0.3;
    let o = select(vec2f(cos(a), sin(a)) * blurR, vec2f(0.0), k == 6) * u.vp.zw;
    let s = textureSampleLevel(sceneTex, lin, clamp(ruv + o, u.screen.zw, lim), 0.0);
    let pl = clamp(min(thickBack, max(s.a - fz, 0.0) / cosv + 0.03), 0.0, 3.0);
    let tk = exp(-sigma * pl);
    transmitted += s.rgb * tk;
    through += select(vec3f(0.0), tk, s.a > 900.0);
    pathL += pl;
  }
  transmitted /= 7.0; through /= 7.0; pathL /= 7.0;
  let scat = 1.0 - exp(-scatK * pathL * 0.5 - scatK * 0.02);

  // ── light arriving inside the body ──
  let NdL = dot(N, L);
  let wrap = clamp((NdL + 0.6) / 1.6, 0.0, 1.0);
  let amb = u.bg.rgb * mix(0.3, 0.75, N.y * 0.5 + 0.5);
  // flesh brightens toward the rind, as in a real melon
  let nearPale = 1.0 - smoothstep(u.shape.w, u.shape.w + 0.3, depth);
  let fleshAlb = mix(u.fleshDeep.rgb, u.flesh.rgb * 0.9, nearPale * 0.45);
  let albedo = fleshAlb * fleshW + u.pale.rgb * 0.7 * paleW + skinCol * skinW;
  let inner = albedo * (amb + vec3f(1.0, 0.97, 0.92) * key * 0.45 * wrap);

  // thin edges glow when the key light is behind them
  let back = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * 1.4 + 0.25;
  let thinK = exp(-sigma * (pathL * 0.6 + 0.05));
  let glowTint = u.flesh.rgb * fleshW + vec3f(0.9, 0.95, 0.78) * paleW + skinCol * 0.6 * skinW;
  let glow = glowTint * thinK * back * key * 0.42 * (1.0 - skinW * 0.7) * clamp(1.0 - NdL * 0.6, 0.0, 1.0);

  // ── assemble body color ──
  var body = transmitted * (1.0 - scat) + inner * scat + glow;

  // tiny sub-surface glints in the flesh (sugar crystals)
  let R = reflect(-V, N);
  let cell = floor(Q * vec3f(70.0, 70.0, 70.0));
  let spark = step(0.985, hash3(cell)) * pow(max(dot(R, L), 0.0), 40.0) * fleshW;
  body += vec3f(1.0, 0.85, 0.8) * spark * 0.2;

  // ── surface: Fresnel reflection of the studio + key highlight ──
  let F0 = mix(0.034, 0.045, skinW);
  let F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
  let env = studioEnv(R, rough, u.bg.rgb);
  let spec = ggx(N, V, L, rough) * key * vec3f(1.0, 0.97, 0.93);
  let col = body * (1.0 - F) + env * F + spec * mix(0.9, 1.1, skinW) * (F0 / 0.04);

  return toDisplay(col, through * (1.0 - scat) * (1.0 - F), i.pos.xy);
}
`

// ── composite the rendered crop into the (transparent) canvas ──
export const WGSL_COMPOSITE = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> c: vec4f; // xy: crop origin (canvas px), zw: canvas px → texture uv
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  return vec4f(p, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  return textureSampleLevel(src, smp, (fc.xy - c.xy) * c.zw, 0.0);
}
`
