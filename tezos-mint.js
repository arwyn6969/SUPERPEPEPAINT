/* SUPERPEPEPAINT sovereign mint - Tezos edition glue
   Loaded last (after mint.js). Two modes, one file:

   VIEWER  (?tune=SPP1.xxx in the URL): this is what minted tokens point at.
           Applies the tune through the same SPP1 codec + junk rejection the
           objkt kit uses. Fully self-contained - no wallet code, no network.

   COMPOSER (no tune param): bootloader.js self-seeds, the app generates a
           tune, and the MINT dialog gains a MINT ON TEZOS flow: connect a
           Beacon wallet, sign one operation, and the collection contract
           mints your tune as a token - artifactUri is built ON CHAIN as
           base_uri + code, so the token provably points back at this app.

   The wallet SDK is only fetched (from CDN) when the collector actually
   clicks mint, so token rendering never depends on external scripts.

   Build stamps the deploy config into the placeholders below
   (tools/build-tezos.cjs); unstamped builds hide the mint button. */

(() => {
	"use strict";

	// stamped at build time - see tools/build-tezos.cjs and contract/deploy.json
	const CONFIG = {
		contract: "__SPP_KT1__",
		network: "__SPP_NETWORK__", // "mainnet" | "shadownet" | ...
		rpc: "__SPP_RPC__",
		price_mutez: "__SPP_PRICE__",
		explorer: "__SPP_EXPLORER__", // e.g. https://shadownet.tzkt.io
	};
	const CONFIGURED = CONFIG.contract.indexOf("KT1") === 0;
	const BEACON_CDN = "https://cdn.jsdelivr.net/npm/@airgap/beacon-sdk@4/dist/walletbeacon.min.js";

	const SPP = window.SPP;
	const SM = window.SPPMINT;
	const BL = window.$bootloader;
	if (!SPP || !SM || !BL) return;

	const qs = new URLSearchParams(window.location.search);
	const tune_param = qs.get("tune");

	function utf8hex(s) {
		let out = "";
		const bytes = new TextEncoder().encode(s);
		for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
		return out;
	}

	// micheline for mint params, layout ("code", ("name", ("attributes", "description")))
	function buildMintParams(code, name, attributes, description) {
		return {
			prim: "Pair",
			args: [
				{ bytes: utf8hex(code) },
				{
					prim: "Pair",
					args: [
						{ bytes: utf8hex(name) },
						{
							prim: "Pair",
							args: [{ bytes: utf8hex(attributes) }, { bytes: utf8hex(description) }],
						},
					],
				},
			],
		};
	}

	function tuneAttributesJson(source) {
		const t = SPP.getTuneData();
		const attrs = SM.computeAttributes(t).map((a) => ({ name: a.name, value: String(a.value) }));
		attrs.push({ name: "Source", value: source });
		return JSON.stringify(attrs);
	}

	function tuneDescription(code) {
		const t = SPP.getTuneData();
		return (
			t.title +
			" — a SUPERPEPEPAINT composition, minted by its composer.\n\n" +
			"TUNE CODE (paste into SUPERPEPEPAINT to replay and remix):\n" +
			code +
			"\n\nThe composer is the mint: every token in this collection is a tune " +
			"written in the app it points back to.\n" +
			"https://github.com/arwyn6969/SUPERPEPEPAINT"
		);
	}

	////////////////////
	//  VIEWER MODE   //
	////////////////////

	let viewer_applied = false;
	if (tune_param) {
		const dec = SM.decodeTune(tune_param.trim());
		if (dec.ok && SPP.applyImportedTune(dec.data)) {
			viewer_applied = true;
			try {
				document.title = "SUPERPEPEPAINT · " + (dec.data.title || "TUNE");
			} catch (err) { /* stub DOMs are fine */ }
		}
		// junk/corrupt tune params fall back to the seed-generated tune
	}

	////////////////////
	//  MINT DIALOG   //
	////////////////////

	// the pure seed tune, replayed without disturbing app state, so we can
	// tell SEED mints from hand-COMPOSED ones
	let base_code = null;
	try {
		if (BL.rnd && BL.rnd.reset) {
			BL.rnd.reset();
			const gen = SPP.generate(BL.rnd);
			base_code = SM.encodeTune({
				notes: gen.notes,
				bpm: gen.bpm,
				swing: gen.swing,
				root_i: gen.root_i,
				mode_i: gen.mode_i,
				title: gen.title,
			});
		}
	} catch (err) { base_code = null; }

	let status_el = null;
	function setStatus(text) {
		if (status_el) status_el.textContent = text;
	}

	function retitleMintDialog() {
		try {
			const steps = document.querySelectorAll(".mint_step");
			for (let i = 0; i < steps.length; i++) {
				if (steps[i].textContent.indexOf("OBJKT") === -1) continue;
				steps[i].textContent = "3. MINT ON TEZOS · ONE SIGNATURE, NO UPLOADS";
				const body = steps[i].nextElementSibling;
				if (body && body.classList && !body.classList.contains("mint_row")) {
					body.textContent = CONFIGURED
						? "YOUR TUNE MINTS STRAIGHT INTO THE SUPERPEPEPAINT COLLECTION. " +
						  "THE CONTRACT WRITES YOUR TUNE CODE INTO THE TOKEN ON CHAIN - " +
						  "THE EXPORTS ABOVE ARE OPTIONAL KEEPSAKES."
						: "THIS BUILD IS NOT BOUND TO A COLLECTION CONTRACT YET. " +
						  "EXPORTS ABOVE STILL WORK; SEE THE REPO FOR THE DEPLOY WALKTHROUGH.";
				}
				const row = steps[i].nextElementSibling && steps[i].nextElementSibling.nextElementSibling;
				if (row && row.classList && row.classList.contains("mint_row")) {
					// swap the objkt link row for the mint button + status
					row.innerHTML = "";
					if (CONFIGURED && !viewer_applied) {
						const btn = document.createElement("button");
						btn.type = "button";
						btn.className = "header_button";
						btn.id = "tezos_mint_button";
						btn.textContent = "⛏ MINT THIS TUNE";
						btn.addEventListener("click", startMint);
						row.appendChild(btn);
					}
					status_el = document.createElement("span");
					status_el.className = "mint_hint";
					status_el.id = "tezos_mint_status";
					status_el.setAttribute("role", "status");
					status_el.setAttribute("aria-live", "polite");
					row.appendChild(status_el);
					if (viewer_applied) {
						setStatus("THIS IS A MINTED TUNE - REMIX IT AND MINT YOUR OWN FROM THE BARE APP URL");
					} else if (CONFIGURED) {
						setStatus("PRICE: " + (Number(CONFIG.price_mutez) / 1000000) + " TEZ + FEES · " + CONFIG.network.toUpperCase());
					}
				}
			}
		} catch (err) { /* stub DOMs without querySelectorAll are fine */ }
	}
	retitleMintDialog();

	////////////////////
	//   MINT FLOW    //
	////////////////////

	let beacon_client = null;
	let minting = false;

	function loadBeacon() {
		return new Promise((resolve, reject) => {
			if (window.beacon && window.beacon.DAppClient) return resolve(window.beacon);
			const s = document.createElement("script");
			s.src = BEACON_CDN;
			s.onload = () => (window.beacon && window.beacon.DAppClient ? resolve(window.beacon) : reject(new Error("beacon global missing")));
			s.onerror = () => reject(new Error("could not load wallet sdk"));
			document.head.appendChild(s);
		});
	}

	function beaconNetwork() {
		if (CONFIG.network === "mainnet") return { type: "mainnet" };
		return { type: "custom", name: CONFIG.network, rpcUrl: CONFIG.rpc };
	}

	async function startMint() {
		if (minting) return;
		minting = true;
		try {
			const code = SM.encodeTune(SPP.getTuneData());
			const check = SM.decodeTune(code);
			if (!check.ok) throw new Error("tune failed to encode");
			const source = base_code !== null && code === base_code ? "SEED" : "COMPOSED";
			const name = (SPP.state.title || "UNTITLED").slice(0, 60);

			setStatus("LOADING WALLET SDK…");
			const beacon = await loadBeacon();
			if (!beacon_client) {
				// beacon v4: the network is set on the client, not per request
				beacon_client = new beacon.DAppClient({
					name: "SUPERPEPEPAINT",
					network: beaconNetwork(),
				});
			}
			setStatus("CONNECT YOUR WALLET…");
			const active = await beacon_client.getActiveAccount();
			if (!active) {
				await beacon_client.requestPermissions();
			}
			setStatus("CONFIRM THE MINT IN YOUR WALLET…");
			const result = await beacon_client.requestOperation({
				operationDetails: [
					{
						kind: "transaction",
						destination: CONFIG.contract,
						amount: String(CONFIG.price_mutez),
						parameters: {
							entrypoint: "mint",
							value: buildMintParams(code, name, tuneAttributesJson(source), tuneDescription(code)),
						},
					},
				],
			});
			const hash = result && (result.transactionHash || result.operationHash || result.opHash);
			setStatus("MINTED ✓ " + (hash ? String(hash).slice(0, 12) + "… · " + CONFIG.explorer + "/" + hash : "OPERATION SENT"));
			SPP.showFeedback("TUNE MINTED ON TEZOS ✓");
		} catch (err) {
			const msg = err && err.message ? err.message : String(err);
			setStatus("MINT STOPPED: " + msg.slice(0, 120));
		}
		minting = false;
	}

	////////////////////
	//   ADMIN OPS    //
	////////////////////

	// one-button admin signer: open /?setbase=<url-encoded new base uri>
	// (the contract rejects non-admin senders, so this is safe to expose)
	const setbase_param = qs.get("setbase");
	if (setbase_param && CONFIGURED) {
		try {
			const panel = document.createElement("div");
			panel.id = "tezos_admin_panel";
			panel.setAttribute(
				"style",
				"position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999999;" +
					"background:#ffffff;border:4px ridge #0b7a0b;padding:10px 14px;max-width:82vw;" +
					'font-family:"unscii8",monospace;color:#0b7a0b;font-size:13px;text-align:center;'
			);
			panel.innerHTML =
				'<div style="font-weight:bold;margin-bottom:6px;">ADMIN · SET_BASE_URI</div>' +
				'<div id="tezos_admin_target" style="word-break:break-all;margin-bottom:8px;"></div>' +
				'<button type="button" class="header_button" id="tezos_admin_sign">SIGN WITH ADMIN WALLET</button>' +
				'<div id="tezos_admin_status" style="margin-top:6px;">&nbsp;</div>';
			document.body.appendChild(panel);
			document.getElementById("tezos_admin_target").textContent = setbase_param;
			const admin_status = document.getElementById("tezos_admin_status");
			document.getElementById("tezos_admin_sign").addEventListener("click", async () => {
				try {
					admin_status.textContent = "LOADING WALLET SDK…";
					const beacon = await loadBeacon();
					if (!beacon_client) {
						beacon_client = new beacon.DAppClient({ name: "SUPERPEPEPAINT", network: beaconNetwork() });
					}
					const active = await beacon_client.getActiveAccount();
					if (!active) await beacon_client.requestPermissions();
					admin_status.textContent = "CONFIRM IN YOUR WALLET…";
					const result = await beacon_client.requestOperation({
						operationDetails: [
							{
								kind: "transaction",
								destination: CONFIG.contract,
								amount: "0",
								parameters: { entrypoint: "set_base_uri", value: { bytes: utf8hex(setbase_param) } },
							},
						],
					});
					const hash = result && (result.transactionHash || result.operationHash || result.opHash);
					admin_status.textContent = "DONE ✓ " + (hash ? String(hash).slice(0, 16) + "…" : "OPERATION SENT");
				} catch (err) {
					admin_status.textContent = "STOPPED: " + String(err && err.message ? err.message : err).slice(0, 110);
				}
			});
		} catch (err) { /* stub DOMs without a body are fine */ }
	}

	// small window for the test suite and tinkerers
	window.SPPTEZ = {
		config: CONFIG,
		configured: CONFIGURED,
		viewerApplied: viewer_applied,
		baseCode: () => base_code,
		buildMintParams: buildMintParams,
		tuneAttributesJson: tuneAttributesJson,
		tuneDescription: tuneDescription,
		startMint: startMint,
	};
})();
