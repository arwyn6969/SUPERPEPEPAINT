/* SUPERPEPEPAINT × fx(hash) adapter
   The participatory mint: on fx(hash), the composer IS the minting interface.

   What this file does (the rest of the app never needs to know):
   - maps the $bootloader surface onto the official fxhash snippet ($fx),
     so bootloader.js and fxhash.min.js are interchangeable boot targets
   - registers ONE fx(params) definition: "tune", a fixed 352-byte
     code-driven bytes param that carries the collector's composition
   - in the minting context, watches the composer and syncs every edit
     into the param via $fx.emit("params:update"), so the tune the
     collector hears is EXACTLY the tune written into their token
   - in standalone/capture contexts, loads the minted tune back through
     the same SPP1 codec + junk rejection the objkt kit uses

   Envelope layout (fixed TUNE_LEN bytes, zero padded):
     [0..3] "SPP1" magic   [4] envelope ver (1)   [5] flags (bit0 = composed)
     [6..7] payload length u16be   [8..] SPP1 codec bytes (max 320)

   Determinism contract (same spirit as the bootloader edition):
   - iteration output is a pure function of (hash, params)
   - the hash-generated tune boots first, consuming $fx.rand exactly like
     the bootloader edition consumes $bootloader.rnd; a valid tune param
     then overrides it without touching the rng
   - an all-zero or garbage param falls back to the generated tune */

(() => {
	"use strict";

	if (!window.$fx) {
		console.error("SUPERPEPEPAINT: fxhash.min.js must load before fxhash-adapter.js");
		return;
	}

	const TUNE_LEN = 352; // frozen forever: fx(params) bytes params are fixed length
	const MAGIC = [0x53, 0x50, 0x50, 0x31]; // "SPP1"
	const ENV_VER = 1;
	const HEAD = 8;
	const CODE_PREFIX = "SPP1."; // must match mint.js

	// one param to rule them all: the whole composition, on chain
	$fx.params([
		{
			id: "tune",
			name: "Tune",
			type: "bytes",
			update: "code-driven",
			default: new Uint8Array(TUNE_LEN), // all zeros = "no tune yet" (deterministic)
			options: { length: TUNE_LEN },
		},
	]);

	const IS_CAPTURE = $fx.isPreview === true || $fx.context === "capture" || $fx.context === "fast-capture";
	const IS_MINTING = $fx.context === "minting";

	////////////////////
	//  $bootloader   //
	////////////////////

	// main.js/mint.js speak $bootloader. capture is deferred until the tune
	// param has been applied, so previews always show the minted composition.
	let glue_done = false;
	let capture_pending = false;

	function fireCapture() {
		try {
			if (window.SPP) window.SPP.draw();
		} catch (err) { /* draw not ready - snapshot whatever is there */ }
		$fx.preview();
	}

	const rnd = () => $fx.rand();
	rnd.reset = () => $fx.rand.reset();

	window.$bootloader = {
		get hash() { return $fx.hash; },
		get iteration() { return $fx.iteration; },
		get isCapture() { return IS_CAPTURE; },
		rnd: rnd,
		setFeatures: (f) => $fx.features(f),
		capture: () => {
			if (glue_done) fireCapture();
			else capture_pending = true;
		},
	};

	////////////////////
	//    ENVELOPE    //
	////////////////////

	function b64urlToBytes(s) {
		let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
		while (b64.length % 4) b64 += "=";
		const bin = atob(b64);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}

	function bytesToB64url(u8) {
		let bin = "";
		for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
		return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}

	// "SPP1.xxxx" tune code -> fixed-size param envelope
	function packTune(code, composed) {
		if (typeof code !== "string" || code.indexOf(CODE_PREFIX) !== 0) return null;
		let payload;
		try {
			payload = b64urlToBytes(code.slice(CODE_PREFIX.length));
		} catch (err) {
			return null;
		}
		if (payload.length < 2 || payload.length > TUNE_LEN - HEAD) return null;
		const out = new Uint8Array(TUNE_LEN);
		out[0] = MAGIC[0]; out[1] = MAGIC[1]; out[2] = MAGIC[2]; out[3] = MAGIC[3];
		out[4] = ENV_VER;
		out[5] = composed ? 1 : 0;
		out[6] = (payload.length >> 8) & 255;
		out[7] = payload.length & 255;
		out.set(payload, HEAD);
		return out;
	}

	// param envelope -> { code, composed } or null (empty / junk / wrong magic)
	function unpackTune(u8) {
		if (!u8 || u8.length < HEAD + 2) return null;
		for (let i = 0; i < 4; i++) if (u8[i] !== MAGIC[i]) return null;
		if (u8[4] !== ENV_VER) return null;
		const len = (u8[6] << 8) | u8[7];
		if (len < 2 || HEAD + len > u8.length) return null;
		return {
			code: CODE_PREFIX + bytesToB64url(u8.subarray(HEAD, HEAD + len)),
			composed: (u8[5] & 1) === 1,
		};
	}

	function hexOf(u8) {
		let s = "";
		for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
		return s;
	}

	////////////////////
	//      GLUE      //
	////////////////////

	// runs after main.js + mint.js have booted (all scripts are synchronous,
	// so DOMContentLoaded is guaranteed to fire after the composer exists)

	let sync_now = () => {};
	let chip = null;
	let chip_timer = 0;

	function setChip(text, flash) {
		if (!chip) return;
		chip.textContent = text;
		if (flash) {
			chip.classList.add("fx_hot");
			clearTimeout(chip_timer);
			chip_timer = setTimeout(() => chip.classList.remove("fx_hot"), 700);
		}
	}

	function installMintChip() {
		try {
			if (!document.body || !document.head) return;
			const style = document.createElement("style");
			style.textContent =
				"#fx_mint_chip{position:fixed;right:10px;bottom:44px;z-index:9999998;" +
				"background:#0b7a0b;color:#ffffff;border:4px ridge #8fd48f;padding:5px 10px;" +
				'font-family:"unscii8",monospace;font-size:13px;letter-spacing:1px;' +
				"text-shadow:1px 1px 0 #063f06;pointer-events:none;user-select:none;max-width:60vw;}" +
				"#fx_mint_chip.fx_hot{background:#0b7a0b;border-style:inset;}";
			document.head.appendChild(style);
			chip = document.createElement("div");
			chip.id = "fx_mint_chip";
			document.body.appendChild(chip);
			setChip("COMPOSE - EVERY EDIT SYNCS TO YOUR MINT", false);
		} catch (err) { /* stub DOMs without a body are fine */ }
	}

	// swap the objkt walkthrough for fx(hash) wording in the mint dialog
	function retitleMintDialog() {
		try {
			const steps = document.querySelectorAll(".mint_step");
			for (let i = 0; i < steps.length; i++) {
				if (steps[i].textContent.indexOf("OBJKT") === -1) continue;
				steps[i].textContent = "3. FX(HASH) EDITION";
				const body = steps[i].nextElementSibling;
				if (body && body.classList && !body.classList.contains("mint_row")) {
					body.textContent =
						"THIS BUILD MINTS ON FX(HASH): WHILE MINTING, YOUR TUNE IS WRITTEN INTO THE TOKEN " +
						"AUTOMATICALLY - JUST HIT MINT IN THE FX(HASH) PANEL WHEN YOU ARE HAPPY. " +
						"THE EXPORTS ABOVE ARE OPTIONAL KEEPSAKES; THE TOKEN ITSELF PLAYS LIVE.";
				}
			}
			const objkt = document.getElementById("objkt_link");
			if (objkt && objkt.parentElement && objkt.parentElement.style) {
				objkt.parentElement.style.display = "none";
			}
		} catch (err) { /* stub DOMs without querySelectorAll are fine */ }
	}

	// one trait schema for the whole fx(hash) collection, seeded or composed
	function uniformFeatures(SPP, SM, source) {
		const t = SPP.getTuneData();
		const f = {};
		const attrs = SM.computeAttributes(t);
		for (let i = 0; i < attrs.length; i++) f[attrs[i].name] = attrs[i].value;
		f["Motif"] = t.title;
		f["Source"] = source;
		return f;
	}

	let glue_ran = false;
	function glue() {
		if (glue_ran) return;
		glue_ran = true;
		try {
			const SPP = window.SPP;
			const SM = window.SPPMINT;
			if (!SPP || !SM) return;

			// 1. a minted/param tune overrides the generated one (never touches rng)
			const incoming = unpackTune($fx.getParam("tune"));
			let applied = null;
			if (incoming) {
				const dec = SM.decodeTune(incoming.code);
				if (dec.ok && SPP.applyImportedTune(dec.data)) applied = incoming;
			}

			// 2. uniform trait schema, with on-chain provenance for the Source trait
			const source = applied && applied.composed ? "COMPOSED" : "SEED";
			window.$bootloader.setFeatures(uniformFeatures(SPP, SM, source));

			retitleMintDialog();

			// 3. minting: the composer becomes the minting interface
			if (IS_MINTING) {
				installMintChip();

				let base_code = SM.encodeTune(SPP.getTuneData()); // what an untouched mint sounds like
				let base_composed = applied ? applied.composed : false;
				let last_hex = "";

				sync_now = function () {
					const code = SM.encodeTune(SPP.getTuneData());
					const composed = base_composed || code !== base_code;
					const env = packTune(code, composed);
					if (!env) return;
					const hex = hexOf(env);
					if (hex === last_hex) return;
					last_hex = hex;
					$fx.emit("params:update", { tune: env });
					window.$bootloader.setFeatures(uniformFeatures(SPP, SM, composed ? "COMPOSED" : "SEED"));
					setChip(composed ? "TUNE SYNCED TO MINT (COMPOSED)" : "TUNE SYNCED TO MINT (SEED)", true);
				};

				// pin the tune the collector is looking at, even before any edit:
				// the final token hash differs from this session's, so an unpinned
				// "untouched" mint would re-roll - pinning makes it WYSIWYG
				sync_now();

				// accept restores pushed back by the minting UI
				$fx.on(
					"params:update",
					() => {},
					() => {
						const raw = $fx.getParam("tune");
						if (!raw) return;
						const hex = hexOf(raw);
						if (hex === last_hex) return; // our own echo
						const back = unpackTune(raw);
						if (!back) return;
						const dec = SM.decodeTune(back.code);
						if (dec.ok && SPP.applyImportedTune(dec.data)) {
							last_hex = hex;
							base_code = SM.encodeTune(SPP.getTuneData());
							base_composed = back.composed;
							setChip("TUNE RESTORED FROM MINT", true);
						}
					}
				);

				setInterval(sync_now, 400);
			}
		} catch (err) {
			try { console.error("SUPERPEPEPAINT fx glue error:", err); } catch (e2) { /* silent */ }
		}
		glue_done = true;
		if (capture_pending) {
			capture_pending = false;
			fireCapture();
		}
	}

	if (typeof document.readyState === "string" && document.readyState !== "loading") {
		glue();
	} else {
		document.addEventListener("DOMContentLoaded", glue);
	}

	// small window for the test suite and tinkerers
	window.SPPFX = {
		TUNE_LEN: TUNE_LEN,
		packTune: packTune,
		unpackTune: unpackTune,
		syncNow: () => sync_now(),
		isMinting: IS_MINTING,
		isCapture: IS_CAPTURE,
	};
})();
