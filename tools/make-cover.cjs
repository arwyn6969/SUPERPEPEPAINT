/* Renders the collection cover PNG using the REAL app code (bootloader.js +
   stamps.js + main.js in the vm harness) with a real node-canvas context and
   real stamp sprites - so the cover is pixel-authentic and reproducible.

   Requires: npm i canvas (native), plus unscii TTFs (convert the repo woff2s
   with fonttools: TTFont(src).save(dst) after flavor=None).

   Usage: node tools/make-cover.cjs <seed64hex> <out.png> [ttf8] [ttf8tall] */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createCanvas, registerFont, Image } = require("canvas");

const ROOT = path.join(__dirname, "..");
const seed = process.argv[2] || "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888";
const out = process.argv[3] || "superpepepaint-cover.png";
const ttf8 = process.argv[4] || "/tmp/unscii8.ttf";
const ttf8tall = process.argv[5] || "/tmp/unscii8tall.ttf";

registerFont(ttf8, { family: "unscii8" });
registerFont(ttf8tall, { family: "unscii8tall" });

// ---- boot the real app in a stub DOM (same pattern as test/logic.test.cjs)
const SRC = ["bootloader.js", "stamps.js", "main.js", "mint.js"].map((f) =>
	fs.readFileSync(path.join(ROOT, f), "utf8")
);

function el() {
	return {
		style: {}, children: [], checked: false, open: false, value: "120",
		textContent: "", innerHTML: "",
		show() {}, close() {}, focus() {}, select() {},
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		setAttribute() {}, getAttribute() { return null; },
		addEventListener() {}, removeEventListener() {},
		insertAdjacentHTML() {}, appendChild() {}, remove() {},
		closest() { return null; }, setPointerCapture() {},
		getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; },
		getContext() { return new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 0 }) : () => {}) }); },
		toBlob(cb) { cb(null); },
	};
}

const elements = {};
const sandbox = {
	console,
	document: {
		referrer: "",
		fonts: { ready: Promise.resolve() },
		getElementById(id) { if (!elements[id]) elements[id] = el(); return elements[id]; },
		createElement() { return el(); },
		addEventListener() {},
	},
	location: { search: "?s=" + seed },
	URLSearchParams,
	performance: { now: () => 0 },
	requestAnimationFrame() {}, setInterval() { return 0; }, clearInterval() {},
	setTimeout() { return 0; }, clearTimeout() {},
	localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
	Image, // REAL node-canvas images - stamp sprites decode from data URIs
	Promise, JSON, Math,
	URL: { createObjectURL() { return ""; }, revokeObjectURL() {} },
	Blob: function () {},
	SPPAudio: { ctx() { return { currentTime: 0, state: "running", resume() {} }; }, bus() { return {}; }, playNote() {}, panFor() { return 0; }, renderWav() { return Promise.resolve(null); } },
};
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.innerWidth = 800; sandbox.innerHeight = 800;
sandbox.btoa = (s) => Buffer.from(s, "binary").toString("base64");
sandbox.atob = (s) => Buffer.from(s, "base64").toString("binary");
sandbox.Uint8Array = Uint8Array;
sandbox.navigator = {};
sandbox.window = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
for (const src of SRC) vm.runInContext(src, sandbox);

// stamp sprites decode asynchronously - wait a tick for onload callbacks
setImmediate(() => {
	const S = sandbox.SPP;
	const c = createCanvas(1200, 1200);
	const g = c.getContext("2d");

	// paper + PEPEPAINT double frame
	g.fillStyle = "#ffffff"; g.fillRect(0, 0, 1200, 1200);
	g.fillStyle = "#0b7a0b";
	g.fillRect(0, 0, 1200, 14); g.fillRect(0, 1186, 1200, 14);
	g.fillRect(0, 0, 14, 1200); g.fillRect(1186, 0, 14, 1200);
	g.strokeStyle = "#8fd48f"; g.lineWidth = 4; g.strokeRect(26, 26, 1148, 1148);

	// title (auto-fit to the frame)
	g.fillStyle = "#0b7a0b"; g.textAlign = "center"; g.textBaseline = "top";
	let ts = 96;
	do { g.font = ts + 'px "unscii8tall"'; ts -= 2; } while (g.measureText("SUPERPEPEPAINT").width > 1050 && ts > 20);
	g.shadowColor = "#bfe8bf"; g.shadowOffsetX = 5; g.shadowOffsetY = 5;
	g.fillText("SUPERPEPEPAINT", 600, 84);
	g.shadowColor = "transparent"; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
	g.font = '30px "unscii8tall"'; g.fillStyle = "#2c8a2c";
	g.fillText("THE COMPOSER IS THE MINT", 600, 212);

	// the real staff, page A, crisp
	g.save();
	g.translate(90, 290); g.scale(2.55, 2.55);
	g.imageSmoothingEnabled = false;
	S.drawStaffInto(g, 0, { no_hover: true });
	g.restore();

	// footer
	g.font = '28px "unscii8tall"'; g.fillStyle = "#0b7a0b";
	g.fillText("COMPOSE → SIGN → MINTED · TEZOS", 600, 1082);
	g.font = '20px "unscii8tall"'; g.fillStyle = "#2c8a2c";
	g.fillText("A PEPEPAINT FORK · EVERY TOKEN IS A PLAYABLE TUNE", 600, 1128);

	fs.writeFileSync(out, c.toBuffer("image/png"));
	console.log("cover:", out, fs.statSync(out).size, "bytes | tune:", S.state.title, "|", S.state.notes.length, "notes | seed", seed.slice(0, 12) + "…");
});
