/* SUPERPEPEPAINT logic tests
   Runs the REAL shipped bootloader.js + stamps.js + main.js inside a stub DOM,
   then checks determinism and composer invariants across many seeds.
   Usage: node test/logic.test.cjs */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = ["bootloader.js", "stamps.js", "main.js", "mint.js"].map((f) =>
	fs.readFileSync(path.join(ROOT, f), "utf8")
);

function makeElementStub() {
	const el = {
		style: {},
		children: [],
		checked: false,
		open: false,
		value: "120",
		textContent: "",
		innerHTML: "",
		show() { this.open = true; },
		close() { this.open = false; },
		focus() {},
		select() {},
		classList: {
			add() {}, remove() {}, toggle() {}, contains() { return false; },
		},
		setAttribute() {},
		getAttribute() { return null; },
		addEventListener() {},
		removeEventListener() {},
		insertAdjacentHTML() {},
		appendChild() {},
		remove() {},
		closest() { return null; },
		setPointerCapture() {},
		getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; },
		getContext() {
			return new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 0 }) : () => {}) });
		},
		toBlob(cb) { cb(null); },
	};
	return el;
}

function bootWorld(seedHex) {
	const elements = {};
	const documentStub = {
		referrer: "",
		fonts: { ready: Promise.resolve() },
		getElementById(id) {
			if (!elements[id]) elements[id] = makeElementStub();
			return elements[id];
		},
		createElement() { return makeElementStub(); },
		addEventListener() {},
	};
	const sandbox = {
		console,
		document: documentStub,
		location: { search: "?s=" + seedHex },
		URLSearchParams,
		performance: { now: () => 0 },
		requestAnimationFrame() {},
		setInterval() { return 0; },
		clearInterval() {},
		setTimeout() { return 0; },
		clearTimeout() {},
		localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
		Image: function () { this.src = ""; },
		Promise,
		JSON,
		Math,
		URL: { createObjectURL() { return ""; }, revokeObjectURL() {} },
		Blob: function () {},
		SPPAudio: {
			ctx() { return { currentTime: 0, state: "running", resume() {} }; },
			bus() { return {}; },
			playNote() {},
			panFor() { return 0; },
			renderWav() { return Promise.resolve(null); },
		},
	};
	sandbox.addEventListener = function () {};
	sandbox.removeEventListener = function () {};
	sandbox.innerWidth = 800;
	sandbox.innerHeight = 800;
	sandbox.btoa = btoa;
	sandbox.atob = atob;
	sandbox.Uint8Array = Uint8Array;
	sandbox.navigator = {};
	sandbox.window = sandbox;
	sandbox.self = sandbox;
	vm.createContext(sandbox);
	for (const src of SRC) vm.runInContext(src, sandbox);
	return sandbox;
}

function randHex(rng) {
	let s = "";
	for (let i = 0; i < 64; i++) s += Math.floor(rng() * 16).toString(16);
	return s;
}

// simple deterministic test rng (mulberry32) for seed generation only
function mulberry32(a) {
	return function () {
		a |= 0; a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

let failures = 0;
let checks = 0;
function assert(cond, msg) {
	checks++;
	if (!cond) {
		failures++;
		console.error("FAIL:", msg);
	}
}

const rng = mulberry32(0xc0ffee);
const N_SEEDS = 120;
const seen_titles = new Set();
const seen_tunes = new Set();
let total_notes = 0;

for (let n = 0; n < N_SEEDS; n++) {
	const seed = randHex(rng);
	const w1 = bootWorld(seed);
	const w2 = bootWorld(seed);
	const s1 = w1.SPP.state;
	const s2 = w2.SPP.state;

	// determinism: same seed, identical tune + identity + features
	assert(JSON.stringify(s1.notes) === JSON.stringify(s2.notes), "notes deterministic for seed " + seed.slice(0, 8));
	assert(s1.title === s2.title && s1.bpm === s2.bpm && s1.swing === s2.swing, "identity deterministic " + seed.slice(0, 8));
	assert(JSON.stringify(s1.features) === JSON.stringify(s2.features), "features deterministic " + seed.slice(0, 8));
	assert(JSON.stringify(s1.pitches) === JSON.stringify(s2.pitches), "pitches deterministic " + seed.slice(0, 8));

	// invariants
	const colCounts = {};
	for (const note of s1.notes) {
		assert(note.c >= 0 && note.c < 32, "col in range");
		assert(note.r >= 0 && note.r < 15, "row in range");
		assert(note.i >= 0 && note.i < 16, "stamp idx in range");
		assert(note.v > 0 && note.v <= 1, "velocity in range");
		const key = note.c + "_" + note.r;
		assert(!colCounts[key], "no duplicate cell " + key);
		colCounts[key] = true;
		colCounts[note.c] = (colCounts[note.c] || 0) + 1;
	}
	for (let c = 0; c < 32; c++) {
		assert((colCounts[c] || 0) <= 3, "MARIO PAINT LAW: max 3 per column (col " + c + " has " + colCounts[c] + ") seed " + seed.slice(0, 8));
	}
	assert(s1.notes.length >= 10, "tune is non-trivial (" + s1.notes.length + " notes) " + seed.slice(0, 8));
	assert(s1.notes.length <= 96, "tune under global cap");
	assert(s1.bpm >= 96 && s1.bpm <= 168, "bpm range");
	assert([0, 1, 2].includes(s1.swing), "swing range");
	assert(s1.title.length > 3, "title exists");
	assert(s1.pitches.length === 15, "15 pitches");
	for (let r = 0; r < 14; r++) assert(s1.pitches[r] > s1.pitches[r + 1], "pitches descend top to bottom");
	assert(s1.pitches[14] > 180 && s1.pitches[0] < 1800, "pitch band sane");

	// features shape
	const f = s1.features;
	["Tempo (BPM)", "Key", "Mood", "Lead", "Bass", "Drums", "Swing", "Croakage (%)", "Stamps (num)", "Motif"].forEach((k) =>
		assert(f[k] !== undefined, "feature " + k)
	);
	assert(f["Stamps (num)"] === s1.notes.length, "stamp count feature matches");

	seen_titles.add(s1.title);
	seen_tunes.add(JSON.stringify(s1.notes));
	total_notes += s1.notes.length;
}

// variety: different seeds should produce different tunes
assert(seen_tunes.size >= N_SEEDS * 0.98, "tunes vary across seeds (" + seen_tunes.size + "/" + N_SEEDS + ")");
assert(seen_titles.size >= 25, "title variety (" + seen_titles.size + ")");

// melody register check on one seed: lead notes should live in upper rows on average
{
	const w = bootWorld(randHex(rng));
	const s = w.SPP.state;
	const leadIdx = w.STAMPS.findIndex((st) => st.name === s.features.Lead);
	const leadRows = s.notes.filter((note) => note.i === leadIdx).map((note) => note.r);
	if (leadRows.length) {
		const avg = leadRows.reduce((a, b) => a + b, 0) / leadRows.length;
		assert(avg <= 9, "lead sits in upper register (avg row " + avg.toFixed(1) + ")");
	}
}

// ---- mint kit: tune-code codec round trip, corruption, MIDI ---------------

const CODEC_SEEDS = 40;
for (let n = 0; n < CODEC_SEEDS; n++) {
	const seed = randHex(rng);
	const w = bootWorld(seed);
	const tune = w.SPP.getTuneData();
	const code = w.SPPMINT.encodeTune(tune);
	assert(code.indexOf("SPP1.") === 0, "code has prefix");
	const dec = w.SPPMINT.decodeTune(code);
	assert(dec.ok, "decode ok " + seed.slice(0, 8) + (dec.ok ? "" : " (" + dec.error + ")"));
	if (dec.ok) {
		const d = dec.data;
		assert(d.bpm === tune.bpm && d.swing === tune.swing, "codec bpm/swing round trip");
		assert(d.root_i === tune.root_i && d.mode_i === tune.mode_i, "codec key round trip");
		assert(d.title === tune.title, "codec title round trip");
		assert(d.notes.length === tune.notes.length, "codec note count");
		let exact = true;
		for (let k = 0; k < d.notes.length; k++) {
			const a = d.notes[k], b = tune.notes[k];
			if (a.c !== b.c || a.r !== b.r || a.i !== b.i || Math.abs(a.v - b.v) > 0.0001) exact = false;
		}
		assert(exact, "codec notes exact round trip " + seed.slice(0, 8));
		// import applies cleanly
		assert(w.SPP.applyImportedTune(d) === true, "import applies");
		assert(w.SPP.state.notes.length === d.notes.length, "import kept all notes");
		assert(w.SPP.state.title === d.title && w.SPP.state.bpm === d.bpm, "import identity");
		assert(w.SPP.state.pitches.length === 15 && w.SPP.state.midis.length === 15, "import rebuilt key tables");
	}
	// corruption detection: flip one payload char
	const pos = 8 + Math.floor(rng() * (code.length - 9));
	const flipped = code.slice(0, pos) + (code[pos] === "A" ? "B" : "A") + code.slice(pos + 1);
	const bad = w.SPPMINT.decodeTune(flipped);
	assert(!bad.ok, "corrupted code rejected");

	// MIDI: valid SMF, deterministic
	const midi1 = w.SPPMINT.buildMidiBytes(tune, w.SPP.state.midis, w.STAMPS, w.SPP.consts.SWING_AMTS);
	const midi2 = w.SPPMINT.buildMidiBytes(tune, w.SPP.state.midis, w.STAMPS, w.SPP.consts.SWING_AMTS);
	assert(String.fromCharCode(midi1[0], midi1[1], midi1[2], midi1[3]) === "MThd", "midi header");
	const distinct = new Set(tune.notes.map((note) => note.i)).size;
	const ntrks = (midi1[10] << 8) | midi1[11];
	assert(ntrks === distinct + 1, "midi track count " + ntrks + " vs stamps " + distinct);
	assert(midi1.length > 100, "midi non-trivial");
	assert(midi1.length === midi2.length && midi1.every((b, i2) => b === midi2[i2]), "midi deterministic");
}

// garbage inputs never throw
{
	const w = bootWorld(randHex(rng));
	["", "hello", "SPP1.", "SPP1.!!!!", "SPP2.AAAA", "SPP1." + "A".repeat(400)].forEach((junk) => {
		const r = w.SPPMINT.decodeTune(junk);
		assert(r && r.ok === false, "junk rejected: " + JSON.stringify(junk.slice(0, 12)));
	});
}

console.log("");
console.log("seeds tested:  " + N_SEEDS);
console.log("codec seeds:   " + CODEC_SEEDS);
console.log("checks run:    " + checks);
console.log("distinct tunes: " + seen_tunes.size + "  titles: " + seen_titles.size);
console.log("avg notes/tune: " + (total_notes / N_SEEDS).toFixed(1));
console.log(failures === 0 ? "ALL TESTS PASSED" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
