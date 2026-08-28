/* SUPERPEPEPAINT audio engine
   16 synthesized meme voices for the Web Audio API. Fully self-contained:
   no samples, no external requests. Every voice is a pure function of
   (time, frequency, velocity) so live playback and offline WAV rendering
   produce the same swamp. */

var SPPAudio = (function () {
	"use strict";

	let live_ctx = null;
	let live_bus = null;
	const noise_cache = new WeakMap();

	function ctx() {
		if (!live_ctx) {
			const AC = window.AudioContext || window.webkitAudioContext;
			live_ctx = new AC();
			live_bus = buildBus(live_ctx);
		}
		if (live_ctx.state === "suspended") {
			live_ctx.resume();
		}
		return live_ctx;
	}

	function bus() {
		ctx();
		return live_bus;
	}

	function buildBus(c) {
		const input = c.createGain();
		input.gain.value = 0.82;
		const comp = c.createDynamicsCompressor();
		comp.threshold.value = -14;
		comp.knee.value = 22;
		comp.ratio.value = 5;
		comp.attack.value = 0.003;
		comp.release.value = 0.24;
		input.connect(comp);
		comp.connect(c.destination);
		return input;
	}

	function noiseBuffer(c) {
		let buf = noise_cache.get(c);
		if (buf) return buf;
		const len = Math.floor(c.sampleRate * 1.2);
		buf = c.createBuffer(1, len, c.sampleRate);
		const data = buf.getChannelData(0);
		// deterministic xorshift noise - identical in live + offline renders
		let s = 0x9e3779b9;
		for (let i = 0; i < len; i++) {
			s ^= s << 13;
			s ^= s >>> 17;
			s ^= s << 5;
			s |= 0;
			data[i] = ((s >>> 0) / 4294967296) * 2 - 1;
		}
		noise_cache.set(c, buf);
		return buf;
	}

	// ---- node helpers -------------------------------------------------

	function osc(c, type, freq, t0, t1) {
		const o = c.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(freq, t0);
		o.start(t0);
		o.stop(t1);
		return o;
	}

	function gainEnv(c, t, attack, peak, decayTo, tEnd) {
		const g = c.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.linearRampToValueAtTime(peak, t + attack);
		g.gain.exponentialRampToValueAtTime(Math.max(decayTo, 0.0001), tEnd);
		return g;
	}

	function noiseSrc(c, t0, t1) {
		const src = c.createBufferSource();
		src.buffer = noiseBuffer(c);
		src.loop = true;
		src.start(t0);
		src.stop(t1);
		return src;
	}

	// ---- the sixteen voices -------------------------------------------
	// (c, out, t, f, v, sd) -> schedules nodes into `out`
	// f = row frequency, v = velocity 0..1, sd = step duration seconds

	const SYNTHS = {
		// PEPE - the croak. square blip gliding up from half pitch.
		pepe: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.24, sd * 1.7);
			const o = osc(c, "square", f * 0.55, t, end + 0.02);
			o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
			const g = gainEnv(c, t, 0.004, 0.42 * v, 0.001, end);
			o.connect(g);
			g.connect(out);
		},

		// CAT - meow contour with a bandpass throat.
		cat: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.3, sd * 1.8);
			const o = osc(c, "square", f * 0.8, t, end + 0.02);
			o.frequency.linearRampToValueAtTime(f * 1.14, t + 0.07);
			o.frequency.linearRampToValueAtTime(f * 0.96, end);
			const bp = c.createBiquadFilter();
			bp.type = "bandpass";
			bp.frequency.setValueAtTime(f * 2.4, t);
			bp.frequency.linearRampToValueAtTime(f * 1.4, end);
			bp.Q.value = 3.2;
			const g = gainEnv(c, t, 0.012, 0.52 * v, 0.001, end);
			o.connect(bp);
			bp.connect(g);
			g.connect(out);
		},

		// GONDOLA - comfy triangle flute with slow vibrato.
		gondola: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.5, sd * 1.9);
			const o = osc(c, "triangle", f, t, end + 0.02);
			const lfo = osc(c, "sine", 5.4, t, end + 0.02);
			const lg = c.createGain();
			lg.gain.value = f * 0.007;
			lfo.connect(lg);
			lg.connect(o.frequency);
			const g = gainEnv(c, t, 0.045, 0.34 * v, 0.001, end);
			o.connect(g);
			g.connect(out);
		},

		// HEART - FM glockenspiel bell.
		bell: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.55, sd * 2.2);
			const car = osc(c, "sine", f * 2, t, end + 0.02);
			const mod = osc(c, "sine", f * 2 * 3.53, t, end + 0.02);
			const mg = c.createGain();
			mg.gain.setValueAtTime(f * 5, t);
			mg.gain.exponentialRampToValueAtTime(1, t + 0.3);
			mod.connect(mg);
			mg.connect(car.frequency);
			const g = gainEnv(c, t, 0.003, 0.36 * v, 0.001, end);
			car.connect(g);
			g.connect(out);
		},

		// DOGE - FM bark pluck. wow.
		doge: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.2, sd * 1.4);
			const car = osc(c, "sine", f, t, end + 0.02);
			const mod = osc(c, "sine", f * 2.7, t, end + 0.02);
			const mg = c.createGain();
			mg.gain.setValueAtTime(f * 4.5, t);
			mg.gain.exponentialRampToValueAtTime(0.5, t + 0.09);
			mod.connect(mg);
			mg.connect(car.frequency);
			const g = gainEnv(c, t, 0.004, 0.5 * v, 0.001, end);
			car.connect(g);
			g.connect(out);
		},

		// SANIC - gotta go fast. two square zaps an octave apart.
		sanic: function (c, out, t, f, v, sd) {
			const gap = Math.min(0.07, sd * 0.5);
			for (let i = 0; i < 2; i++) {
				const t0 = t + i * gap;
				const end = t0 + 0.05;
				const o = osc(c, "square", f * (i ? 2 : 1), t0, end + 0.02);
				const hp = c.createBiquadFilter();
				hp.type = "highpass";
				hp.frequency.value = 700;
				const g = gainEnv(c, t0, 0.003, 0.3 * v, 0.001, end);
				o.connect(hp);
				hp.connect(g);
				g.connect(out);
			}
		},

		// UFO - theremin glide with tremolo.
		ufo: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.5, sd * 1.9);
			const o = osc(c, "sine", f * 0.6, t, end + 0.02);
			o.frequency.exponentialRampToValueAtTime(f, t + 0.13);
			const trem = osc(c, "sine", 7, t, end + 0.02);
			const tg = c.createGain();
			tg.gain.value = 0.12 * v;
			trem.connect(tg);
			const g = gainEnv(c, t, 0.03, 0.32 * v, 0.001, end);
			tg.connect(g.gain);
			o.connect(g);
			g.connect(out);
		},

		// WOJAK - he just wants the notes to feel something. sad detuned ooh.
		wojak: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.45, sd * 1.9);
			const o1 = osc(c, "triangle", f, t, end + 0.02);
			const o2 = osc(c, "sine", f * 0.993, t, end + 0.02);
			o1.frequency.linearRampToValueAtTime(f * 0.985, end);
			const g = gainEnv(c, t, 0.05, 0.3 * v, 0.001, end);
			o1.connect(g);
			o2.connect(g);
			g.connect(out);
		},

		// CHEEMS - wobbly detuned saws through a wah filter. bmusic.
		cheems: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.32, sd * 1.7);
			const o1 = osc(c, "sawtooth", f * 1.005, t, end + 0.02);
			const o2 = osc(c, "sawtooth", f * 0.995, t, end + 0.02);
			const lp = c.createBiquadFilter();
			lp.type = "lowpass";
			lp.frequency.value = 1400;
			lp.Q.value = 2;
			const lfo = osc(c, "sine", 6.5, t, end + 0.02);
			const lg = c.createGain();
			lg.gain.value = 420;
			lfo.connect(lg);
			lg.connect(lp.frequency);
			const g = gainEnv(c, t, 0.015, 0.26 * v, 0.001, end);
			o1.connect(lp);
			o2.connect(lp);
			lp.connect(g);
			g.connect(out);
		},

		// GROYPER - hollow staccato pluck.
		groyper: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.15, sd * 1.1);
			const o1 = osc(c, "square", f, t, end + 0.02);
			const o2 = osc(c, "square", f * 2, t, end + 0.02);
			const g2 = c.createGain();
			g2.gain.value = 0.35;
			o2.connect(g2);
			const g = gainEnv(c, t, 0.003, 0.34 * v, 0.001, end);
			o1.connect(g);
			g2.connect(g);
			g.connect(out);
		},

		// SWOLE - three-saw brass stack with filter sweep.
		brass: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.38, sd * 1.8);
			const lp = c.createBiquadFilter();
			lp.type = "lowpass";
			lp.frequency.setValueAtTime(500, t);
			lp.frequency.linearRampToValueAtTime(2800, t + 0.06);
			lp.frequency.exponentialRampToValueAtTime(800, end);
			[1, 1.006, 0.994].forEach(function (d) {
				const o = osc(c, "sawtooth", f * d, t, end + 0.02);
				o.connect(lp);
			});
			const g = gainEnv(c, t, 0.02, 0.3 * v, 0.001, end);
			lp.connect(g);
			g.connect(out);
		},

		// NPC - flat affect. fixed length, zero expression.
		npc: function (c, out, t, f, v) {
			const end = t + 0.12;
			const o = osc(c, "square", f, t, end + 0.01);
			const g = c.createGain();
			g.gain.setValueAtTime(0.0001, t);
			g.gain.linearRampToValueAtTime(0.24 * v, t + 0.005);
			g.gain.setValueAtTime(0.24 * v, end - 0.005);
			g.gain.linearRampToValueAtTime(0.0001, end);
			o.connect(g);
			g.connect(out);
		},

		// SMINEM - improbably deep bass pluck.
		bass: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.36, sd * 1.8);
			const o1 = osc(c, "sine", f * 0.53, t, end + 0.02);
			o1.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.035);
			const o2 = osc(c, "triangle", f, t, end + 0.02);
			const g2 = c.createGain();
			g2.gain.value = 0.3;
			o2.connect(g2);
			const g = gainEnv(c, t, 0.005, 0.6 * v, 0.001, end);
			o1.connect(g);
			g2.connect(g);
			g.connect(out);
		},

		// XCP - the kick. pitched thump plus click.
		kick: function (c, out, t, f, v, sd) {
			const fk = Math.max(38, Math.min(120, f * 0.35));
			const end = t + Math.min(0.26, sd * 1.6);
			const o = osc(c, "sine", fk * 4.2, t, end + 0.02);
			o.frequency.exponentialRampToValueAtTime(fk, t + 0.05);
			const g = gainEnv(c, t, 0.003, 0.68 * v, 0.001, end);
			o.connect(g);
			g.connect(out);
			const n = noiseSrc(c, t, t + 0.03);
			const hp = c.createBiquadFilter();
			hp.type = "highpass";
			hp.frequency.value = 2000;
			const ng = gainEnv(c, t, 0.001, 0.14 * v, 0.001, t + 0.028);
			n.connect(hp);
			hp.connect(ng);
			ng.connect(out);
		},

		// SUN - hi-hat tick. row pitch sets brightness.
		hat: function (c, out, t, f, v) {
			const end = t + 0.055;
			const n = noiseSrc(c, t, end + 0.01);
			const hp = c.createBiquadFilter();
			hp.type = "highpass";
			hp.frequency.value = 4200 + f * 2.5;
			const g = gainEnv(c, t, 0.001, 0.2 * v, 0.001, end);
			n.connect(hp);
			hp.connect(g);
			g.connect(out);
		},

		// FIREDOG - this is fine. snare of noise and thump.
		snare: function (c, out, t, f, v, sd) {
			const end = t + Math.min(0.16, sd * 1.2);
			const n = noiseSrc(c, t, end + 0.01);
			const bp = c.createBiquadFilter();
			bp.type = "bandpass";
			bp.frequency.value = 1500 + f;
			bp.Q.value = 0.7;
			const g = gainEnv(c, t, 0.001, 0.42 * v, 0.001, end);
			n.connect(bp);
			bp.connect(g);
			g.connect(out);
			const o = osc(c, "sine", Math.min(230, f * 0.7), t, t + 0.09);
			const og = gainEnv(c, t, 0.001, 0.22 * v, 0.001, t + 0.085);
			o.connect(og);
			og.connect(out);
		},
	};

	// deterministic stereo spread per instrument index
	function panFor(i) {
		return ((i % 7) - 3) * 0.11;
	}

	function playNote(c, dest, synth_id, when, freq, vel, step_dur, pan) {
		const fn = SYNTHS[synth_id];
		if (!fn) return;
		let out = dest;
		if (c.createStereoPanner) {
			const p = c.createStereoPanner();
			p.pan.value = pan || 0;
			p.connect(dest);
			out = p;
		}
		fn(c, out, when, freq, vel, step_dur);
	}

	// ---- offline WAV rendering -----------------------------------------

	function renderWav(opts) {
		const bpm = opts.bpm;
		const swing_amt = opts.swingAmt || 0;
		const passes = opts.passes || 2;
		const step_dur = 60 / bpm / 2;
		const loop_dur = 32 * step_dur;
		const tail = 0.8;
		const sr = 44100;
		const length = Math.ceil((passes * loop_dur + tail) * sr);
		const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
		const off = new OAC(2, length, sr);
		const off_bus = buildBus(off);
		for (let p = 0; p < passes; p++) {
			for (let k = 0; k < opts.notes.length; k++) {
				const note = opts.notes[k];
				let when = 0.03 + p * loop_dur + note.c * step_dur;
				if (note.c % 2 === 1) when += swing_amt * step_dur;
				playNote(off, off_bus, opts.stamps[note.i].synth, when, opts.pitches[note.r], note.v || 0.85, step_dur, panFor(note.i));
			}
		}
		return off.startRendering().then(encodeWav);
	}

	function encodeWav(buffer) {
		const ch = buffer.numberOfChannels;
		const sr = buffer.sampleRate;
		const frames = buffer.length;
		const bytes_per_sample = 2;
		const block_align = ch * bytes_per_sample;
		const data_size = frames * block_align;
		const ab = new ArrayBuffer(44 + data_size);
		const dv = new DataView(ab);
		function wstr(off, s) {
			for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
		}
		wstr(0, "RIFF");
		dv.setUint32(4, 36 + data_size, true);
		wstr(8, "WAVE");
		wstr(12, "fmt ");
		dv.setUint32(16, 16, true);
		dv.setUint16(20, 1, true);
		dv.setUint16(22, ch, true);
		dv.setUint32(24, sr, true);
		dv.setUint32(28, sr * block_align, true);
		dv.setUint16(32, block_align, true);
		dv.setUint16(34, 16, true);
		wstr(36, "data");
		dv.setUint32(40, data_size, true);
		const chans = [];
		for (let i = 0; i < ch; i++) chans.push(buffer.getChannelData(i));
		let off = 44;
		for (let i = 0; i < frames; i++) {
			for (let j = 0; j < ch; j++) {
				let s = Math.max(-1, Math.min(1, chans[j][i]));
				dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
				off += 2;
			}
		}
		return new Blob([ab], { type: "audio/wav" });
	}

	// tap the live bus into a MediaStream (for video recording) without
	// disturbing what the speakers hear. returns { stream, disconnect }.
	function tapRecordStream() {
		const c = ctx();
		const dest = c.createMediaStreamDestination();
		const comp = c.createDynamicsCompressor();
		comp.threshold.value = -14;
		comp.knee.value = 22;
		comp.ratio.value = 5;
		comp.attack.value = 0.003;
		comp.release.value = 0.24;
		live_bus.connect(comp);
		comp.connect(dest);
		return {
			stream: dest.stream,
			disconnect: function () {
				try {
					live_bus.disconnect(comp);
				} catch (err) { /* already gone */ }
			},
		};
	}

	return {
		ctx: ctx,
		bus: bus,
		playNote: playNote,
		panFor: panFor,
		renderWav: renderWav,
		tapRecordStream: tapRecordStream,
	};
})();
