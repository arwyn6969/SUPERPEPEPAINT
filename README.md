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

Run `npm test` at the repository root for submission-retry client tests. Manually verify brush previews, drawing behaviour, keyboard controls, filters, undo/redo, and image export in a browser.

See [CONTRIBUTING.md](CONTRIBUTING.md) for more detail and [AGENTS.md](AGENTS.md) for project-specific coding guidance.

## Production deployment

Production is hosted at <https://pepepaint.journeypaint.fun> on the same VPS as JourneyPaint, but uses an isolated deployment user, web directory, Nginx site, and TLS certificate.

Every push to `main` triggers the [Deploy PEPEPAINT workflow](.github/workflows/deploy.yml). After the one-time versioned-release migration, the workflow:

1. Checks out the committed `main` branch.
2. Completes all frontend, backend, deployment-script, and dependency-audit checks before configuring SSH.
3. Builds and checksums one allowlisted frontend/backend release identified by the full Git SHA and GitHub run metadata.
4. Uploads and validates it in a new same-filesystem staging directory without changing the live release.
5. Atomically switches `current`, restarts the backend, and verifies private and public health/readiness plus the exact public release manifest.
6. Automatically restores, restarts, and verifies the previous release if any post-activation check fails.

The workflow deploys these frontend files:

```text
index.html
main.js
submission-retry.js
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

### Versioned releases and rollback

Frontend and backend are deployed as one immutable compatibility unit under
`/var/www/pepepaint/releases`; configuration and the archive/outbox remain
external. Manual rollback selects an existing exact release ID through the
protected workflow and uses the same lock, compatibility guard, atomic pointer
operation, restart, and readiness checks as automatic rollback.

The complete filesystem layout, release ID format, transaction, retention,
failure recovery, minimal administrator changes, and one-time migration are in
[deployment/README.md](deployment/README.md). The migration is deliberately not
run by the normal workflow.

### Deployment security

- Never commit deployment keys, `.env` files, API tokens, or passwords.
- The `PEPEPAINT_DEPLOY_KEY` secret must contain only the dedicated PEPEPAINT deployment key.
- If that key is exposed, replace the GitHub secret and remove the corresponding public key from the VPS.
- Changes to Nginx, DNS, certificates, users, or server permissions are not managed by the deployment workflow and require deliberate server administration.

## Submission backend

The frontend sends `multipart/form-data` to `POST /api/submissions`. A submission contains the title, description, editions, Tezos wallet address, selected trait values, and either a PNG or GIF. Animated artwork is submitted as GIF; other artwork is submitted as PNG. Submission GIFs use at most 32 evenly spaced frames, with their delay adjusted to preserve the animation cycle while remaining safely within email attachment limits. Downloaded GIFs retain their full export frame count.

Before artwork encoding begins, the browser persists a UUID and `preparing`
record in the `submission_attempts` IndexedDB store. Before the first request,
it adds the exact encoded artwork Blob, its SHA-256 digest, normalized form
fields, accepted traits, filename/type/size, timestamps, and attempt metadata,
then moves the record to `ready`. Requests move through `sending` and then to
`uncertain`, `archived_queued`, `delivered`, or `rejected`. Reloading a
`sending` record after its send lease expires makes it `uncertain` (`draft` is
represented by no submission record); retries
always reconstruct the multipart body from the frozen record and reuse its
UUID. There is no automatic retry loop. A user must explicitly dismiss a
terminal record or abandon a pending record before a new UUID can be created.
Abandoning an uncertain record warns that the server may already have accepted
it. Web Locks and an expiring IndexedDB lease coordinate tabs, with server
idempotency as the final safeguard.

The backend validates the request, writes the artwork, `submission.json`, and
`delivery.json` into a private staging directory, syncs them, and atomically
publishes the complete directory as the browser-generated UUID. The delivery
record is a durable filesystem outbox. Resend email and a private Telegram
channel are supported. Submission never clears the canvas or its IndexedDB
save; only the form fields reset after a delivered or safely queued response.
The archive stores a server-computed fingerprint of every accepted field plus
the exact artwork bytes. Reusing a UUID with different content returns `409`
without overwriting the archive or starting another delivery.

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
`status: "queued"`; `delivery_status` distinguishes pending, throttled, and
uncertain provider delivery without making the browser retry an already
archived submission. The frontend treats that as safely received, resets only
the form, and does not encourage a duplicate retry. Older backend responses
using `status: "uncertain"` after confirmed archival are handled the same way
for compatibility. A durable dead-letter
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

Set `RESEND_ENABLED=true`, `TELEGRAM_ENABLED=true`, or both and complete every
variable for each enabled provider, then run:

```sh
npm start
```

The service listens on `127.0.0.1:3101` by default and also serves the frontend for local testing. Run backend tests with `npm test`.

### Production setup

Keep the API isolated from JourneyPaint with its own process, private localhost port, environment file, logs, archive directory, and Nginx `/api` route. Do not put the Resend API key or destination email in browser JavaScript.

Example systemd and Nginx configurations are in `backend/deploy/`. The production environment should set:

```text
PORT=3101
BIND_HOST=127.0.0.1
APP_ENV=production
RESEND_ENABLED=true
RESEND_API_KEY=...
SUBMISSION_FROM_EMAIL=PEPEPAINT <submissions@pepepaint.journeypaint.fun>
SUBMISSION_TO_EMAIL=your-private-address@example.com
TELEGRAM_ENABLED=true
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
SUBMISSION_DELIVERY_TIMEOUT_MS=30000
SUBMISSION_OUTBOX_INTERVAL_MS=30000
SUBMISSION_OUTBOX_BATCH_SIZE=20
SUBMISSION_RETRY_BASE_DELAY_MS=5000
SUBMISSION_RETRY_MAX_DELAY_MS=900000
SUBMISSION_RETRY_MAX_ATTEMPTS=10
SUBMISSION_RETRY_JITTER_PERCENT=20
SUBMISSION_UNCERTAIN_RETRY_DELAY_MS=300000
SUBMISSION_UNCERTAIN_MAX_ATTEMPTS=2
TELEGRAM_RETRY_AFTER_MAX_MS=3600000
SUBMISSION_STAGING_MAX_AGE_MS=3600000
SUBMISSION_STORAGE_MAX_BYTES=5368709120
SUBMISSION_STORAGE_RETENTION_DAYS=0
READINESS_PROBE_INTERVAL_MS=30000
READINESS_PROBE_TIMEOUT_MS=5000
READINESS_RETRY_AFTER_SECONDS=10
```

Production startup validation is strict. `SUBMISSION_STORAGE_ROOT`, explicit
provider enablement, and at least one complete provider are required. Email
requires a structurally valid API key, sender, and destination; Telegram
requires both a structurally valid bot token and numeric chat ID. Invalid
booleans, integers, bounds, retry relationships, undersized leases, placeholder
production values, and a storage quota too small for one maximum submission are
fatal. Development and tests may inject fake provider functions, but normal
production startup never sends a provider test message or makes an authentication
request. Configuration errors name only the environment key and a safe reason.

The archive must be outside the public web root. Before the listener or outbox
worker starts, the service creates the root if needed, rejects a regular file or
an exact-root symbolic link, and uses a uniquely named private probe directory.
It creates and fsyncs a file, atomically renames and reads it back, exercises the
same temporary-file replacement used by `delivery.json`, syncs the directory,
then removes only that exact probe directory. The probe is bounded by
`READINESS_PROBE_TIMEOUT_MS`. A fatal probe, cleanup, schema, or worker-start
failure exits non-zero before HTTP is accepted or provider work begins.

`GET /api/health` is lightweight liveness and retains `{ "status": "ok" }`:
it means the HTTP process can answer, not that submissions are safe to accept.
`GET /api/ready` returns HTTP 200 with `status: "ready"`, or HTTP 503 with
`status: "not_ready"` and sanitized configuration/archive/outbox/delivery check
names. It performs no filesystem or provider work; it reads cached state.
Readiness means configuration is valid, archive and outbox atomic writes work,
the worker initialized, capacity is available, and shutdown has not begun.

Archive/write/rename/outbox faults make readiness false immediately. New
submissions are rejected before multipart buffering with HTTP 503 and a bounded
`Retry-After`; configured hard capacity returns HTTP 507. Browser retries send
the existing UUID in `X-Submission-ID`, allowing an already archived UUID to
receive its stable state through read-only reconciliation even while new writes
are gated. A single non-overlapping, unref'd recovery timer repeats the bounded
probe every `READINESS_PROBE_INTERVAL_MS`; success restores readiness when
capacity is also available. Shutdown marks not-ready before stopping the worker
and HTTP listener.

Provider throttling, backoff, uncertain delivery, queued work, or a temporary
provider outage is delivery degradation, not loss of readiness: the durable
outbox can retain it safely. `/api/ready` may therefore show
`delivery: "degraded"` while still returning 200. A permanent startup configuration error
for an enabled provider is different and is fatal. Diagnose a 503 using the
sanitized service log reason/code and filesystem capacity/permissions; readiness
responses never include credentials, destinations, archive paths, submission
data, stack traces, or raw exceptions.

Startup validates existing outbox schemas before declaring the worker ready,
then defers due provider attempts until initialization has completed. This keeps
corrupt/incompatible durable state startup-fatal without making listener startup
wait on Resend or Telegram.

The defaults use a two-minute lease and a 30-second explicit provider request timeout,
scan up to 20 archives every 30 seconds,
and retry after 5 seconds with exponential backoff capped at 15 minutes for up
to 10 attempts, plus up to 20 percent jitter. HTTP 408/425 and most 5xx
responses and definitive connection/DNS failures are retryable. HTTP 429 is
throttled; Telegram's valid `parameters.retry_after` is honored when it is
longer than local backoff and clamped to one hour. Credential, destination,
payload, media, and most other 4xx errors are permanent. An expired lease is
reclaimed automatically. Staging directories abandoned for an hour are
removed; published UUID directories are never overwritten.

Timeouts or connection loss after transmission may have begun are stored as
`uncertain`, not as confirmed failures. They wait five minutes before another
attempt. Resend retries reuse the immutable `pepepaint-<uuid>` idempotency key;
Resend currently retains keys for 24 hours. Telegram offers no equivalent
general idempotency or send reconciliation API, so a retry can duplicate a
message. After two uncertain Telegram attempts the target enters
`manual_review` instead of retrying without bound. Each provider has independent
attempt, throttle, retry, uncertainty, message-ID, and terminal state. Overall
delivery is `delivered` only when every configured provider is confirmed;
remaining pending/throttled/uncertain work stays queued, and all-terminal
non-success states become `dead_letter`.

`SUBMISSION_STORAGE_RETENTION_DAYS=0` disables automatic deletion. Before
enabling retention, agree the archive/backup policy and monitor available disk
space. Retention never removes pending or processing outbox work. A full
configured archive returns HTTP 507 without calling Resend or Telegram.

For recovery, inspect `<storage-root>/<uuid>/delivery.json` and service logs.
Pending, throttled, and uncertain work resumes from its persisted deadline on
startup. Shutdown aborts active provider requests, records them for a later
retry, releases their filesystem leases, and stops the polling timer. For
`dead_letter`, first fix the
provider/configuration problem and preserve a backup of the UUID directory;
then an operator may atomically replace `delivery.json` with only the affected
target set back to `pending`, its `next_attempt_at` set to the current time,
its throttle and lease cleared, and the overall state derived accordingly.
Never reset a target already marked `delivered`. Do not edit or delete the artwork or
`submission.json`, and keep the original UUID so Resend retains its stable
idempotency key.

The workflow deploys the backend runtime and restarts its service, but does not deploy secrets, server configuration, tests, or archived submissions. Do not place the backend archive beneath the public Nginx document root. Versioned deployment requires the example `/api/ready` Nginx location and the one-time migration in [deployment/README.md](deployment/README.md) to be completed and verified first.

## License and bundled assets

The project source code is available under the [MIT License](LICENSE).

The `fonts/` and `brushes/` directories include bundled third-party or derivative assets that may be subject to separate copyright, trademark, or font-license terms. Their inclusion in this repository does not grant rights beyond those provided by their respective owners. Contributors should verify asset rights before adding or reusing bundled assets, particularly for commercial use.
