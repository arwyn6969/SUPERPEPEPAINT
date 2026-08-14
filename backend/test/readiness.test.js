import assert from "node:assert/strict";
import { access, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ReadinessManager, probeArchiveFilesystem } from "../readiness.js";

test("the archive probe creates a missing root, proves atomic replacement, and cleans only its probe", async () => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pepepaint-ready-"));
	const storage_root = path.join(parent, "missing", "submissions");
	await probeArchiveFilesystem(storage_root);
	assert.equal((await lstat(storage_root)).isDirectory(), true);
	assert.deepEqual(await readdir(storage_root), []);
	await writeFile(path.join(storage_root, "existing"), "untouched");
	await probeArchiveFilesystem(storage_root);
	assert.equal(await readFile(path.join(storage_root, "existing"), "utf8"), "untouched");
});

test("the archive probe rejects a regular file and an exact-root symlink", async () => {
	const parent = await mkdtemp(path.join(os.tmpdir(), "pepepaint-ready-invalid-"));
	const file_path = path.join(parent, "file");
	await writeFile(file_path, "x");
	await assert.rejects(probeArchiveFilesystem(file_path));
	const link_path = path.join(parent, "link");
	await import("node:fs/promises").then(({ symlink }) => symlink(parent, link_path));
	await assert.rejects(probeArchiveFilesystem(link_path), (error) => error.code === "UNSAFE_SYMLINK");
});

test("probe failures are cleaned safely and rename failures are detected", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-ready-rename-"));
	const fs = {
		access, lstat, mkdir, open: (await import("node:fs/promises")).open,
		readFile, readdir, rm,
		rename: async () => { throw Object.assign(new Error("rename denied"), { code: "EROFS" }); },
	};
	await assert.rejects(probeArchiveFilesystem(storage_root, { fs }), /rename denied/);
	assert.deepEqual((await readdir(storage_root)).filter((name) => name.startsWith(".readiness-probe-")), []);
});

test("the probe detects create, sync/close, and timeout failures", async () => {
	const native = await import("node:fs/promises");
	const denied_root = path.join(await mkdtemp(path.join(os.tmpdir(), "pepepaint-ready-denied-")), "root");
	await assert.rejects(probeArchiveFilesystem(denied_root, {
		fs: { ...native, mkdir: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } },
	}), /denied/);

	for (const failing_method of ["sync", "close"]) {
		const storage_root = await mkdtemp(path.join(os.tmpdir(), `pepepaint-ready-${failing_method}-`));
		let first_open = true;
		const fs = {
			...native,
			open: async (...arguments_) => {
				const handle = await native.open(...arguments_);
				if (!first_open) return handle;
				first_open = false;
				return {
					writeFile: (...args) => handle.writeFile(...args),
					sync: failing_method === "sync" ? async () => { throw Object.assign(new Error("sync failed"), { code: "EIO" }); } : () => handle.sync(),
					close: failing_method === "close" ? async () => { await handle.close(); throw Object.assign(new Error("close failed"), { code: "EIO" }); } : () => handle.close(),
				};
			},
		};
		await assert.rejects(probeArchiveFilesystem(storage_root, { fs }), new RegExp(`${failing_method} failed`));
		assert.deepEqual((await readdir(storage_root)).filter((name) => name.startsWith(".readiness-probe-")), []);
	}

	const timeout_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-ready-timeout-"));
	await assert.rejects(probeArchiveFilesystem(timeout_root, {
		timeout_ms: 10,
		fs: { ...native, open: async () => new Promise(() => {}) },
	}), (error) => error.code === "PROBE_TIMEOUT");
});

test("readiness probes are non-overlapping and a later success recovers service state", async () => {
	let calls = 0;
	let fail = true;
	const manager = new ReadinessManager({
		storage_root: "/unused",
		probe_interval_ms: 1_000,
		logger: { error() {} },
		probe: async () => {
			calls += 1;
			await new Promise((resolve) => setTimeout(resolve, 5));
			if (fail) throw Object.assign(new Error("read only"), { code: "EROFS" });
		},
	});
	await assert.rejects(Promise.all([manager.runProbe(), manager.runProbe()]));
	assert.equal(calls, 1);
	assert.equal(manager.publicSnapshot().status, "not_ready");
	fail = false;
	await manager.runProbe();
	manager.markWorkerReady();
	assert.equal(manager.publicSnapshot().status, "ready");
	manager.close();
});

test("shutdown invalidates readiness and public snapshots expose no internal reason", async () => {
	const manager = new ReadinessManager({ storage_root: "/unused", probe: async () => {} });
	await manager.initialize();
	manager.markWorkerReady();
	assert.equal(manager.publicSnapshot().status, "ready");
	manager.beginShutdown();
	assert.equal(manager.publicSnapshot().status, "not_ready");
	assert.equal("reason_code" in manager.publicSnapshot(), false);
});
