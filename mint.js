/* SUPERPEPEPAINT mint kit
   The MINT button produces everything a wallet-signed objkt.com mint needs:
   - a recorded video of the composition (the artifact - plays anywhere, forever)
   - a score-card PNG (the cover)
   - a metadata JSON carrying title, attributes and the TUNE CODE
   - a MIDI file for DAW people (bonus, not a mint path)

   The tune code is the composition serialized to a short string. It rides in
   the token description, so every minted video permanently embeds its own
   replayable source: paste it back into SUPERPEPEPAINT to hear and remix the
   exact tune. Provenance stays honest - the artifact never depends on this
   app existing, but the source always travels with it. */

(function () {
	"use strict";

	const S = window.SPP;
	const BL = window.$bootloader;
	if (!S || !BL) return;

	const $ = (id) => document.getElementById(id);
	const dialog = $("mint_dialog");
	const code_area = $("code_area");
	const mint_status = $("mint_status");
	const record_button = $("record_button");
	const record_cancel_button = $("record_cancel_button");
	const record_status = $("record_status");
	const C = S.consts;

	function setStatus(message, warning) {
		if (!mint_status) return;
		mint_status.textContent = message || " ";
		mint_status.classList.toggle("warning", !!warning);
	}

	////////////////////
	//   TUNE CODEC   //
	////////////////////
	// "SPP1." + base64url of:
	// ver(1) bpm-60(1) swing(1) root_i(1) mode_i(1) titleLen(1) title(N)
	// noteCount(1) [note: 2B packed (c*15+r)*16+i, 1B vel*100] ... xor checksum(1)

	const CODE_PREFIX = "SPP1.";

	function b64urlEncode(bytes) {
		let bin = "";
		for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
		return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}

	function b64urlDecode(str) {
		let s = str.replace(/-/g, "+").replace(/_/g, "/");
		while (s.length % 4) s += "=";
		const bin = atob(s);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return bytes;
	}

	function encodeTune(tune) {
		const title = String(tune.title || "").slice(0, 24);
		const bytes = [];
		bytes.push(1);
		bytes.push(Math.max(0, Math.min(160, Math.round(tune.bpm) - 60)));
		bytes.push(tune.swing & 3);
		bytes.push(tune.root_i & 255);
		bytes.push(tune.mode_i & 255);
		bytes.push(title.length);
		for (let i = 0; i < title.length; i++) {
			const cc = title.charCodeAt(i);
			bytes.push(cc >= 32 && cc < 127 ? cc : 63);
		}
		const notes = tune.notes.slice(0, 96);
		bytes.push(notes.length);
		for (let k = 0; k < notes.length; k++) {
			const n = notes[k];
			const packed = (n.c * 15 + n.r) * 16 + n.i;
			bytes.push((packed >> 8) & 255, packed & 255);
			bytes.push(Math.max(1, Math.min(100, Math.round((n.v || 0.85) * 100))));
		}
		let checksum = 0;
		for (let i = 0; i < bytes.length; i++) checksum ^= bytes[i];
		bytes.push(checksum);
		return CODE_PREFIX + b64urlEncode(new Uint8Array(bytes));
	}

	function decodeTune(str) {
		try {
			const trimmed = String(str || "").trim();
			if (trimmed.indexOf(CODE_PREFIX) !== 0) return { ok: false, error: "NOT A SPP1 TUNE CODE" };
			const bytes = b64urlDecode(trimmed.slice(CODE_PREFIX.length));
			if (bytes.length < 9) return { ok: false, error: "CODE TOO SHORT" };
			let checksum = 0;
			for (let i = 0; i < bytes.length - 1; i++) checksum ^= bytes[i];
			if (checksum !== bytes[bytes.length - 1]) return { ok: false, error: "CHECKSUM FAILED - CODE CORRUPTED" };
			if (bytes[0] !== 1) return { ok: false, error: "UNKNOWN CODE VERSION" };
			const bpm = bytes[1] + 60;
			const swing = bytes[2];
			const root_i = bytes[3];
			const mode_i = bytes[4];
			if (swing > 2) return { ok: false, error: "BAD SWING" };
			if (root_i >= C.ROOTS.length || mode_i >= C.MODES.length) return { ok: false, error: "BAD KEY" };
			const title_len = bytes[5];
			if (title_len > 24 || 6 + title_len >= bytes.length) return { ok: false, error: "BAD TITLE" };
			let title = "";
			for (let i = 0; i < title_len; i++) title += String.fromCharCode(bytes[6 + i]);
			let p = 6 + title_len;
			const count = bytes[p++];
			if (count > 96 || p + count * 3 + 1 !== bytes.length) return { ok: false, error: "BAD NOTE DATA" };
			const notes = [];
			for (let k = 0; k < count; k++) {
				const packed = (bytes[p] << 8) | bytes[p + 1];
				const vel = bytes[p + 2];
				p += 3;
				const i = packed % 16;
				const cr = (packed - i) / 16;
				const r = cr % 15;
				const c = (cr - r) / 15;
				if (c >= C.COLS || r >= C.ROWS || i >= STAMPS.length || vel < 1 || vel > 100) {
					return { ok: false, error: "NOTE OUT OF RANGE" };
				}
				notes.push({ c: c, r: r, i: i, v: vel / 100 });
			}
			return { ok: true, data: { notes: notes, bpm: bpm, swing: swing, root_i: root_i, mode_i: mode_i, title: title } };
		} catch (err) {
			return { ok: false, error: "COULD NOT PARSE CODE" };
		}
	}

	////////////////////
	//   ATTRIBUTES   //
	////////////////////

	function computeAttributes(tune) {
		const counts = {};
		let croaks = 0;
		let pages_b = false;
		for (let k = 0; k < tune.notes.length; k++) {
			const n = tune.notes[k];
			counts[n.i] = (counts[n.i] || 0) + 1;
			if (n.i === 0) croaks++;
			if (n.c >= 16) pages_b = true;
		}
		let dominant = 0;
		let best = -1;
		Object.keys(counts).forEach((i) => {
			if (counts[i] > best) {
				best = counts[i];
				dominant = Number(i);
			}
		});
		const total = tune.notes.length;
		const mode = C.MODES[tune.mode_i];
		const root = C.ROOTS[tune.root_i];
		return [
			{ name: "Tempo (BPM)", value: tune.bpm },
			{ name: "Key", value: root[0] + " " + mode.name },
			{ name: "Mood", value: mode.mood },
			{ name: "Swing", value: C.SWING_NAMES[tune.swing] },
			{ name: "Stamps (num)", value: total },
			{ name: "Croakage (%)", value: total ? Math.round((100 * croaks) / total) : 0 },
			{ name: "Top Stamp", value: total ? STAMPS[dominant].name : "NONE" },
			{ name: "Pages", value: pages_b ? "A+B" : "A" },
		];
	}

	////////////////////
	//    METADATA    //
	////////////////////

	function saveMetadata() {
		const tune = S.getTuneData();
		const code = encodeTune(tune);
		const meta = {
			name: tune.title,
			description:
				tune.title +
				" — a SUPERPEPEPAINT composition. 4 bars of swamp music, composed stamp by stamp.\n\n" +
				"TUNE CODE (paste into SUPERPEPEPAINT to replay and remix this exact tune):\n" +
				code +
				"\n\nMade with SUPERPEPEPAINT, a Mario Paint style music fork of PEPEPAINT.\n" +
				"https://github.com/arwyn6969/SUPERPEPEPAINT",
			tags: ["superpepepaint", "pepepaint", "music", "mariopaint", "chiptune", "pepe"],
			attributes: computeAttributes(tune),
			artifact: "your recorded video (webm or mp4)",
			cover: "your COVER PNG export",
			tuneCode: code,
			seed: BL.hash,
			edition: BL.iteration,
			app: { name: "SUPERPEPEPAINT", version: "1.1.2", repo: "https://github.com/arwyn6969/SUPERPEPEPAINT" },
		};
		const blob = new Blob([JSON.stringify(meta, null, 2) + "\n"], { type: "application/json" });
		const ok = S.downloadBlob(blob, "SUPERPEPEPAINT_" + S.fileTag() + "_metadata.json");
		setStatus(ok ? "METADATA JSON SAVED — PASTE INTO THE OBJKT FORM" : "DOWNLOAD BLOCKED", !ok);
	}

	////////////////////
	//      MIDI      //
	////////////////////

	// GM program per synth voice (0-based). percussion goes to channel 10.
	const GM_PROGRAMS = {
		pepe: 80, cat: 85, gondola: 73, bell: 9, doge: 45, sanic: 87, ufo: 78,
		wojak: 52, cheems: 62, groyper: 84, brass: 61, npc: 7, bass: 38,
	};
	const GM_DRUMS = { kick: 36, hat: 42, snare: 38 };

	function vlq(value) {
		const out = [value & 127];
		value >>= 7;
		while (value > 0) {
			out.unshift((value & 127) | 128);
			value >>= 7;
		}
		return out;
	}

	function buildMidiBytes(tune, midis, stamps, swing_amts) {
		const TPQ = 480;
		const STEP = TPQ / 2; // eighth note
		const NOTE_LEN = 210;
		const swing_ticks = Math.round(swing_amts[tune.swing] * STEP);

		// group notes by stamp
		const groups = {};
		tune.notes.forEach((n) => {
			(groups[n.i] = groups[n.i] || []).push(n);
		});
		const stamp_ids = Object.keys(groups).map(Number).sort((a, b) => a - b);

		function trackChunk(events) {
			// events: [{tick, bytes:[...]}] - sort by tick, then emit deltas
			events.sort((a, b) => a.tick - b.tick || a.order - b.order);
			const body = [];
			let last = 0;
			events.forEach((ev) => {
				body.push.apply(body, vlq(ev.tick - last));
				body.push.apply(body, ev.bytes);
				last = ev.tick;
			});
			body.push(0, 0xff, 0x2f, 0); // end of track
			const out = [0x4d, 0x54, 0x72, 0x6b];
			const len = body.length;
			out.push((len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255);
			return out.concat(body);
		}

		const chunks = [];
		// track 0: tempo + time signature
		const uspq = Math.round(60000000 / tune.bpm);
		chunks.push(trackChunk([
			{ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (uspq >> 16) & 255, (uspq >> 8) & 255, uspq & 255] },
			{ tick: 0, order: 1, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
		]));

		let next_channel = 0;
		stamp_ids.forEach((si) => {
			const stamp = stamps[si];
			const is_drum = GM_DRUMS[stamp.synth] !== undefined;
			let channel;
			if (is_drum) {
				channel = 9;
			} else {
				channel = next_channel;
				next_channel++;
				if (next_channel === 9) next_channel = 10; // skip GM drum channel
				if (next_channel > 15) next_channel = 15;
			}
			const events = [];
			const name = "SPP " + stamp.name;
			const name_bytes = [];
			for (let i = 0; i < name.length; i++) name_bytes.push(name.charCodeAt(i) & 127);
			events.push({ tick: 0, order: 0, bytes: [0xff, 0x03, name_bytes.length].concat(name_bytes) });
			if (!is_drum) {
				events.push({ tick: 0, order: 1, bytes: [0xc0 | channel, GM_PROGRAMS[stamp.synth] || 80] });
			}
			groups[si].forEach((n) => {
				const tick = n.c * STEP + (n.c % 2 === 1 ? swing_ticks : 0);
				const pitch = is_drum ? GM_DRUMS[stamp.synth] : Math.max(0, Math.min(127, midis[n.r]));
				const vel = Math.max(1, Math.min(127, Math.round((n.v || 0.85) * 127)));
				events.push({ tick: tick, order: 2, bytes: [0x90 | channel, pitch, vel] });
				events.push({ tick: tick + NOTE_LEN, order: 1, bytes: [0x80 | channel, pitch, 0] });
			});
			chunks.push(trackChunk(events));
		});

		const ntrks = 1 + stamp_ids.length;
		const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (ntrks >> 8) & 255, ntrks & 255, (TPQ >> 8) & 255, TPQ & 255];
		let total = header.length;
		chunks.forEach((c2) => { total += c2.length; });
		const bytes = new Uint8Array(total);
		bytes.set(header, 0);
		let off = header.length;
		chunks.forEach((c2) => {
			bytes.set(c2, off);
			off += c2.length;
		});
		return bytes;
	}

	function saveMidi() {
		const tune = S.getTuneData();
		if (!tune.notes.length) {
			setStatus("NOTHING TO EXPORT - THE STAFF IS EMPTY", true);
			return;
		}
		const bytes = buildMidiBytes(tune, S.state.midis, STAMPS, C.SWING_AMTS);
		const ok = S.downloadBlob(new Blob([bytes], { type: "audio/midi" }), "SUPERPEPEPAINT_" + S.fileTag() + ".mid");
		setStatus(ok ? "MIDI SAVED — NOTES ONLY, THE CROAK STAYS HERE" : "DOWNLOAD BLOCKED", !ok);
	}

	////////////////////
	// VIDEO RECORDER //
	////////////////////

	const REC_W = 800;
	const REC_H = 1120;
	const rec = { active: false, discard: false, raf: 0, status_timer: null, recorder: null, tap: null, chunks: [], t0: 0, est: 0, mime: "" };

	function pickMime() {
		if (!window.MediaRecorder) return "";
		const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
		for (let i = 0; i < candidates.length; i++) {
			try {
				if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
			} catch (err) { /* keep looking */ }
		}
		return "";
	}

	function drawRecFrame(g) {
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.imageSmoothingEnabled = false;
		g.fillStyle = "#ffffff";
		g.fillRect(0, 0, REC_W, REC_H);
		g.fillStyle = "green";
		g.textAlign = "center";
		g.font = '34px "unscii8", monospace';
		g.fillText("SUPERPEPEPAINT", REC_W / 2, 62);
		g.font = '24px "unscii8", monospace';
		g.fillText(S.state.title, REC_W / 2, 106);
		g.font = '16px "unscii8tall", monospace';
		g.fillText(S.state.meta_line + " · SWING " + C.SWING_NAMES[S.state.swing], REC_W / 2, 134);

		const step = S.playheadStep();
		const page = step >= 0 ? Math.floor(step / 16) : 0;
		g.save();
		g.translate(0, 158);
		g.scale(2, 2);
		S.drawStaffInto(g, page, { playhead_step: step, no_hover: true });
		g.restore();

		const elapsed = (performance.now() - rec.t0) / 1000;
		g.font = '15px "unscii8tall", monospace';
		g.fillText("PAGE " + (page === 0 ? "A" : "B"), REC_W / 2, 792);
		// progress bar
		const bx = 60, bw = REC_W - 120, by = 816, bh = 10;
		g.strokeStyle = "green";
		g.lineWidth = 1;
		g.strokeRect(bx, by, bw, bh);
		g.fillStyle = "#00a437";
		g.fillRect(bx + 1, by + 1, Math.max(0, Math.min(1, elapsed / rec.est)) * (bw - 2), bh - 2);
		g.fillStyle = "green";
		g.font = '13px "unscii8tall", monospace';
		g.fillText("SEED " + BL.hash.slice(0, 12) + "… · EDITION #" + BL.iteration, REC_W / 2, REC_H - 56);
		g.fillText("MADE WITH SUPERPEPEPAINT · A PEPEPAINT FORK", REC_W / 2, REC_H - 34);
	}

	function updateRecordStatus() {
		const elapsed = Math.floor((performance.now() - rec.t0) / 1000);
		record_status.textContent = "REC " + elapsed + "s / ~" + Math.ceil(rec.est) + "s";
	}

	function recordVideo() {
		if (rec.active) return;
		const mime = pickMime();
		if (!mime) {
			setStatus("VIDEO RECORDING NOT SUPPORTED IN THIS BROWSER", true);
			return;
		}
		if (!S.state.notes.length) {
			setStatus("NOTHING TO RECORD - THE STAFF IS EMPTY", true);
			return;
		}
		if (S.isPlaying()) S.stopPlayback();

		const canvas = document.createElement("canvas");
		canvas.width = REC_W;
		canvas.height = REC_H;
		const g = canvas.getContext("2d");

		let stream;
		let tap;
		try {
			stream = canvas.captureStream(30);
			tap = SPPAudio.tapRecordStream();
			const tracks = stream.getVideoTracks().concat(tap.stream.getAudioTracks());
			rec.recorder = new MediaRecorder(new MediaStream(tracks), {
				mimeType: mime,
				videoBitsPerSecond: 6000000,
				audioBitsPerSecond: 192000,
			});
		} catch (err) {
			if (tap) tap.disconnect();
			setStatus("COULD NOT START RECORDER: " + err.message, true);
			return;
		}

		rec.active = true;
		rec.discard = false;
		rec.mime = mime;
		rec.tap = tap;
		rec.chunks = [];
		rec.est = 2 * 32 * S.stepDur() + 1.2;
		rec.t0 = performance.now();
		rec.recorder.ondataavailable = (ev) => {
			if (ev.data && ev.data.size) rec.chunks.push(ev.data);
		};
		rec.recorder.onstop = finalizeRecording;
		rec.recorder.start(400);

		record_button.classList.add("hidden");
		record_cancel_button.classList.remove("hidden");
		setStatus("RECORDING 2 LOOPS — LISTEN ALONG");
		updateRecordStatus();
		rec.status_timer = setInterval(updateRecordStatus, 300);

		const loop = () => {
			if (!rec.active) return;
			drawRecFrame(g);
			rec.raf = requestAnimationFrame(loop);
		};
		rec.raf = requestAnimationFrame(loop);

		setTimeout(() => {
			S.startPlayback({
				passes: 2,
				quiet: true,
				onComplete: () => {
					setTimeout(() => {
						if (rec.recorder && rec.recorder.state !== "inactive") rec.recorder.stop();
					}, 700);
				},
			});
		}, 250);
	}

	function cancelRecording() {
		if (!rec.active) return;
		rec.discard = true;
		if (S.isPlaying()) {
			S.stopPlayback(); // onComplete fires and stops the recorder
		} else if (rec.recorder && rec.recorder.state !== "inactive") {
			rec.recorder.stop();
		}
	}

	function finalizeRecording() {
		rec.active = false;
		cancelAnimationFrame(rec.raf);
		if (rec.status_timer !== null) {
			clearInterval(rec.status_timer);
			rec.status_timer = null;
		}
		if (rec.tap) rec.tap.disconnect();
		record_button.classList.remove("hidden");
		record_cancel_button.classList.add("hidden");
		record_status.textContent = "";
		if (rec.discard) {
			rec.chunks = [];
			setStatus("RECORDING CANCELLED");
			return;
		}
		const type = rec.mime.split(";")[0];
		const blob = new Blob(rec.chunks, { type: type });
		rec.chunks = [];
		S.last_video = { size: blob.size, type: blob.type };
		const ext = type.indexOf("mp4") >= 0 ? "mp4" : "webm";
		const ok = S.downloadBlob(blob, "SUPERPEPEPAINT_" + S.fileTag() + "." + ext);
		const mb = (blob.size / 1048576).toFixed(1);
		setStatus(ok
			? "VIDEO SAVED (" + mb + "MB " + ext.toUpperCase() + ") — THIS IS YOUR MINT ARTEFACT"
			: "DOWNLOAD BLOCKED — OPEN THE APP OUTSIDE THE SANDBOX", !ok);
	}

	////////////////////
	//  DIALOG WIRING //
	////////////////////

	function refreshCode() {
		code_area.value = encodeTune(S.getTuneData());
	}

	function openDialog() {
		if (dialog.open) return;
		refreshCode();
		setStatus("");
		dialog.show();
	}

	$("mint_button").addEventListener("click", openDialog);
	$("mint_close_button").addEventListener("click", () => dialog.close());
	record_button.addEventListener("click", recordVideo);
	record_cancel_button.addEventListener("click", cancelRecording);
	$("meta_button").addEventListener("click", saveMetadata);
	$("midi_button").addEventListener("click", saveMidi);
	$("png_button").addEventListener("click", () => setStatus("COVER PNG SAVED — USE AS THE TOKEN COVER"));
	$("wav_button").addEventListener("click", () => setStatus("RENDERING WAV — AUDIO ONLY, NOT THE ARTEFACT"));

	$("code_copy_button").addEventListener("click", () => {
		refreshCode();
		const code = code_area.value;
		const done = () => setStatus("CODE COPIED — IT RIDES IN THE TOKEN DESCRIPTION");
		const fail = () => {
			code_area.focus();
			code_area.select();
			setStatus("PRESS CTRL/CMD+C TO COPY", true);
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(code).then(done, fail);
		} else {
			fail();
		}
	});

	$("code_import_button").addEventListener("click", () => {
		const result = decodeTune(code_area.value);
		if (!result.ok) {
			setStatus(result.error, true);
			return;
		}
		if (S.applyImportedTune(result.data)) {
			setStatus("TUNE LOADED: " + (result.data.title || "UNTITLED"));
			S.showFeedback("TUNE IMPORTED");
		} else {
			setStatus("COULD NOT LOAD TUNE", true);
		}
	});

	document.addEventListener("keydown", (ev) => {
		if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
		const tag = ev.target && ev.target.tagName;
		if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") {
			if (ev.key === "Escape" && dialog.open) dialog.close();
			return;
		}
		if (ev.key === "d") openDialog();
		if (ev.key === "Escape" && dialog.open) dialog.close();
	});

	// exposed for the test suite and tinkerers
	window.SPPMINT = {
		encodeTune: encodeTune,
		decodeTune: decodeTune,
		computeAttributes: computeAttributes,
		buildMidiBytes: buildMidiBytes,
	};
})();
