# PEPEPAINT V1

PEPEPAINT is a browser drawing app for creating Pepe-themed artwork. The frontend is plain HTML, CSS, and JavaScript with no build step. A small Node.js service handles artwork submissions.

Live site: <https://pepepaint.journeypaint.fun>

## Features

- Image-based brushes and custom fonts
- Adjustable brush size and opacity
- Keyboard-controlled effects, filters, transforms, and randomisation
- Undo and redo
- Canvas export

## Run locally

The project is static, so it can be served by any local HTTP server. From the project root, for example:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

You can also use an editor-provided static server. No package installation or build command is required.

## Project structure

```text
index.html   UI layout and controls
styles.css  Application styling
main.js     Drawing logic, brushes, canvas pipeline, and events
filters.js  Image and canvas filters
traits.js   Artwork trait calculations
brushes/    Brush image assets
fonts/      Custom font assets
backend/    Submission API, email delivery, archive, and deployment examples
```

## Development workflow

1. Create a branch from `main`.
2. Make and test changes locally.
3. Commit the changes and push the branch to GitHub.
4. Open a pull request for review before merging into `main`.

For a small change made directly on `main`:

```sh
git add .
git commit -m "Describe the change"
git push
```

There are currently no automated tests. Manually verify brush previews, drawing behaviour, keyboard controls, filters, undo/redo, and image export in a browser.

See [CONTRIBUTING.md](CONTRIBUTING.md) for more detail and [AGENTS.md](AGENTS.md) for project-specific coding guidance.

## Production deployment

Production is hosted at <https://pepepaint.journeypaint.fun> on the same VPS as JourneyPaint, but uses an isolated deployment user, web directory, Nginx site, and TLS certificate.

Every push to `main` triggers the [Deploy PEPEPAINT workflow](.github/workflows/deploy.yml). The workflow:

1. Checks out the committed `main` branch.
2. Authenticates to the VPS with a dedicated deployment key stored as a GitHub Actions secret.
3. Synchronises the frontend files to `/var/www/pepepaint/current`.
4. Synchronises the backend runtime files to `/var/www/pepepaint/backend` without touching its environment or archive.
5. Installs locked production dependencies and restarts `pepepaint-submissions.service` through a narrowly scoped sudo rule.
6. Verifies the website, `traits.js`, and the public API health endpoint.

The workflow deploys these frontend files:

```text
index.html
main.js
filters.js
traits.js
styles.css
brushes/
fonts/
```

Repository documentation, Git metadata, workflow files, and local environment files are not deployed.

Deployment runs and logs are available in the repository's **Actions** tab. A successful Git push does not by itself prove that deployment succeeded, so check the latest workflow run after production changes.

### Manual deployment

The workflow can also be started from GitHub:

1. Open **Actions**.
2. Select **Deploy PEPEPAINT**.
3. Choose **Run workflow** on the `main` branch.

### Rollback

To undo a deployed change without rewriting Git history:

```sh
git log --oneline
git revert <commit-hash>
git push
```

The revert commit triggers a new deployment. If deployment fails, investigate the failed Actions run before making unrelated changes.

### Deployment security

- Never commit deployment keys, `.env` files, API tokens, or passwords.
- The `PEPEPAINT_DEPLOY_KEY` secret must contain only the dedicated PEPEPAINT deployment key.
- If that key is exposed, replace the GitHub secret and remove the corresponding public key from the VPS.
- Changes to Nginx, DNS, certificates, users, or server permissions are not managed by the deployment workflow and require deliberate server administration.

## Submission backend

The frontend sends `multipart/form-data` to `POST /api/submissions`. A submission contains the title, description, editions, Tezos wallet address, selected trait values, and either a PNG or GIF. Animated artwork is submitted as GIF; other artwork is submitted as PNG. Submission GIFs use at most 32 evenly spaced frames, with their delay adjusted to preserve the animation cycle while remaining safely within email attachment limits. Downloaded GIFs retain their full export frame count.

The backend validates the request, writes the artwork, `submission.json`, and
`delivery.json` into a private staging directory, syncs them, and atomically
publishes the complete directory as the browser-generated UUID. The delivery
record is a durable filesystem outbox. Resend email and a private Telegram
channel are supported. Submission never clears the canvas or its IndexedDB
save; only the form fields reset after a delivered or safely queued response.

Delivery state moves from `pending` to `processing` under a durable owner and
expiry lease, then to `delivered`, back to `pending` with bounded exponential
backoff, or to `dead_letter` after a permanent provider error or the configured
attempt limit. Per-UUID work is serialized in-process and the filesystem lease
coordinates concurrent processes. Every Resend retry uses the same
`pepepaint-<uuid>` idempotency key. The service scans due records before it
starts listening and periodically afterward, so a browser retry is not needed
after a restart.

`POST /api/submissions` returns `201` when a new archive is delivered during
the request and `200` for an already delivered UUID. If a transient provider
failure leaves the complete archive queued, it returns `202` with
`status: "queued"`; the frontend treats that as safely received, resets only
the form, and does not encourage a duplicate retry. A durable dead-letter
record returns `502` with `status: "failed"` and requires operator review.

The public submission boundary validates complete PNG/GIF container structure,
integrity, dimensions, decompressed PNG rows, GIF image streams, and frame count.
It also applies per-IP rate limits, a global in-process concurrency ceiling, a
total archive capacity limit, and optional age-based retention. Production
should additionally use the Nginx request and connection zones in
`backend/deploy/`; application limits are defense in depth, not a substitute
for a reverse-proxy boundary.

Only these trait values are submitted and archived:

- Croakage: `value`
- RSi: `value`
- Quietus elapsed time: `formatted`
- Quietus: percentage of 100 years
- Wanderlust: `value`
- Chaos: `value`
- Brushiness: `value`

### Run the backend locally

Requires Node.js 20.6 or newer.

```sh
cd backend
npm ci
cp .env.example .env
```

Set either the Resend variables, the Telegram variables, or both, then run:

```sh
npm start
```

The service listens on `127.0.0.1:3101` by default and also serves the frontend for local testing. Run backend tests with `npm test`.

### Production setup

Keep the API isolated from JourneyPaint with its own process, private localhost port, environment file, logs, archive directory, and Nginx `/api` route. Do not put the Resend API key or destination email in browser JavaScript.

Example systemd and Nginx configurations are in `backend/deploy/`. The production environment should set:

```text
PORT=3101
APP_ENV=production
RESEND_API_KEY=...
SUBMISSION_FROM_EMAIL=PEPEPAINT <submissions@pepepaint.journeypaint.fun>
SUBMISSION_TO_EMAIL=your-private-address@example.com
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=-1001234567890
SUBMISSION_STORAGE_ROOT=/var/lib/pepepaint/submissions
SUBMISSION_MAX_FILE_BYTES=12582912
SUBMISSION_MAX_ARTWORK_WIDTH=400
SUBMISSION_MAX_ARTWORK_HEIGHT=560
SUBMISSION_MAX_ARTWORK_PIXELS=224000
SUBMISSION_MAX_GIF_FRAMES=32
SUBMISSION_RATE_LIMIT_WINDOW_MS=900000
SUBMISSION_RATE_LIMIT_MAX=5
SUBMISSION_RATE_LIMIT_MAX_CLIENTS=10000
SUBMISSION_CONCURRENT_MAX=2
SUBMISSION_DELIVERY_LEASE_MS=120000
SUBMISSION_DELIVERY_TIMEOUT_MS=60000
SUBMISSION_OUTBOX_INTERVAL_MS=30000
SUBMISSION_OUTBOX_BATCH_SIZE=20
SUBMISSION_RETRY_BASE_DELAY_MS=5000
SUBMISSION_RETRY_MAX_DELAY_MS=900000
SUBMISSION_RETRY_MAX_ATTEMPTS=10
SUBMISSION_STAGING_MAX_AGE_MS=3600000
SUBMISSION_STORAGE_MAX_BYTES=5368709120
SUBMISSION_STORAGE_RETENTION_DAYS=0
```

The defaults use a two-minute lease and a one-minute provider request timeout,
scan up to 20 archives every 30 seconds,
and retry after 5 seconds with exponential backoff capped at 15 minutes for up
to 10 attempts. Network errors, HTTP 408/409/425/429, and 5xx responses are
retryable; other provider 4xx responses are permanent. An expired lease is
reclaimed automatically. Staging directories abandoned for an hour are
removed; published UUID directories are never overwritten.

`SUBMISSION_STORAGE_RETENTION_DAYS=0` disables automatic deletion. Before
enabling retention, agree the archive/backup policy and monitor available disk
space. Retention never removes pending or processing outbox work. A full
configured archive returns HTTP 507 without calling Resend or Telegram.

For recovery, inspect `<storage-root>/<uuid>/delivery.json` and service logs.
Pending work resumes automatically on startup. For `dead_letter`, first fix the
provider/configuration problem and preserve a backup of the UUID directory;
then an operator may atomically replace `delivery.json` with the failed target
set back to `pending`, `status` set to `pending`, `lease` cleared, and
`next_attempt_at` set to the current time. Do not edit or delete the artwork or
`submission.json`, and keep the original UUID so Resend retains its stable
idempotency key.

The workflow deploys the backend runtime and restarts its service, but does not deploy secrets, server configuration, tests, or archived submissions. Do not place the backend archive beneath the public Nginx document root.

## License and bundled assets

The project source code is available under the [MIT License](LICENSE).

The `fonts/` and `brushes/` directories include bundled third-party or derivative assets that may be subject to separate copyright, trademark, or font-license terms. Their inclusion in this repository does not grant rights beyond those provided by their respective owners. Contributors should verify asset rights before adding or reusing bundled assets, particularly for commercial use.
