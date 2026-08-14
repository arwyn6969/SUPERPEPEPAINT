#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [directory_arg, release_id, commit_sha, timestamp] = process.argv.slice(2);
if (!directory_arg || !/^[0-9a-f]{40}-[1-9][0-9]{0,19}-[1-9][0-9]{0,5}$/.test(release_id ?? "")) throw new Error("invalid release ID");
if (!/^[0-9a-f]{40}$/.test(commit_sha ?? "") || !release_id.startsWith(`${commit_sha}-`)) throw new Error("release ID and commit mismatch");
const directory = path.resolve(directory_arg);
async function walk(base, prefix = "") {
	const files = [];
	for (const entry of (await readdir(base, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (relative === "backend/node_modules" && entry.isDirectory()) continue;
		if (entry.isSymbolicLink()) throw new Error(`symlink forbidden: ${relative}`);
		if (entry.isDirectory()) files.push(...await walk(path.join(base, entry.name), relative));
		else if (entry.isFile() && relative !== "release-manifest.json") files.push(relative);
		else if (!entry.isFile()) throw new Error(`unsupported path type: ${relative}`);
	}
	return files;
}
const files = {};
for (const relative of await walk(directory)) {
	files[relative] = createHash("sha256").update(await readFile(path.join(directory, relative))).digest("hex");
}
await writeFile(path.join(directory, "release-manifest.json"), `${JSON.stringify({
	manifest_version: 1,
	release_id,
	commit_sha,
	built_at: timestamp,
	runtime: { node_major: 22 },
	durable_schema: { minimum: 1, maximum: 2 },
	files,
}, null, 2)}\n`, { mode: 0o644 });
