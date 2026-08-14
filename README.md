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

The backend validates the request, saves `artwork.png` or `artwork.gif` alongside `submission.json`, and then sends the artwork and submission details through each configured delivery service. Resend email and a private Telegram channel are supported. It uses the browser-generated submission UUID, archived delivery state, and Resend idempotency header to avoid repeat delivery after a retry. Submission never clears the canvas or its IndexedDB save; only the form fields reset after a successful response.

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
```

The workflow deploys the backend runtime and restarts its service, but does not deploy secrets, server configuration, tests, or archived submissions. Do not place the backend archive beneath the public Nginx document root.

## License and bundled assets

The project source code is available under the [MIT License](LICENSE).

The `fonts/` and `brushes/` directories include bundled third-party or derivative assets that may be subject to separate copyright, trademark, or font-license terms. Their inclusion in this repository does not grant rights beyond those provided by their respective owners. Contributors should verify asset rights before adding or reusing bundled assets, particularly for commercial use.
