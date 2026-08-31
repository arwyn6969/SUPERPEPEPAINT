/* Emits the Cloudflare Worker source that serves the Tezos edition
   (dist/tezos-stage) with the CORS headers objkt.com requires.

   CRITICAL: objkt's frontend fetch()es https artifact URLs cross-origin
   from https://objkt.com before embedding them. Without
   Access-Control-Allow-Origin the browser blocks the fetch and the token
   pane shows "unable to load asset". This script bakes CORS into every
   response, including OPTIONS preflight.

   Usage:
     node tools/build-tezos.cjs          # stage the app bound to your KT1
     node tools/deploy-worker.cjs        # writes dist/worker.js
   Then upload dist/worker.js as a Cloudflare Worker (dashboard paste, or
   PUT /accounts/{id}/workers/scripts/{name} with the file as the script
   body-part) and enable its workers.dev route. */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STAGE = path.join(ROOT, "dist", "tezos-stage");
const OUT = path.join(ROOT, "dist", "worker.js");

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	"": "text/plain; charset=utf-8",
};

const files = {};
for (const f of fs.readdirSync(STAGE)) {
	const ext = path.extname(f);
	files["/" + f] = { ct: TYPES[ext] || TYPES[""], body: fs.readFileSync(path.join(STAGE, f), "utf8") };
}

const worker = `
const FILES = ${JSON.stringify(files)};
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-max-age": "86400"
};
addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method === "OPTIONS") {
    event.respondWith(new Response(null, { status: 204, headers: CORS }));
    return;
  }
  const url = new URL(req.url);
  let p = url.pathname;
  if (p === "/" || p === "") p = "/index.html";
  if (p === "/walletbeacon.min.js") {
    // same-origin Beacon SDK: proxied + edge-cached from the pinned CDN build,
    // so mobile webviews that block third-party scripts still get the wallet SDK
    event.respondWith(
      fetch("https://cdn.jsdelivr.net/npm/@airgap/beacon-sdk@4.8.1/dist/walletbeacon.min.js", {
        cf: { cacheEverything: true, cacheTtl: 604800 }
      }).then((r) => {
        if (!r.ok) return new Response("sdk upstream error", { status: 502, headers: CORS });
        return new Response(r.body, { headers: Object.assign({ "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=604800" }, CORS) });
      }).catch(() => new Response("sdk fetch failed", { status: 502, headers: CORS }))
    );
    return;
  }
  const f = FILES[p];
  if (!f) {
    event.respondWith(new Response("not found", { status: 404, headers: CORS }));
    return;
  }
  const headers = Object.assign({ "content-type": f.ct, "cache-control": "public, max-age=300", "x-superpepepaint": "the-composer-is-the-mint" }, CORS);
  event.respondWith(new Response(f.body, { headers }));
});
`;

fs.writeFileSync(OUT, worker);
console.log("worker source:", OUT, "(" + (fs.statSync(OUT).size / 1024).toFixed(1) + " KB,", Object.keys(files).length, "files embedded, CORS enabled)");
