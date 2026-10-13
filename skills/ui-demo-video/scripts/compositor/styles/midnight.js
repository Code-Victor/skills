// midnight: the proving style. A near-black matte with a very slow, low-luminance
// aurora behind the window, dither + light grain + a soft vignette on the whole
// frame, a dark window with a hairline border and an inner top highlight, a glass
// caption, light text on dark cards, Geist and Geist Mono, a spring camera with a
// little motion blur, and transitions that pass through the dark background
// (never white). One accent, sentence case, no glow halos.
//
// It extends studio, so it only names what differs. Read studio.js for every token.
export default {
  name: 'midnight',
  extends: 'studio',
  description: 'Dark and cinematic: near-black ground, a slow aurora, a glass caption and a spring camera.',
  suits: 'Launch videos, dark-mode products and anything that should feel calm and premium.',

  palette: {
    background: '#06070b',
    foreground: '#f2f3f7',
    accent: '#8ab4ff',                         // the one accent
    onAccent: '#06070b',
    tagColors: { Before: '#e08a8a', After: '#8ab4ff', Tour: '#8fd6b0' },
    tagFallback: '#a7afc2',
    danger: '#e08a8a',
  },
  fonts: {
    text: { family: 'Geist', weights: [400, 500, 600], fallback: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
    display: { family: 'Geist', weights: [400, 500, 600], fallback: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
    mono: { family: 'Geist Mono', weights: [400, 500], fallback: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  },

  canvas: {
    matte: '#05060a',
    model: 'shared',                           // one background per frame: transitions pass through it
    background: {
      kind: 'shader', shader: 'aurora',        // a period of about 20 s for the slowest wave
      colors: ['#06070b', '#1b3a63', '#352c6e', '#12474a'],
      speed: 0.05, intensity: 0.26, height: 0.34, spread: 0.2,
    },
  },
  post: { dither: 2.5, grain: 0.012, grainSize: 1.4, vignette: 0.3, vignetteSoftness: 0.65 },

  window: {
    radius: 0.009,
    fill: '#0b0c10',
    shadow: '0 44px 120px rgba(0,0,0,0.7),0 14px 36px rgba(0,0,0,0.5)',
    shadowPad: 220,
    border: { width: 1, color: 'rgba(255,255,255,0.1)' },
    highlight: { color: 'rgba(255,255,255,0.16)' },
    drift: { to: 1.02 },                       // no frame is static
  },

  caption: {
    variant: 'glass', enter: 'blur', color: '#f2f3f7', weight: 500,
    glass: { blur: 18, tint: 'rgba(12,13,18,0.46)', saturate: 1.2, border: 'rgba(255,255,255,0.14)' },
    tag: { style: 'word', weight: 600 },
  },
  title: { weight: 600, subtitleOpacity: 0.62, subtitleEnter: 'blur', measure: 'glyph', tracking: { 'word-push': -0.025, 'micro-scale-fade': -0.03, 'soft-blur-in': -0.045 } },
  card: {
    fill: '#101218', border: 'rgba(255,255,255,0.09)', shadow: '0 36px 100px rgba(0,0,0,0.6)',
    metaOpacity: 0.6, statusAlpha: 0.16,
  },
  list: { iconAlpha: 0.2, subtitleOpacity: 0.6 },
  callout: { ringWidth: 2, fillAlpha: 0.06, dimAlpha: 0.5, dimColor: '#000000', chip: { size: 21 } },

  motion: {
    text: { softBlur: { stagger: 1, rise: 14, blur: 14, frames: 34, riseFrames: 14, ease: [0.22, 1, 0.36, 1] } },
  },
  camera: {
    ease: { type: 'spring', stiffness: 320, damping: 40, mass: 0.92 },   // overdamped: arrives without overshoot
    motionBlur: { shutter: 0.5, samples: 6 },
  },
  transition: {
    default: 'focus-pull', sec: 0.6,
    params: { focusPull: { bright: 1.06, brightIn: 1.05 } },             // the original brightens x1.3: a flash on a dark ground
    custom: {
      // Original: a soft diagonal wipe from the first scene to the second, a touch darker at the seam.
      'dissolve-wipe': {
        sec: 0.8,
        glsl: `
vec4 transition(vec2 uv){
  float d = uv.x * 0.85 + uv.y * 0.15, x = mix(-0.2, 1.2, uProgress);
  float m = 1. - smoothstep(x - .18, x + .18, d);
  vec4 c = mix(getFrom(uv), getTo(uv), m);
  return c * (1. - .22 * exp(-pow((d - x) / .1, 2.)));
}`,
      },
    },
  },
};
