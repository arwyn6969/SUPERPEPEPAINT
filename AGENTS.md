# AGENTS.md

Project: PEPEPAINT V1 (static HTML/CSS/JS frontend with a Node.js submission API)

Purpose

- Single-page drawing app with no frontend build step.
- Primary drawing and submission-client logic is in `main.js`; UI is in `index.html`, styling is in `styles.css`, and trait calculations are in `traits.js`.
- The Express backend in `backend/` validates, archives, and emails artwork submissions through Resend.

How to run

- For frontend-only work, open `index.html` in a browser or use a static server.
- For end-to-end submission work, copy `backend/.env.example` to the ignored `backend/.env`, configure development values, then run `npm ci` and `npm start` from `backend/`. The backend also serves the frontend locally.
- Never commit `.env` files, API keys, destination email addresses, deployment keys, or production submission data.

Key files

- `index.html` UI layout and controls.
- `main.js` drawing logic, brushes, canvas pipeline, events.
- `styles.css` UI styling.
- `filters.js` image/canvas filters.
- `traits.js` artwork trait calculations.
- `fonts/` custom fonts (used by text brush).
- `brushes/` and `assets/` image assets (if present).
- `backend/app.js` Express routes, upload limits, rate limiting, and error responses.
- `backend/submissions.js` submission validation, archive records, Resend messages, and delivery.
- `backend/test/` automated backend tests.
- `.github/workflows/deploy.yml` production test and deployment workflow.

Conventions

- Prefer adding new brush logic near existing brush sections in `main.js`.
- Use offscreen canvases for brush previews and performance where possible.
- Keep variable names consistent with existing patterns (snake_case).
- Keep UI controls in `index.html` synced to defaults in `main.js` via `setSlidersAndInputs()`.

Notes

- If you add new controls, wire them through the `.brush_controller` system and update previews.

Submission invariants

- Submit `multipart/form-data` to `POST /api/submissions`. Keep `/api/health` available for deployment and monitoring checks.
- The current form includes title, description, editions, and a valid Tezos wallet address. Keep client and server validation synchronized when fields change.
- Only submit and archive these trait fields unless the product requirements change: `pepeness` value, `number_of_strokes` value, formatted `duration`, `distance_travelled` value, `chaos` value, and `variety` value.
- Submit a PNG for static artwork and a GIF when animation is active. Submission GIFs are capped at 32 evenly sampled frames while preserving the full animation-cycle duration; downloaded GIFs retain their normal full frame count.
- A successful submission resets only the form. Never clear or reset the artwork, drawing state, canvas, or IndexedDB canvas save as part of submission handling.
- Preserve the browser-generated UUID and Resend idempotency key behavior so retries do not send duplicate emails.
- Archive the JSON and artwork before attempting email delivery. Production archives belong outside the public web root and must not be deployed, deleted, or committed.
- Keep file type/signature validation, upload limits, honeypot handling, rate limiting, and escaped email output intact when changing the endpoint.

Deployment

- The frontend deployment uses an explicit `rsync` allowlist in `.github/workflows/deploy.yml`. When adding a new top-level file or asset directory, add it to the frontend `--include` rules; otherwise it will not be deployed and may be removed from production by `--delete`.
- Pushes to `main` automatically test and deploy to `https://pepepaint.journeypaint.fun`; check the GitHub Actions result after pushing. A successful Git push alone does not confirm a successful deployment.
- The workflow must run all checks before configuring SSH or modifying production. Failed checks must leave the currently deployed version running.
- CI uses Node.js 22, runs frontend syntax checks, installs all backend dependencies with `npm ci`, and runs `npm test`. Production uses `npm ci --omit=dev`.
- Backend deployment excludes `.env`, archives, tests, scripts, deployment examples, and `node_modules`. Do not weaken those exclusions without a specific operational reason.
- Production configuration lives on the server, not in Git. The API runs as `pepepaint-submissions.service`, listens privately on `127.0.0.1:3101`, and is exposed through Nginx under `/api/`.
- Do not change DNS, Nginx, TLS, systemd, server users, permissions, retention, or backups as an incidental part of application work.

Testing

- Before committing frontend changes, run `node --check main.js`, `node --check filters.js`, and `node --check traits.js` from the project root.
- Before committing backend or submission changes, run `npm ci` and `npm test` from `backend/`.
- Add or update backend tests whenever submission validation, trait fields, archive structure, email contents, duplicate handling, or accepted artwork formats change.
- Automated backend tests do not cover browser drawing behavior. Manually verify relevant brush previews, drawing behavior, UI controls, canvas persistence, PNG/GIF export, and submission behavior.
- For submission changes, specifically confirm that static submissions send PNG, animated submissions send GIF, successful submission clears only the form, and failed submission preserves the form and artwork for retry.
