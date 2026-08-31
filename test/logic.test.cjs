/* SUPERPEPEPAINT logic tests
   Runs the REAL shipped bootloader.js + stamps.js + main.js inside a stub DOM,
   then checks determinism and composer invariants across many seeds.
   Also boots the fx(hash) edition (real fxhash.min.js snippet + adapter) and
   proves the participatory-mint param flow: pin on boot, envelope round
   trips, junk fallback, provenance flags and capture ordering.
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

// ---- fx(hash) edition: snippet + adapter + participatory mint -------------

const FXSRC = ["fxhash.min.js", "fxhash-adapter.js", "stamps.js", "main.js", "mint.js"].map((f) =>
	fs.readFileSync(path.join(ROOT, f), "utf8")
);

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function randFxHash(rng2) {
	let s = "oo";
	for (let i = 0; i < 49; i++) s += B58[Math.floor(rng2() * B58.length)];
	return s;
}

function hexs(u8) {
	let s = "";
	for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
	return s;
}

function bootWorldFX(opts) {
	const o = opts || {};
	const elements = {};
	const dom_listeners = {};
	const parent_msgs = [];
	const win_events = [];
	const documentStub = {
		referrer: "",
		fonts: { ready: Promise.resolve() },
		head: makeElementStub(),
		body: makeElementStub(),
		getElementById(id) {
			if (!elements[id]) elements[id] = makeElementStub();
			return elements[id];
		},
		createElement() { return makeElementStub(); },
		querySelectorAll() { return []; },
		addEventListener(name, fn) {
			(dom_listeners[name] = dom_listeners[name] || []).push(fn);
		},
	};
	function ImageStub() {
		const self = this;
		let src = "";
		Object.defineProperty(this, "src", {
			get() { return src; },
			set(v) {
				src = v;
				if (o.async_images) queueMicrotask(() => { if (self.onload) self.onload(); });
			},
		});
	}
	const sandbox = {
		console,
		document: documentStub,
		location: {
			search:
				"?fxhash=" + o.hash +
				"&fxcontext=" + (o.context || "standalone") +
				"&fxiteration=" + (o.iteration || 1) +
				(o.preview ? "&preview=1" : ""),
			hash: o.paramsHex ? "#0x" + o.paramsHex : "",
		},
		URLSearchParams,
		performance: { now: () => 0 },
		requestAnimationFrame: o.sync_raf ? (fn) => fn() : () => {},
		setInterval() { return 0; },
		clearInterval() {},
		setTimeout() { return 0; },
		clearTimeout() {},
		queueMicrotask,
		localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
		Image: ImageStub,
		Promise,
		JSON,
		Math,
		URL: { createObjectURL() { return ""; }, revokeObjectURL() {} },
		Blob: function () {},
		Event: function (type) { this.type = type; },
		SPPAudio: {
			ctx() { return { currentTime: 0, state: "running", resume() {} }; },
			bus() { return {}; },
			playNote() {},
			panFor() { return 0; },
			renderWav() { return Promise.resolve(null); },
		},
		parent: { postMessage(m) { parent_msgs.push(m); } },
		crypto: { getRandomValues(a) { return a; } },
	};
	sandbox.addEventListener = function () {};
	sandbox.removeEventListener = function () {};
	sandbox.dispatchEvent = function (e) { win_events.push(e && e.type); };
	sandbox.innerWidth = 800;
	sandbox.innerHeight = 800;
	sandbox.btoa = btoa;
	sandbox.atob = atob;
	sandbox.Uint8Array = Uint8Array;
	sandbox.navigator = {};
	sandbox.window = sandbox;
	sandbox.self = sandbox;
	vm.createContext(sandbox);
	for (const src of FXSRC) vm.runInContext(src, sandbox);
	return {
		w: sandbox,
		msgs: parent_msgs,
		events: win_events,
		fireDom() { (dom_listeners["DOMContentLoaded"] || []).forEach((fn) => fn()); },
	};
}

const tick = () => new Promise((r) => setImmediate(r));
const UNIFORM_KEYS = ["Tempo (BPM)", "Key", "Mood", "Swing", "Stamps (num)", "Croakage (%)", "Top Stamp", "Pages", "Motif", "Source"];

(async () => {
	// FX1+FX2+FX3: param registration, standalone determinism, zero-param fallback
	const hashA = randFxHash(rng);
	const a1 = bootWorldFX({ hash: hashA });
	a1.fireDom();
	const a2 = bootWorldFX({ hash: hashA });
	a2.fireDom();

	const defs = a1.w.$fx.getDefinitions();
	assert(defs.length === 1 && defs[0].id === "tune", "fx: exactly one param, id tune");
	assert(defs[0].type === "bytes" && defs[0].update === "code-driven", "fx: tune param is code-driven bytes");
	assert(defs[0].options.length === 352, "fx: tune param frozen at 352 bytes");
	assert(a1.w.$fx.inputBytes === "0".repeat(704), "fx: zero default serializes to 704 zero hex chars");
	assert(a1.w.SPP.state.notes.length >= 10, "fx: zero-param boot generates a tune from the hash");
	assert(JSON.stringify(a1.w.SPP.getTuneData()) === JSON.stringify(a2.w.SPP.getTuneData()), "fx: same fxhash boots identical tune");
	const feats = a1.w.$fx.getFeatures();
	UNIFORM_KEYS.forEach((k) => assert(feats[k] !== undefined, "fx: uniform feature " + k));
	assert(feats["Source"] === "SEED", "fx: zero-param Source is SEED");
	const hashB = randFxHash(rng);
	const b1 = bootWorldFX({ hash: hashB });
	b1.fireDom();
	assert(JSON.stringify(b1.w.SPP.getTuneData()) !== JSON.stringify(a1.w.SPP.getTuneData()), "fx: different fxhash, different tune");

	// FX4: minting boot pins the visible tune into the mint (SEED flag)
	const fx = bootWorldFX({ hash: randFxHash(rng), context: "minting" });
	fx.fireDom();
	await tick(); // snippet's param update pipeline is async
	assert(fx.msgs.length >= 1, "fx: minting boot emits a pin");
	const m0 = fx.msgs[fx.msgs.length - 1];
	assert(m0.id === "fxhash_emit:params:update", "fx: emit uses the official message id");
	const env0 = m0.data.params.tune;
	assert(env0 && env0.length === 352, "fx: emitted envelope is exactly 352 bytes");
	const up0 = fx.w.SPPFX.unpackTune(env0);
	assert(up0 && up0.composed === false, "fx: untouched pin flagged SEED");
	const dec0 = fx.w.SPPMINT.decodeTune(up0.code);
	assert(dec0.ok, "fx: pinned tune decodes through the SPP1 codec");
	assert(JSON.stringify(dec0.data.notes) === JSON.stringify(fx.w.SPP.getTuneData().notes), "fx: pinned tune equals the tune on screen");
	assert(hexs(fx.w.$fx.getParam("tune")) === hexs(env0), "fx: local param state updated by the emit");
	assert(fx.w.$fx.inputBytes.length === 704, "fx: inputBytes carries the full envelope");
	assert(fx.w.$fx.getFeatures()["Source"] === "SEED", "fx: minting Source starts as SEED");

	// FX5: an edit resyncs with the COMPOSED flag
	const t5 = fx.w.SPP.getTuneData();
	t5.bpm = t5.bpm <= 218 ? t5.bpm + 2 : t5.bpm - 2;
	assert(fx.w.SPP.applyImportedTune(t5) === true, "fx: edit applies");
	fx.w.SPPFX.syncNow();
	await tick();
	const m1 = fx.msgs[fx.msgs.length - 1];
	const up1 = fx.w.SPPFX.unpackTune(m1.data.params.tune);
	assert(up1 && up1.composed === true, "fx: edited pin flagged COMPOSED");
	const dec1 = fx.w.SPPMINT.decodeTune(up1.code);
	assert(dec1.ok && dec1.data.bpm === t5.bpm, "fx: edited bpm lands in the mint payload");
	assert(fx.w.$fx.getFeatures()["Source"] === "COMPOSED", "fx: Source trait flips to COMPOSED");
	const msgs_before = fx.msgs.length;
	fx.w.SPPFX.syncNow();
	await tick();
	assert(fx.msgs.length === msgs_before, "fx: unchanged tune does not re-emit");

	// FX6: the emitted param bytes boot the identical tune under a different hash
	const fx6 = bootWorldFX({ hash: randFxHash(rng), paramsHex: fx.w.$fx.inputBytes });
	fx6.fireDom();
	assert(
		JSON.stringify(fx6.w.SPP.getTuneData()) === JSON.stringify(fx.w.SPP.getTuneData()),
		"fx: param round trip - minted bytes reproduce the exact tune under a different hash"
	);
	assert(fx6.w.$fx.getFeatures()["Source"] === "COMPOSED", "fx: provenance survives the round trip");

	// FX7: junk params never brick the piece - they fall back to the generated tune
	let junk = "";
	for (let i = 0; i < 352; i++) junk += (i === 0 ? 17 : Math.floor(rng() * 256)).toString(16).padStart(2, "0");
	const a3 = bootWorldFX({ hash: hashA, paramsHex: junk });
	a3.fireDom();
	assert(JSON.stringify(a3.w.SPP.getTuneData()) === JSON.stringify(a1.w.SPP.getTuneData()), "fx: junk param falls back to the generated tune");
	let junk2 = "53505031" + "01" + "00" + "0140";
	while (junk2.length < 704) junk2 += Math.floor(rng() * 256).toString(16).padStart(2, "0");
	const a4 = bootWorldFX({ hash: hashA, paramsHex: junk2.slice(0, 704) });
	a4.fireDom();
	assert(JSON.stringify(a4.w.SPP.getTuneData()) === JSON.stringify(a1.w.SPP.getTuneData()), "fx: magic-but-corrupt payload rejected by checksum, falls back");

	// FX8: capture waits for the param tune in BOTH load orderings
	const cap_tune = fx.w.SPP.getTuneData();
	const cap_env_hex = fx.w.$fx.inputBytes;
	const cap_opts = { hash: randFxHash(rng), context: "capture", preview: true, paramsHex: cap_env_hex, sync_raf: true, async_images: true };

	const c1 = bootWorldFX(cap_opts); // ordering A: glue first, images later
	c1.fireDom();
	await tick();
	await tick();
	assert(c1.events.indexOf("fxhash-preview") !== -1, "fx: capture fires (dom-first ordering)");
	assert(JSON.stringify(c1.w.SPP.getTuneData()) === JSON.stringify(cap_tune), "fx: dom-first capture shows the minted tune");

	const c2 = bootWorldFX(cap_opts); // ordering B: images resolve before the glue
	await tick();
	await tick();
	assert(c2.events.indexOf("fxhash-preview") === -1, "fx: capture deferred until the param tune is applied");
	c2.fireDom();
	assert(c2.events.indexOf("fxhash-preview") !== -1, "fx: deferred capture fires after glue");
	assert(JSON.stringify(c2.w.SPP.getTuneData()) === JSON.stringify(cap_tune), "fx: image-first capture still shows the minted tune");

	// FX9: envelope codec round trips across many generated tunes
	for (let n = 0; n < 40; n++) {
		const w = bootWorldFX({ hash: randFxHash(rng) });
		w.fireDom();
		const tune = w.w.SPP.getTuneData();
		const code = w.w.SPPMINT.encodeTune(tune);
		const env = w.w.SPPFX.packTune(code, n % 2 === 1);
		assert(env && env.length === 352, "fx: envelope fixed size " + n);
		const back = w.w.SPPFX.unpackTune(env);
		assert(back && back.code === code && back.composed === (n % 2 === 1), "fx: envelope round trip " + n);
		const dec = w.w.SPPMINT.decodeTune(back.code);
		assert(dec.ok && JSON.stringify(dec.data.notes) === JSON.stringify(tune.notes), "fx: envelope preserves notes " + n);
	}

	// FX10: eth-style 64-hex hashes also boot (fxhash multichain)
	{
		let hx = "0x";
		for (let i = 0; i < 64; i++) hx += Math.floor(rng() * 16).toString(16);
		const wE = bootWorldFX({ hash: hx });
		wE.fireDom();
		assert(wE.w.SPP.state.notes.length >= 10, "fx: hex hash boots a tune");
	}

	// ---- Tezos sovereign-mint edition: viewer, provenance, micheline -------

	const TZ_STAGE = path.join(ROOT, "dist", "tezos-stage", "tezos-mint.js");
	const TZSRC = ["bootloader.js", "stamps.js", "main.js", "mint.js"]
		.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8"))
		.concat([fs.readFileSync(TZ_STAGE, "utf8")]);

	function bootWorldTZ(search, opts) {
		opts = opts || {};
		const elements = {};
		const documentStub = {
			referrer: "",
			fonts: { ready: Promise.resolve() },
			head: makeElementStub(),
			body: makeElementStub(),
			title: "",
			getElementById(id) {
				if (!elements[id]) elements[id] = makeElementStub();
				return elements[id];
			},
			createElement() { return makeElementStub(); },
			querySelectorAll() { return []; },
			addEventListener() {},
		};
		const sandbox = {
			console,
			document: documentStub,
			location: { search: search, hash: "" },
			URLSearchParams,
			TextEncoder,
			performance: { now: () => 0 },
			requestAnimationFrame() {},
			setInterval() { return 0; },
			clearInterval() {},
			setTimeout() { return 0; },
			clearTimeout() {},
			localStorage: opts.storageThrows
				? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } }
				: { getItem() { return null; }, setItem() {}, removeItem() {} },
			Image: function () { this.src = ""; },
			Promise, JSON, Math, Date,
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
		sandbox.dispatchEvent = function () {};
		sandbox.innerWidth = 800;
		sandbox.innerHeight = 800;
		sandbox.btoa = btoa;
		sandbox.atob = atob;
		sandbox.Uint8Array = Uint8Array;
		sandbox.navigator = {};
		sandbox.window = sandbox;
		sandbox.self = sandbox;
		sandbox.parent = sandbox;
		sandbox.top = opts.framed ? { __not_self: true } : sandbox;
		sandbox.location.origin = "https://test.local";
		sandbox.location.pathname = "/";
		vm.createContext(sandbox);
		for (const src of TZSRC) vm.runInContext(src, sandbox);
		return sandbox;
	}

	const TZ_SEED = randHex(rng);
	const CODE_FXPARITY = "SPP1.AVABAAAIRlhQQVJJVFkFAHBfAjFVA_RVBhBfB488Ug";

	// TZ1: viewer mode applies the tune param over the generated tune
	{
		const w = bootWorldTZ("?s=" + TZ_SEED + "&tune=" + CODE_FXPARITY);
		assert(w.SPPTEZ.viewerApplied === true, "tz: viewer applied the tune param");
		assert(w.SPP.state.title === "FXPARITY" && w.SPP.state.bpm === 140, "tz: viewer state is the minted tune");
		assert(w.SPP.state.notes.length === 5, "tz: viewer note count");
		assert(w.SPPTEZ.configured === true, "tz: build is bound to a KT1");
	}

	// TZ2: junk tune param falls back to the seed-generated tune
	{
		const plain = bootWorldTZ("?s=" + TZ_SEED);
		const junk = bootWorldTZ("?s=" + TZ_SEED + "&tune=SPP1.zzzz!!notatune");
		assert(junk.SPPTEZ.viewerApplied === false, "tz: junk tune param not applied");
		assert(
			JSON.stringify(junk.SPP.getTuneData()) === JSON.stringify(plain.SPP.getTuneData()),
			"tz: junk param falls back to the generated tune"
		);
		// TZ3: SEED/COMPOSED provenance baseline = the pure seed tune
		assert(plain.SPPTEZ.baseCode() === plain.SPPMINT.encodeTune(plain.SPP.getTuneData()), "tz: base code equals the boot tune (SEED baseline)");
	}

	// TZ4: micheline builder matches taquito's own encoding (live golden)
	{
		const golden_path = path.join(ROOT, "contract", "build", "golden_mint_micheline.json");
		assert(fs.existsSync(golden_path), "tz: golden micheline exists (from live e2e)");
		const golden = JSON.parse(fs.readFileSync(golden_path, "utf8"));
		const w = bootWorldTZ("?s=" + TZ_SEED);
		const built = w.SPPTEZ.buildMintParams(
			golden.inputs.code,
			golden.inputs.name,
			golden.inputs.attributes,
			golden.inputs.description
		);
		assert(golden.entrypoint === "mint", "tz: golden entrypoint");
		assert(JSON.stringify(built) === JSON.stringify(golden.value), "tz: buildMintParams IDENTICAL to taquito encoding");
	}

	// TZ5: attributes + description builders
	{
		const w = bootWorldTZ("?s=" + TZ_SEED + "&tune=" + CODE_FXPARITY);
		const attrs = JSON.parse(w.SPPTEZ.tuneAttributesJson("COMPOSED"));
		const names = attrs.map((a) => a.name);
		["Tempo (BPM)", "Key", "Mood", "Swing", "Stamps (num)", "Croakage (%)", "Top Stamp", "Pages", "Source"].forEach((k) =>
			assert(names.indexOf(k) !== -1, "tz: attribute " + k)
		);
		assert(attrs.every((a) => typeof a.value === "string"), "tz: attribute values are strings");
		const desc = w.SPPTEZ.tuneDescription(CODE_FXPARITY);
		assert(desc.indexOf(CODE_FXPARITY) !== -1 && desc.indexOf("FXPARITY") !== -1, "tz: description carries title + tune code");
		assert(new TextEncoder().encode(desc).length <= 1600, "tz: description under the contract bound");
	}

	// TZ6: determinism - same seed boots the same tune in the tezos build
	{
		const a = bootWorldTZ("?s=" + TZ_SEED);
		const b = bootWorldTZ("?s=" + TZ_SEED);
		assert(JSON.stringify(a.SPP.getTuneData()) === JSON.stringify(b.SPP.getTuneData()), "tz: seed determinism intact with glue loaded");
	}

	// TZ7: restricted wallet environments (objkt preview iframe, storage-blocked
	// webviews) are detected and the mint escape hatch carries the exact tune
	{
		const plain = bootWorldTZ("?s=" + TZ_SEED);
		assert(plain.SPPTEZ.walletEnvBlocked() === null, "tz: top-level page with storage is not blocked");

		const framed = bootWorldTZ("?s=" + TZ_SEED, { framed: true });
		assert(framed.SPPTEZ.walletEnvBlocked() === null, "tz: frame with WORKING storage is not blocked (beacon works there)");

		const noStore = bootWorldTZ("?s=" + TZ_SEED, { storageThrows: true });
		assert(noStore.SPPTEZ.walletEnvBlocked() === "RESTRICTED BROWSER STORAGE", "tz: storage-throwing webview detected as RESTRICTED BROWSER STORAGE");

		const both = bootWorldTZ("?s=" + TZ_SEED, { framed: true, storageThrows: true });
		assert(both.SPPTEZ.walletEnvBlocked() === "SANDBOXED PREVIEW", "tz: sandboxed iframe (framed + blocked storage) detected as SANDBOXED PREVIEW");

		const withTune = bootWorldTZ("?s=" + TZ_SEED + "&tune=" + CODE_FXPARITY, { framed: true });
		const url = withTune.SPPTEZ.mintLinkOutUrl();
		const expected_code = withTune.SPPMINT.encodeTune(withTune.SPP.getTuneData());
		assert(url.indexOf("?tune=" + expected_code) !== -1, "tz: link-out URL carries the current tune code");
		assert(expected_code === CODE_FXPARITY, "tz: link-out code round-trips the viewer tune exactly");
		const stampedPage = withTune.SPPTEZ.config.page;
		assert(stampedPage.indexOf("__SPP_") === 0 ? url.indexOf("https://test.local/") === 0 : url.indexOf(stampedPage) === 0, "tz: link-out URL uses stamped page (or location fallback when unstamped)");
	}

	console.log("");
	console.log("seeds tested:  " + N_SEEDS);
	console.log("codec seeds:   " + CODEC_SEEDS);
	console.log("checks run:    " + checks);
	console.log("distinct tunes: " + seen_tunes.size + "  titles: " + seen_titles.size);
	console.log("avg notes/tune: " + (total_notes / N_SEEDS).toFixed(1));
	console.log(failures === 0 ? "ALL TESTS PASSED" : failures + " FAILURES");
	process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
	console.error("FX SUITE CRASH:", err);
	process.exit(1);
});
