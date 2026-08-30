# SUPERPEPEPAINT

SUPERPEPEPAINT is a Mario Paint style music composer wearing PEPEPAINT's skin. Place meme stamps on a musical staff; every stamp is a synthesized instrument. The seed composes a deterministic starter tune, you take it from there — and when you're happy, you mint.

Three publishing paths from one codebase:

- **The sovereign mint (Tezos edition)** — **LIVE ON MAINNET**: [`KT1TFFL3BpiPya6NVUkbvpQb9d1PVU2ts5ZH`](https://tzkt.io/KT1TFFL3BpiPya6NVUkbvpQb9d1PVU2ts5ZH) · [mint page](https://superpepepaint.mrarwyn.workers.dev/) · [collection on objkt](https://objkt.com/collections/KT1TFFL3BpiPya6NVUkbvpQb9d1PVU2ts5ZH). The composer is the minting interface: compose inside the app, sign once, and the contract builds `artifactUri = app + tune code` on chain. 10 tez mint, 10% royalties. See **[MINTING-TEZOS.md](MINTING-TEZOS.md)**.
- **Manual objkt.com mint kit** — the MINT button produces a video artefact, cover, metadata and MIDI for a hand-made [objkt.com](https://objkt.com) mint.
- **[bootloader.art](https://bootloader.art) generic web** (`boot:web@1.0.0`) — the self-contained seeded edition.

A fork of [PEPEPAINT V1](https://github.com/nathansonic/PEPEPAINT-V1) by Nathan Gregg (MIT). The unscii fonts, the green-on-white text-shadow chrome, the beveled buttons, the feedback popup, and all sixteen stamp sprites are inherited from PEPEPAINT's visual system in honored continuity — the drawing canvas just grew staff lines.

## What it does

- **16 instrument stamps**, each a Web Audio synth voice: PEPE (square croak), CAT (meow bend), GONDOLA (comfy flute), HEART (FM bell), DOGE (FM bark), SANIC (octave zap), UFO (theremin), WOJAK (sad detune), CHEEMS (wobble saw), GROYPER (hollow pluck), SWOLE (brass stack), NPC (flat robot pulse), SMINEM (deep bass), XCP (kick), SUN (hi-hat), FIREDOG (snare). No samples — every sound is synthesized, so nothing external is ever fetched.
- **Mario Paint rules**: 2 pages × 16 eighth-note steps (4 bars), 15 diatonic staff rows, **max 3 stamps per beat**, stamps wiggle when the playhead hits them, placing a stamp previews its note.
- **Seeded starter tune**: `$bootloader.rnd()` picks mode, key, tempo, swing, progression, lead/bass/drums and composes a 4-bar loop plus a title ("SWAMP KEK", "MIDNIGHT RIBBIT", ...). Same seed, same tune, forever.
- **Token features** via `$bootloader.setFeatures()`: Tempo, Key, Mood, Lead, Bass, Drums, Swing, Croakage (%), Stamps (num), Motif.
- **Mint kit** (MINT button / `d`): records your composition as a **video with sound** (MediaRecorder, 2 loops, webm — mp4 on Safari), plus a score-card **cover PNG**, a **metadata JSON** (title, attributes, tune code), a 2-loop stereo **WAV**, and a **MIDI** file for DAWs.
- **Tune codes**: the whole composition serialized to a short checksummed string (`SPP1.…`). It rides in the minted token's description, so every video permanently embeds its replayable source — paste it back in to hear and remix the exact tune.
- **Persistence**: compositions autosave to localStorage per token hash (never during capture, so thumbnails stay deterministic).

## Controls

| Key | Action |
| --- | --- |
| click / drag staff | place selected stamp (3 per beat max) |
| space | play / stop |
| 1-8, 9 0 q w r t y u | select stamp |
| e | eraser |
| z / x | undo / redo |
| a | new random tune |
| c | clear |
| n / m | tempo down / up |
| g | swing (straight / light / heavy) |
| l | loop on / off |
| left / right | page A / B |
| s | save score PNG |
| v | save WAV |
| d | mint & share dialog (video / MIDI / tune code) |
| h | hide controls |
| ? | help panel |

## Run locally

The app is static with no build step:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>. `bootloader.js` self-seeds when no query parameters are given; control it with `?s=<64-hex-seed>&i=<edition>&c=true` (capture mode). Open <http://localhost:8000/dev.html> for a six-seed preview lab.

## Mint your tune on objkt.com

When a composition is ready, open **MINT** (or press `d`) and follow the three steps:

1. **REC VIDEO** — plays your tune twice while recording the animated score with sound. The resulting webm/mp4 is the token **artefact** (objkt supports video up to 250 MB).
2. **Save the mint files** — **COVER PNG** (the token cover), **METADATA** (title, attributes and the tune code, ready to paste into the mint form), plus WAV/MIDI extras.
3. **OPEN OBJKT.COM** → Create → pick a collection → upload the video as artefact + the PNG as cover → paste the title, description (with tune code) and attributes → set editions and royalties → confirm with your Tezos wallet.

The wallet signature is the one step no app can do for you — objkt has no prefill API, so the kit prepares everything up to that click. Paste any minted token's tune code back into the app (MINT → IMPORT CODE) to replay and remix it.

The whole app also satisfies objkt's **interactive token** rules (top-level `index.html`, relative refs, zero external requests), so `dist/superpepepaint.zip` can itself be minted as a playable interactive OBJKT if you ever want the instrument on-chain too.

## The sovereign mint (Tezos edition)

`npm run zip:tez` builds `dist/superpepepaint-tezos.zip`: the same app booted by `bootloader.js` (self-seeding), plus `tezos-mint.js` — viewer mode for minted tokens (`?tune=SPP1.…` in the URL applies the tune through the checksummed codec) and a Beacon wallet mint flow for composers. The FA2 contract (`contract/`) enforces the linkage on chain: it concatenates `base_uri + code` into `artifactUri` itself, so every token in the collection provably points at the canonical app playing that exact tune. Full architecture, live Shadownet dry-run evidence and the mainnet runbook: **[MINTING-TEZOS.md](MINTING-TEZOS.md)**.

## The fx(hash) edition (shelved with honors)

`npm run zip:fx` builds `dist/superpepepaint-fxhash.zip` — a complete fx(params) edition where the composer ran inside fxhash's minting UI and synced every edit into a 352-byte code-driven bytes param (`fxhash-adapter.js`, verified against the official snippet in the test suite). It was finished and browser-verified on 2026-08-30 — twelve days after fxhash permanently shut down (2026-08-17), which we discovered at the sandbox-test gate. It ships as engineering record; the sovereign Tezos edition above is its successor and improves on it (no platform to die).

## Publish to bootloader.art (still supported)

The published artifact is a zip of exactly these files:

```text
index.html      entry (required name)
bootloader.js   the boot:web@1.0.0 runtime (verbatim from the official examples)
manifest.json   trigger capture, 1000x1000 viewport
styles.css      PEPEPAINT chrome, subset unscii fonts inlined as woff2 data URIs
stamps.js       16 stamp sprites as PNG data URIs + eraser icon
audio.js        synth voices, scheduler helpers, WAV encoder, record tap
main.js         composer, staff renderer, interaction, bootloader wiring
mint.js         mint kit: video recorder, tune codec, MIDI writer, metadata
LICENSE         MIT, original + fork
```

Build it:

```sh
npm run zip
```

Then on [bootloader.art/create](https://bootloader.art/create) choose **Generic Web**, upload the zip, preview a few seeds, pick a thumbnail seed, and publish. The project follows the generic-web rules: all randomness flows from `$bootloader.rnd()`, every asset is bundled (data URIs — no external requests anywhere), the card scales to any viewport, `$bootloader.capture()` fires in capture mode after fonts and sprites are ready.

## Repository layout

Beyond the artifact files above: `dev.html` (seed lab); `test/logic.test.cjs` (`node test/logic.test.cjs` — boots the real `bootloader.js` + `main.js` in a stub DOM and checks determinism and composer invariants across 120 seeds, then boots the fx(hash) edition against the real snippet, then the Tezos edition including a golden Micheline cross-check against Taquito's encoding — 30k+ checks); `contract/` (the FA2 sovereign-mint contract, compiled build, deploy + live-E2E scripts); `tezos-mint.js`, `fxhash-adapter.js`, `fxhash.min.js` (edition glue); `tools/` (edition build scripts); and the inherited `brushes/` + `fonts/` directories from upstream PEPEPAINT, which are the source art the stamp sprites and subset fonts were derived from. Upstream's drawing-app files (`filters.js`, `traits.js`, `backend/`, `greenpaper/`) are not used by SUPERPEPEPAINT.

## Credits & license

- [PEPEPAINT V1](https://github.com/nathansonic/PEPEPAINT-V1) by Nathan Gregg — MIT. Art, fonts, visual system.
- [unscii](http://viznut.fi/unscii/) bitmap font by viznut (in PEPEPAINT upstream), subset here to ASCII + symbols.
- [bootloader.art](https://bootloader.art) — open-source generative art platform on Tezos by objkt.
- SUPERPEPEPAINT fork — MIT, same terms as upstream. See `LICENSE`.
