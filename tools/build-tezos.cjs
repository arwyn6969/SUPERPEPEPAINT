/* Builds dist/superpepepaint-tezos.zip - the sovereign-mint Tezos edition.
   bootloader.js stays the boot target (it self-seeds without ?s=), and
   tezos-mint.js is appended as the last script: viewer mode for minted
   tokens (?tune=...), Beacon mint flow for composers.

   Deploy config is stamped from contract/deploy.json into the CONFIG
   placeholders in tezos-mint.js. An empty contract field builds an
   unbound app (mint button hidden) - fine for pinning BEFORE origination.

   Usage: node tools/build-tezos.cjs */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STAGE = path.join(ROOT, "dist", "tezos-stage");
const OUT = path.join(ROOT, "dist", "superpepepaint-tezos.zip");
const DEPLOY = path.join(ROOT, "contract", "deploy.json");

const SHARED = ["bootloader.js", "styles.css", "stamps.js", "audio.js", "main.js", "mint.js", "LICENSE"];

const cfg = JSON.parse(fs.readFileSync(DEPLOY, "utf8"));
for (const k of ["contract", "network", "rpc", "price_mutez", "explorer"]) {
	if (typeof cfg[k] !== "string") throw new Error("deploy.json missing string field: " + k);
}

let glue = fs.readFileSync(path.join(ROOT, "tezos-mint.js"), "utf8");
const stamps = {
	__SPP_KT1__: cfg.contract,
	__SPP_NETWORK__: cfg.network,
	__SPP_RPC__: cfg.rpc,
	__SPP_PRICE__: cfg.price_mutez,
	__SPP_EXPLORER__: cfg.explorer,
	__SPP_PAGE__: cfg.page || "",
};
for (const [ph, val] of Object.entries(stamps)) {
	if (glue.indexOf(ph) === -1) throw new Error("tezos-mint.js missing placeholder " + ph);
	glue = glue.split(ph).join(val);
}

const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const needle = '<script src="mint.js"></script>';
if (src.indexOf(needle) === -1) throw new Error("index.html: mint.js script tag not found");
const out = src.replace(needle, needle + '\n\t<script src="tezos-mint.js"></script>');

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
fs.writeFileSync(path.join(STAGE, "index.html"), out);
fs.writeFileSync(path.join(STAGE, "tezos-mint.js"), glue);
for (const f of SHARED) fs.copyFileSync(path.join(ROOT, f), path.join(STAGE, f));

fs.rmSync(OUT, { force: true });
const files = ["index.html", "tezos-mint.js"].concat(SHARED).map((f) => JSON.stringify(path.join(STAGE, f))).join(" ");
execSync("zip -j " + JSON.stringify(OUT) + " " + files, { stdio: "inherit" });

const size = fs.statSync(OUT).size;
console.log("built " + OUT + " (" + (size / 1024).toFixed(1) + " KB, " + (SHARED.length + 2) + " files)");
console.log("bound to: " + (cfg.contract || "(no contract - mint button hidden)") + " on " + cfg.network);
