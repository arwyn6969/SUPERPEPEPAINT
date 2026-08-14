#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

repository=$(cd "$(dirname "$0")/../.." && pwd -P)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/pepepaint-release-test.XXXXXX")
trap 'chmod -R u+w "$temporary" 2>/dev/null || true; rm -rf "$temporary"' EXIT
root="$temporary/root"
storage="$temporary/storage"
tools_directory="$temporary/bin"
mkdir -p "$root/releases" "$root/shared" "$storage" "$tools_directory"
printf '2\n' > "$root/shared/durable-schema-version"
environment_file="$temporary/backend.env"
printf '%s\n' 'APP_ENV=test' "SUBMISSION_STORAGE_ROOT=$storage" 'RESEND_ENABLED=false' 'TELEGRAM_ENABLED=false' > "$environment_file"

id_one="1111111111111111111111111111111111111111-1-1"
id_two="2222222222222222222222222222222222222222-2-1"
id_three="3333333333333333333333333333333333333333-3-1"
timestamp='2026-01-01T00:00:00Z'

node "$repository/deployment/build-release.mjs" "$repository" "$temporary/release-one" "$id_one" "${id_one%%-*}" "$timestamp"
node "$repository/deployment/build-release.mjs" "$repository" "$temporary/release-two" "$id_two" "${id_two%%-*}" "$timestamp"
node "$repository/deployment/build-release.mjs" "$repository" "$temporary/release-three" "$id_three" "${id_three%%-*}" "$timestamp"
if node "$repository/deployment/build-release.mjs" "$repository" "$temporary/release-one" "$id_one" "${id_one%%-*}" "$timestamp" >/dev/null 2>&1; then
	echo 'builder overwrote an existing output directory' >&2
	exit 1
fi
[[ -f "$temporary/release-one/release-manifest.json" && ! -e "$temporary/release-one/README.md" ]]
[[ ! -e "$temporary/release-one/backend/.env" && ! -e "$temporary/release-one/backend/test" && ! -e "$temporary/release-one/backend/deploy" ]]

cp -a "$temporary/release-one" "$root/releases/$id_one"
ln -s "releases/$id_one" "$root/current"
ln -s "releases/$id_one" "$root/previous"

cat > "$tools_directory/npm" <<'EOF'
#!/usr/bin/env bash
set -eu
[[ ${FAIL_NPM:-false} != true ]] || exit 42
if [[ ${1:-} == ci && ${2:-} == --omit=dev ]]; then
	mkdir -p node_modules
	printf '{}\n' > node_modules/.installed-for-test
elif [[ ${1:-} != ls || ${2:-} != --omit=dev ]]; then
	exit 1
fi
EOF
cat > "$tools_directory/sudo" <<'EOF'
#!/usr/bin/env bash
set -eu
[[ ${1:-} == -n ]] && shift
exec "$@"
EOF
cat > "$tools_directory/systemctl" <<'EOF'
#!/usr/bin/env bash
set -eu
[[ ${1:-} == restart || ( ${1:-} == is-active && ${2:-} == --quiet ) ]]
active=$(readlink "$TEST_ROOT/current")
active=${active#releases/}
fail_mode=''
fail_release=''
[[ ! -f "$TEST_ROOT/fail-mode" ]] || fail_mode=$(<"$TEST_ROOT/fail-mode")
[[ ! -f "$TEST_ROOT/fail-release" ]] || fail_release=$(<"$TEST_ROOT/fail-release")
if [[ $fail_mode == restart && $fail_release == "$active" && ${1:-} == restart ]]; then exit 1; fi
exit 0
EOF
cat > "$tools_directory/curl" <<'EOF'
#!/usr/bin/env bash
set -eu
url=${!#}
active=$(readlink "$TEST_ROOT/current")
active=${active#releases/}
fail_mode=''
fail_release=''
[[ ! -f "$TEST_ROOT/fail-mode" ]] || fail_mode=$(<"$TEST_ROOT/fail-mode")
[[ ! -f "$TEST_ROOT/fail-release" ]] || fail_release=$(<"$TEST_ROOT/fail-release")
if [[ $fail_release == "$active" ]]; then
	[[ $fail_mode != liveness || "$url" != http://127.0.0.1:3101/api/health ]] || exit 22
	[[ $fail_mode != readiness || "$url" != http://127.0.0.1:3101/api/ready ]] || exit 22
	[[ $fail_mode != public || "$url" != https://* ]] || exit 22
fi
case "$url" in
	*/api/health) printf '{"status":"ok"}\n' ;;
	*/api/ready) printf '{"status":"ready"}\n' ;;
	*/release-manifest.json) cat "$TEST_ROOT/current/release-manifest.json" ;;
	*) printf 'ok\n' ;;
esac
EOF
cat > "$tools_directory/flock" <<'EOF'
#!/usr/bin/env bash
set -eu
[[ ${LOCK_HELD:-false} != true ]]
EOF
cat > "$tools_directory/mv" <<'EOF'
#!/usr/bin/env bash
set -eu
if [[ ${1:-} == -T ]]; then
	shift
	[[ -L $2 ]] && unlink "$2"
fi
exec /bin/mv "$@"
EOF
cat > "$tools_directory/rm" <<'EOF'
#!/usr/bin/env bash
set -eu
arguments=()
for argument in "$@"; do [[ $argument == --one-file-system ]] || arguments+=("$argument"); done
exec /bin/rm "${arguments[@]}"
EOF
cat > "$tools_directory/stat" <<'EOF'
#!/usr/bin/env bash
set -eu
[[ ${1:-} == -c && ${2:-} == %Y ]]
exec /usr/bin/stat -f %m "$3"
EOF
cat > "$tools_directory/validate-release" <<'EOF'
#!/usr/bin/env bash
set -eu
[[ ${1:-} == staging && ${2:-} =~ ^[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$ ]]
cd "$TEST_ROOT/releases/.staging-$2/backend"
exec "$TEST_NODE" --env-file="$TEST_ENVIRONMENT_FILE" validate-release.js
EOF
chmod +x "$tools_directory"/*

remote=(env NODE_BIN="$(command -v node)" NPM_BIN="$tools_directory/npm" CURL_BIN="$tools_directory/curl" SUDO_BIN="$tools_directory/sudo" SYSTEMCTL_BIN="$tools_directory/systemctl" FLOCK_BIN="$tools_directory/flock" MV_BIN="$tools_directory/mv" RM_BIN="$tools_directory/rm" STAT_BIN="$tools_directory/stat" VALIDATE_RELEASE_BIN="$tools_directory/validate-release" PUBLIC_URL='https://example.invalid' PROBE_DEADLINE_SECONDS=1 TEST_ROOT="$root" TEST_NODE="$(command -v node)" TEST_ENVIRONMENT_FILE="$environment_file" ALLOW_NONDEFAULT_ROOT_FOR_TESTS=true bash "$repository/deployment/remote-release.sh")

if "${remote[@]}" init "$root" '../escape' >/dev/null 2>&1; then echo 'malformed release ID was accepted' >&2; exit 1; fi
stage=$("${remote[@]}" init "$root" "$id_two")
[[ "$stage" == "$root/releases/.staging-$id_two" ]]
cp -a "$temporary/release-two/." "$stage/"
"${remote[@]}" deploy "$root" "$id_two" "$id_one"
[[ $(readlink "$root/current") == "releases/$id_two" ]]
[[ $(readlink "$root/previous") == "releases/$id_one" ]]

stage=$("${remote[@]}" init "$root" "$id_three")
cp -a "$temporary/release-three/." "$stage/"
printf '%s\n' "$id_three" > "$root/fail-release"
printf '%s\n' readiness > "$root/fail-mode"
if "${remote[@]}" deploy "$root" "$id_three" "$id_two"; then
	echo 'failed readiness did not leave deployment status failed' >&2
	exit 1
fi
rm "$root/fail-release" "$root/fail-mode"
[[ $(readlink "$root/current") == "releases/$id_two" ]]
[[ -d "$root/releases/$id_three" ]]

for failure in \
	'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-11-1 restart' \
	'cccccccccccccccccccccccccccccccccccccccc-12-1 liveness' \
	'dddddddddddddddddddddddddddddddddddddddd-13-1 public'; do
	failed_id=${failure%% *}
	failure_mode=${failure##* }
	output="$temporary/release-$failure_mode"
	node "$repository/deployment/build-release.mjs" "$repository" "$output" "$failed_id" "${failed_id%%-*}" "$timestamp"
	stage=$("${remote[@]}" init "$root" "$failed_id")
	cp -a "$output/." "$stage/"
	printf '%s\n' "$failed_id" > "$root/fail-release"
	printf '%s\n' "$failure_mode" > "$root/fail-mode"
	if "${remote[@]}" deploy "$root" "$failed_id" "$id_two"; then
		echo "$failure_mode failure did not trigger a failed rollback transaction" >&2
		exit 1
	fi
	rm "$root/fail-release" "$root/fail-mode"
	[[ $(readlink "$root/current") == "releases/$id_two" && -d "$root/releases/$failed_id" ]]
done

bad_id="4444444444444444444444444444444444444444-4-1"
node "$repository/deployment/build-release.mjs" "$repository" "$temporary/release-bad" "$bad_id" "${bad_id%%-*}" "$timestamp"
stage=$("${remote[@]}" init "$root" "$bad_id")
cp -a "$temporary/release-bad/." "$stage/"
printf 'forbidden\n' > "$stage/backend/.env"
if "${remote[@]}" deploy "$root" "$bad_id" "$id_two" >/dev/null 2>&1; then echo 'forbidden .env was accepted' >&2; exit 1; fi
[[ $(readlink "$root/current") == "releases/$id_two" ]]

checksum_id="5555555555555555555555555555555555555555-5-1"
node "$repository/deployment/build-release.mjs" "$repository" "$temporary/release-checksum" "$checksum_id" "${checksum_id%%-*}" "$timestamp"
stage=$("${remote[@]}" init "$root" "$checksum_id")
cp -a "$temporary/release-checksum/." "$stage/"
printf '\nchanged\n' >> "$stage/main.js"
if "${remote[@]}" deploy "$root" "$checksum_id" "$id_two" >/dev/null 2>&1; then echo 'checksum mismatch was accepted' >&2; exit 1; fi
[[ $(readlink "$root/current") == "releases/$id_two" ]]

npm_fail_id="6666666666666666666666666666666666666666-6-1"
node "$repository/deployment/build-release.mjs" "$repository" "$temporary/release-npm-fail" "$npm_fail_id" "${npm_fail_id%%-*}" "$timestamp"
stage=$("${remote[@]}" init "$root" "$npm_fail_id")
cp -a "$temporary/release-npm-fail/." "$stage/"
if FAIL_NPM=true "${remote[@]}" deploy "$root" "$npm_fail_id" "$id_two" >/dev/null 2>&1; then echo 'dependency failure was accepted' >&2; exit 1; fi
[[ $(readlink "$root/current") == "releases/$id_two" && -d "$stage" ]]

if LOCK_HELD=true "${remote[@]}" rollback "$root" "$id_one" >/dev/null 2>&1; then echo 'server lock did not serialize rollback' >&2; exit 1; fi
"${remote[@]}" rollback "$root" "$id_one"
[[ $(readlink "$root/current") == "releases/$id_one" ]]

printf '3\n' > "$root/shared/durable-schema-version"
if "${remote[@]}" rollback "$root" "$id_two" >/dev/null 2>&1; then echo 'schema-incompatible rollback was accepted' >&2; exit 1; fi
[[ $(readlink "$root/current") == "releases/$id_one" ]]
printf '2\n' > "$root/shared/durable-schema-version"

retained_id="7777777777777777777777777777777777777777-7-1"
unsafe_id="8888888888888888888888888888888888888888-8-1"
incomplete_id="9999999999999999999999999999999999999999-9-1"
outside="$temporary/outside"
mkdir "$outside"
node "$repository/deployment/build-release.mjs" "$repository" "$temporary/release-retained" "$retained_id" "${retained_id%%-*}" "$timestamp"
mkdir "$root/releases/$incomplete_id"
ln -s "$outside" "$root/releases/$unsafe_id"
stage=$("${remote[@]}" init "$root" "$retained_id")
cp -a "$temporary/release-retained/." "$stage/"
RETAIN_ADDITIONAL_RELEASES=0 "${remote[@]}" deploy "$root" "$retained_id" "$id_one"
[[ $(readlink "$root/current") == "releases/$retained_id" ]]
[[ ! -e "$root/releases/$id_two" && ! -e "$root/releases/$id_three" ]]
[[ -d "$root/releases/$incomplete_id" && -L "$root/releases/$unsafe_id" && -f "$root/shared/durable-schema-version" ]]

stale_id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-10-1"
stale_stage=$("${remote[@]}" init "$root" "$stale_id")
"${remote[@]}" cleanup-staging "$root" 3600
[[ -d "$stale_stage" && -f "$root/shared/upload-$stale_id" ]]
touch -t 202001010000 "$stale_stage" "$root/shared/upload-$stale_id"
"${remote[@]}" cleanup-staging "$root" 3600
[[ ! -e "$stale_stage" && ! -e "$root/shared/upload-$stale_id" ]]

rm "$root/current"
ln -s "$outside" "$root/current"
if "${remote[@]}" current-id "$root" >/dev/null 2>&1; then echo 'external current target was accepted' >&2; exit 1; fi

printf 'release script tests passed\n'
