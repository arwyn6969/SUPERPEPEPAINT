#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const RELEASE_PATTERN = /^[0-9a-f]{40}-[1-9][0-9]{0,19}-[1-9][0-9]{0,5}$/;
const frontend_files = ["index.html", "main.js", "submission-retry.js", "traits.js", "filters.js", "styles.css"];
const frontend_directories = ["favicon", "brushes", "fonts"];
const backend_excluded = new Set([".env", "node_modules", "var", "test", "scripts", "deploy"]);

function fail(message) {
	console.error(message);
	process.exit(1);
}

const [source_arg, output_arg, release_id, commit_sha, timestamp] = process.argv.slice(2);
if (!source_arg || !output_arg || !RELEASE_PATTERN.test(release_id ?? "")) fail("Invalid release ID.");
if (!/^[0-9a-f]{40}$/.test(commit_sha ?? "") || !release_id.startsWith(`${commit_sha}-`)) fail("Release ID and commit SHA do not match.");
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp ?? "")) fail("Timestamp must be a UTC ISO-8601 second.");

const source = path.resolve(source_arg);
const output = path.resolve(output_arg);
if (output === source || output.startsWith(`${source}${path.sep}`)) fail("Release output must be outside the source tree.");
try {
	await lstat(output);
	fail("Release output already exists; refusing to overwrite it.");
} catch (error) {
	if (error?.code !== "ENOENT") throw error;
}
await mkdir(path.join(output, "backend"), { recursive: true, mode: 0o755 });

for (const name of frontend_files) {
	await cp(path.join(source, name), path.join(output, name), { errorOnExist: true });
}
for (const name of frontend_directories) {
	await cp(path.join(source, name), path.join(output, name), { recursive: true, filter: (entry) => path.basename(entry) !== ".DS_Store" });
}
for (const entry of await readdir(path.join(source, "backend"), { withFileTypes: true })) {
	if (backend_excluded.has(entry.name) || entry.name.startsWith(".env")) continue;
	if (!entry.isFile()) continue;
	await cp(path.join(source, "backend", entry.name), path.join(output, "backend", entry.name));
}

for (const required of ["backend/package.json", "backend/package-lock.json", "backend/server.js", "backend/validate-release.js"]) {
	await stat(path.join(output, required)).catch(() => fail(`Missing required release file: ${required}`));
}

async function walk(directory, prefix = "") {
	const files = [];
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isSymbolicLink()) fail(`Release contains a symbolic link: ${relative}`);
		if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
		else if (entry.isFile()) files.push(relative);
		else fail(`Release contains an unsupported path type: ${relative}`);
	}
	return files;
}

const files = {};
for (const relative of await walk(output)) {
	const data = await readFile(path.join(output, relative));
	files[relative] = createHash("sha256").update(data).digest("hex");
}
const manifest = {
	manifest_version: 1,
	release_id,
	commit_sha,
	built_at: timestamp,
	runtime: { node_major: 22 },
	durable_schema: { minimum: 1, maximum: 2 },
	files,
};
await writeFile(path.join(output, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
