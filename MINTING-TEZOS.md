# The sovereign mint — SUPERPEPEPAINT on Tezos

## 🟢 LIVE ON MAINNET (2026-08-30)

| | |
| --- | --- |
| Contract | [`KT1TFFL3BpiPya6NVUkbvpQb9d1PVU2ts5ZH`](https://tzkt.io/KT1TFFL3BpiPya6NVUkbvpQb9d1PVU2ts5ZH) |
| Mint page | [superpepepaint.mrarwyn.workers.dev](https://superpepepaint.mrarwyn.workers.dev/) |
| Canonical app (on chain) | `ipfs://QmNj24dkjAttpM9HtMgZTrkgrNT2N84RLx5obkVXF4mAXX/` — what every token's artifactUri points at; the mint page above serves the identical build from Cloudflare because 2026 public IPFS gateways no longer render HTML for browsers |
| Collection on objkt | [objkt.com/collections/KT1TFFL3…](https://objkt.com/collections/KT1TFFL3BpiPya6NVUkbvpQb9d1PVU2ts5ZH) |
| Admin / creator / royalties | `tz1a13cp8xSdqYRoCXRrNiGgd233bNHpeNw5` (10%) |
| Mint price | 10 tez (admin-adjustable via `set_mint_price`) |

Compose in the app → **⛏ MINT THIS TUNE** → sign. That's the whole flow.

---

The composer is the minting interface. Your collection lives in **your own FA2
contract**; collectors compose a tune inside the app, click **⛏ MINT THIS
TUNE**, sign once with their wallet, and the contract mints their tune as a
token in your collection. No uploads, no forms, no platform — and nothing to
shut down, because you own every piece.

**On-chain integrity, enforced by the contract itself:**

- `artifactUri = base_uri + tune code` is concatenated **on chain** — every
  token provably points at the canonical app rendering that exact tune
- the tune code must start with `SPP1.` and fit the codec bounds
- the `formats` JSON and a machine-readable `tune` key are written on chain
- royalties, creators, cover and tags come from admin-set `shared_info`
- corrupt or junk tune params never brick a token: the app's checksummed
  codec rejects them and falls back to the seed tune (provable on chain —
  see token 0 of the dry run below, minted with a deliberately broken code)

## Proven live: the Shadownet dry run (2026-08-30)

Everything below already happened end-to-end on Tezos' permanent testnet:

| | |
| --- | --- |
| Contract | [`KT1BxZP2KnckZiW9xMYiMQj9iJYfrxyCpD5R`](https://shadownet.tzkt.io/KT1BxZP2KnckZiW9xMYiMQj9iJYfrxyCpD5R) |
| Collection on objkt | [shadownet.objkt.com/collections/KT1BxZ…](https://shadownet.objkt.com/collections/KT1BxZP2KnckZiW9xMYiMQj9iJYfrxyCpD5R) |
| SmartPy scenarios | all entrypoints + adversarial cases, simulated |
| Live E2E | 26/26 checks: open mint from a second non-admin wallet, wrong-price / non-tune / oversize / paused rejections, FA2 transfer, withdraw, on-chain `token_info` verified byte-for-byte |
| Indexing | tzkt + objkt both parsed the TZIP-21 metadata (names, attributes, covers) |
| Micheline parity | the app's wallet payload is byte-identical to Taquito's encoding (golden test in the suite) |

Measured costs on Shadownet (same order on mainnet): **origination ≈ 2.5 tez**
(9.7 KB storage) — one-time; **each mint ≈ 0.32–0.41 tez** in fees+storage on
top of whatever mint price you set (goes to the contract, withdrawable by you).

### Try a wallet mint yourself (2 minutes, free)

1. In Temple (or any Beacon wallet), add a custom network:
   RPC `https://rpc.shadownet.teztnets.com`
2. Fund your address free: `npx @tacoinfra/get-tez --amount 5 --network shadownet <your tz1>`
   (or use <https://faucet.shadownet.teztnets.com>)
3. Open the test app, compose, hit **MINT → ⛏ MINT THIS TUNE**, sign.
   Your tune appears in the collection on shadownet.objkt.com within a minute.

> Note: the hosted *test* page runs in a sandboxed iframe that blocks wallet
> storage. Use the same build served from any normal origin (IPFS gateway,
> your own domain, or a local `python3 -m http.server`) for the wallet flow.

## Mainnet launch runbook

### 0. What you need

- A Tezos wallet you control (Temple / Kukai) with ~8 tez
- A [Pinata](https://pinata.cloud) account (free tier) — only the web UI's
  drag-and-drop is used, no API key required

### 1. Configure the collection

Edit `contract/deploy-input.json`:

```json
{
	"rpc": "https://mainnet.ecadinfra.com",
	"explorer": "https://tzkt.io",
	"network": "mainnet",
	"admin": "tz1YOURADDRESS",
	"base_uri": "ipfs://PENDING?tune=",
	"mint_price_mutez": "500000",
	"collection_name": "SUPERPEPEPAINT",
	"collection_description": "…",
	"cover_uri": "ipfs://YOUR_COVER_CID",
	"creators_json": "[\"tz1YOURADDRESS\"]",
	"royalties_json": "{\"decimals\":3,\"shares\":{\"tz1YOURADDRESS\":100}}"
}
```

`admin` is YOUR address — the deploy key below is only gas. Royalties shown =
10%. Pin a cover image on Pinata first (drag-and-drop) for `cover_uri`.

### 2. Originate (throwaway-key pattern — your real key never leaves your wallet)

```sh
npm install            # taquito dev deps
node -e 'const{b58Encode,PrefixV2}=require("@taquito/utils");const{InMemorySigner}=require("@taquito/signer");const c=require("crypto");const k=b58Encode(c.randomBytes(32),PrefixV2.Ed25519Seed);InMemorySigner.fromSecretKey(k).then(async s=>{require("fs").writeFileSync("deploy_key.json",JSON.stringify({edsk:k,addr:await s.publicKeyHash()}));console.log("fund this with 5 tez:",await s.publicKeyHash())})'
# send 5 tez from your wallet to the printed address, then:
node contract/originate.mjs --key deploy_key.json
```

The script prints your `KT1…` and writes `contract/deploy.mainnet.json`.
Because `admin` was set to your address, **you own the contract from block
one** — the throwaway key has no power afterward. Send any leftover tez back
and delete `deploy_key.json`.

### 3. Pin the app and point the contract at it

```sh
cp contract/deploy.mainnet.json contract/deploy.json
npm run zip:tez        # builds dist/superpepepaint-tezos.zip bound to your KT1
```

Unzip it, drag the **folder** into Pinata → copy the CID. Then call
`set_base_uri` on your contract (better-call.dev → your KT1 → Interact →
`set_base_uri`, wallet-signed) with the bytes of:

```
ipfs://<CID>/?tune=
```

(hex-encode the string, or use the "string" input mode if offered). Every
future token's artifactUri now resolves to your immutable IPFS app. You can
also host the same folder at your own domain and use an `https://…?tune=`
base instead — updatable, at the cost of depending on that domain.

### 4. Genesis + objkt

Open the app (the pinned `ipfs://<CID>/` via any gateway, or your domain),
compose the genesis tune, **⛏ MINT THIS TUNE**, sign. Token 0 is yours.

The collection appears automatically at `objkt.com/collections/<KT1>` —
log in there with the admin wallet to claim/curate the collection page.
Tell collectors one URL: the app. Compose → mint → done.

### 5. Operating the collection (all wallet-signed via better-call.dev)

| Entrypoint | Effect |
| --- | --- |
| `set_mint_price(mutez)` | change the price for future mints |
| `set_paused(bool)` | pause / resume minting |
| `set_base_uri(bytes)` | point future mints at a new app build |
| `set_shared_info(map)` | change cover / royalties / tags for future mints |
| `withdraw_mutez(dest, amount)` | collect mint proceeds |
| `set_administrator(address)` | hand over or rotate admin |

Minted tokens are immutable — admin changes only affect future mints.

## Hosting requirements for https artifacts (hard-won lessons)

If `base_uri` points at an **https** host (like the Cloudflare worker), that host
**MUST send CORS headers** — objkt's frontend `fetch()`es the artifact URL
cross-origin from `https://objkt.com` before embedding it, and without
`Access-Control-Allow-Origin` the pane shows *"unable to load asset"*:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
```

`tools/deploy-worker.cjs` emits the worker source with these baked in.

If `base_uri` points at **ipfs://** instead, objkt must mirror the CID into
`assets.objkt.media` before the live view works (the raw ipfs.io fallback no
longer serves HTML to browsers). That mirror runs automatically for
established contracts (hicetnunc, fxhash); for brand-new collections it may
need a nudge via objkt support.

## Minting from mobile wallets and embedded previews (hard-won lessons)

- **Wallets cannot connect from restricted environments.** objkt's embedded
  live view runs in a sandboxed iframe, and some mobile in-app browsers block
  storage — the Beacon SDK crashes during init there (the old symptom:
  `MINT STOPPED: beacon global missing`). The app now detects both cases
  (`walletEnvBlocked()`) and swaps the mint button for **⛏ OPEN THE APP TO
  MINT**, which opens the full app carrying the exact current tune
  (`page + ?tune=<code>`, stamped from `deploy.json`'s `page` field).
- **The Beacon SDK loads same-origin first.** The worker serves
  `/walletbeacon.min.js` as an edge-cached proxy of the pinned
  `@airgap/beacon-sdk@4.8.1` bundle, with the jsDelivr CDN as the in-app
  fallback — webviews that block third-party scripts still get the SDK, and
  IPFS/local builds degrade to the CDN automatically.
- **SDK crashes now self-report.** The loader captures the bundle's own
  error and surfaces it in the status line (`wallet sdk crashed: …`), so a
  mobile bug report carries the real cause instead of a generic failure.

## Files


```text
contract/superpepepaint_fa2.py      SmartPy source + full scenario suite
contract/build/contract.json        compiled Michelson (SmartPy 0.24.2)
contract/originate.mjs              deploy script (reads deploy-input.json)
contract/test-e2e.mjs               live-network E2E (26 checks)
contract/deploy-input.json          origination parameters
contract/deploy.json                active binding used by npm run zip:tez
contract/deploy.shadownet.json      the dry-run deployment record
tezos-mint.js                       app glue: viewer + Beacon mint flow
tools/build-tezos.cjs               builds dist/superpepepaint-tezos.zip
```

Rebuild the contract from source: `pip install smartpy-tezos` (Python ≥ 3.10),
then `python contract/superpepepaint_fa2.py` — scenarios run and the compiled
Michelson lands in `superpepepaint_fa2/`.
