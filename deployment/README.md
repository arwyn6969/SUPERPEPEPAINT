# Versioned production releases

Normal deployment is intentionally disabled until the one-time migration below
has converted the legacy live directories. None of these instructions are run
automatically against production by this repository.

## Filesystem and ownership

```text
/var/www/pepepaint/
  current -> releases/<release-id>
  previous -> releases/<release-id>
  releases/
    <release-id>/
      index.html, JavaScript, CSS, favicon/, brushes/, fonts/
      backend/                 source plus locked production node_modules
      release-manifest.json
  shared/
    deployment.lock
    durable-schema-version
    upload-<release-id>         temporary upload lease
/etc/pepepaint/submissions.env                 protected configuration/secrets
/var/lib/pepepaint/submissions/                archives and delivery outbox
```

Only `releases/`, `current`, `previous`, and the two non-secret files in
`shared/` are managed by `pepepaint-deploy`. The environment file is owned by
an administrator, and the service's archive/outbox is owned by `pepepaint`.
Archives, `delivery.json`, leases, readiness probe directories, credentials,
logs, backups, and other runtime state never enter a release. Rollback changes
code pointers only; it never restores, copies, edits, or deletes shared state.

Release IDs have exactly this form:

```text
<40 lowercase hex Git SHA>-<GitHub numeric run ID>-<positive run attempt>
```

The full expression is
`^[0-9a-f]{40}-[1-9][0-9]{0,19}-[1-9][0-9]{0,5}$`. Branches, tags, workflow
inputs, and filesystem paths are not used to derive deployment paths.

## Normal deployment and rollback transaction

All JavaScript checks, frontend tests, deployment tests, backend tests, and the
production dependency audit finish before the workflow configures SSH. The
runner then builds an exact allowlisted payload outside the checkout. Backend
`.env`, `var`, `test`, `scripts`, `deploy`, and `node_modules` are excluded.
The manifest records release/commit identity, UTC build time, Node major,
durable compatibility, an exact file inventory, and SHA-256 for every packaged
file. It contains no environment values, credentials, local paths, or runner
identity.

The remote sequence is:

1. Under the server `flock`, create only
   `releases/.staging-<release-id>` and a private upload-lease marker in
   `shared/`; an existing stage, lease, or release is fatal.
2. Upload into that new directory. An SSH or interrupted-rsync failure cannot
   alter `current`, `previous`, the process, or any complete release.
3. Reacquire the same lock for the entire publication/activation transaction.
4. Enforce required and forbidden paths and verify the manifest inventory and
   every checksum.
5. Run `npm ci --omit=dev` and `npm ls --omit=dev` inside only the stage. A
   narrow root-owned wrapper runs `backend/validate-release.js` as the existing
   `pepepaint` service user against the real environment and archive. It
   parses configuration and reads all durable outbox schemas, but does not bind,
   create probes, start a worker, write state, or contact providers.
6. Verify packaged checksums again, make files read-only to non-owners, and
   atomically rename the stage to `releases/<release-id>`.
7. Refuse activation if `current` changed since upload began, if either pointer
   resolves outside `releases`, or if the durable compatibility guard fails.
8. Atomically replace `previous` with the recorded active target and atomically
   replace `current` using a temporary symlink plus GNU `mv -T`.
9. Immediately restart `pepepaint-submissions.service` and, within a bounded
   60-second deadline, require service activity, private health, private
   readiness, public HTML, `traits.js`, public health/readiness, and a public
   manifest containing the exact new release ID.

The frontend pointer changes immediately; the old Node process continues old
backend code until restart. Adjacent releases must therefore remain protocol
compatible during this short pointer/restart interval. This is not a blue-green
process swap and the workflow does not claim the symlink alone replaces Node.

Any post-switch restart or probe failure atomically restores the exact old
`current`, restarts the service again, and subjects rollback to the same checks.
A verified rollback still exits non-zero so the bad deployment remains visible.
If rollback verification also fails, the workflow exits loudly and preserves
both releases and all mutable state for diagnosis.

Manual rollback uses the **Deploy PEPEPAINT** workflow's `rollback` operation
and an exact release ID copied from `releases/`. It uses the protected production
environment, strict input validation, server lock, compatibility guard, pointer
transaction, restart, and verification above. It does not rebuild or reinstall
the target. An arbitrary path is never accepted.

Inspect production without changing it:

```sh
readlink /var/www/pepepaint/current
readlink /var/www/pepepaint/previous
sed -n '1,20p' /var/www/pepepaint/current/release-manifest.json
```

## Durable rollback compatibility

`shared/durable-schema-version` is a conservative compatibility epoch for the
combined archive/outbox contract, not a copy of either JSON record's internal
version. The initial value is `2`. Current manifests support epochs 1 through 2.
A rollback target must have a valid manifest whose inclusive range contains the
persisted epoch. A release without this metadata is never a rollback candidate.

Durable changes must remain backward-compatible across every retained release.
If a future change is not backward-compatible, increment the shared epoch only
as a separately reviewed data migration and update manifest ranges accurately.
The deployment script will then refuse an old binary rather than downgrade
records. Never restore an older archive, remove newer fields, or reset delivery
state as part of code rollback. There is no general data-down migration system,
so the guard is deliberately conservative.

## Retention and stale uploads

After successful activation only, cleanup keeps `current`, `previous`, and the
five most recently modified additional complete, checksum-valid releases by
default. Set `RETAIN_ADDITIONAL_RELEASES` to a non-negative integer to adjust
this. Invalid directories, symlinks, unexpected path types, and incomplete
releases are logged and retained. Cleanup failure is reported but does not undo
a verified deployment. No cleanup code examines paths outside the exact
`releases` directory or follows symlinks.

Interrupted uploads are not removed by normal retention. With no deployment or
rollback running, an operator can use the same reviewed script and server lock:

```sh
ssh pepepaint-deploy@87.106.69.245 \
  'bash -s -- cleanup-staging /var/www/pepepaint 86400' \
  < deployment/remote-release.sh
```

Only strict `.staging-<release-id>` real directories at least the requested age
(minimum one hour) are removed. A matching upload-lease marker prevents cleanup
until that lease is also older than the threshold; the normal deploy consumes
the marker under the lock before validation. Active lock contention is fatal.

## One-time administrator migration

Review and back up the live filesystem first. Do not run the migration from
GitHub Actions. Confirm the deployed commit SHA and use `<sha>-1-1` for the
initial release. The script has a read-only preflight unless `--apply` is given.

Administrator preparation:

1. Confirm `/var/www/pepepaint/current` and `/var/www/pepepaint/backend` are the
   expected real legacy directories, their ownership is understood, and no
   symlink resolves elsewhere.
2. Back up the legacy frontend/backend, `/etc/pepepaint/submissions.env`, and
   `/var/lib/pepepaint/submissions` using the existing production backup policy.
3. Move any legacy `backend/.env` into
   `/etc/pepepaint/submissions.env` with owner `root`, a deliberately selected
   restricted group, mode `0640`, then verify it before preserving/removing the
   old copy. The migration refuses while `backend/.env` exists.
4. Move and verify any legacy `backend/var` archive beneath the configured
   `SUBMISSION_STORAGE_ROOT` (`/var/lib/pepepaint/submissions` in the example).
   The migration refuses a non-empty legacy `var`.
5. Ensure the archive is a real directory owned by `pepepaint:pepepaint`, mode
   `0700`, and outside `/var/www/pepepaint`.
6. Install `deployment/pepepaint-validate-release` as
   `/usr/local/sbin/pepepaint-validate-release`, owned by `root:root` and mode
   `0755`. Separately approve exactly one additional sudoers command for
   `pepepaint-deploy`:

   ```sh
   install -o root -g root -m 0755 deployment/pepepaint-validate-release /usr/local/sbin/pepepaint-validate-release
   ```

   ```text
   pepepaint-deploy ALL=(root) NOPASSWD: /usr/local/sbin/pepepaint-validate-release staging *
   ```

   The root-owned wrapper accepts one strictly validated release ID, resolves
   only the matching stage under the fixed production root, clears inherited
   environment variables, and invokes Node as `pepepaint`. The deployment user
   receives no direct access to the EnvironmentFile or archive. Do not make the
   wrapper writable by the deployment or service users.
7. Install the reviewed service example so `WorkingDirectory` and `ExecStart`
   use `/var/www/pepepaint/current/backend`, retain
   `EnvironmentFile=/etc/pepepaint/submissions.env`, retain the external
   `ReadWritePaths`, use `Restart=on-abnormal` so invalid configuration does not
   loop, and use `TimeoutStopSec=150`. Run `systemd-analyze verify`
   and `systemctl daemon-reload`; do not restart yet.
8. Confirm Nginx's document root remains `/var/www/pepepaint/current`, the Nginx
   user may traverse release directories, and `/api/health` plus `/api/ready`
   match the reviewed examples. Run `nginx -t`. A reload is needed only if the
   configuration changed.

Run preflight, then the same command with `--apply`:

```sh
sudo deployment/migrate-to-versioned-releases.sh \
  --root /var/www/pepepaint \
  --legacy-backend /var/www/pepepaint/backend \
  --environment-file /etc/pepepaint/submissions.env \
  --storage-root /var/lib/pepepaint/submissions \
  --release-id <full-git-sha>-1-1
```

The script assembles and validates a new release without touching the live
frontend, publishes it, preserves the legacy frontend at
`.legacy-current-<release-id>`, then establishes `current` and `previous`.
The script restarts the service and verifies `is-active`, localhost health and
readiness, public HTML/health/readiness, and the public manifest. Only after
verification should the administrator run these exact ownership changes
(use an equivalent narrow ACL instead if local policy requires it):

```sh
chown -R pepepaint-deploy:pepepaint-deploy /var/www/pepepaint/releases /var/www/pepepaint/shared
setfacl -m u:pepepaint-deploy:rwx /var/www/pepepaint
```

The root-directory ACL is needed only to create and atomically replace the two
pointer entries; it does not grant access to `/etc` or `/var/lib`. Routine
sudoers rules are limited to:

```text
/usr/bin/systemctl restart pepepaint-submissions.service
/usr/bin/systemctl is-active --quiet pepepaint-submissions.service
/usr/local/sbin/pepepaint-validate-release staging *
```

The validator rule is the sole additional permission and requires separate
approval. No Nginx, daemon-reload, filesystem, shell, `runuser`, Node, or
arbitrary systemctl sudo right is needed for routine releases.

Migration rollback before acceptance: stop the service, remove only the newly
created `current` and `previous` symlinks after verifying their exact targets,
rename `.legacy-current-<release-id>` back to `current`, restore the prior
systemd unit and legacy backend working directory, run
`systemd-analyze verify`, `daemon-reload`, restart, and repeat private/public
health checks. Preserve the new release, environment, archives, and outbox for
investigation; never restore mutable state merely because code migration failed.

## Failure handling

Before pointer activation, test, SSH, upload, dependency, required-file,
forbidden-file, checksum, configuration, publication, stale-job, and lock
failures leave the running release untouched. After activation, service,
liveness, readiness, public frontend, public API, and manifest failures trigger
automatic rollback. Cleanup failure does not roll back a healthy release.

If both deployment and rollback verification fail, do not edit the archive or
outbox and do not delete either release. An administrator should inspect
`readlink current`, both manifests, `systemctl status`, `journalctl -u
pepepaint-submissions.service`, localhost health/readiness, Nginx logs, capacity,
and permissions. Restore a known compatible pointer under the deployment lock,
restart, and verify. Changing systemd/Nginx or durable schema remains an explicit
administrator operation.
