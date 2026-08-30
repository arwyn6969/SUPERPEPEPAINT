#!/usr/bin/env node
/* SUPERPEPEPAINT contract E2E - runs against the LIVE originated contract.

   Proves on a real network what the SmartPy scenarios proved in simulation:
   - open mint: a non-admin wallet mints straight into the collection
   - token_info is built on chain: artifactUri = base_uri + code, formats
     JSON, tune key, shared fields merged
   - adversarial rejections: wrong price, non-tune code, oversize code,
     paused, non-admin admin calls
   - FA2 transfer + admin withdraw
   - writes the golden mint Micheline for the vm suite cross-check

   Usage: node contract/test-e2e.mjs --key <admin_key.json> */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { TezosToolkit } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";
import { b58Encode, PrefixV2 } from "@taquito/utils";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argKey = process.argv.indexOf("--key");
const key = JSON.parse(fs.readFileSync(process.argv[argKey + 1], "utf8"));
const deploy = JSON.parse(fs.readFileSync(path.join(HERE, "deploy.shadownet.json"), "utf8"));
const input = JSON.parse(fs.readFileSync(path.join(HERE, "deploy-input.json"), "utf8"));

const utf8hex = (s) => Buffer.from(s, "utf8").toString("hex");
const hex2utf8 = (h) => Buffer.from(h, "hex").toString("utf8");

let checks = 0;
let failures = 0;
function assert(cond, msg) {
	checks++;
	if (cond) console.log("  ok  " + msg);
	else {
		failures++;
		console.error("  FAIL " + msg);
	}
}

async function expectFail(promise, needle, msg) {
	try {
		await promise;
		assert(false, msg + " (unexpectedly succeeded)");
	} catch (err) {
		const s = JSON.stringify(err.message || "") + JSON.stringify(err.errors || "");
		assert(s.includes(needle), msg + " (got: " + String(err.message).slice(0, 90) + ")");
	}
}

// two real melodies: FXPARITY (hand-built, verified in Chrome) and COMFY LILY
// (browser-composed via RAND during the fx build verification)
const CODE_FXPARITY = "SPP1.AVABAAAIRlhQQVJJVFkFAHBfAjFVA_RVBhBfB488Ug";
const LILY_ENV_HEX = fs.readFileSync("/tmp/fx_bytes.txt", "utf8").trim();
const lilyPayloadLen = parseInt(LILY_ENV_HEX.slice(12, 16), 16);
const lilyPayload = Buffer.from(LILY_ENV_HEX.slice(16, 16 + lilyPayloadLen * 2), "hex");
const CODE_LILY = "SPP1." + lilyPayload.toString("base64url");

const tezos = new TezosToolkit(deploy.rpc);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(key.edsk));
const admin = key.addr;
const c = await tezos.contract.at(deploy.contract);
const PRICE = Number(deploy.price_mutez);

console.log("contract:", deploy.contract);
console.log("base_uri:", input.base_uri);

function mintArgs(code, name, source, extraDesc) {
	return {
		code: utf8hex(code),
		name: utf8hex(name),
		attributes: utf8hex(JSON.stringify([{ name: "Source", value: source }])),
		description: utf8hex(name + " - " + (extraDesc || "a SUPERPEPEPAINT composition") + "\nTUNE CODE:\n" + code),
	};
}

console.log("\n[1] golden micheline for the vm cross-check");
{
	const tp = c.methodsObject.mint(mintArgs(CODE_FXPARITY, "FXPARITY", "COMPOSED")).toTransferParams({ amount: PRICE, mutez: true });
	fs.writeFileSync(path.join(HERE, "build", "golden_mint_micheline.json"), JSON.stringify({
		entrypoint: tp.parameter.entrypoint,
		value: tp.parameter.value,
		inputs: { code: CODE_FXPARITY, name: "FXPARITY", attributes: JSON.stringify([{ name: "Source", value: "COMPOSED" }]), description: hex2utf8(mintArgs(CODE_FXPARITY, "FXPARITY", "COMPOSED").description) },
	}, null, "\t"));
	assert(tp.parameter.entrypoint === "mint", "golden written (entrypoint mint)");
}

console.log("\n[2] genesis mint by admin (token 0, FXPARITY)");
{
	const op = await c.methodsObject.mint(mintArgs(CODE_FXPARITY, "FXPARITY", "COMPOSED", "the parity test melody")).send({ amount: PRICE, mutez: true });
	await op.confirmation(2);
	assert(true, "mint op " + op.hash.slice(0, 12) + "…");
}

console.log("\n[3] adversarial rejections");
await expectFail(
	c.methodsObject.mint(mintArgs(CODE_FXPARITY, "CHEAP", "SEED")).send({ amount: 1, mutez: true }),
	"SPP_WRONG_PRICE", "wrong price rejected");
await expectFail(
	c.methodsObject.mint(mintArgs("HELLO.WORLDxx", "JUNK", "SEED")).send({ amount: PRICE, mutez: true }),
	"SPP_NOT_A_TUNE", "non-tune code rejected");
await expectFail(
	c.methodsObject.mint(mintArgs("SPP1." + "A".repeat(600), "TOO BIG", "SEED")).send({ amount: PRICE, mutez: true }),
	"SPP_CODE_TOO_LONG", "oversize code rejected");

console.log("\n[4] pause blocks minting");
{
	const op = await c.methodsObject.set_paused(true).send();
	await op.confirmation(2);
	await expectFail(
		c.methodsObject.mint(mintArgs(CODE_FXPARITY, "WHILE PAUSED", "SEED")).send({ amount: PRICE, mutez: true }),
		"SPP_PAUSED", "paused mint rejected");
	const op2 = await c.methodsObject.set_paused(false).send();
	await op2.confirmation(2);
	assert(true, "unpaused");
}

console.log("\n[5] open mint: fund a second wallet, non-admin mints token 1");
const seed2 = crypto.randomBytes(32);
const edsk2 = b58Encode(seed2, PrefixV2.Ed25519Seed);
const signer2 = await InMemorySigner.fromSecretKey(edsk2);
const addr2 = await signer2.publicKeyHash();
{
	const op = await tezos.contract.transfer({ to: addr2, amount: 3 });
	await op.confirmation(2);
	assert(true, "collector wallet funded: " + addr2);

	const tez2 = new TezosToolkit(deploy.rpc);
	tez2.setSignerProvider(signer2);
	const c2 = await tez2.contract.at(deploy.contract);

	const op2 = await c2.methodsObject.mint(mintArgs(CODE_LILY, "COMFY LILY", "COMPOSED", "browser-composed during the fx dry run")).send({ amount: PRICE, mutez: true });
	await op2.confirmation(2);
	assert(true, "NON-ADMIN mint op " + op2.hash.slice(0, 12) + "… (the mint is open)");

	await expectFail(c2.methodsObject.set_paused(true).send(), "FA2_NOT_ADMIN", "non-admin cannot pause");
	await expectFail(c2.methodsObject.set_mint_price(0).send(), "FA2_NOT_ADMIN", "non-admin cannot set price");
	await expectFail(c2.methodsObject.withdraw_mutez({ destination: addr2, amount: 1 }).send(), "FA2_NOT_ADMIN", "non-admin cannot withdraw");

	console.log("\n[6] FA2 transfer: collector sends token 1 to admin");
	const op3 = await c2.methodsObject.transfer([{ from_: addr2, txs: [{ to_: admin, token_id: 1, amount: 1 }] }]).send();
	await op3.confirmation(2);
	assert(true, "transfer confirmed");
}

console.log("\n[7] on-chain state verification via RPC");
{
	const storage = await c.storage();
	assert(String(storage.next_token_id) === "2", "next_token_id == 2 (two real mints)");
	const t0 = await storage.token_metadata.get("0");
	const t1 = await storage.token_metadata.get("1");
	const info0 = Object.fromEntries([...t0.token_info.entries()].map(([k, v]) => [k, hex2utf8(v)]));
	const info1 = Object.fromEntries([...t1.token_info.entries()].map(([k, v]) => [k, hex2utf8(v)]));
	assert(info0.artifactUri === input.base_uri + CODE_FXPARITY, "token0 artifactUri = base + code (ON-CHAIN LINK)");
	assert(info0.formats === '[{"uri":"' + input.base_uri + CODE_FXPARITY + '","mimeType":"text/html"}]', "token0 formats JSON built on chain");
	assert(info0.tune === CODE_FXPARITY, "token0 tune key");
	assert(info0.name === "FXPARITY", "token0 name");
	assert(info0.decimals === "0" && info0.symbol === "SPPTUNE", "token0 shared fields merged");
	assert(info1.artifactUri === input.base_uri + CODE_LILY, "token1 artifactUri = base + code");
	assert(info1.name === "COMFY LILY", "token1 name");
	const owner0 = await storage.ledger.get("0");
	const owner1 = await storage.ledger.get("1");
	assert(owner0 === admin, "token0 owned by admin (genesis)");
	assert(owner1 === admin, "token1 owned by admin after transfer");
	assert(storage.paused === false, "not paused");
}

console.log("\n[8] withdraw proceeds to admin");
{
	const bal = await tezos.tz.getBalance(deploy.contract);
	assert(bal.toNumber() === PRICE * 2, "contract holds exactly 2 mint fees (" + bal.toNumber() + " mutez)");
	const op = await c.methodsObject.withdraw_mutez({ destination: admin, amount: bal.toNumber() }).send();
	await op.confirmation(2);
	const bal2 = await tezos.tz.getBalance(deploy.contract);
	assert(bal2.toNumber() === 0, "contract drained to admin");
}

console.log("\n" + checks + " checks, " + failures + " failures");
console.log(failures === 0 ? "E2E ALL GREEN" : "E2E FAILURES");
process.exit(failures === 0 ? 0 : 1);
