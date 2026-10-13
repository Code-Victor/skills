// studio: today's look, exactly. Every number below is a literal that used to
// live in plan.js, scenes.js or gl.js. A new style does not repeat all of this:
// it names what it changes and `extends` the rest (see styles/README.md).
//
// Units: lengths in "u" (px at 1920 wide, scaled with the canvas) unless the
// name says a fraction of the width (W) or height (H). Times in seconds.
export default {
  name: 'studio',
  description: 'The original light look: soft gradient, white window, dark pill captions.',
  suits: 'Bug-fix before/afters, feature tours and changelogs read in Slack, PRs and docs.',

  palette: {
    background: '#ffffff',          // CSS background (any gradient) for canvas.background.kind "css"; theme.background wins
    foreground: '#111114',          // text on the canvas and on cards; theme.foreground wins
    accent: '#3b6bff',              // the one accent; theme.accent wins; any CSS colour
    onAccent: '#fff',               // text on an accent fill
    tagColors: {},                  // { Before: '#e5484d', ... }; theme.tagColors merges over this
    tagFallback: '#6ebeff',         // tag colour when the tag has none
    danger: '#e5484d',              // the issue card's quote bar when tagColors.Before is not set
  },

  fonts: {
    // family: Google Fonts family to download (null: use the fallback only). The fallback stack is what shows when offline.
    text: { family: 'Inter', weights: [500, 600, 700], fallback: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
    display: { family: 'Inter', weights: [500, 600, 700], fallback: '-apple-system, BlinkMacSystemFont, sans-serif' },
    mono: { family: null, weights: [400, 500], fallback: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  },

  canvas: {
    matte: '#ffffff',               // colour behind everything; what a fade or blur passes through
    model: 'scene',                 // "scene": each scene paints its own background (today). "shared": one background per frame, scenes draw over it
    background: { kind: 'css' },    // css | shader | ambient (see README)
  },

  post: { dither: 0, grain: 0, grainSize: 1.5, vignette: 0, vignetteSoftness: 0.6 },   // final pass: dither in LSB, grain amplitude 0..1, vignette strength 0..1

  window: {
    maxWidth: 0.9, maxHeight: 0.8,  // fractions of W and H the whole window may take
    top: 0.055, align: 'center', margin: 0.05,   // top as a fraction of H; align center|left|right with margin (fraction of W)
    radius: 0.008,                  // corner radius, fraction of W
    fill: '#fff',                   // colour behind the recording
    shadow: '0 0 0 1px rgba(0,0,0,0.06),0 24px 70px rgba(0,0,0,0.22)',   // any CSS box-shadow list
    shadowPad: 130,                 // room around the window for the shadow, px
    border: null,                   // { width: 1, color } hairline drawn OVER the recording's edge
    highlight: null,                // { color } 1px light line along the inner top edge, over the recording
    glow: null,                     // { color, blur, spread } tinted glow behind the window
    insets: [0, 0, 0, 0],           // u: room inside the shell around the recording [top, right, bottom, left]
    chrome: { kind: 'none' },       // none | browser: { height, fill, lights, url, urlText, color }
    drift: null,                    // { to: 1.035 } scene-long push-in of the whole window
    tilt: 0, tiltJitter: 0,         // degrees; a small constant tilt of the window group
  },
  split: { gap: 0.025, width: 0.92, height: 0.7, top: 0.12, labelSize: 0.0135, labelRise: 0.055 },

  caption: {
    variant: 'pill',                // pill | glass | plain | bar | mono
    placement: 'under',             // under (in the band below the window) | overlay (inside, at the bottom) | slot (the shell's own strip)
    align: 'center', size: 0.0135, offset: 0.05, inset: 0.03,   // size: fraction of W; offset: bottom gap when there is no band (H); inset: overlay gap (H)
    enter: 'fade', delay: 0.25, exit: 0.35, rise: 0.8,           // enter: fade|blur|rise|type; rise in caption heights
    blurPx: 12, blurSec: 0.22, typeCps: 30, caret: 'bar',         // blur: start radius and duration; type: chars/s; caret bar|block|none
    color: '#fff', weight: 500, textShadow: null,     // textShadow: CSS text-shadow for bar and mono (plain has its own)
    pill: { gap: 0.7, padY: 0.55, padX: 1.05, radius: 999, background: 'rgba(17,17,20,0.92)', shadow: '0 1px 0 rgba(255,255,255,0.06) inset,0 8px 24px rgba(0,0,0,0.18)', border: null },
    glass: { gap: 0.7, padY: 0.6, padX: 1.1, radius: 999, blur: 18, tint: 'rgba(24,24,30,0.38)', saturate: 1.25, border: 'rgba(255,255,255,0.16)', shadow: '0 8px 30px rgba(0,0,0,0.25)' },
    plain: { shadow: '0 2px 3px rgba(0,0,0,0.5),0 4px 16px rgba(0,0,0,0.35)', rule: null, ruleColor: null },
    bar: { barWidth: 0.2, padX: 0.9, padY: 0.2, background: null, tagSize: 0.72 },
    mono: { prompt: '>', promptColor: null },
    tag: { style: 'word', weight: 600 },     // word (coloured) | chip | bracket
  },

  title: { size: 0.042, weight: 600, align: 'center', subtitleSize: 0.0155, subtitleWeight: 500, subtitleOpacity: 0.6, subtitleEnter: 'fade', gap: 0.008, measure: 'estimate', padLeft: 0.08,
    tracking: { 'word-push': -0.02, 'micro-scale-fade': -0.03, 'soft-blur-in': -0.05 } },
  card: {
    width: 1040, padX: 60, padY: 52, radius: 28, gap: 22, fill: '#fff',
    shadow: '0 0 0 1px rgba(0,0,0,0.06),0 24px 70px rgba(0,0,0,0.16)', border: null,
    metaSize: 24, metaOpacity: 0.55, statusSize: 21, statusAlpha: 24 / 255, titleSize: 48, quoteSize: 30, reporterSize: 22, quoteBar: 4,
    rowEnter: 'rise',
  },
  list: { width: 1100, gap: 30, titleSize: 60, subtitleSize: 26, subtitleOpacity: 0.55, itemSize: 32, itemGap: 18, itemEnter: 'slide', iconSize: 30, iconAlpha: 31 / 255, align: 'center', numbered: false },

  callout: {
    mark: 'ring',                   // ring | a style builder (build.calloutMark)
    pad: 8, radius: 10, ringWidth: 2.5, fillAlpha: 20 / 255, dimAlpha: 0.42, dimColor: '#0a0a0e', scaleIn: 0.96, forSec: 2.5, enterSec: 0.35, exitSec: 0.25,
    chip: { size: 22, weight: 600, padY: 6, padX: 12, radius: 999, background: null, color: null },
  },
  logo: {},

  motion: {
    spring: { damping: 200 },       // the house spring for every enter
    clock: null,                    // { poses: 10, seed: 1, jitterPx: 1.4, jitterDeg: 0.35 }: quantise everything except the recording
    card: { rise: 14, rows: [0.15, 0.45, 0.65], alpha: [1, 0.85, 0.55] },
    list: { headRise: 14, start: 0.45, step: 0.16, dx: -18 },
    split: { stagger: 4, rise: 16 },
    text: {
      softBlur: { stagger: 1, rise: 16, blur: 12, frames: 27, riseFrames: 9, ease: [0.22, 1, 0.36, 1] },     // frames at the output rate
      microScale: { frames: 18, from: 0.96, ease: [0.32, 0.72, 0, 1] },                                       // frames at 30 fps
      wordPush: { reveal: 2, slide: 12, over: 0.5, char: 0.5, space: 0.22, gap: 10, accel: 0.8 },             // frames at 30 fps
      subtitle: { from: 0.7, to: 1.2, rise: 8 },
    },
  },
  camera: { ease: { type: 'bezier', curve: [0.65, 0, 0.35, 1] }, motionBlur: null },   // ease: bezier | spring {stiffness, damping, mass}; motionBlur: { shutter: 0.5, samples: 6 }

  transition: {
    default: 'zoom-blur', sec: 0.45, stepped: false,
    params: {
      zoomBlur: { scaleIn: 0.9, scaleOut: 1.12, sigma: 16 },
      focusPull: { bright: 1.3, brightIn: 1.25 },
    },
    custom: {},                     // { name: { sec, stepped, glsl } }
  },
  build: {},                        // builders: title, issue, list, caption, calloutChip, calloutMark, window, furniture (see README)
};
