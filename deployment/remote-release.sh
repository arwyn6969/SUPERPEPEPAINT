#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

release_pattern='^[0-9a-f]{40}-[1-9][0-9]{0,19}-[1-9][0-9]{0,5}$'
staging_pattern='^\.staging-[0-9a-f]{40}-[1-9][0-9]{0,19}-[1-9][0-9]{0,5}$'
default_root='/var/www/pepepaint'
node_bin="${NODE_BIN:-/usr/bin/node}"
npm_bin="${NPM_BIN:-/usr/bin/npm}"
curl_bin="${CURL_BIN:-/usr/bin/curl}"
sudo_bin="${SUDO_BIN:-/usr/bin/sudo}"
systemctl_bin="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"
flock_bin="${FLOCK_BIN:-/usr/bin/flock}"
mv_bin="${MV_BIN:-/usr/bin/mv}"
rm_bin="${RM_BIN:-/usr/bin/rm}"
stat_bin="${STAT_BIN:-/usr/bin/stat}"
service_name="${SERVICE_NAME:-pepepaint-submissions.service}"
validate_release_bin="${VALIDATE_RELEASE_BIN:-/usr/local/sbin/pepepaint-validate-release}"
public_url="${PUBLIC_URL:-https://pepepaint.journeypaint.fun}"
probe_deadline_seconds="${PROBE_DEADLINE_SECONDS:-60}"
retain_additional="${RETAIN_ADDITIONAL_RELEASES:-5}"
allow_nondefault_root="${ALLOW_NONDEFAULT_ROOT_FOR_TESTS:-false}"

usage() {
	cat <<'EOF'
Usage:
  remote-release.sh init ROOT RELEASE_ID
  remote-release.sh deploy ROOT RELEASE_ID EXPECTED_CURRENT_ID
  remote-release.sh rollback ROOT TARGET_RELEASE_ID
  remote-release.sh cleanup-staging ROOT MINIMUM_AGE_SECONDS
  remote-release.sh current-id ROOT

init creates one new upload directory. Upload release contents into the printed
path, then deploy validates, publishes, atomically activates, verifies, and
rolls back automatically on failure. All mutating commands use the server lock.
EOF
}

die() { printf 'deployment error: %s\n' "$*" >&2; exit 1; }
log() { printf 'deployment: %s\n' "$*"; }

validate_root() {
	local root=$1
	[[ "$root" == /* && "$root" != '/' && "$root" != *$'\n'* ]] || die 'deployment root must be a non-root absolute path'
	[[ "$root" == "$default_root" || "$allow_nondefault_root" == true ]] || die "production deployment root must be $default_root"
	[[ -d "$root" && ! -L "$root" ]] || die 'deployment root must be an existing real directory'
	[[ -d "$root/releases" && ! -L "$root/releases" ]] || die 'releases directory is missing or unsafe; run the migration first'
	[[ -d "$root/shared" && ! -L "$root/shared" ]] || die 'shared directory is missing or unsafe; run the migration first'
	local resolved_root resolved_releases
	resolved_root=$(cd "$root" && pwd -P)
	resolved_releases=$(cd "$root/releases" && pwd -P)
	[[ "$resolved_releases" == "$resolved_root/releases" ]] || die 'releases resolves outside the deployment root'
}

validate_release_id() { [[ $1 =~ $release_pattern ]] || die "invalid release ID: $1"; }

release_id_from_pointer() {
	local root=$1 pointer=$2 target
	[[ -L "$root/$pointer" ]] || die "$pointer must be a symbolic link"
	target=$(readlink "$root/$pointer")
	[[ "$target" == releases/* && "$target" != */*/* ]] || die "$pointer has an unsafe target"
	local id=${target#releases/}
	validate_release_id "$id"
	[[ -d "$root/releases/$id" && ! -L "$root/releases/$id" ]] || die "$pointer target is missing or unsafe"
	[[ $(cd "$root/releases/$id" && pwd -P) == "$(cd "$root/releases" && pwd -P)/$id" ]] || die "$pointer resolves outside releases"
	printf '%s\n' "$id"
}

atomic_pointer() {
	local root=$1 pointer=$2 id=$3 temporary
	validate_release_id "$id"
	[[ -d "$root/releases/$id" && ! -L "$root/releases/$id" ]] || die "release does not exist: $id"
	temporary="$root/.${pointer}.tmp.$$.$RANDOM"
	[[ ! -e "$temporary" && ! -L "$temporary" ]] || die 'temporary pointer collision'
	ln -s "releases/$id" "$temporary"
	"$mv_bin" -T "$temporary" "$root/$pointer"
}

verify_manifest() {
	local directory=$1 expected_id=$2
	"$node_bin" --input-type=module - "$directory" "$expected_id" <<'NODE'
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
const [directory, expected] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(path.join(directory, "release-manifest.json"), "utf8"));
if (manifest.manifest_version !== 1 || manifest.release_id !== expected || !expected.startsWith(`${manifest.commit_sha}-`)) throw new Error("manifest identity mismatch");
if (manifest.runtime?.node_major !== 22 || manifest.durable_schema?.minimum !== 1 || manifest.durable_schema?.maximum !== 2) throw new Error("manifest compatibility metadata is invalid");
const forbidden = new Set([".env", ".git", "archives", "backups", "var", "test", "tests", "scripts", "deploy"]);
async function walk(base, prefix = "") {
  const result = [];
  for (const entry of await readdir(base, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (relative === "backend/node_modules" && entry.isDirectory()) continue;
    if (entry.name === "node_modules") throw new Error(`forbidden release path: ${relative}`);
    if (entry.isSymbolicLink()) throw new Error(`symlink forbidden: ${relative}`);
    if (forbidden.has(entry.name) || entry.name.startsWith(".env")) throw new Error(`forbidden release path: ${relative}`);
    if (entry.isDirectory()) result.push(...await walk(path.join(base, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`unsupported path type: ${relative}`);
  }
  return result;
}
for (const required of ["index.html", "main.js", "traits.js", "filters.js", "styles.css", "backend/package.json", "backend/package-lock.json", "backend/server.js", "backend/validate-release.js"]) await lstat(path.join(directory, required));
const actual = (await walk(directory)).filter((name) => name !== "release-manifest.json").sort();
const expectedFiles = Object.keys(manifest.files ?? {}).sort();
if (JSON.stringify(actual) !== JSON.stringify(expectedFiles)) throw new Error("manifest file list mismatch");
for (const relative of expectedFiles) {
  const digest = createHash("sha256").update(await readFile(path.join(directory, relative))).digest("hex");
  if (digest !== manifest.files[relative]) throw new Error(`checksum mismatch: ${relative}`);
}
NODE
}

schema_guard() {
	local root=$1 target=$2 state_file="$root/shared/durable-schema-version" value bounds minimum maximum
	[[ -f "$state_file" && ! -L "$state_file" ]] || die 'durable schema state is missing or unsafe'
	value=$(<"$state_file")
	[[ "$value" =~ ^[1-9][0-9]*$ ]] || die 'durable schema state is invalid'
	bounds=$("$node_bin" --input-type=module - "$root/releases/$target/release-manifest.json" <<'NODE'
import { readFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
console.log(`${manifest.durable_schema.minimum}:${manifest.durable_schema.maximum}`);
NODE
	)
	minimum=${bounds%%:*}
	maximum=${bounds##*:}
	(( value >= minimum && value <= maximum )) || die "release $target cannot safely read durable schema $value"
}

service_action() {
	if [[ $1 == is-active ]]; then "$sudo_bin" -n "$systemctl_bin" is-active --quiet "$service_name"
	else "$sudo_bin" -n "$systemctl_bin" "$1" "$service_name"
	fi
}

probe_once() {
	local expected_id=$1 health ready manifest
	service_action is-active >/dev/null || return 1
	health=$("$curl_bin" --fail --silent --show-error --max-time 5 http://127.0.0.1:3101/api/health) || return 1
	[[ "$health" == *'"status":"ok"'* || "$health" == *'"status": "ok"'* ]] || return 1
	ready=$("$curl_bin" --fail --silent --show-error --max-time 5 http://127.0.0.1:3101/api/ready) || return 1
	[[ "$ready" == *'"status":"ready"'* || "$ready" == *'"status": "ready"'* ]] || return 1
	"$curl_bin" --fail --silent --show-error --max-time 10 "$public_url/" >/dev/null || return 1
	"$curl_bin" --fail --silent --show-error --max-time 10 "$public_url/traits.js" >/dev/null || return 1
	"$curl_bin" --fail --silent --show-error --max-time 10 "$public_url/api/health" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' || return 1
	"$curl_bin" --fail --silent --show-error --max-time 10 "$public_url/api/ready" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' || return 1
	manifest=$("$curl_bin" --fail --silent --show-error --max-time 10 "$public_url/release-manifest.json") || return 1
	[[ "$manifest" == *"\"release_id\": \"$expected_id\""* ]]
}

verify_service() {
	local expected_id=$1 deadline=$((SECONDS + probe_deadline_seconds))
	while (( SECONDS < deadline )); do
		if probe_once "$expected_id"; then return 0; fi
		sleep 2
	done
	return 1
}

restart_and_verify() {
	local expected_id=$1
	service_action restart || return 1
	verify_service "$expected_id"
}

publish_stage() {
	local root=$1 id=$2 stage="$root/releases/.staging-$id" release="$root/releases/$id"
	[[ -d "$stage" && ! -L "$stage" ]] || die 'staging directory is missing or unsafe'
	[[ ! -e "$release" && ! -L "$release" ]] || die 'release ID already exists; refusing to reuse it'
	verify_manifest "$stage" "$id"
	( cd "$stage/backend" && "$npm_bin" ci --omit=dev )
	( cd "$stage/backend" && "$npm_bin" ls --omit=dev )
	chmod -R u=rwX,go=rX "$stage"
	"$sudo_bin" -n "$validate_release_bin" staging "$id"
	verify_manifest "$stage" "$id"
	"$mv_bin" "$stage" "$release"
	chmod -R a-w "$release"
	log "published immutable release $id"
}

activate_transaction() {
	local root=$1 target=$2 expected_current=$3 old failed=0
	verify_manifest "$root/releases/$target" "$target"
	schema_guard "$root" "$target"
	old=$(release_id_from_pointer "$root" current)
	[[ "$expected_current" == '-' || "$old" == "$expected_current" ]] || die "active release changed from expected $expected_current to $old"
	if [[ "$old" == "$target" ]]; then die 'target release is already active'; fi
	atomic_pointer "$root" previous "$old"
	atomic_pointer "$root" current "$target"
	rollback_interrupted_activation() {
		trap - HUP INT TERM
		log "activation interrupted; restoring $old"
		atomic_pointer "$root" current "$old" || true
		restart_and_verify "$old" || log "interrupted-activation rollback also failed verification"
		exit 1
	}
	trap rollback_interrupted_activation HUP INT TERM
	log "activated pointer for $target; restarting backend immediately"
	if ! restart_and_verify "$target"; then failed=1; fi
	if (( failed )); then
		log "verification failed for $target; restoring $old"
		atomic_pointer "$root" current "$old"
		if restart_and_verify "$old"; then
			trap - HUP INT TERM
			log "rollback to $old verified; deployment remains failed"
			exit 1
		fi
		die "rollback to $old also failed verification; both releases were preserved"
	fi
	trap - HUP INT TERM
	log "release $target verified"
}

cleanup_releases() {
	local root=$1 current previous entry id entries keep_count=0
	current=$(release_id_from_pointer "$root" current)
	previous=$(release_id_from_pointer "$root" previous)
	entries=$("$node_bin" --input-type=module - "$root/releases" <<'NODE'
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
const directory = process.argv[2];
const entries = [];
for (const name of await readdir(directory)) {
  if (!/^[0-9a-f]/.test(name)) continue;
  const candidate = path.join(directory, name);
  const details = await lstat(candidate);
  if (details.isDirectory() && !details.isSymbolicLink()) entries.push([details.mtimeMs, candidate]);
}
entries.sort((a, b) => b[0] - a[0]);
for (const [, candidate] of entries) console.log(candidate);
NODE
	) || return 1
	while IFS= read -r entry; do
		[[ -n "$entry" ]] || continue
		id=${entry##*/}
		[[ $id =~ $release_pattern ]] || { log "ignoring unexpected release entry $id"; continue; }
		[[ -d "$entry" && ! -L "$entry" ]] || { log "ignoring unsafe release entry $id"; continue; }
		if ! verify_manifest "$entry" "$id" >/dev/null 2>&1; then log "ignoring incomplete or invalid release $id"; continue; fi
		if [[ "$id" == "$current" || "$id" == "$previous" ]]; then continue; fi
		if (( keep_count < retain_additional )); then ((keep_count += 1)); continue; fi
		chmod -R u+w "$entry"
		"$rm_bin" -rf --one-file-system "$entry"
		log "removed retained release $id"
	done <<< "$entries"
}

with_lock() {
	local root=$1; shift
	exec 9>"$root/shared/deployment.lock"
	"$flock_bin" -n 9 || die 'another deployment or rollback holds the server lock'
	"$@"
}

command_init() {
	local root=$1 id=$2 stage owner
	validate_root "$root"; validate_release_id "$id"
	stage="$root/releases/.staging-$id"
	owner="$root/shared/upload-$id"
	[[ ! -e "$root/releases/$id" && ! -L "$root/releases/$id" ]] || die 'release ID already exists'
	[[ ! -e "$stage" && ! -L "$stage" ]] || die 'staging directory already exists; use a new run attempt'
	[[ ! -e "$owner" && ! -L "$owner" ]] || die 'upload ownership marker already exists'
	mkdir -m 0700 "$stage"
	if ! ( set -o noclobber; printf '%s\n' "$id" > "$owner" ); then rmdir "$stage"; die 'could not create upload ownership marker'; fi
	chmod 0600 "$owner"
	printf '%s\n' "$stage"
}

command_deploy() {
	local root=$1 id=$2 expected=$3
	validate_root "$root"; validate_release_id "$id"
	[[ -f "$root/shared/upload-$id" && ! -L "$root/shared/upload-$id" ]] || die 'upload ownership marker is missing or unsafe'
	"$rm_bin" "$root/shared/upload-$id"
	publish_stage "$root" "$id"
	activate_transaction "$root" "$id" "$expected"
	set +e
	( set -Eeuo pipefail; cleanup_releases "$root" )
	local cleanup_status=$?
	set -e
	if (( cleanup_status != 0 )); then log 'release cleanup failed after successful activation'; fi
}

command_rollback() {
	local root=$1 target=$2 current
	validate_root "$root"; validate_release_id "$target"
	current=$(release_id_from_pointer "$root" current)
	activate_transaction "$root" "$target" "$current"
}

command_cleanup_staging() {
	local root=$1 age=$2 now mtime entry name id owner owner_mtime
	validate_root "$root"
	[[ "$age" =~ ^[1-9][0-9]*$ && "$age" -ge 3600 ]] || die 'minimum staging age must be at least 3600 seconds'
	now=$(date +%s)
	for entry in "$root"/releases/.staging-*; do
		[[ -e "$entry" || -L "$entry" ]] || continue
		name=${entry##*/}
		[[ $name =~ $staging_pattern && -d "$entry" && ! -L "$entry" ]] || { log "ignoring unsafe staging entry $name"; continue; }
		id=${name#.staging-}
		owner="$root/shared/upload-$id"
		if [[ -e "$owner" || -L "$owner" ]]; then
			[[ -f "$owner" && ! -L "$owner" ]] || { log "ignoring staging entry with unsafe owner marker $name"; continue; }
			owner_mtime=$("$stat_bin" -c %Y "$owner")
			if (( now - owner_mtime < age )); then log "retaining staging directory with active upload lease $name"; continue; fi
			"$rm_bin" "$owner"
			log "expired stale upload lease for $name"
		fi
		mtime=$("$stat_bin" -c %Y "$entry")
		if (( now - mtime >= age )); then "$rm_bin" -rf --one-file-system "$entry"; log "removed stale staging directory $name"; fi
	done
}

[[ $# -ge 1 ]] || { usage; exit 2; }
[[ "$probe_deadline_seconds" =~ ^[1-9][0-9]*$ && "$probe_deadline_seconds" -le 600 ]] || die 'probe deadline must be 1 through 600 seconds'
[[ "$retain_additional" =~ ^(0|[1-9][0-9]*)$ && "$retain_additional" -le 100 ]] || die 'release retention must be 0 through 100'
command=$1; shift
case "$command" in
	init) [[ $# -eq 2 ]] || die 'init requires ROOT RELEASE_ID'; validate_root "$1"; with_lock "$1" command_init "$@" ;;
	deploy) [[ $# -eq 3 ]] || die 'deploy requires ROOT RELEASE_ID EXPECTED_CURRENT_ID'; validate_root "$1"; with_lock "$1" command_deploy "$@" ;;
	rollback) [[ $# -eq 2 ]] || die 'rollback requires ROOT TARGET_RELEASE_ID'; validate_root "$1"; with_lock "$1" command_rollback "$@" ;;
	cleanup-staging) [[ $# -eq 2 ]] || die 'cleanup-staging requires ROOT MINIMUM_AGE_SECONDS'; validate_root "$1"; with_lock "$1" command_cleanup_staging "$@" ;;
	current-id) [[ $# -eq 1 ]] || die 'current-id requires ROOT'; validate_root "$1"; release_id_from_pointer "$1" current ;;
	--help|-h|help) usage ;;
	*) usage; die "unknown command: $command" ;;
esac
