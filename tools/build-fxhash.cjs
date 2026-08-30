/* Builds dist/superpepepaint-fxhash.zip - the fx(hash) edition.
   Same app, but booted by the official fxhash snippet + adapter instead of
   bootloader.js. index.html is transformed at build time, never forked, so
   the two editions cannot drift. Usage: node tools/build-fxhash.cjs */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STAGE = path.join(ROOT, "dist", "fxhash-stage");
const OUT = path.join(ROOT, "dist", "superpepepaint-fxhash.zip");

const SHARED = [
	"fxhash.min.js",
	"fxhash-adapter.js",
	"styles.css",
	"stamps.js",
	"audio.js",
	"main.js",
	"mint.js",
	"LICENSE",
];

const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const needle = '<script src="./bootloader.js"></script>';
if (src.indexOf(needle) === -1) {
	throw new Error("index.html: bootloader script tag not found - build aborted");
}
const out = src.replace(
	needle,
	'<script src="./fxhash.min.js"></script>\n\t\t<script src="./fxhash-adapter.js"></script>'
);
if (out.indexOf("bootloader.js") !== -1) {
	throw new Error("index.html transform left a bootloader.js reference - build aborted");
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
fs.writeFileSync(path.join(STAGE, "index.html"), out);
for (const f of SHARED) fs.copyFileSync(path.join(ROOT, f), path.join(STAGE, f));

fs.rmSync(OUT, { force: true });
const files = ["index.html"].concat(SHARED).map((f) => JSON.stringify(path.join(STAGE, f))).join(" ");
execSync("zip -j " + JSON.stringify(OUT) + " " + files, { stdio: "inherit" });

const size = fs.statSync(OUT).size;
console.log("built " + OUT + " (" + (size / 1024).toFixed(1) + " KB, " + (SHARED.length + 1) + " files)");
