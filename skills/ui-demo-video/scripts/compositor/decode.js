// Clip sources: a WebCodecs VideoDecoder fed straight from the mp4 bytes.
//
// No demuxing library: compose.mjs lists every packet with ffprobe (position,
// size, timestamp, keyframe flag) plus the avcC decoder description, so the
// page just slices the file and hands the slices to the decoder.
//
// Hardware decode is tried first on clips without B-frames (it fails on
// reordered streams); software decode takes anything. A decode error on the
// hardware path restarts the same clip in software from where it was.
// Frames are kept about 40 ahead so the decoder never starves the encoder.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// One download per file, shared by every scene that plays it.
const files = new Map();
export const loadFile = (url) => {
  if (!files.has(url)) files.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)));
  return files.get(url);
};
export const dropFile = (url) => files.delete(url);

export class ClipSource {
  /** meta: from compose.mjs (packets, avcC, codec, width, height, hasB). startUs: first source time wanted. */
  constructor({ name, url, meta, startUs = 0, forceSoftware = false, ahead, log }) {
    this.name = name; this.url = url; this.meta = meta; this.startUs = startUs; this.log = log || (() => {});
    this.pk = meta.packets;
    const px = meta.width * meta.height;
    this.ahead = ahead ?? (px > 3_000_000 ? 24 : 40);
    this.hw = !forceSoftware && !meta.hasB;
    this.fellBack = false;
    this.lastT = startUs;
    this.waitMs = 0;
  }

  async open() {
    this.bytes = await loadFile(this.url);
    await this.start(this.hw ? 'prefer-hardware' : 'prefer-software', this.startUs);
  }

  // Index (decode order) of the last keyframe at or before t.
  seekIndex(tUs) {
    let k = 0;
    for (let i = 0; i < this.pk.length; i++) if (this.pk[i].key && this.pk[i].pts <= tUs) k = i;
    return k;
  }

  async start(pref, tUs) {
    this.stop();
    this.err = null; this.frames = []; this.eof = false; this.flushing = false;
    this.next = this.seekIndex(tUs); this.submitted = 0; this.received = 0;
    const conf = {
      codec: this.meta.codec, codedWidth: this.meta.width, codedHeight: this.meta.height,
      description: b64(this.meta.avcC), hardwareAcceleration: pref,
    };
    const sup = await VideoDecoder.isConfigSupported(conf).catch(() => ({ supported: false }));
    if (!sup.supported) {
      if (pref === 'prefer-hardware') return this.start('prefer-software', tUs);
      throw new Error(`this Chrome cannot decode ${this.name} (${this.meta.codec} ${this.meta.width}x${this.meta.height})`);
    }
    this.pref = pref;
    const dec = (this.dec = new VideoDecoder({
      output: (f) => { if (this.dec !== dec) { f.close(); return; } this.received++; this.frames.push(f); this.waiter?.(); },
      error: (e) => { if (this.dec === dec) { this.err = e; this.waiter?.(); } },
    }));
    dec.configure(conf);
  }

  stop() {
    if (this.frames) for (const f of this.frames) f.close();
    this.frames = [];
    try { this.dec?.close(); } catch {}
    this.dec = null;
  }
  close() { this.stop(); }

  feed() {
    if (this.err || !this.dec) return;
    while (this.next < this.pk.length && this.submitted - this.received + this.frames.length < this.ahead && this.dec.decodeQueueSize < 40) {
      const p = this.pk[this.next++];
      this.dec.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: p.pts, data: this.bytes.subarray(p.pos, p.pos + p.size) }));
      this.submitted++;
    }
    if (this.next >= this.pk.length && !this.flushing) {
      this.flushing = true;
      this.dec.flush().then(() => { this.eof = true; this.waiter?.(); }, () => {});
    }
  }

  /** The frame on screen at source time tUs (the newest one not after it). The frame stays valid until a later get(). */
  async get(tUs) {
    this.lastT = tUs;
    const eps = 2000;
    for (;;) {
      if (this.err) {
        if (this.pref === 'prefer-hardware') {   // hardware refused this stream: redo it in software from here
          this.log(`${this.name}: hardware decode failed (${this.err.message || this.err}); switching to software`);
          this.fellBack = true;
          await this.start('prefer-software', tUs);
          continue;
        }
        throw new Error(`decode error in ${this.name}: ${this.err.message || this.err}`);
      }
      this.feed();
      while (this.frames.length >= 2 && this.frames[1].timestamp <= tUs + eps) this.frames.shift().close();
      if (this.frames.length >= 2) return this.frames[0];
      if (this.eof && this.frames.length === 1) return this.frames[0];   // past the end: hold the last frame
      if (this.eof) throw new Error(`${this.name}: the file produced no frames`);
      const t0 = performance.now();
      await Promise.race([new Promise((r) => (this.waiter = r)), sleep(8000)]);
      this.waitMs += performance.now() - t0;
      if (performance.now() - t0 >= 8000) throw new Error(`decoder stalled on ${this.name}`);
    }
  }
}
