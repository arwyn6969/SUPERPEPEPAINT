#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

usage() {
	cat <<'EOF'
Usage: migrate-to-versioned-releases.sh --root ROOT --legacy-backend DIR \
  --environment-file FILE --storage-root DIR --release-id ID [--apply]

Without --apply this performs preflight only. Run as an administrator from a
reviewed repository checkout. It never runs from the normal deployment job.
The release ID must be FULL_GIT_SHA-1-1 for the commit matching the live files.
EOF
}
die() { printf 'migration error: %s\n' "$*" >&2; exit 1; }
log() { printf 'migration: %s\n' "$*"; }

root='' legacy_backend='' environment_file='' storage_root='' release_id='' apply=false
while [[ $# -gt 0 ]]; do
	case "$1" in
		--root) root=${2:-}; shift 2 ;;
		--legacy-backend) legacy_backend=${2:-}; shift 2 ;;
		--environment-file) environment_file=${2:-}; shift 2 ;;
		--storage-root) storage_root=${2:-}; shift 2 ;;
		--release-id) release_id=${2:-}; shift 2 ;;
		--apply) apply=true; shift ;;
		--help|-h) usage; exit 0 ;;
		*) usage; die "unknown argument: $1" ;;
	esac
done

[[ "$root" == /* && "$root" != / && -d "$root" && ! -L "$root" ]] || die 'root must be an existing real absolute directory'
[[ "$root" == /var/www/pepepaint ]] || die 'migration root must be the exact production root /var/www/pepepaint'
[[ -d "$root/current" && ! -L "$root/current" ]] || die 'legacy current must be a real directory (migration may already be complete)'
[[ "$legacy_backend" == /* && -d "$legacy_backend" && ! -L "$legacy_backend" ]] || die 'legacy backend must be an existing real absolute directory'
[[ -f "$environment_file" && ! -L "$environment_file" ]] || die 'protected systemd EnvironmentFile must already exist as a regular file'
[[ "$environment_file" == /etc/pepepaint/submissions.env ]] || die 'unexpected production EnvironmentFile path'
[[ "$storage_root" == /* && -d "$storage_root" && ! -L "$storage_root" ]] || die 'shared storage root must already exist as a real absolute directory'
[[ "$storage_root" == /var/lib/pepepaint/submissions ]] || die 'unexpected production storage root path'
[[ "$storage_root" != "$root" && "$storage_root" != "$root"/* ]] || die 'shared storage must be outside the release/web root'
[[ $release_id =~ ^[0-9a-f]{40}-1-1$ ]] || die 'initial release ID must be FULL_GIT_SHA-1-1'
[[ ! -e "$root/shared/durable-schema-version" ]] || die 'durable schema state already exists; inspect the partial migration'
[[ -x /usr/local/sbin/pepepaint-validate-release && ! -L /usr/local/sbin/pepepaint-validate-release ]] || die 'install the reviewed root-owned validation wrapper first'
[[ $(stat -c '%U:%G:%a' /usr/local/sbin/pepepaint-validate-release) == root:root:755 ]] || die 'validation wrapper must be root:root mode 0755'
[[ ! -e "$legacy_backend/.env" ]] || die 'legacy .env still exists; install it as the protected EnvironmentFile, verify it, then securely preserve/remove the legacy copy'
if [[ -d "$legacy_backend/var" ]] && find "$legacy_backend/var" -mindepth 1 -print -quit | grep -q .; then
	die 'legacy backend/var contains data; migrate and verify it under the configured external storage root before continuing'
fi

for required in index.html main.js submission-retry.js traits.js filters.js styles.css; do [[ -f "$root/current/$required" ]] || die "missing legacy frontend file: $required"; done
for required in package.json package-lock.json server.js validate-release.js; do [[ -f "$legacy_backend/$required" ]] || die "missing legacy backend file: $required"; done
if [[ $apply != true ]]; then
	log 'preflight passed; no files or services were changed (rerun with --apply after the documented admin preparation)'
	exit 0
fi

mkdir -p -m 0755 "$root/releases" "$root/shared"
exec 9>"$root/shared/deployment.lock"
flock -n 9 || die 'another deployment or migration holds the server lock'
stage="$root/releases/.staging-$release_id"
release="$root/releases/$release_id"
backup="$root/.legacy-current-$release_id"
[[ ! -e "$stage" && ! -e "$release" && ! -e "$backup" ]] || die 'migration target already exists; inspect it rather than overwriting'
mkdir -m 0700 "$stage" "$stage/backend"
trap 'log "migration stopped; inspect the preserved legacy directories and $stage"' ERR
for name in index.html main.js submission-retry.js traits.js filters.js styles.css; do cp -p "$root/current/$name" "$stage/$name"; done
for name in favicon brushes fonts; do [[ ! -d "$root/current/$name" ]] || cp -a "$root/current/$name" "$stage/$name"; done
for source in "$legacy_backend"/*.js "$legacy_backend"/package.json "$legacy_backend"/package-lock.json; do [[ -f "$source" ]] && cp -p "$source" "$stage/backend/"; done
( cd "$stage/backend" && /usr/bin/npm ci --omit=dev )
script_directory=$(cd "$(dirname "$0")" && pwd -P)
commit_sha=${release_id%%-*}
/usr/bin/node "$script_directory/write-manifest.mjs" "$stage" "$release_id" "$commit_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
chmod -R u=rwX,go=rX "$stage"
/usr/local/sbin/pepepaint-validate-release staging "$release_id"
mv "$stage" "$release"
chmod -R a-w "$release"
( set -o noclobber; printf '2\n' > "$root/shared/durable-schema-version" )
chmod 0644 "$root/shared/durable-schema-version"
mv "$root/current" "$backup"
ln -s "releases/$release_id" "$root/.current.tmp.$$"
mv -T "$root/.current.tmp.$$" "$root/current"
ln -s "releases/$release_id" "$root/.previous.tmp.$$"
mv -T "$root/.previous.tmp.$$" "$root/previous"
log "initial release published and current switched to $release_id"
systemctl restart pepepaint-submissions.service
deadline=$((SECONDS + 60))
verified=false
while (( SECONDS < deadline )); do
	if systemctl is-active --quiet pepepaint-submissions.service \
		&& curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3101/api/health | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' \
		&& curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3101/api/ready | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' \
		&& curl --fail --silent --show-error --max-time 10 https://pepepaint.journeypaint.fun/ >/dev/null \
		&& curl --fail --silent --show-error --max-time 10 https://pepepaint.journeypaint.fun/api/health | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' \
		&& curl --fail --silent --show-error --max-time 10 https://pepepaint.journeypaint.fun/api/ready | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' \
		&& curl --fail --silent --show-error --max-time 10 https://pepepaint.journeypaint.fun/release-manifest.json | grep -Fq "\"release_id\": \"$release_id\""; then
		verified=true
		break
	fi
	sleep 2
done
[[ $verified == true ]] || die "migration verification failed; follow the documented migration rollback using preserved $backup and $legacy_backend"
log "service, private readiness, public readiness, and release identity verified for $release_id"
log "do not remove $backup or $legacy_backend until the migration verification and backup are complete"
