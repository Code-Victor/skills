// Streams screencast frames into ffmpeg as they arrive: no frame files, no
// end-of-take encode pass.
//
// Frames go in a tiny Matroska stream (see mkv below) so every frame carries
// its exact page-time stamp; ffmpeg's fps filter then lays them on an exact
// constant-rate timeline, holding each frame until the next one. That keeps
// the old behaviour (Chrome only sends a frame when something repaints)
// without decoding a held frame again for every repeat.

import { spawn } from 'node:child_process';

// ---------------------------------------------------------------- matroska

const TICK_NS = 100000; // timestamps in 0.1 ms
const uint = (n) => {
  const b = [];
  do { b.unshift(n % 256); n = Math.floor(n / 256); } while (n > 0);
  return Buffer.from(b);
};
const vsize = (n) => {
  // EBML variable-length size, shortest form that fits.
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const b = Buffer.alloc(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) { b[i] = v % 256; v = Math.floor(v / 256); }
      b[0] |= 1 << (8 - len);
      return b;
    }
  }
  throw new Error('element too large');
};
const el = (id, ...body) => {
  const data = Buffer.concat(body.map((x) => (typeof x === 'string' ? Buffer.from(x) : x)));
  return Buffer.concat([Buffer.from(id, 'hex'), vsize(data.length), data]);
};
const u = (id, n) => el(id, uint(n));

const mkvHeader = ({ w, h, png }) => {
  // PNG has no native Matroska id; the VFW fourcc 'MPNG' is what ffmpeg reads.
  const bmp = Buffer.alloc(40);
  bmp.writeUInt32LE(40, 0); bmp.writeInt32LE(w, 4); bmp.writeInt32LE(h, 8);
  bmp.writeUInt16LE(1, 12); bmp.writeUInt16LE(24, 14); bmp.write('MPNG', 16, 'latin1');
  const track = el('AE',
    u('D7', 1), u('73C5', 1), u('83', 1),
    png ? el('86', 'V_MS/VFW/FOURCC') : el('86', 'V_MJPEG'),
    png ? el('63A2', bmp) : Buffer.alloc(0),
    el('E0', u('B0', w), u('BA', h)));
  return Buffer.concat([
    el('1A45DFA3', u('4286', 1), u('42F7', 1), u('42F2', 4), u('42F3', 8), el('4282', 'matroska'), u('4287', 4), u('4285', 2)),
    // Segment of unknown length: we are streaming.
    Buffer.from('18538067', 'hex'), Buffer.from('01ffffffffffffff', 'hex'),
    el('1549A966', u('2AD7B1', TICK_NS), el('4D80', 'capture'), el('5741', 'capture')),
    el('1654AE6B', track),
  ]);
};
const mkvFrame = (buf, sec) =>
  // One cluster per frame: its timecode is the frame's, the block offset is 0.
  el('1F43B675', u('E7', Math.round((sec * 1e9) / TICK_NS)), el('A3', Buffer.from([0x81, 0, 0, 0x80]), buf));

// ---------------------------------------------------------------- encoders

// Picked by measurement (see the notes in capture.mjs): x264 veryfast, no
// B-frames, a keyframe at least every 30 frames. `--encoder vt` is the
// hardware option.
export const encoderArgs = (name, crf, fps) => {
  if (name === 'vt')
    return ['-c:v', 'h264_videotoolbox', '-q:v', String(Math.max(1, Math.min(100, Math.round(100 - crf * 2.2)))),
      '-allow_sw', '1', '-bf', '0', '-g', '30', '-profile:v', 'high'];
  const preset = name === 'x264-faster' ? 'faster' : name === 'x264-slow' ? 'slow' : 'veryfast';
  return ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-tune', 'animation',
    '-bf', '0', '-g', String(Math.min(30, Math.round(fps / 2))), '-keyint_min', '1', '-refs', '2'];
};

export function startEncoder({ out, w, h, fps = 60, crf = 14, encoder = 'x264', png = false, nullOut = false }) {
  const W = Math.round(w / 2) * 2, H = Math.round(h / 2) * 2;
  const argv = [
    '-y', '-loglevel', 'error', '-nostdin',
    '-probesize', '2M', '-analyzeduration', '0',
    '-f', 'matroska', '-i', 'pipe:0',
    '-vf', `fps=${fps}:round=near,scale=${W}:${H}:flags=bicubic:out_range=tv,format=yuv420p`,
    '-fps_mode', 'cfr',
    ...encoderArgs(encoder, crf, fps),
    '-pix_fmt', 'yuv420p',
    ...(nullOut ? ['-f', 'null', '-'] : ['-movflags', '+faststart', out]),
  ];
  const ff = spawn('ffmpeg', argv, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => (err += d));
  let dead = null;
  let broken = false;
  const exited = new Promise((res) => ff.on('close', (code) => { dead = code; res(code); }));
  ff.stdin.on('error', () => { broken = true; });
  // ffmpeg's last words, for the message when it dies under us.
  const lastWords = () => err.trim().split('\n').slice(-8).join('\n') || '(no output)';
  const died = () => new Error(`ffmpeg exited early (code ${dead}):\n${lastWords()}`);
  // Wait for room in the pipe, but not past ffmpeg's death: a pipe nobody reads
  // never drains.
  const roomOrDeath = () => new Promise((res) => {
    const done = () => {
      ff.stdin.off('drain', done); ff.stdin.off('error', done); ff.stdin.off('close', done); ff.off('close', done);
      res();
    };
    ff.stdin.once('drain', done); ff.stdin.once('error', done); ff.stdin.once('close', done); ff.once('close', done);
  });
  ff.stdin.write(mkvHeader({ w, h, png }));

  // Hold one frame back: if the next one lands in the same 1/fps slot it
  // replaces it (only the latest paint of a slot can ever be shown), so
  // ffmpeg never decodes a frame that would be dropped.
  let held = null; // { buf, t, slot }
  let written = 0;
  const write = (f) => {
    written++;
    return ff.stdin.write(mkvFrame(f.buf, f.t));
  };
  return {
    get frames() { return written; },
    // Returns a promise that resolves when ffmpeg can take more (backpressure).
    async push(buf, t) {
      if (dead !== null) throw died();
      const slot = Math.round(t * fps);
      let ok = true;
      if (held && slot > held.slot) ok = write(held);
      held = { buf, t, slot };
      if (!ok) {
        await roomOrDeath();
        // The pipe broke before the process finished closing: let it, so the
        // message carries what ffmpeg said.
        if (dead === null && broken) await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
        if (dead !== null) throw died();
      }
    },
    // End the stream at page time `end`: the last frame is held until then.
    async finish(end) {
      if (held) {
        write(held);
        // A repeat of the last frame at the end stamps the clip's length.
        if (end > held.t) { written--; write({ buf: held.buf, t: end }); }
      }
      ff.stdin.end();
      const code = await exited;
      if (code !== 0) throw new Error(`ffmpeg failed (${code}):\n${lastWords()}`);
    },
    abort() { try { ff.kill('SIGKILL'); } catch {} },
  };
}
