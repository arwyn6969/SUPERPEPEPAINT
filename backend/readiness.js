import { randomUUID } from "node:crypto";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { syncDirectory, writeJsonAtomic } from "./delivery-outbox.js";

const PROBE_PREFIX = ".readiness-probe-";

function timeoutError() {
	const error = new Error("Readiness filesystem probe timed out.");
	error.code = "PROBE_TIMEOUT";
	return error;
}

export async function probeArchiveFilesystem(storage_root, options = {}) {
	const fs = options.fs ?? fsPromises;
	const timeout_ms = options.timeout_ms ?? 5_000;
	const probe_directory = path.join(storage_root, `${PROBE_PREFIX}${randomUUID()}`);
	let created = false;
	const operation = (async () => {
		await fs.mkdir(storage_root, { recursive: true, mode: 0o700 });
		const root_stat = await fs.lstat(storage_root);
		if (root_stat.isSymbolicLink()) throw Object.assign(new Error("Archive root cannot be a symbolic link."), { code: "UNSAFE_SYMLINK" });
		if (!root_stat.isDirectory()) throw Object.assign(new Error("Archive root is not a directory."), { code: "NOT_DIRECTORY" });
		await fs.mkdir(probe_directory, { mode: 0o700 });
		created = true;
		const pending_path = path.join(probe_directory, "archive.pending");
		const published_path = path.join(probe_directory, "archive.published");
		const handle = await fs.open(pending_path, "wx", 0o600);
		try {
			await handle.writeFile("pepepaint-readiness\n", "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await fs.rename(pending_path, published_path);
		if ((await fs.readFile(published_path, "utf8")) !== "pepepaint-readiness\n") {
			throw Object.assign(new Error("Archive probe readback failed."), { code: "READBACK_FAILED" });
		}
		await writeJsonAtomic(path.join(probe_directory, "delivery.json"), { probe: 1 }, {
			open_impl: fs.open.bind(fs),
			rename_impl: fs.rename.bind(fs),
			rm_impl: fs.rm.bind(fs),
			sync_directory: false,
		});
		await writeJsonAtomic(path.join(probe_directory, "delivery.json"), { probe: 2 }, {
			open_impl: fs.open.bind(fs),
			rename_impl: fs.rename.bind(fs),
			rm_impl: fs.rm.bind(fs),
			sync_directory: false,
		});
		if (fs === fsPromises) await syncDirectory(probe_directory);
	})();
	let timer;
	try {
		await Promise.race([
			operation,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(timeoutError()), timeout_ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
		if (created) await fs.rm(probe_directory, { recursive: true, force: true }).catch(() => {});
		if (fs === fsPromises) await syncDirectory(storage_root).catch(() => {});
	}
}

export class ReadinessManager {
	constructor(options) {
		this.storage_root = options.storage_root;
		this.probe = options.probe ?? probeArchiveFilesystem;
		this.probe_options = { timeout_ms: options.probe_timeout_ms };
		this.capacity_check = options.capacity_check ?? (async () => false);
		this.interval_ms = options.probe_interval_ms ?? 30_000;
		this.clock = options.clock ?? { now: () => Date.now() };
		this.logger = options.logger ?? console;
		this.configuration_ok = true;
		this.archive_ok = false;
		this.outbox_ok = false;
		this.worker_ok = false;
		this.shutting_down = false;
		this.storage_full = false;
		this.delivery_degraded = false;
		this.reason_code = "starting";
		this.last_successful_probe_at = null;
		this.last_failed_probe_at = null;
		this.probe_promise = null;
		this.timer = null;
	}

	get ready() {
		return this.configuration_ok && this.archive_ok && this.outbox_ok && this.worker_ok && !this.shutting_down && !this.storage_full;
	}

	async initialize() {
		await this.runProbe();
	}

	markWorkerReady() {
		this.worker_ok = true;
		if (this.ready) this.reason_code = "ready";
	}

	markStorageFull(full = true) {
		this.storage_full = full;
		if (full) {
			this.reason_code = "storage_full";
			this.startRecovery();
		}
	}

	markDeliveryDegraded(degraded = true) {
		this.delivery_degraded = degraded;
	}

	markDurabilityFailure(reason_code = "durability_fault", error) {
		this.archive_ok = false;
		this.outbox_ok = false;
		this.reason_code = reason_code;
		this.last_failed_probe_at = new Date(this.clock.now()).toISOString();
		this.logger.error?.("Readiness lost", { reason: reason_code, code: error?.code ?? "UNKNOWN" });
		this.startRecovery();
	}

	startRecovery() {
		if (this.timer || this.shutting_down) return;
		this.timer = setInterval(() => void this.runProbe().catch(() => {}), this.interval_ms);
		this.timer.unref?.();
	}

	async runProbe() {
		if (this.probe_promise) return this.probe_promise;
		this.probe_promise = (async () => {
			try {
				await this.probe(this.storage_root, this.probe_options);
				this.archive_ok = true;
				this.outbox_ok = true;
				this.storage_full = await this.capacity_check();
				this.last_successful_probe_at = new Date(this.clock.now()).toISOString();
				this.reason_code = this.storage_full ? "storage_full" : (this.ready ? "ready" : this.reason_code);
				if (this.storage_full) this.startRecovery();
				else {
					if (this.timer) clearInterval(this.timer);
					this.timer = null;
				}
			} catch (error) {
				this.archive_ok = false;
				this.outbox_ok = false;
				this.reason_code = error?.code === "PROBE_TIMEOUT" ? "probe_timeout" : "archive_unavailable";
				this.last_failed_probe_at = new Date(this.clock.now()).toISOString();
				throw error;
			}
		})();
		try {
			return await this.probe_promise;
		} finally {
			this.probe_promise = null;
		}
	}

	beginShutdown() {
		this.shutting_down = true;
		this.reason_code = "shutting_down";
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	close() {
		this.beginShutdown();
	}

	publicSnapshot() {
		return {
			status: this.ready ? "ready" : "not_ready",
			checks: {
				configuration: this.configuration_ok ? "ok" : "failed",
				archive: this.archive_ok && !this.storage_full ? "ok" : "failed",
				outbox: this.outbox_ok && this.worker_ok ? "ok" : "failed",
				delivery: this.delivery_degraded ? "degraded" : "ok",
			},
		};
	}

	internalSnapshot() {
		return {
			...this.publicSnapshot(),
			reason_code: this.reason_code,
			last_successful_probe_at: this.last_successful_probe_at,
			last_failed_probe_at: this.last_failed_probe_at,
			shutting_down: this.shutting_down,
			storage_full: this.storage_full,
		};
	}
}
