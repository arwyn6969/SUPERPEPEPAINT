/* SUPERPEPEPAINT
   A Mario Paint style music composer, forked from PEPEPAINT V1.
   Place meme stamps on the staff. Each stamp is an instrument. The token
   seed composes a starter tune; you take it from there.

   Forked from PEPEPAINT V1 by Nathan Gregg (MIT) - art, fonts and visual
   system inherited in honored continuity. https://github.com/nathansonic/PEPEPAINT-V1

   bootloader.art generic-web rules honored:
   - all output-affecting randomness flows from $bootloader.rnd()
   - no external requests, every asset is bundled
   - $bootloader.setFeatures() + $bootloader.capture() wired
*/

(function () {
	"use strict";

	const BL = window.$bootloader;

	////////////////////
	//    CONSTANTS   //
	////////////////////

	const COLS = 32; // 4 bars of 8 eighth-notes
	const PAGE_COLS = 16; // 2 pages, Mario Paint style
	const ROWS = 15; // two diatonic octaves, bottom row = scale root
	const MAX_PER_COL = 3; // the sacred Mario Paint polyphony law
	const CV = 3; // canvas backing scale (1200x900 for a 400x300 staff)
	const GRID = { x0: 12, y0: 12, w: 376, h: 276 };
	const CELL_W = GRID.w / PAGE_COLS;
	const CELL_H = GRID.h / ROWS;
	const STAMP_PX = 21;
	const SWING_AMTS = [0, 0.12, 0.22];
	const SWING_NAMES = ["STRAIGHT", "LIGHT", "HEAVY"];
	const DRUM_NAMES = ["NONE", "LIGHT", "FULL"];

	////////////////////
	//      STATE     //
	////////////////////

	const state = {
		notes: [], // {c: 0-31, r: 0-14 (0 = top), i: stamp index, v: velocity}
		bpm: 120,
		swing: 0,
		loop: true,
		page: 0,
		sel: 0,
		eraser: false,
		hide_ui: false,
		title: "",
		meta_line: "",
		pitches: [], // freq per row (0 = top = highest)
		midis: [], // midi note per row
		root_i: 0,
		mode_i: 0,
		features: {},
	};

	let undo_stack = [];
	let redo_stack = [];
	const save_key = "spp1:" + BL.hash.slice(0, 16) + ":" + BL.iteration;

	////////////////////
	//   DOM LOOKUPS  //
	////////////////////

	const $ = (id) => document.getElementById(id);
	const staff_canvas = $("staff_canvas");
	const cx = staff_canvas.getContext("2d");
	const play_button = $("play_button");
	const loop_button = $("loop_button");
	const swing_button = $("swing_button");
	const tempo_range = $("tempo_range");
	const bpm_readout = $("bpm_readout");
	const page_button = $("page_button");
	const eraser_button = $("eraser_button");
	const feedback_dialog = $("feedback_dialog");
	const feedback_text = $("feedback_text");
	const track_title = $("track_title");
	const track_meta = $("track_meta");
	const info_overlay = $("info_overlay");

	////////////////////
	//    FEEDBACK    //
	////////////////////

	let feedback_timeout_id = null;
	function showFeedbackNotification(message) {
		if (!feedback_dialog || !feedback_text) return;
		feedback_text.textContent = message;
		feedback_dialog.classList.add("visible");
		if (feedback_timeout_id !== null) clearTimeout(feedback_timeout_id);
		feedback_timeout_id = setTimeout(() => {
			feedback_dialog.classList.remove("visible");
			feedback_timeout_id = null;
		}, 1400);
	}

	////////////////////
	//  NOTE HELPERS  //
	////////////////////

	function colCount(notes, c) {
		let n = 0;
		for (let k = 0; k < notes.length; k++) if (notes[k].c === c) n++;
		return n;
	}

	function noteAt(notes, c, r) {
		for (let k = 0; k < notes.length; k++) {
			if (notes[k].c === c && notes[k].r === r) return k;
		}
		return -1;
	}

	// add with the Mario Paint column law. returns true if placed.
	function addNote(notes, c, r, i, v) {
		if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
		const existing = noteAt(notes, c, r);
		if (existing >= 0) {
			notes[existing].i = i;
			notes[existing].v = v || 0.85;
			return true;
		}
		if (colCount(notes, c) >= MAX_PER_COL) return false;
		notes.push({ c: c, r: r, i: i, v: v || 0.85 });
		return true;
	}

	////////////////////
	// SEEDED COMPOSER //
	////////////////////

	// Everything below draws only from the rnd stream passed in, so the same
	// token hash always boots the same starter tune (and capture thumbnail).

	const MODES = [
		{ name: "IONIAN", iv: [0, 2, 4, 5, 7, 9, 11], mood: "COMFY", minor: false },
		{ name: "DORIAN", iv: [0, 2, 3, 5, 7, 9, 10], mood: "GROOVY", minor: true },
		{ name: "MIXOLYDIAN", iv: [0, 2, 4, 5, 7, 9, 10], mood: "BASED", minor: false },
		{ name: "AEOLIAN", iv: [0, 2, 3, 5, 7, 8, 10], mood: "DOOMER", minor: true },
		{ name: "PHRYGIAN", iv: [0, 1, 3, 5, 7, 8, 10], mood: "SCHIZO", minor: true },
		{ name: "LYDIAN", iv: [0, 2, 4, 6, 7, 9, 11], mood: "DREAMY", minor: false },
	];
	const ROOTS = [["C", 0], ["D", 2], ["EB", 3], ["E", 4], ["F", 5], ["G", 7], ["A", 9]];
	const TITLE_A = ["SWAMP", "MIDNIGHT", "COMFY", "RARE", "COSMIC", "FEELS", "BASED", "GIGA", "SMUG", "NEON", "BOG", "HONK"];
	const TITLE_B = ["CROAK", "GONDOLA", "RIBBIT", "FROGSONG", "POND", "LILY", "STONK", "HOPIUM", "MEMEWAVE", "SUNSET", "MARSH", "KEK"];

	function scaleMidis(root_semi, ivals) {
		// scale index k: 0 = root near C4, rising two octaves. row = 14 - k.
		const root_midi = 60 + root_semi - (root_semi > 7 ? 12 : 0);
		const m = new Array(ROWS);
		for (let k = 0; k < ROWS; k++) {
			m[14 - k] = root_midi + 12 * Math.floor(k / 7) + ivals[k % 7];
		}
		return m;
	}

	function buildPitches(root_semi, ivals) {
		return scaleMidis(root_semi, ivals).map((midi) => 440 * Math.pow(2, (midi - 69) / 12));
	}

	function rowOfScaleIndex(k) {
		return 14 - Math.max(0, Math.min(14, k));
	}

	function generate(rnd) {
		const pick = (a) => a[Math.floor(rnd() * a.length)];
		const ri = (n) => Math.floor(rnd() * n);

		// index picks consume rnd() exactly like pick() did - seed determinism frozen
		const mode_i = Math.floor(rnd() * MODES.length);
		const mode = MODES[mode_i];
		const root_i = Math.floor(rnd() * ROOTS.length);
		const root = ROOTS[root_i];
		const bpm = 96 + 4 * ri(19); // 96..168
		const swing = pick([0, 0, 0, 1, 1, 2]);
		const prog_major = [[0, 5, 3, 4], [0, 3, 5, 4], [0, 4, 5, 3], [0, 5, 1, 4], [3, 4, 0, 4], [0, 3, 0, 4]];
		const prog_minor = [[0, 5, 2, 6], [0, 3, 4, 4], [0, 6, 2, 4], [0, 2, 3, 4], [0, 3, 0, 6], [0, 5, 3, 6]];
		const prog = pick(mode.minor ? prog_minor : prog_major);

		// casting call. stamp indexes: 0 pepe 1 cat 2 gondola 3 heart 4 doge
		// 5 sanic 6 ufo 7 wojak 8 cheems 9 groyper 10 swole 11 npc 12 sminem
		// 13 xcp 14 sun 15 firedog
		const lead = pick([0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 2, 3]);
		const harm_pool = [7, 9, 10, 11, 2, 8, 3].filter((i) => i !== lead);
		const harm = pick(harm_pool);
		const bass = pick([12, 12, 12, 8, 9]);
		const drum_style = pick([0, 1, 1, 2, 2]);
		const hat_row = 1 + ri(2);
		const density = 0.6 + rnd() * 0.35;

		const notes = [];

		// --- rhythm section
		for (let b = 0; b < 4; b++) {
			const deg = prog[b];
			addNote(notes, b * 8, rowOfScaleIndex(deg), bass, 0.95);
			const roll = rnd();
			if (roll < 0.5) addNote(notes, b * 8 + 4, rowOfScaleIndex(deg), bass, 0.85);
			else if (roll < 0.8) addNote(notes, b * 8 + 4, rowOfScaleIndex(deg + 4), bass, 0.85);
		}

		// --- melody
		const patterns = [[0, 2, 4, 6], [0, 3, 4, 6], [0, 2, 4, 5, 6], [0, 4, 6], [0, 2, 3, 4, 6, 7], [0, 1, 4, 6]];
		let cur_k = 7 + prog[0];
		const bar_start_k = [];
		for (let b = 0; b < 4; b++) {
			const deg = prog[b];
			const pat = pick(patterns);
			for (let pi = 0; pi < pat.length; pi++) {
				const s = pat[pi];
				if (s !== 0 && rnd() > density) continue;
				const c = b * 8 + s;
				if (s % 4 === 0) {
					// strong beat: nearest chord tone in the upper register
					const opts = [];
					[deg, deg + 2, deg + 4].forEach((d) => {
						[d % 7, (d % 7) + 7, (d % 7) + 14].forEach((k) => {
							if (k >= 5 && k <= 14) opts.push(k);
						});
					});
					opts.sort((a, b2) => Math.abs(a - cur_k) - Math.abs(b2 - cur_k));
					cur_k = opts[0];
				} else {
					const leap = rnd() < 0.15 ? 3 : 1;
					cur_k += (rnd() < 0.5 ? -1 : 1) * leap;
					cur_k = Math.max(5, Math.min(14, cur_k));
				}
				if (s === 0) bar_start_k[b] = cur_k;
				addNote(notes, c, rowOfScaleIndex(cur_k), lead, s % 4 === 0 ? 0.95 : 0.8);
			}
		}

		// --- drums
		if (drum_style > 0) {
			for (let b = 0; b < 4; b++) {
				addNote(notes, b * 8, rowOfScaleIndex(1), 13, 0.9); // XCP kick
				if (drum_style === 2) addNote(notes, b * 8 + 4, rowOfScaleIndex(1), 13, 0.8);
				addNote(notes, b * 8 + (drum_style === 2 ? 2 : 6), rowOfScaleIndex(0) - 6, 15, 0.8); // FIREDOG snare
				if (drum_style === 2) addNote(notes, b * 8 + 6, 8, 15, 0.75);
				const hat_prob = drum_style === 2 ? 0.6 : 0.3;
				for (let s = 1; s < 8; s += 2) {
					if (rnd() < hat_prob) addNote(notes, b * 8 + s, hat_row, 14, 0.7); // SUN hat
				}
			}
		}

		// --- harmony sprinkles
		for (let b = 0; b < 4; b++) {
			if (bar_start_k[b] !== undefined && rnd() < 0.5) {
				addNote(notes, b * 8, rowOfScaleIndex(bar_start_k[b] - 2), harm, 0.7);
			}
		}

		// --- identity
		const title = pick(TITLE_A) + " " + pick(TITLE_B);
		let pepe_count = 0;
		for (let k = 0; k < notes.length; k++) if (notes[k].i === 0) pepe_count++;
		const features = {
			"Tempo (BPM)": bpm,
			"Key": root[0] + " " + mode.name,
			"Mood": mode.mood,
			"Lead": STAMPS[lead].name,
			"Bass": STAMPS[bass].name,
			"Drums": DRUM_NAMES[drum_style],
			"Swing": SWING_NAMES[swing],
			"Croakage (%)": notes.length ? Math.round((100 * pepe_count) / notes.length) : 0,
			"Stamps (num)": notes.length,
			"Motif": title,
		};

		return {
			notes: notes,
			bpm: bpm,
			swing: swing,
			title: title,
			meta_line: root[0] + " " + mode.name + " · " + bpm + " BPM",
			pitches: buildPitches(root[1], mode.iv),
			midis: scaleMidis(root[1], mode.iv),
			root_i: root_i,
			mode_i: mode_i,
			features: features,
		};
	}

	function applyGenerated(gen) {
		state.notes = gen.notes;
		state.bpm = gen.bpm;
		state.swing = gen.swing;
		state.title = gen.title;
		state.meta_line = gen.meta_line;
		state.pitches = gen.pitches;
		state.midis = gen.midis;
		state.root_i = gen.root_i;
		state.mode_i = gen.mode_i;
		track_title.textContent = gen.title;
		track_meta.textContent = gen.meta_line;
	}

	// load a decoded tune-code: {notes, bpm, swing, root_i, mode_i, title}
	function applyImportedTune(data) {
		if (!data || !Array.isArray(data.notes)) return false;
		const mode = MODES[data.mode_i];
		const root = ROOTS[data.root_i];
		if (!mode || !root) return false;
		pushUndo();
		const clean = [];
		for (let k = 0; k < data.notes.length; k++) {
			const note = data.notes[k];
			addNote(clean, note.c, note.r, note.i, note.v);
		}
		state.notes = clean;
		state.bpm = Math.max(60, Math.min(220, Math.round(data.bpm) || 120));
		state.swing = data.swing === 1 || data.swing === 2 ? data.swing : 0;
		state.root_i = data.root_i;
		state.mode_i = data.mode_i;
		state.pitches = buildPitches(root[1], mode.iv);
		state.midis = scaleMidis(root[1], mode.iv);
		if (typeof data.title === "string" && data.title.length) state.title = data.title.slice(0, 24);
		state.meta_line = root[0] + " " + mode.name + " · " + state.bpm + " BPM";
		track_title.textContent = state.title;
		track_meta.textContent = state.meta_line;
		syncTransportUI();
		saveLocal();
		return true;
	}

	////////////////////
	//     IMAGES     //
	////////////////////

	const stamp_imgs = [];
	let eraser_img = null;
	function loadImages() {
		const jobs = STAMPS.map((s, k) => new Promise((res) => {
			const im = new Image();
			im.onload = () => res();
			im.onerror = () => res();
			im.src = s.img;
			stamp_imgs[k] = im;
		}));
		jobs.push(new Promise((res) => {
			eraser_img = new Image();
			eraser_img.onload = () => res();
			eraser_img.onerror = () => res();
			eraser_img.src = ERASER_IMG;
		}));
		return Promise.all(jobs);
	}

	////////////////////
	//    RENDERING   //
	////////////////////

	// staff line rows for a treble-ish look: F5 D5 B4 G4 E4 when bottom = C4
	const STAFF_LINE_ROWS = [4, 6, 8, 10, 12];
	const pops = {}; // "c_r" -> ms timestamp of playback hit
	let hover_cell = null; // {c, r} in absolute cols
	let playhead = { step: -1, when: 0 };
	const playhead_queue = [];

	function cellRect(local_c, r) {
		return {
			x: GRID.x0 + local_c * CELL_W,
			y: GRID.y0 + r * CELL_H,
			w: CELL_W,
			h: CELL_H,
		};
	}

	function drawStaffInto(g, page, opts) {
		opts = opts || {};
		const now = performance.now();
		g.save();

		// paper
		g.fillStyle = "#ffffff";
		g.fillRect(0, 0, 400, 300);

		// column shading per beat pair
		for (let lc = 0; lc < PAGE_COLS; lc++) {
			if ((lc >> 2) % 2 === 1) {
				g.fillStyle = "rgba(0, 128, 0, 0.045)";
				g.fillRect(GRID.x0 + lc * CELL_W, GRID.y0, CELL_W, GRID.h);
			}
		}

		// staff lines
		g.strokeStyle = "#2e8b2e";
		g.lineWidth = 1;
		STAFF_LINE_ROWS.forEach((r) => {
			const y = GRID.y0 + (r + 0.5) * CELL_H;
			g.beginPath();
			g.moveTo(GRID.x0, y);
			g.lineTo(GRID.x0 + GRID.w, y);
			g.stroke();
		});

		// bar lines + light beat ticks
		for (let lc = 0; lc <= PAGE_COLS; lc++) {
			const x = GRID.x0 + lc * CELL_W;
			const is_bar = lc % 8 === 0;
			const is_beat = lc % 4 === 0;
			g.strokeStyle = is_bar ? "#1f6f1f" : is_beat ? "#7bc47b" : "#dcefdc";
			g.lineWidth = is_bar ? 2 : 1;
			g.beginPath();
			g.moveTo(x, GRID.y0 - (is_bar ? 6 : 0));
			g.lineTo(x, GRID.y0 + GRID.h + (is_bar ? 6 : 0));
			g.stroke();
		}

		// bar numbers
		g.fillStyle = "#2e8b2e";
		g.font = '9px "unscii8tall", monospace';
		g.textAlign = "left";
		for (let bar = 0; bar < 2; bar++) {
			g.fillText(String(page * 2 + bar + 1), GRID.x0 + bar * 8 * CELL_W + 3, GRID.y0 - 3);
		}

		// playhead
		if (opts.playhead_step !== undefined && opts.playhead_step >= 0) {
			const lc = opts.playhead_step - page * PAGE_COLS;
			if (lc >= 0 && lc < PAGE_COLS) {
				g.fillStyle = "rgba(0, 164, 55, 0.16)";
				g.fillRect(GRID.x0 + lc * CELL_W, GRID.y0, CELL_W, GRID.h);
				g.strokeStyle = "#00a437";
				g.lineWidth = 2;
				g.beginPath();
				g.moveTo(GRID.x0 + lc * CELL_W, GRID.y0 - 4);
				g.lineTo(GRID.x0 + lc * CELL_W, GRID.y0 + GRID.h + 4);
				g.stroke();
			}
		}

		// hover ghost
		if (!opts.static_render && !opts.no_hover && hover_cell && hover_cell.c >= page * PAGE_COLS && hover_cell.c < (page + 1) * PAGE_COLS) {
			const rect = cellRect(hover_cell.c - page * PAGE_COLS, hover_cell.r);
			if (state.eraser) {
				g.strokeStyle = "#cc4444";
				g.lineWidth = 1.5;
				g.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
			} else {
				const im = stamp_imgs[state.sel];
				if (im) {
					g.globalAlpha = 0.45;
					g.drawImage(im, rect.x + rect.w / 2 - STAMP_PX / 2, rect.y + rect.h / 2 - STAMP_PX / 2, STAMP_PX, STAMP_PX);
					g.globalAlpha = 1;
				}
			}
		}

		// stamps
		for (let k = 0; k < state.notes.length; k++) {
			const note = state.notes[k];
			const lc = note.c - page * PAGE_COLS;
			if (lc < 0 || lc >= PAGE_COLS) continue;
			const rect = cellRect(lc, note.r);
			const im = stamp_imgs[note.i];
			if (!im) continue;
			let size = STAMP_PX;
			let rot = 0;
			if (!opts.static_render) {
				const pop = pops[note.c + "_" + note.r];
				if (pop !== undefined) {
					const age = now - pop;
					if (age < 150) {
						const kf = 1 - age / 150;
						size = STAMP_PX * (1 + 0.35 * kf);
						rot = Math.sin(age / 24) * 0.16 * kf;
					} else {
						delete pops[note.c + "_" + note.r];
					}
				}
			}
			g.save();
			g.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
			g.rotate(rot);
			g.drawImage(im, -size / 2, -size / 2, size, size);
			g.restore();
		}

		g.restore();
	}

	function draw() {
		cx.setTransform(CV, 0, 0, CV, 0, 0);
		cx.imageSmoothingEnabled = false;
		drawStaffInto(cx, state.page, { playhead_step: player.playing ? playhead.step : -1 });
	}

	////////////////////
	//    PLAYBACK    //
	////////////////////

	const player = {
		playing: false,
		step: 0,
		next_time: 0,
		timer: null,
		ending: false,
		steps_done: 0,
		passes_target: null, // when set, play exactly N passes then stop
		on_complete: null, // callback("complete" | "stopped")
	};

	function stepDur() {
		return 60 / state.bpm / 2;
	}

	function notesInCol(c) {
		const out = [];
		for (let k = 0; k < state.notes.length; k++) if (state.notes[k].c === c) out.push(state.notes[k]);
		return out;
	}

	function scheduleStep(step, when) {
		const c = SPPAudio.ctx();
		const sd = stepDur();
		let t = when;
		if (step % 2 === 1) t += SWING_AMTS[state.swing] * sd;
		const col_notes = notesInCol(step);
		for (let k = 0; k < col_notes.length; k++) {
			const note = col_notes[k];
			SPPAudio.playNote(c, SPPAudio.bus(), STAMPS[note.i].synth, t, state.pitches[note.r], note.v || 0.85, sd, SPPAudio.panFor(note.i));
		}
		playhead_queue.push({ step: step, when: t });
	}

	function schedulerTick() {
		const c = SPPAudio.ctx();
		const sd = stepDur();
		while (player.next_time < c.currentTime + 0.14) {
			if (player.ending) break;
			scheduleStep(player.step, player.next_time);
			player.steps_done++;
			player.step++;
			if (player.step >= COLS) {
				const passes_done = player.passes_target !== null && player.steps_done >= COLS * player.passes_target;
				if (passes_done || (player.passes_target === null && !state.loop)) {
					player.ending = true;
				} else {
					player.step = 0;
				}
			}
			player.next_time += sd;
		}
		if (player.ending && c.currentTime > player.next_time + 0.2) {
			stopPlayback("complete");
		}
	}

	function startPlayback(opts) {
		opts = opts || {};
		const c = SPPAudio.ctx();
		if (c.state === "suspended") {
			c.resume();
		}
		player.playing = true;
		player.ending = false;
		player.step = 0;
		player.steps_done = 0;
		player.passes_target = opts.passes || null;
		player.on_complete = opts.onComplete || null;
		player.next_time = c.currentTime + 0.08;
		playhead_queue.length = 0;
		playhead.step = -1;
		player.timer = setInterval(schedulerTick, 25);
		schedulerTick();
		play_button.innerHTML = "&#9632; STOP";
		play_button.setAttribute("aria-pressed", "true");
		if (!opts.quiet) showFeedbackNotification("RIBBIT");
	}

	function stopPlayback(reason) {
		const cb = player.on_complete;
		player.playing = false;
		player.ending = false;
		player.passes_target = null;
		player.on_complete = null;
		if (player.timer !== null) {
			clearInterval(player.timer);
			player.timer = null;
		}
		playhead_queue.length = 0;
		playhead.step = -1;
		play_button.innerHTML = "&#9654; PLAY";
		play_button.setAttribute("aria-pressed", "false");
		if (cb) cb(reason === "complete" ? "complete" : "stopped");
	}

	function togglePlayback() {
		if (player.playing) {
			stopPlayback();
			showFeedbackNotification("STOPPED");
		} else {
			startPlayback();
		}
	}

	// rAF loop: playhead tracking, stamp pops, page follow
	function frame() {
		if (player.playing) {
			const c = SPPAudio.ctx();
			while (playhead_queue.length && playhead_queue[0].when <= c.currentTime) {
				const hit = playhead_queue.shift();
				playhead.step = hit.step;
				const col_notes = notesInCol(hit.step);
				for (let k = 0; k < col_notes.length; k++) {
					pops[col_notes[k].c + "_" + col_notes[k].r] = performance.now();
				}
			}
			const want_page = playhead.step >= 0 ? Math.floor(playhead.step / PAGE_COLS) : state.page;
			if (want_page !== state.page && playhead.step >= 0) {
				state.page = want_page;
				updatePageButton();
			}
		}
		draw();
		requestAnimationFrame(frame);
	}

	////////////////////
	//  UNDO / REDO   //
	////////////////////

	function snapshot() {
		return JSON.stringify({ n: state.notes, b: state.bpm, s: state.swing, ri: state.root_i, mi: state.mode_i, t: state.title });
	}

	function applyKeySignature(root_i, mode_i) {
		const mode = MODES[mode_i];
		const root = ROOTS[root_i];
		if (!mode || !root) return;
		state.root_i = root_i;
		state.mode_i = mode_i;
		state.pitches = buildPitches(root[1], mode.iv);
		state.midis = scaleMidis(root[1], mode.iv);
		state.meta_line = root[0] + " " + mode.name + " · " + state.bpm + " BPM";
		track_title.textContent = state.title;
		track_meta.textContent = state.meta_line;
	}

	function pushUndo() {
		undo_stack.push(snapshot());
		if (undo_stack.length > 80) undo_stack.shift();
		redo_stack.length = 0;
	}

	function applySnapshot(snap) {
		try {
			const data = JSON.parse(snap);
			state.notes = data.n || [];
			state.bpm = data.b || state.bpm;
			state.swing = data.s !== undefined ? data.s : state.swing;
			if (typeof data.t === "string" && data.t.length) state.title = data.t;
			if (data.ri !== undefined && data.mi !== undefined) applyKeySignature(data.ri, data.mi);
			syncTransportUI();
		} catch (err) { /* keep current state */ }
	}

	function undo() {
		if (!undo_stack.length) {
			showFeedbackNotification("NOTHING TO UNDO");
			return;
		}
		redo_stack.push(snapshot());
		applySnapshot(undo_stack.pop());
		saveLocal();
		showFeedbackNotification("UNDO");
	}

	function redo() {
		if (!redo_stack.length) {
			showFeedbackNotification("NOTHING TO REDO");
			return;
		}
		undo_stack.push(snapshot());
		applySnapshot(redo_stack.pop());
		saveLocal();
		showFeedbackNotification("REDO");
	}

	////////////////////
	//  PERSISTENCE   //
	////////////////////

	let save_timer = null;
	function saveLocal() {
		if (BL.isCapture) return;
		if (save_timer !== null) clearTimeout(save_timer);
		save_timer = setTimeout(() => {
			try {
				localStorage.setItem(save_key, snapshot());
			} catch (err) { /* sandboxed - fine */ }
		}, 350);
	}

	function restoreLocal() {
		try {
			const raw = localStorage.getItem(save_key);
			if (!raw) return false;
			const data = JSON.parse(raw);
			if (!data || !Array.isArray(data.n)) return false;
			const clean = [];
			for (let k = 0; k < data.n.length; k++) {
				const note = data.n[k];
				if (typeof note.c !== "number" || typeof note.r !== "number" || typeof note.i !== "number") continue;
				if (note.i < 0 || note.i >= STAMPS.length) continue;
				addNote(clean, Math.floor(note.c), Math.floor(note.r), Math.floor(note.i), note.v);
			}
			state.notes = clean;
			if (typeof data.b === "number" && data.b >= 60 && data.b <= 220) state.bpm = data.b;
			if (data.s === 0 || data.s === 1 || data.s === 2) state.swing = data.s;
			if (typeof data.t === "string" && data.t.length) state.title = data.t.slice(0, 24);
			if (data.ri !== undefined && data.mi !== undefined) applyKeySignature(data.ri, data.mi);
			return true;
		} catch (err) {
			return false;
		}
	}

	////////////////////
	//   INTERACTION  //
	////////////////////

	function canvasCell(ev) {
		const rect = staff_canvas.getBoundingClientRect();
		const x = ((ev.clientX - rect.left) / rect.width) * 400;
		const y = ((ev.clientY - rect.top) / rect.height) * 300;
		const lc = Math.floor((x - GRID.x0) / CELL_W);
		const r = Math.floor((y - GRID.y0) / CELL_H);
		if (lc < 0 || lc >= PAGE_COLS || r < 0 || r >= ROWS) return null;
		return { c: state.page * PAGE_COLS + lc, r: r };
	}

	let stroke_active = false;
	let last_stroke_cell = null;

	function applyStroke(cell) {
		if (!cell) return;
		if (last_stroke_cell && last_stroke_cell.c === cell.c && last_stroke_cell.r === cell.r) return;
		last_stroke_cell = cell;
		if (state.eraser) {
			const idx = noteAt(state.notes, cell.c, cell.r);
			if (idx >= 0) {
				state.notes.splice(idx, 1);
				saveLocal();
			}
			return;
		}
		const placed = addNote(state.notes, cell.c, cell.r, state.sel, 0.85);
		if (!placed) {
			showFeedbackNotification("3 STAMPS MAX PER BEAT");
			return;
		}
		saveLocal();
		// preview blip, Mario Paint style
		try {
			const c = SPPAudio.ctx();
			SPPAudio.playNote(c, SPPAudio.bus(), STAMPS[state.sel].synth, c.currentTime + 0.01, state.pitches[cell.r], 0.8, stepDur(), SPPAudio.panFor(state.sel));
			pops[cell.c + "_" + cell.r] = performance.now();
		} catch (err) { /* audio blocked until gesture - but this IS a gesture */ }
	}

	staff_canvas.addEventListener("pointerdown", (ev) => {
		ev.preventDefault();
		try {
			staff_canvas.setPointerCapture(ev.pointerId);
		} catch (err) { /* synthetic pointers have no capture */ }
		stroke_active = true;
		last_stroke_cell = null;
		pushUndo();
		applyStroke(canvasCell(ev));
	});

	staff_canvas.addEventListener("pointermove", (ev) => {
		const cell = canvasCell(ev);
		hover_cell = cell;
		if (stroke_active) applyStroke(cell);
	});

	staff_canvas.addEventListener("pointerup", () => {
		stroke_active = false;
		last_stroke_cell = null;
	});

	staff_canvas.addEventListener("pointerleave", () => {
		hover_cell = null;
	});

	////////////////////
	//   TRANSPORT UI //
	////////////////////

	function updatePageButton() {
		page_button.textContent = "PAGE " + (state.page === 0 ? "A" : "B");
	}

	function syncTransportUI() {
		tempo_range.value = String(state.bpm);
		bpm_readout.textContent = String(state.bpm);
		swing_button.setAttribute("aria-pressed", state.swing > 0 ? "true" : "false");
		swing_button.textContent = (state.swing > 0 ? "●" : "○") + "SWING" + (state.swing === 0 ? "" : "·" + (state.swing === 1 ? "L" : "H"));
		loop_button.setAttribute("aria-pressed", state.loop ? "true" : "false");
		loop_button.textContent = (state.loop ? "●" : "○") + "LOOP";
		eraser_button.setAttribute("aria-pressed", state.eraser ? "true" : "false");
		eraser_button.textContent = (state.eraser ? "●" : "○") + "ERASE";
		updatePageButton();
	}

	function setPage(p) {
		state.page = Math.max(0, Math.min(1, p));
		updatePageButton();
		showFeedbackNotification("PAGE " + (state.page === 0 ? "A" : "B"));
	}

	function setSwing(s) {
		state.swing = s % 3;
		syncTransportUI();
		showFeedbackNotification("SWING: " + SWING_NAMES[state.swing]);
		saveLocal();
	}

	function setEraser(on) {
		state.eraser = on;
		syncTransportUI();
		showFeedbackNotification(on ? "ERASER ON" : "ERASER OFF");
	}

	function selectStamp(i) {
		state.sel = i;
		state.eraser = false;
		const radio = document.getElementById("stamp_radio_" + i);
		if (radio) radio.checked = true;
		syncTransportUI();
		showFeedbackNotification(STAMPS[i].name);
		// Mario Paint style: picking an instrument says hello.
		// Fixed reference pitch (the key's root, one octave up = row 7) so
		// every voice previews consistently. Selection is always a user
		// gesture, and capture mode never selects - determinism unharmed.
		if (!BL.isCapture) {
			try {
				const c = SPPAudio.ctx();
				SPPAudio.playNote(c, SPPAudio.bus(), STAMPS[i].synth, c.currentTime + 0.01, state.pitches[7], 0.85, stepDur(), SPPAudio.panFor(i));
			} catch (err) { /* audio not available yet - stay silent */ }
		}
	}

	function clearAll() {
		pushUndo();
		state.notes = [];
		saveLocal();
		showFeedbackNotification("CLEARED");
	}

	function randomTune() {
		pushUndo();
		const gen = generate(BL.rnd);
		applyGenerated(gen);
		syncTransportUI();
		saveLocal();
		showFeedbackNotification("NEW TUNE: " + gen.title);
	}

	play_button.addEventListener("click", togglePlayback);
	loop_button.addEventListener("click", () => {
		state.loop = !state.loop;
		syncTransportUI();
		showFeedbackNotification("LOOP: " + (state.loop ? "ON" : "OFF"));
	});
	swing_button.addEventListener("click", () => setSwing(state.swing + 1));
	tempo_range.addEventListener("input", () => {
		state.bpm = parseInt(tempo_range.value, 10);
		bpm_readout.textContent = String(state.bpm);
		saveLocal();
	});
	$("page_prev_button").addEventListener("click", () => setPage(0));
	$("page_next_button").addEventListener("click", () => setPage(1));
	page_button.addEventListener("click", () => setPage(state.page === 0 ? 1 : 0));
	eraser_button.addEventListener("click", () => setEraser(!state.eraser));
	$("undo_button").addEventListener("click", undo);
	$("redo_button").addEventListener("click", redo);
	$("rand_button").addEventListener("click", randomTune);
	$("clear_button").addEventListener("click", clearAll);
	$("help_button").addEventListener("click", () => info_overlay.classList.toggle("visible"));

	////////////////////
	//     PALETTE    //
	////////////////////

	function buildPalette() {
		const bar = $("palette_bar");
		let html = "";
		for (let i = 0; i < STAMPS.length; i++) {
			const s = STAMPS[i];
			html +=
				'<input type="radio" name="stamp" id="stamp_radio_' + i + '" class="hidden_radio"' + (i === 0 ? " checked" : "") + " />" +
				'<label for="stamp_radio_' + i + '" class="stamp_box" data-stamp="' + i + '" title="' + s.name + " (" + s.key + ')" style="background-image:url(\'' + s.img + "')\"></label>";
		}
		bar.insertAdjacentHTML("beforeend", html);
		bar.addEventListener("click", (ev) => {
			const label = ev.target.closest(".stamp_box");
			if (!label) return;
			selectStamp(parseInt(label.getAttribute("data-stamp"), 10));
		});
	}

	////////////////////
	//     EXPORTS    //
	////////////////////

	function downloadBlob(blob, name) {
		try {
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = name;
			document.body.appendChild(a);
			a.click();
			setTimeout(() => {
				URL.revokeObjectURL(url);
				a.remove();
			}, 2000);
			return true;
		} catch (err) {
			return false;
		}
	}

	function fileTag() {
		return (state.title || "TUNE").replace(/[^A-Z0-9]+/gi, "_") + "_" + BL.hash.slice(0, 8);
	}

	let wav_busy = false;
	function exportWav() {
		if (wav_busy) return;
		wav_busy = true;
		showFeedbackNotification("RENDERING WAV...");
		SPPAudio.renderWav({
			notes: state.notes,
			pitches: state.pitches,
			stamps: STAMPS,
			bpm: state.bpm,
			swingAmt: SWING_AMTS[state.swing],
			passes: 2,
		}).then((blob) => {
			wav_busy = false;
			const ok = downloadBlob(blob, "SUPERPEPEPAINT_" + fileTag() + ".wav");
			showFeedbackNotification(ok ? "WAV SAVED" : "WAV EXPORT BLOCKED");
		}).catch(() => {
			wav_busy = false;
			showFeedbackNotification("WAV RENDER FAILED");
		});
	}

	function exportPng() {
		try {
			const W = 800, H = 1240;
			const out = document.createElement("canvas");
			out.width = W;
			out.height = H;
			const g = out.getContext("2d");
			g.imageSmoothingEnabled = false;
			g.fillStyle = "#ffffff";
			g.fillRect(0, 0, W, H);
			g.fillStyle = "green";
			g.textAlign = "center";
			g.font = '32px "unscii8", monospace';
			g.fillText("SUPERPEPEPAINT", W / 2, 56);
			g.font = '22px "unscii8tall", monospace';
			g.fillText(state.title, W / 2, 96);
			g.font = '16px "unscii8tall", monospace';
			g.fillText(state.meta_line + " · SWING " + SWING_NAMES[state.swing], W / 2, 124);
			// both pages, stacked
			for (let p = 0; p < 2; p++) {
				g.save();
				g.translate(0, 150 + p * 470);
				g.scale(2, 1.5);
				drawStaffInto(g, p, { static_render: true, playhead_step: -1 });
				g.restore();
				g.font = '14px "unscii8tall", monospace';
				g.fillText("PAGE " + (p === 0 ? "A" : "B"), W / 2, 150 + p * 470 + 465);
			}
			g.font = '14px "unscii8tall", monospace';
			g.fillText("SEED " + BL.hash.slice(0, 16) + "... · EDITION " + BL.iteration, W / 2, H - 46);
			g.fillText("A PEPEPAINT FORK · MARIO PAINT STYLE SWAMP MUSIC", W / 2, H - 24);
			out.toBlob((blob) => {
				if (!blob) {
					showFeedbackNotification("PNG EXPORT BLOCKED");
					return;
				}
				const ok = downloadBlob(blob, "SUPERPEPEPAINT_" + fileTag() + ".png");
				showFeedbackNotification(ok ? "SCORE PNG SAVED" : "PNG EXPORT BLOCKED");
			}, "image/png");
		} catch (err) {
			showFeedbackNotification("PNG EXPORT BLOCKED");
		}
	}

	$("wav_button").addEventListener("click", exportWav);
	$("png_button").addEventListener("click", exportPng);

	////////////////////
	//    KEYBOARD    //
	////////////////////

	function hideUI(hide) {
		state.hide_ui = hide;
		["header", "track_bar", "transport_bar", "tool_bar", "palette_bar", "footer_bar"].forEach((id) => {
			const el = $(id);
			if (el) el.classList.toggle("hidden", hide);
		});
	}

	document.addEventListener("keydown", (ev) => {
		if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
		// never hijack typing in form fields (tune-code textarea etc.)
		const tag = ev.target && ev.target.tagName;
		if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
		const key = ev.key;
		// stamp keys
		for (let i = 0; i < STAMPS.length; i++) {
			if (key === STAMPS[i].key) {
				selectStamp(i);
				ev.preventDefault();
				return;
			}
		}
		switch (key) {
			case " ":
				togglePlayback();
				ev.preventDefault();
				break;
			case "z": undo(); break;
			case "x": redo(); break;
			case "a": randomTune(); break;
			case "c": clearAll(); break;
			case "e": setEraser(!state.eraser); break;
			case "g": setSwing(state.swing + 1); break;
			case "l":
				state.loop = !state.loop;
				syncTransportUI();
				showFeedbackNotification("LOOP: " + (state.loop ? "ON" : "OFF"));
				break;
			case "n":
				state.bpm = Math.max(60, state.bpm - 2);
				syncTransportUI();
				showFeedbackNotification("TEMPO " + state.bpm);
				saveLocal();
				break;
			case "m":
				state.bpm = Math.min(220, state.bpm + 2);
				syncTransportUI();
				showFeedbackNotification("TEMPO " + state.bpm);
				saveLocal();
				break;
			case "s": exportPng(); ev.preventDefault(); break;
			case "v": exportWav(); break;
			case "h": hideUI(!state.hide_ui); break;
			case "?": info_overlay.classList.toggle("visible"); break;
			case "ArrowLeft": setPage(0); ev.preventDefault(); break;
			case "ArrowRight": setPage(1); ev.preventDefault(); break;
			case "Escape": info_overlay.classList.remove("visible"); break;
		}
	});

	////////////////////
	//  CARD SCALING  //
	////////////////////

	function fitCard() {
		const s = Math.min(window.innerWidth / 400, window.innerHeight / 560);
		document.getElementById("card").style.transform =
			"translate(-50%, -50%) scale(" + s + ")";
	}
	window.addEventListener("resize", fitCard);

	////////////////////
	//      BOOT      //
	////////////////////

	function init() {
		fitCard();
		buildPalette();

		// the seed composes. same hash, same tune, forever.
		const gen = generate(BL.rnd);
		applyGenerated(gen);
		state.features = gen.features;
		$("info_token_row").textContent = "SEED " + BL.hash.slice(0, 12) + "... · EDITION #" + BL.iteration;
		BL.setFeatures(gen.features);

		// collectors keep their edits (never during capture)
		if (!BL.isCapture) {
			if (restoreLocal()) showFeedbackNotification("SAVED TUNE RESTORED");
		}

		syncTransportUI();

		loadImages().then(() => {
			const fonts_ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
			fonts_ready.then(() => {
				if (BL.isCapture) {
					draw();
					requestAnimationFrame(() => {
						draw();
						requestAnimationFrame(() => BL.capture());
					});
				} else {
					requestAnimationFrame(frame);
				}
			});
		});
	}

	init();

	// small window for tinkerers, dev harness, tests and the mint kit
	window.SPP = {
		state: state,
		generate: generate,
		draw: draw,
		addNote: addNote,
		togglePlayback: togglePlayback,
		startPlayback: startPlayback,
		stopPlayback: stopPlayback,
		isPlaying: () => player.playing,
		playheadStep: () => playhead.step,
		stepDur: stepDur,
		exportWav: exportWav,
		exportPng: exportPng,
		drawStaffInto: drawStaffInto,
		getTuneData: () => ({
			notes: state.notes.map((n) => ({ c: n.c, r: n.r, i: n.i, v: n.v })),
			bpm: state.bpm,
			swing: state.swing,
			root_i: state.root_i,
			mode_i: state.mode_i,
			title: state.title,
		}),
		applyImportedTune: applyImportedTune,
		downloadBlob: downloadBlob,
		fileTag: fileTag,
		showFeedback: showFeedbackNotification,
		images: stamp_imgs,
		consts: {
			COLS: COLS,
			ROWS: ROWS,
			MODES: MODES,
			ROOTS: ROOTS,
			SWING_AMTS: SWING_AMTS,
			SWING_NAMES: SWING_NAMES,
		},
	};
})();
