// GLSL a style can ask for: animated backgrounds (built in, or its own function)
// and its own transitions. The page splices the style's function into a fixed
// wrapper, so a style file never touches the engine.
//
// BACKGROUND contract. A style gives either `shader: '<builtin>'` or `glsl`, a
// function the wrapper calls once per pixel:
//     vec3 background(vec2 uv, vec2 px, float t)
//   uv  0..1 across the canvas, y DOWN;  px  the pixel position;  t  seconds * speed
// and may read:  uCol[0..5] (vec3, from background.colors, sRGB 0..1),
//   uP[0..7] (floats, from background.params), uNCol (how many colours), uRes (canvas px).
// It returns an opaque sRGB colour. Keep it slow: see styles/README.md for periods.
//
// TRANSITION contract (pure function of the two scene layers, the progress, the
// resolution and the palette):
//     vec4 transition(vec2 uv)
//   uv 0..1, y DOWN. Read the layers with getFrom(uv) / getTo(uv) (premultiplied
//   RGBA; transparent where a scene has nothing, the shared background is
//   composited UNDER the result), and uProgress (0..1), uRes, uPal[0..3] (matte,
//   foreground, accent, dim colour) and uDir (unit vector, y DOWN, from the
//   transition's "direction": left (-1,0) is the default, right, up, down).
//   Return premultiplied RGBA.

const BG_HEAD = `#version 300 es
precision highp float;
uniform float uTime; uniform vec3 uCol[6]; uniform float uP[8]; uniform float uNCol; uniform float uDither, uFrame; uniform vec2 uRes;
in vec2 vPx; out vec4 o;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
const BG_TAIL = `
void main(){
  vec3 c = background(vPx / uRes, vPx, uTime);
  if (uDither > 0.) { vec2 s = vPx + 5.588238 * mod(uFrame, 64.); c += (ign(s) + ign(s + vec2(37., 17.)) - 1.) * (uDither / 255.); }
  o = vec4(c, 1.);
}`;

// name -> { params: [[name, default, unitScaled]], glsl }
export const BUILTIN_BACKGROUNDS = {
  // Adapted from Paper Design Shaders' mesh-gradient (Apache-2.0, github.com/paper-design/shaders): colour spots on slow Lissajous orbits, inverse-distance weighted, with a centre-weighted warp and swirl.
  mesh: {
    params: [['speed', 0.15], ['distortion', 0.8], ['swirl', 0.1]],
    glsl: `
vec2 rot2(vec2 p, float a){ return mat2(cos(a), sin(a), -sin(a), cos(a)) * p; }
vec2 spot(int i, float t){ float a = float(i) * .37, b = .6 + fract(float(i) / 3.) * .9, c = .8 + fract(float(i + 1) / 4.); return .5 + .5 * vec2(sin(t * b + a), cos(t * c + a * 1.5)); }
vec3 background(vec2 uv, vec2 px, float t0){
  float t = .5 * (t0 * uP[0] + 41.5);
  float radius = smoothstep(0., 1., length(uv - .5)), center = 1. - radius;
  for (float i = 1.; i <= 2.; i++) {
    uv.x += uP[1] * center / i * sin(t + i * .4 * smoothstep(0., 1., uv.y)) * cos(.2 * t + i * 2.4 * smoothstep(0., 1., uv.y));
    uv.y += uP[1] * center / i * cos(t + i * 2. * smoothstep(0., 1., uv.x));
  }
  vec2 q = rot2(uv - .5, -3. * uP[2] * radius) + .5;
  vec3 col = vec3(0.); float tw = 0.;
  for (int i = 0; i < 6; i++) { if (float(i) >= uNCol) break;
    float d = pow(length(q - spot(i, t)), 3.5), w = 1. / (d + 1e-3);
    col += uCol[i] * w; tw += w;
  }
  return col / max(1e-4, tw);
}` },
  // Original: a few soft curtains whose height wanders slowly along x; colour is added to the base (colours[0]) with a Gaussian profile.
  aurora: {
    params: [['speed', 0.06], ['intensity', 0.4], ['height', 0.32], ['spread', 0.16]],
    glsl: `
vec3 background(vec2 uv, vec2 px, float t0){
  float t = t0 * uP[0] * 6.2831853;      // speed = cycles per second of the slowest wave
  vec3 base = uCol[0], c = base;
  for (int i = 0; i < 3; i++) { float fi = float(i);
    float yc = uP[2] + .09 * fi + .11 * sin(uv.x * (1.3 + .5 * fi) + t * (1. + .3 * fi) + fi * 2.1);
    float w = uP[3] * (1. + .3 * sin(uv.x * 2.7 + t * .7 + fi));
    float k = exp(-pow((uv.y - yc) / w, 2.)) * (.6 + .4 * sin(uv.x * 2.3 - t * .8 + fi * 1.7));
    c += (uCol[1 + i] - base) * k * uP[1];
  }
  c = mix(base, c, smoothstep(1.05, .15, uv.y));        // fades out toward the bottom
  return c;
}` },
  // Original: a dot grid that drifts slowly and fades toward the edges. colours[0] ground, colours[1] dots, colours[2] optional second ground (bottom).
  dots: {
    params: [['spacing', 28, 1], ['radius', 1.3, 1], ['drift', 4, 1], ['fade', 0.8], ['opacity', 0.5], ['gradient', 0]],
    glsl: `
vec3 background(vec2 uv, vec2 px, float t){
  vec3 ground = mix(uCol[0], uCol[2], uv.y * uP[5]);
  vec2 p = px + vec2(uP[2] * t, uP[2] * t * .5);
  vec2 g = (fract(p / uP[0]) - .5) * uP[0];
  float m = 1. - smoothstep(uP[1] - .7, uP[1] + .7, length(g));
  float mask = mix(1., smoothstep(1.1, .2, length((uv - .5) * vec2(1.25, 1.)) * 1.6), uP[3]);
  return mix(ground, uCol[1], m * uP[4] * mask);
}` },
  // Original: a line grid, same parameters as dots (width in px).
  lines: {
    params: [['spacing', 64, 1], ['width', 1, 1], ['drift', 3, 1], ['fade', 0.8], ['opacity', 0.35], ['gradient', 0]],
    glsl: `
vec3 background(vec2 uv, vec2 px, float t){
  vec3 ground = mix(uCol[0], uCol[2], uv.y * uP[5]);
  vec2 p = px + vec2(uP[2] * t, uP[2] * t * .5);
  vec2 g = abs(fract(p / uP[0]) - .5) * uP[0];
  float d = .5 * uP[0] - max(g.x, g.y);
  float m = 1. - smoothstep(uP[1] * .5 - .6, uP[1] * .5 + .6, d);
  float mask = mix(1., smoothstep(1.1, .2, length((uv - .5) * vec2(1.25, 1.)) * 1.6), uP[3]);
  return mix(ground, uCol[1], m * uP[4] * mask);
}` },
};

/** The program for a shader background token: { shader | glsl, colors, params, speed, ...named params }. */
export const backgroundProgram = (gl, bg) => {
  const b = BUILTIN_BACKGROUNDS[bg.shader];
  const glsl = bg.glsl ?? b?.glsl;
  if (!glsl) throw new Error(`unknown background shader "${bg.shader}" (built in: ${Object.keys(BUILTIN_BACKGROUNDS).join(', ')})`);
  const key = `bg|${bg.shader ?? ''}|${glsl.length}|${glsl.slice(0, 60)}${glsl.slice(-60)}`;
  return gl.customProgram(key, BG_HEAD + glsl + BG_TAIL, ['uTime', 'uCol', 'uP', 'uNCol', 'uDither', 'uFrame']);
};
/** Parameter values in order for the program: named ones from the builtin's table (length-like ones scaled by u), or `params` for a custom function. */
export const backgroundParams = (bg, u) => {
  const b = BUILTIN_BACKGROUNDS[bg.shader];
  const out = new Array(8).fill(0);
  if (bg.glsl) (bg.params ?? []).slice(0, 8).forEach((v, i) => { out[i] = v; });
  else b.params.forEach(([name, dflt, scaled], i) => { out[i] = (bg[name] ?? dflt) * (scaled ? u : 1); });
  return out;
};

const TR_HEAD = `#version 300 es
precision highp float;
uniform sampler2D uFrom, uTo; uniform float uProgress; uniform vec3 uPal[4]; uniform vec2 uRes, uDir;
in vec2 vPx; out vec4 o;
vec4 getFrom(vec2 uv){ return texture(uFrom, vec2(uv.x, 1. - uv.y)); }
vec4 getTo(vec2 uv){ return texture(uTo, vec2(uv.x, 1. - uv.y)); }
`;
export const transitionProgram = (gl, name, glsl) => gl.customProgram(`tr|${name}|${glsl.length}`, TR_HEAD + glsl + '\nvoid main(){ o = transition(vPx / uRes); }', ['uFrom', 'uTo', 'uProgress', 'uPal', 'uDir']);
