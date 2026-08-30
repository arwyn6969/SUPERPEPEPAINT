#!/usr/bin/env node
/* Originates the SUPERPEPEPAINT FA2 collection.

   Inputs:
   - contract/build/contract.json          compiled Michelson (SmartPy output)
   - contract/deploy-input.json            origination parameters (see below)
   - key file (JSON {edsk, addr}) given as --key <path>

   deploy-input.json shape:
   {
     "rpc": "https://rpc.shadownet.teztnets.com",
     "explorer": "https://shadownet.tzkt.io",
     "network": "shadownet",
     "admin": "",                        // final admin; empty = the signing key
     "base_uri": "https://.../index.html?tune=",
     "mint_price_mutez": "500000",
     "collection_name": "SUPERPEPEPAINT",
     "collection_description": "...",
     "cover_uri": "ipfs://... or https://...",
     "creators_json": "[\"tz1...\"]",
     "royalties_json": "{\"decimals\":3,\"shares\":{\"tz1...\":100}}"
   }

   Usage: node contract/originate.mjs --key /path/key.json
   Writes the KT1 to contract/deploy.<network>.json */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TezosToolkit, MichelsonMap } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argKey = process.argv.indexOf("--key");
if (argKey === -1) throw new Error("usage: node originate.mjs --key <keyfile.json>");
const key = JSON.parse(fs.readFileSync(process.argv[argKey + 1], "utf8"));
const input = JSON.parse(fs.readFileSync(path.join(HERE, "deploy-input.json"), "utf8"));
const code = JSON.parse(fs.readFileSync(path.join(HERE, "build", "contract.json"), "utf8"));

const utf8hex = (s) => Buffer.from(s, "utf8").toString("hex");

const admin = input.admin || key.addr;

const tzip16 = {
	name: input.collection_name,
	description: input.collection_description,
	version: "1.2.0",
	interfaces: ["TZIP-012", "TZIP-016", "TZIP-021"],
	authors: JSON.parse(input.creators_json),
	homepage: "https://github.com/arwyn6969/SUPERPEPEPAINT",
	imageUri: input.cover_uri,
};

const metadata = new MichelsonMap();
metadata.set("", utf8hex("tezos-storage:content"));
metadata.set("content", utf8hex(JSON.stringify(tzip16)));

const shared = new MichelsonMap();
shared.set("decimals", utf8hex("0"));
shared.set("symbol", utf8hex("SPPTUNE"));
shared.set("displayUri", utf8hex(input.cover_uri));
shared.set("thumbnailUri", utf8hex(input.cover_uri));
shared.set("creators", utf8hex(input.creators_json));
shared.set("royalties", utf8hex(input.royalties_json));
shared.set("tags", utf8hex('["superpepepaint","music","mariopaint","generative","pepe"]'));

const storage = {
	administrator: admin,
	base_uri: utf8hex(input.base_uri),
	ledger: new MichelsonMap(),
	metadata,
	mint_price: input.mint_price_mutez,
	next_token_id: 0,
	operators: new MichelsonMap(),
	paused: false,
	shared_info: shared,
	token_metadata: new MichelsonMap(),
};

const tezos = new TezosToolkit(input.rpc);
tezos.setSignerProvider(await InMemorySigner.fromSecretKey(key.edsk));

console.log("originating from", key.addr, "on", input.rpc);
console.log("final admin:", admin);
const op = await tezos.contract.originate({ code, storage });
console.log("operation:", op.hash);
const contract = await op.contract(2);
console.log("ORIGINATED:", contract.address);
console.log("explorer:  ", input.explorer + "/" + contract.address);

const record = {
	contract: contract.address,
	network: input.network,
	rpc: input.rpc,
	price_mutez: input.mint_price_mutez,
	explorer: input.explorer,
};
const outPath = path.join(HERE, "deploy." + input.network + ".json");
fs.writeFileSync(outPath, JSON.stringify(record, null, "\t") + "\n");
console.log("wrote", outPath);
