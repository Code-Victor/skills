// The GPU side: a small WebGL2 toolkit.
//   quad     a textured rectangle with opacity (and an optional soft blur for
//            single glyphs, a left-to-right clip for typing); stills, captions,
//            backgrounds, scene layers.
//   video    a recording in a rounded window: exact sub-pixel source rectangle
//            (the camera), averaged over k x k bilinear taps per output pixel so
//            a downscale and a slow zoom both stay smooth. Optional camera motion
//            blur: several sub-frame camera poses averaged.
//   callout  the ring / spotlight highlight, from a signed distance function.
//   blur     one direction of a gaussian blur, for the transitions and glass.
//   glass    a rounded panel that shows a blurred, tinted copy of what is behind.
//   grade    a layer with saturation / dim / tint (the ambient background).
//   bg       a style's animated background (GLSL function spliced into a wrapper).
//   post     the final pass: vignette, film grain, dither.
//   trans    a style's own transition (GLSL function of the two scene layers).
//   solid    a flat colour rectangle (type-on carets).
// Everything is premultiplied alpha, blended with ONE, ONE_MINUS_SRC_ALPHA.
// Positions are in output pixels with the origin at the top left. Draws can be
// put through one 2D affine (`setXf`): the window group's drift and tilt.

const VERT = `#version 300 es
uniform vec4 uRect; uniform vec2 uRes; uniform vec4 uXm; uniform vec2 uXt;
out vec2 vPx; out vec2 vC;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 px = uRect.xy + c * uRect.zw;
  vPx = px; vC = c;
  vec2 w = mat2(uXm.xy, uXm.zw) * px + uXt;      // the group's affine (identity by default)
  gl_Position = vec4(w.x / uRes.x * 2. - 1., 1. - w.y / uRes.y * 2., 0., 1.);
}`;

const SDF = `
float sdRound(vec2 p, vec2 c, vec2 hs, float r){ vec2 q = abs(p - c) - (hs - r); return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }`;
// Jimenez's interleaved gradient noise (the constants are public; see playcanvas/engine, MIT)
const IGN = `float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

const QUAD = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec4 uUV; uniform vec2 uTexSize;
uniform float uOpacity, uBright, uSigma, uClipX; uniform vec2 uClipY, uMaskY;
in vec2 vC; in vec2 vPx; out vec4 o;
vec4 tap(vec2 uv){ return (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) ? vec4(0.) : texture(uTex, uv); }
void main(){
  if (uClipX >= 0. && vPx.x > uClipX) discard;
  if (vPx.y < uClipY.x || vPx.y > uClipY.y || vPx.y < uMaskY.x || vPx.y > uMaskY.y) discard;
  vec2 uv = mix(uUV.xy, uUV.zw, vC);
  vec4 c;
  if (uSigma > 0.3) {                       // 9 x 9 gaussian taps spaced 0.75 sigma apart
    vec2 st = vec2(0.75 * uSigma) / uTexSize * sign(uUV.zw - uUV.xy);
    float tw = 0.; c = vec4(0.);
    for (int a = -4; a <= 4; a++) for (int b = -4; b <= 4; b++) {
      float w = exp(-float(a * a + b * b) * 0.28125);
      c += tap(uv + vec2(float(a), float(b)) * st) * w; tw += w;
    }
    c /= tw;
  } else c = texture(uTex, uv);
  c.rgb = min(c.rgb * uBright, vec3(c.a));
  o = c * uOpacity;
}`;

const VIDEO = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec4 uWin; uniform float uRadius, uTopR, uOpacity;
uniform vec2 uSrcOrigin, uSrcPerPx, uTexSize, uOrigin0, uPer0; uniform int uK, uN;
in vec2 vPx; out vec4 o;
${SDF}
void main(){
  float r = vPx.y < uWin.y + uWin.w * .5 ? uTopR : uRadius;
  float cov = clamp(.5 - sdRound(vPx, uWin.xy + uWin.zw * .5, uWin.zw * .5, r), 0., 1.);
  if (cov <= 0.) discard;
  vec3 acc = vec3(0.); float k = float(uK);
  int n = max(uN, 1);
  for (int s = 0; s < 12; s++) { if (s >= n) break;          // camera motion blur: n poses between last frame's camera and this one's
    float f = n > 1 ? (float(s) + .5) / float(n) : 1.;
    vec2 org = mix(uOrigin0, uSrcOrigin, f), per = mix(uPer0, uSrcPerPx, f);
    vec3 a = vec3(0.);
    for (int i = 0; i < 8; i++) { if (i >= uK) break;
      for (int b = 0; b < 8; b++) { if (b >= uK) break;
        vec2 off = (vec2(float(i), float(b)) + .5) / k - .5;
        a += texture(uTex, (org + (vPx + off - uWin.xy) * per) / uTexSize).rgb;
    } }
    acc += a / (k * k);
  }
  o = vec4(acc / float(n), 1.) * (cov * uOpacity);
}`;

const CALLOUT = `#version 300 es
precision highp float;
uniform vec4 uWin; uniform float uWinR, uTopR;
uniform vec4 uBox; uniform float uBoxR, uRing, uOpacity, uFillA, uDimA, uDash; uniform vec3 uAccent, uDim;
in vec2 vPx; out vec4 o;
${SDF}
vec4 over(vec4 top, vec4 bottom){ return top + bottom * (1. - top.a); }
void main(){
  float r = vPx.y < uWin.y + uWin.w * .5 ? uTopR : uWinR;
  float win = clamp(.5 - sdRound(vPx, uWin.xy + uWin.zw * .5, uWin.zw * .5, r), 0., 1.);
  float d = sdRound(vPx, uBox.xy, uBox.zw, uBoxR);
  float inside = clamp(.5 - d, 0., 1.);
  float ring = max(clamp(.5 - (d - uRing), 0., 1.) - inside, 0.);
  if (uDash > 0.) { vec2 q = (vPx - uBox.xy) / uBox.zw; ring *= step(.5, fract(atan(q.y, q.x) / 6.2831853 * uDash)); }
  vec4 c = vec4(uDim * uDimA, uDimA) * (1. - inside);   // everything else dims (spotlight)
  c = over(vec4(uAccent * uFillA, uFillA) * inside, c);                      // the faint tint inside (ring)
  c = over(vec4(uAccent * ring, ring), c);                                   // the outline
  o = c * (uOpacity * win);
}`;

const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDir; uniform float uSigma;   // uDir: one source texel step in uv
in vec2 vC; out vec4 o;
void main(){
  vec2 uv = vec2(vC.x, 1. - vC.y);
  float stride = max(uSigma / 4., .5);
  vec4 c = vec4(0.); float tw = 0.;
  for (int i = -12; i <= 12; i++) {
    float d = float(i) * stride;
    float w = exp(-d * d / (2. * uSigma * uSigma));
    vec2 p = uv + uDir * (float(i) * stride);
    if (p.x >= 0. && p.x <= 1. && p.y >= 0. && p.y <= 1.) c += texture(uTex, p) * w;   // outside the layer is transparent, like CSS blur()
    tw += w;
  }
  o = c / tw;
}`;

const GLASS = `#version 300 es
precision highp float;
uniform sampler2D uA, uB; uniform vec4 uBox; uniform float uRad, uOpacity, uHasB, uSat; uniform vec4 uTint; uniform vec2 uRes;
in vec2 vPx; out vec4 o;
${SDF}
void main(){
  float cov = clamp(.5 - sdRound(vPx, uBox.xy + uBox.zw * .5, uBox.zw * .5, uRad), 0., 1.);
  if (cov <= 0.) discard;
  vec2 uv = vec2(vPx.x / uRes.x, 1. - vPx.y / uRes.y);
  vec4 a = texture(uA, uv);
  if (uHasB > .5) { vec4 b = texture(uB, uv); a = b + a * (1. - b.a); }   // the layer being drawn over the frame beneath it
  float l = dot(a.rgb, vec3(.2126, .7152, .0722));
  vec3 rgb = mix(vec3(l), a.rgb, uSat);
  vec3 c = uTint.rgb + rgb * (1. - uTint.a);
  o = vec4(c, 1.) * (cov * uOpacity);
}`;

const GRADE = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform float uSat, uDim, uOpacity; uniform vec4 uTint; uniform vec4 uUV;
in vec2 vC; out vec4 o;
void main(){
  vec4 c = texture(uTex, mix(uUV.xy, uUV.zw, vC));
  float l = dot(c.rgb, vec3(.2126, .7152, .0722));
  vec3 rgb = mix(vec3(l), c.rgb, uSat) * uDim;
  rgb = uTint.rgb + rgb * (1. - uTint.a);
  o = vec4(rgb, 1.) * uOpacity;
}`;

const SOLID = `#version 300 es
precision highp float;
uniform vec4 uColor; in vec2 vPx; out vec4 o;
void main(){ o = uColor; }`;

const POST = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uRes; uniform float uFrame, uGrainFrame, uDither, uGrain, uGrainSize, uVig, uVigSoft;
in vec2 vPx; out vec4 o;
${IGN}
void main(){
  vec2 uv = vec2(vPx.x / uRes.x, 1. - vPx.y / uRes.y);
  vec3 c = texture(uTex, uv).rgb;
  if (uVig > 0.) {                                           // darken toward the corners: 0 in the middle, 1 at the corners
    float r = length((vPx / uRes - .5) * 2.) / 1.41421356;
    c *= 1. - uVig * smoothstep(1. - uVigSoft, 1., r);
  }
  vec2 seed = vPx + 5.588238 * mod(uGrainFrame, 64.);   // dither follows the noise clock too (post.grainClock)
  if (uGrain > 0.) {                                         // luminance film grain, triangular, at uGrainSize px
    vec2 g = floor(vPx / uGrainSize) + 5.588238 * mod(uGrainFrame, 64.);
    c += (ign(g) + ign(g + vec2(37., 17.)) - 1.) * uGrain;
  }
  if (uDither > 0.) c += vec3(ign(seed) + ign(seed + vec2(37., 17.)) - 1., ign(seed + vec2(11., 29.)) + ign(seed + vec2(53., 3.)) - 1., ign(seed + vec2(7., 41.)) + ign(seed + vec2(23., 59.)) - 1.) * (uDither / 255.);
  o = vec4(c, 1.);
}`;

export class GL {
  constructor(canvas, W, H) {
    this.W = W; this.H = H; this.cw = W; this.ch = H;
    const gl = (this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }));
    if (!gl) throw new Error('WebGL2 is not available in this Chrome');
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    this.progs = {
      quad: this.program(QUAD, ['uTex', 'uUV', 'uTexSize', 'uOpacity', 'uBright', 'uSigma', 'uClipX', 'uClipY', 'uMaskY']),
      video: this.program(VIDEO, ['uTex', 'uWin', 'uRadius', 'uTopR', 'uOpacity', 'uSrcOrigin', 'uSrcPerPx', 'uTexSize', 'uK', 'uN', 'uOrigin0', 'uPer0']),
      callout: this.program(CALLOUT, ['uWin', 'uWinR', 'uTopR', 'uBox', 'uBoxR', 'uRing', 'uOpacity', 'uFillA', 'uDimA', 'uAccent', 'uDim', 'uDash']),
      blur: this.program(BLUR, ['uTex', 'uDir', 'uSigma']),
      glass: this.program(GLASS, ['uA', 'uB', 'uBox', 'uRad', 'uOpacity', 'uHasB', 'uSat', 'uTint']),
      grade: this.program(GRADE, ['uTex', 'uSat', 'uDim', 'uOpacity', 'uTint', 'uUV']),
      solid: this.program(SOLID, ['uColor']),
      post: this.program(POST, ['uTex', 'uFrame', 'uGrainFrame', 'uDither', 'uGrain', 'uGrainSize', 'uVig', 'uVigSoft']),
    };
    this.custom = new Map();
    this.xf = null;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    this.fbos = {};
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }

  program(frag, uniforms, extraVert = VERT) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, extraVert)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = { uRect: gl.getUniformLocation(p, 'uRect'), uRes: gl.getUniformLocation(p, 'uRes'), uXm: gl.getUniformLocation(p, 'uXm'), uXt: gl.getUniformLocation(p, 'uXt') };
    for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }
  /** A program built from a style's GLSL, compiled once per source. */
  customProgram(key, frag, uniforms) {
    if (!this.custom.has(key)) this.custom.set(key, this.program(frag, uniforms));
    return this.custom.get(key);
  }

  /** Put every following draw through an affine { a, b, c, d, tx, ty } (x' = a x + c y + tx), or null. */
  setXf(m) { this.xf = m; }
  use(prog, rect) {
    const gl = this.gl, m = this.xf;
    gl.useProgram(prog.p);
    gl.uniform2f(prog.u.uRes, this.cw, this.ch);
    gl.uniform4f(prog.u.uRect, rect.x, rect.y, rect.w, rect.h);
    if (m) { gl.uniform4f(prog.u.uXm, m.a, m.b, m.c, m.d); gl.uniform2f(prog.u.uXt, m.tx, m.ty); }
    else { gl.uniform4f(prog.u.uXm, 1, 0, 0, 1); gl.uniform2f(prog.u.uXt, 0, 0); }
  }

  // ---------------------------------------------------------- textures
  texture(filter = 'linear') {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { t, w: 0, h: 0 };
  }
  /** Upload an ImageBitmap (already premultiplied) as a still. */
  still(bitmap) {
    const gl = this.gl, tex = this.texture('linear');
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    tex.w = bitmap.width; tex.h = bitmap.height;
    return tex;
  }
  /** Upload a decoded VideoFrame (skipped when it is the one already there). */
  video(tex, frame) {
    if (tex.last === frame) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex.t);
    const w = frame.displayWidth, h = frame.displayHeight;
    if (tex.w !== w || tex.h !== h) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame); tex.w = w; tex.h = h; }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    tex.last = frame;
  }
  /** A render target created once per name: canvas-sized, or `div` times smaller, optionally half-float (no banding before the final dither). */
  fbo(name, div = 1, half = false) {
    if (this.fbos[name]) return this.fbos[name];
    const gl = this.gl, tex = this.texture('linear');
    const w = Math.max(2, Math.round(this.W / div)), h = Math.max(2, Math.round(this.H / div)), f16 = half && this.float;
    gl.texImage2D(gl.TEXTURE_2D, 0, f16 ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, f16 ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    tex.w = w; tex.h = h;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.t, 0);
    return (this.fbos[name] = { fb, tex, w, h });
  }
  target(f) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fb : null);
    this.cw = f ? f.w : this.W; this.ch = f ? f.h : this.H;
    gl.viewport(0, 0, this.cw, this.ch);
  }
  /** Clip drawing to a rectangle (output px, top left origin), or null for no clip. */
  scissor(r) {
    const gl = this.gl;
    if (!r) { gl.disable(gl.SCISSOR_TEST); return; }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(r.x), Math.floor(this.ch - r.y - r.h), Math.ceil(r.w) + 1, Math.ceil(r.h) + 1);
  }
  clear(r = 0, g = 0, b = 0, a = 1) { this.gl.clearColor(r, g, b, a); this.gl.clear(this.gl.COLOR_BUFFER_BIT); }
  bind(tex, unit = 0) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex.t); }
  fill() { this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4); }
  full() { return { x: 0, y: 0, w: this.cw, h: this.ch }; }

  // ---------------------------------------------------------- draws
  /** A still (or a scene layer) at a rectangle. `o`: opacity, bright, sigma (glyph blur), fbo (flip v), clipX (hide right of this x), clipY [y0, y1] (hide outside that band, in the quad's own moved position), maskY (the same but fixed on screen). */
  quad(tex, r, o = {}) {
    const gl = this.gl, P = this.progs.quad;
    this.use(P, r); this.bind(tex);
    gl.uniform1i(P.u.uTex, 0);
    gl.uniform4f(P.u.uUV, ...(o.fbo ? [0, 1, 1, 0] : [0, 0, 1, 1]));
    gl.uniform2f(P.u.uTexSize, tex.w, tex.h);
    gl.uniform1f(P.u.uOpacity, o.opacity ?? 1); gl.uniform1f(P.u.uBright, o.bright ?? 1); gl.uniform1f(P.u.uSigma, o.sigma ?? 0);
    gl.uniform1f(P.u.uClipX, o.clipX ?? -1);
    gl.uniform2f(P.u.uClipY, ...(o.clipY ?? [-1e9, 1e9]));
    gl.uniform2f(P.u.uMaskY, ...(o.maskY ?? [-1e9, 1e9]));
    this.fill();
  }
  solid(r, rgb, a) {
    const P = this.progs.solid;
    this.use(P, r);
    this.gl.uniform4f(P.u.uColor, rgb[0] * a, rgb[1] * a, rgb[2] * a, a);
    this.fill();
  }
  /**
   * A recording in a rounded window; srcOrigin/srcPerPx map output px to source px.
   * o.topR: radius of the top corners (0 under a chrome bar); o.prev: { origin, perPx, n } the previous camera, for motion blur; o.maxK: tap limit.
   */
  window(tex, win, radius, srcOrigin, srcPerPx, opacity = 1, o = {}) {
    const gl = this.gl, P = this.progs.video;
    this.use(P, { x: Math.floor(win.x) - 1, y: Math.floor(win.y) - 1, w: Math.ceil(win.w) + 3, h: Math.ceil(win.h) + 3 });
    this.bind(tex); gl.uniform1i(P.u.uTex, 0);
    gl.uniform4f(P.u.uWin, win.x, win.y, win.w, win.h); gl.uniform1f(P.u.uRadius, radius); gl.uniform1f(P.u.uTopR, o.topR ?? radius);
    gl.uniform2f(P.u.uSrcOrigin, srcOrigin[0], srcOrigin[1]); gl.uniform2f(P.u.uSrcPerPx, srcPerPx[0], srcPerPx[1]);
    const pv = o.prev;
    gl.uniform2f(P.u.uOrigin0, ...(pv ? pv.origin : srcOrigin)); gl.uniform2f(P.u.uPer0, ...(pv ? pv.perPx : srcPerPx)); gl.uniform1i(P.u.uN, pv ? pv.n : 1);
    gl.uniform2f(P.u.uTexSize, tex.w, tex.h); gl.uniform1f(P.u.uOpacity, opacity);
    const foot = Math.max(srcPerPx[0], srcPerPx[1]);
    gl.uniform1i(P.u.uK, Math.max(1, Math.min(pv && pv.n > 1 ? 2 : (o.maxK ?? 4), Math.ceil(foot))));
    this.fill();
  }
  callout(win, winR, c, topR = winR) {
    const gl = this.gl, P = this.progs.callout;
    this.use(P, win);
    gl.uniform4f(P.u.uWin, win.x, win.y, win.w, win.h); gl.uniform1f(P.u.uWinR, winR); gl.uniform1f(P.u.uTopR, topR);
    gl.uniform4f(P.u.uBox, c.cx, c.cy, c.hw, c.hh); gl.uniform1f(P.u.uBoxR, c.radius);
    gl.uniform1f(P.u.uRing, c.ring); gl.uniform1f(P.u.uOpacity, c.opacity);
    gl.uniform1f(P.u.uFillA, c.fillA); gl.uniform1f(P.u.uDimA, c.dimA); gl.uniform3f(P.u.uAccent, ...c.accent);
    gl.uniform3f(P.u.uDim, ...c.dim); gl.uniform1f(P.u.uDash, c.dash ?? 0);
    this.fill();
  }
  /** Blur a layer into another; two passes make a full gaussian. Sigma is in source texels. */
  blur(srcFbo, dstFbo, sigma, horizontal) {
    const gl = this.gl, P = this.progs.blur;
    this.target(dstFbo); this.clear(0, 0, 0, 0);
    this.use(P, this.full());
    this.bind(srcFbo.tex); gl.uniform1i(P.u.uTex, 0);
    gl.uniform2f(P.u.uDir, horizontal ? 1 / srcFbo.tex.w : 0, horizontal ? 0 : 1 / srcFbo.tex.h);
    gl.uniform1f(P.u.uSigma, sigma);
    this.fill();
  }
  /** A glass panel over the current target: `a` is the blurred frame beneath, `b` the blurred layer being drawn (or null). */
  glass(a, b, box, rad, o) {
    const gl = this.gl, P = this.progs.glass;
    this.use(P, { x: Math.floor(box.x) - 2, y: Math.floor(box.y) - 2, w: Math.ceil(box.w) + 5, h: Math.ceil(box.h) + 5 });
    this.bind(a.tex, 0); this.bind((b ?? a).tex, 1);
    gl.uniform1i(P.u.uA, 0); gl.uniform1i(P.u.uB, 1);
    gl.uniform4f(P.u.uBox, box.x, box.y, box.w, box.h); gl.uniform1f(P.u.uRad, rad);
    gl.uniform1f(P.u.uOpacity, o.opacity ?? 1); gl.uniform1f(P.u.uHasB, b ? 1 : 0); gl.uniform1f(P.u.uSat, o.saturate ?? 1);
    gl.uniform4f(P.u.uTint, ...(o.tint ?? [0, 0, 0, 0]));
    this.fill();
    gl.activeTexture(gl.TEXTURE0);
  }
  /** A layer with saturation, dim and tint, stretched over `r`. */
  grade(tex, r, o) {
    const gl = this.gl, P = this.progs.grade;
    this.use(P, r); this.bind(tex); gl.uniform1i(P.u.uTex, 0);
    gl.uniform4f(P.u.uUV, 0, 1, 1, 0);
    gl.uniform1f(P.u.uSat, o.saturate ?? 1); gl.uniform1f(P.u.uDim, o.dim ?? 1); gl.uniform1f(P.u.uOpacity, o.opacity ?? 1);
    gl.uniform4f(P.u.uTint, ...(o.tint ?? [0, 0, 0, 0]));
    this.fill();
  }
  /** The final pass: the finished frame to the canvas with vignette, grain and dither. */
  post(tex, frame, o) {
    const gl = this.gl, P = this.progs.post;
    this.use(P, this.full()); this.bind(tex); gl.uniform1i(P.u.uTex, 0);
    gl.uniform1f(P.u.uFrame, frame); gl.uniform1f(P.u.uGrainFrame, o.grainFrame ?? frame); gl.uniform1f(P.u.uDither, o.dither ?? 0); gl.uniform1f(P.u.uGrain, o.grain ?? 0);
    gl.uniform1f(P.u.uGrainSize, o.grainSize ?? 1.5); gl.uniform1f(P.u.uVig, o.vignette ?? 0); gl.uniform1f(P.u.uVigSoft, o.vignetteSoftness ?? 0.6);
    gl.disable(gl.BLEND); this.fill(); gl.enable(gl.BLEND);
  }
}
