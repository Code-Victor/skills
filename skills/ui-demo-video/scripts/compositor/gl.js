// The GPU side: a small WebGL2 toolkit with four programs.
//   quad     a textured rectangle with opacity (and an optional soft blur for
//            single glyphs); stills, captions, backgrounds, scene layers.
//   video    a recording in a rounded window: exact sub-pixel source rectangle
//            (the camera), averaged over k x k bilinear taps per output pixel so
//            a downscale and a slow zoom both stay smooth. (The 2D canvas snaps
//            to whole pixels and shimmers; this does not.)
//   callout  the ring / spotlight highlight, from a signed distance function.
//   blur     one direction of a gaussian blur, for the transitions.
// Everything is premultiplied alpha, blended with ONE, ONE_MINUS_SRC_ALPHA.
// Positions are in output pixels with the origin at the top left.

const VERT = `#version 300 es
uniform vec4 uRect; uniform vec2 uRes;
out vec2 vPx; out vec2 vC;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 px = uRect.xy + c * uRect.zw;
  vPx = px; vC = c;
  gl_Position = vec4(px.x / uRes.x * 2. - 1., 1. - px.y / uRes.y * 2., 0., 1.);
}`;

const SDF = `
float sdRound(vec2 p, vec2 c, vec2 hs, float r){ vec2 q = abs(p - c) - (hs - r); return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }`;

const QUAD = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec4 uUV; uniform vec2 uTexSize;
uniform float uOpacity, uBright, uSigma;
in vec2 vC; out vec4 o;
vec4 tap(vec2 uv){ return (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) ? vec4(0.) : texture(uTex, uv); }
void main(){
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
uniform sampler2D uTex; uniform vec4 uWin; uniform float uRadius, uOpacity;
uniform vec2 uSrcOrigin, uSrcPerPx, uTexSize; uniform int uK;
in vec2 vPx; out vec4 o;
${SDF}
void main(){
  float cov = clamp(.5 - sdRound(vPx, uWin.xy + uWin.zw * .5, uWin.zw * .5, uRadius), 0., 1.);
  if (cov <= 0.) discard;
  vec3 acc = vec3(0.); float k = float(uK);
  for (int a = 0; a < 8; a++) { if (a >= uK) break;
    for (int b = 0; b < 8; b++) { if (b >= uK) break;
      vec2 off = (vec2(float(a), float(b)) + .5) / k - .5;
      acc += texture(uTex, (uSrcOrigin + (vPx + off - uWin.xy) * uSrcPerPx) / uTexSize).rgb;
  } }
  o = vec4(acc / (k * k), 1.) * (cov * uOpacity);
}`;

const CALLOUT = `#version 300 es
precision highp float;
uniform vec4 uWin; uniform float uWinR;
uniform vec4 uBox; uniform float uBoxR, uRing, uOpacity, uFillA, uDimA; uniform vec3 uAccent;
in vec2 vPx; out vec4 o;
${SDF}
vec4 over(vec4 top, vec4 bottom){ return top + bottom * (1. - top.a); }
void main(){
  float win = clamp(.5 - sdRound(vPx, uWin.xy + uWin.zw * .5, uWin.zw * .5, uWinR), 0., 1.);
  float d = sdRound(vPx, uBox.xy, uBox.zw, uBoxR);
  float inside = clamp(.5 - d, 0., 1.);
  float ring = max(clamp(.5 - (d - uRing), 0., 1.) - inside, 0.);
  vec4 c = vec4(vec3(10., 10., 14.) / 255. * uDimA, uDimA) * (1. - inside);   // everything else dims (spotlight)
  c = over(vec4(uAccent * uFillA, uFillA) * inside, c);                      // the faint tint inside (ring)
  c = over(vec4(uAccent * ring, ring), c);                                   // the outline
  o = c * (uOpacity * win);
}`;

const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDir; uniform float uSigma;   // uDir: one texel step in uv
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

export class GL {
  constructor(canvas, W, H) {
    this.W = W; this.H = H;
    const gl = (this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }));
    if (!gl) throw new Error('WebGL2 is not available in this Chrome');
    this.progs = {
      quad: this.program(QUAD, ['uTex', 'uUV', 'uTexSize', 'uOpacity', 'uBright', 'uSigma']),
      video: this.program(VIDEO, ['uTex', 'uWin', 'uRadius', 'uOpacity', 'uSrcOrigin', 'uSrcPerPx', 'uTexSize', 'uK']),
      callout: this.program(CALLOUT, ['uWin', 'uWinR', 'uBox', 'uBoxR', 'uRing', 'uOpacity', 'uFillA', 'uDimA', 'uAccent']),
      blur: this.program(BLUR, ['uTex', 'uDir', 'uSigma']),
    };
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    this.fbos = {};
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }

  program(frag, uniforms) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = { uRect: gl.getUniformLocation(p, 'uRect'), uRes: gl.getUniformLocation(p, 'uRes') };
    for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }

  use(prog, rect) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.uniform2f(prog.u.uRes, this.W, this.H);
    gl.uniform4f(prog.u.uRect, rect.x, rect.y, rect.w, rect.h);
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
  /** A render target the size of the canvas, created once per name. */
  fbo(name) {
    if (this.fbos[name]) return this.fbos[name];
    const gl = this.gl, tex = this.texture('linear');
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    tex.w = this.W; tex.h = this.H;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.t, 0);
    return (this.fbos[name] = { fb, tex });
  }
  target(f) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fb : null);
    gl.viewport(0, 0, this.W, this.H);
  }
  /** Clip drawing to a rectangle (output px, top left origin), or null for no clip. */
  scissor(r) {
    const gl = this.gl;
    if (!r) { gl.disable(gl.SCISSOR_TEST); return; }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(r.x), Math.floor(this.H - r.y - r.h), Math.ceil(r.w) + 1, Math.ceil(r.h) + 1);
  }
  clear(r = 0, g = 0, b = 0, a = 1) { this.gl.clearColor(r, g, b, a); this.gl.clear(this.gl.COLOR_BUFFER_BIT); }
  bind(tex, unit = 0) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex.t); }
  fill() { this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4); }

  // ---------------------------------------------------------- draws
  /** A still (or a scene layer) at a rectangle. `o`: opacity, bright, sigma (glyph blur), fbo (flip v). */
  quad(tex, r, o = {}) {
    const gl = this.gl, P = this.progs.quad;
    this.use(P, r); this.bind(tex);
    gl.uniform1i(P.u.uTex, 0);
    gl.uniform4f(P.u.uUV, ...(o.fbo ? [0, 1, 1, 0] : [0, 0, 1, 1]));
    gl.uniform2f(P.u.uTexSize, tex.w, tex.h);
    gl.uniform1f(P.u.uOpacity, o.opacity ?? 1); gl.uniform1f(P.u.uBright, o.bright ?? 1); gl.uniform1f(P.u.uSigma, o.sigma ?? 0);
    this.fill();
  }
  /** A recording in a rounded window; srcOrigin/srcPerPx map output px to source px. */
  window(tex, win, radius, srcOrigin, srcPerPx, opacity = 1) {
    const gl = this.gl, P = this.progs.video;
    this.use(P, { x: Math.floor(win.x) - 1, y: Math.floor(win.y) - 1, w: Math.ceil(win.w) + 3, h: Math.ceil(win.h) + 3 });
    this.bind(tex); gl.uniform1i(P.u.uTex, 0);
    gl.uniform4f(P.u.uWin, win.x, win.y, win.w, win.h); gl.uniform1f(P.u.uRadius, radius);
    gl.uniform2f(P.u.uSrcOrigin, srcOrigin[0], srcOrigin[1]); gl.uniform2f(P.u.uSrcPerPx, srcPerPx[0], srcPerPx[1]);
    gl.uniform2f(P.u.uTexSize, tex.w, tex.h); gl.uniform1f(P.u.uOpacity, opacity);
    const foot = Math.max(srcPerPx[0], srcPerPx[1]);
    gl.uniform1i(P.u.uK, Math.max(1, Math.min(4, Math.ceil(foot))));
    this.fill();
  }
  callout(win, winR, c) {
    const gl = this.gl, P = this.progs.callout;
    this.use(P, win);
    gl.uniform4f(P.u.uWin, win.x, win.y, win.w, win.h); gl.uniform1f(P.u.uWinR, winR);
    gl.uniform4f(P.u.uBox, c.cx, c.cy, c.hw, c.hh); gl.uniform1f(P.u.uBoxR, c.radius);
    gl.uniform1f(P.u.uRing, c.ring); gl.uniform1f(P.u.uOpacity, c.opacity);
    gl.uniform1f(P.u.uFillA, c.fillA); gl.uniform1f(P.u.uDimA, c.dimA); gl.uniform3f(P.u.uAccent, ...c.accent);
    this.fill();
  }
  /** Blur a canvas-sized layer into another; two passes make a full gaussian. */
  blur(srcFbo, dstFbo, sigma, horizontal) {
    const gl = this.gl, P = this.progs.blur;
    this.target(dstFbo); this.clear(0, 0, 0, 0);
    this.use(P, { x: 0, y: 0, w: this.W, h: this.H });
    this.bind(srcFbo.tex); gl.uniform1i(P.u.uTex, 0);
    gl.uniform2f(P.u.uDir, horizontal ? 1 / this.W : 0, horizontal ? 0 : 1 / this.H);
    gl.uniform1f(P.u.uSigma, sigma);
    this.fill();
  }
}
