# SUPERPEPEPAINT

SUPERPEPEPAINT is a Mario Paint style music composer wearing PEPEPAINT's skin. Place meme stamps on a musical staff; every stamp is a synthesized instrument. It ships as a fully self-contained web artwork for the [bootloader.art](https://bootloader.art) generic-web runtime (`boot:web@1.0.0`): the token seed composes a deterministic starter tune, and the collector takes it from there.

A fork of [PEPEPAINT V1](https://github.com/nathansonic/PEPEPAINT-V1) by Nathan Gregg (MIT). The unscii fonts, the green-on-white text-shadow chrome, the beveled buttons, the feedback popup, and all sixteen stamp sprites are inherited from PEPEPAINT's visual system in honored continuity — the drawing canvas just grew staff lines.

## What it does

- **16 instrument stamps**, each a Web Audio synth voice: PEPE (square croak), CAT (meow bend), GONDOLA (comfy flute), HEART (FM bell), DOGE (FM bark), SANIC (octave zap), UFO (theremin), WOJAK (sad detune), CHEEMS (wobble saw), GROYPER (hollow pluck), SWOLE (brass stack), NPC (flat robot pulse), SMINEM (deep bass), XCP (kick), SUN (hi-hat), FIREDOG (snare). No samples — every sound is synthesized, so nothing external is ever fetched.
- **Mario Paint rules**: 2 pages × 16 eighth-note steps (4 bars), 15 diatonic staff rows, **max 3 stamps per beat**, stamps wiggle when the playhead hits them, placing a stamp previews its note.
- **Seeded starter tune**: `$bootloader.rnd()` picks mode, key, tempo, swing, progression, lead/bass/drums and composes a 4-bar loop plus a title ("SWAMP KEK", "MIDNIGHT RIBBIT", ...). Same seed, same tune, forever.
- **Token features** via `$bootloader.setFeatures()`: Tempo, Key, Mood, Lead, Bass, Drums, Swing, Croakage (%), Stamps (num), Motif.
- **Exports**: 2-loop stereo WAV (OfflineAudioContext render) and a 2-page score card PNG.
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
| h | hide controls |
| ? | help panel |

## Run locally

The app is static with no build step:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>. `bootloader.js` self-seeds when no query parameters are given; control it with `?s=<64-hex-seed>&i=<edition>&c=true` (capture mode). Open <http://localhost:8000/dev.html> for a six-seed preview lab.

## Publish to bootloader.art

The published artifact is a zip of exactly these files:

```text
index.html      entry (required name)
bootloader.js   the boot:web@1.0.0 runtime (verbatim from the official examples)
manifest.json   trigger capture, 1000x1000 viewport
styles.css      PEPEPAINT chrome, subset unscii fonts inlined as woff2 data URIs
stamps.js       16 stamp sprites as PNG data URIs + eraser icon
audio.js        synth voices, scheduler helpers, WAV encoder
main.js         composer, staff renderer, interaction, bootloader wiring
LICENSE         MIT, original + fork
```

Build it:

```sh
npm run zip     # or: zip -j dist/superpepepaint.zip index.html bootloader.js manifest.json styles.css stamps.js audio.js main.js LICENSE
```

Then on [bootloader.art/create](https://bootloader.art/create) choose **Generic Web**, upload the zip, preview a few seeds, pick a thumbnail seed, and publish. The project follows the generic-web rules: all randomness flows from `$bootloader.rnd()`, every asset is bundled (data URIs — no external requests anywhere), the card scales to any viewport, `$bootloader.capture()` fires in capture mode after fonts and sprites are ready.

## Repository layout

Beyond the artifact files above: `dev.html` (seed lab), `test/logic.test.cjs` (`node test/logic.test.cjs` — boots the real `bootloader.js` + `main.js` in a stub DOM and checks determinism and composer invariants across 120 seeds), and the inherited `brushes/` + `fonts/` directories from upstream PEPEPAINT, which are the source art the stamp sprites and subset fonts were derived from. Upstream's drawing-app files (`filters.js`, `traits.js`, `backend/`, `greenpaper/`) are not used by SUPERPEPEPAINT.

## Credits & license

- [PEPEPAINT V1](https://github.com/nathansonic/PEPEPAINT-V1) by Nathan Gregg — MIT. Art, fonts, visual system.
- [unscii](http://viznut.fi/unscii/) bitmap font by viznut (in PEPEPAINT upstream), subset here to ASCII + symbols.
- [bootloader.art](https://bootloader.art) — open-source generative art platform on Tezos by objkt.
- SUPERPEPEPAINT fork — MIT, same terms as upstream. See `LICENSE`.
