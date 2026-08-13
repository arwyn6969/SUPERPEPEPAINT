import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_DIRECTORY = ".delivery-lease";

export async function syncDirectory(directory) {
	let handle;
	try {
		handle = await open(directory, "r");
		await handle.sync();
	} catch (error) {
		if (!new Set(["EINVAL", "ENOTSUP", "EISDIR"]).has(error.code)) throw error;
	} finally {
		await handle?.close();
	}
}

export async function writeJsonAtomic(file_path, value, options = {}) {
	const temporary_path = `${file_path}.${randomUUID()}.tmp`;
	const open_impl = options.open_impl ?? open;
	const rename_impl = options.rename_impl ?? rename;
	const rm_impl = options.rm_impl ?? rm;
	let handle;
	try {
		handle = await open_impl(temporary_path, "wx", 0o600);
		await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
		await handle.sync();
		await handle.close();
		handle = null;
		await rename_impl(temporary_path, file_path);
		if (options.sync_directory !== false) await syncDirectory(path.dirname(file_path));
	} catch (error) {
		await handle?.close().catch(() => {});
		await rm_impl(temporary_path, { force: true }).catch(() => {});
		throw error;
	}
}

export async function writeFileSynced(file_path, value, options = {}) {
	const handle = await open(file_path, options.flag ?? "wx", options.mode ?? 0o600);
	try {
		await handle.writeFile(value, options.encoding ? { encoding: options.encoding } : undefined);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export function createDeliveryRecord(submission_id, targets, now = Date.now()) {
	const timestamp = new Date(now).toISOString();
	return {
		schema_version: 1,
		submission_id,
		status: "pending",
		attempt_count: 0,
		last_error: null,
		next_attempt_at: timestamp,
		lease: null,
		targets: Object.fromEntries(
			targets.map((name) => [name, { status: "pending", message_id: null, method: null, last_error: null, updated_at: timestamp }]),
		),
		created_at: timestamp,
		updated_at: timestamp,
		delivered_at: null,
		dead_lettered_at: null,
	};
}

export async function readDeliveryRecord(storage_root, submission_id) {
	try {
		return JSON.parse(await readFile(path.join(storage_root, submission_id, "delivery.json"), "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

export async function ensureDeliveryRecord(storage_root, record, targets, now = Date.now()) {
	const existing = await readDeliveryRecord(storage_root, record.submission_id);
	if (existing) return existing;
	const delivery = createDeliveryRecord(record.submission_id, targets, now);
	for (const target_name of targets) {
		const legacy = record[`${target_name}_delivery`];
		if (legacy?.status === "sent") {
			delivery.targets[target_name] = {
				status: "delivered",
				message_id: legacy.message_id ?? null,
				method: legacy.method ?? null,
				last_error: null,
				updated_at: legacy.updated_at ?? delivery.created_at,
			};
		}
	}
	if (Object.values(delivery.targets).every((target) => target.status === "delivered")) {
		delivery.status = "delivered";
		delivery.next_attempt_at = null;
		delivery.delivered_at = delivery.created_at;
	}
	const delivery_path = path.join(storage_root, record.submission_id, "delivery.json");
	try {
		await writeFileSynced(delivery_path, `${JSON.stringify(delivery, null, 2)}\n`, { encoding: "utf8" });
		await syncDirectory(path.dirname(delivery_path));
		return delivery;
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		return readDeliveryRecord(storage_root, record.submission_id);
	}
}

async function readLease(lease_directory, lease_ms, now) {
	try {
		return JSON.parse(await readFile(path.join(lease_directory, "lease.json"), "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
		const details = await stat(lease_directory);
		return { owner: null, expires_at: new Date(details.mtimeMs + lease_ms).toISOString() };
	}
}

export async function acquireDeliveryLease(storage_root, submission_id, options = {}) {
	const now = options.now ?? Date.now();
	const lease_ms = options.lease_ms ?? 120_000;
	const owner = options.owner ?? randomUUID();
	const submission_directory = path.join(storage_root, submission_id);
	const lease_directory = path.join(submission_directory, LEASE_DIRECTORY);
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await mkdir(lease_directory, { mode: 0o700 });
			const lease = {
				owner,
				acquired_at: new Date(now).toISOString(),
				expires_at: new Date(now + lease_ms).toISOString(),
			};
			await writeFileSynced(path.join(lease_directory, "lease.json"), `${JSON.stringify(lease, null, 2)}\n`, {
				encoding: "utf8",
			});
			await syncDirectory(lease_directory);
			return lease;
		} catch (error) {
			if (error.code !== "EEXIST") {
				await rm(lease_directory, { recursive: true, force: true }).catch(() => {});
				throw error;
			}
		}

		const observed = await readLease(lease_directory, lease_ms, now).catch((error) => {
			if (error.code === "ENOENT") return null;
			throw error;
		});
		if (!observed) continue;
		if (Date.parse(observed.expires_at) > now) return null;

		const retired_directory = path.join(submission_directory, `.delivery-lease.expired-${owner}`);
		try {
			await rename(lease_directory, retired_directory);
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		const retired = await readLease(retired_directory, lease_ms, now).catch(() => null);
		if (retired?.owner !== observed.owner || retired?.expires_at !== observed.expires_at) {
			await rename(retired_directory, lease_directory).catch(() => {});
			return null;
		}
		await rm(retired_directory, { recursive: true, force: true });
	}
	return null;
}

export async function verifyDeliveryLease(storage_root, submission_id, owner, now = Date.now()) {
	const lease_directory = path.join(storage_root, submission_id, LEASE_DIRECTORY);
	const lease = await readLease(lease_directory, 0, Date.now()).catch(() => null);
	return lease?.owner === owner && Date.parse(lease.expires_at) > now;
}

export async function renewDeliveryLease(storage_root, submission_id, owner, options = {}) {
	const now = options.now ?? Date.now();
	const lease_ms = options.lease_ms ?? 120_000;
	const lease_directory = path.join(storage_root, submission_id, LEASE_DIRECTORY);
	const lease = await readLease(lease_directory, lease_ms, now).catch(() => null);
	if (lease?.owner !== owner || Date.parse(lease.expires_at) <= now) return null;
	const renewed = { ...lease, expires_at: new Date(now + lease_ms).toISOString() };
	await writeJsonAtomic(path.join(lease_directory, "lease.json"), renewed);
	return renewed;
}

export async function releaseDeliveryLease(storage_root, submission_id, owner) {
	const submission_directory = path.join(storage_root, submission_id);
	const lease_directory = path.join(submission_directory, LEASE_DIRECTORY);
	const observed = await readLease(lease_directory, 0, Date.now()).catch(() => null);
	if (observed?.owner !== owner) return false;
	const retired_directory = path.join(submission_directory, `.delivery-lease.release-${owner}`);
	try {
		await rename(lease_directory, retired_directory);
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
	const retired = await readLease(retired_directory, 0, Date.now()).catch(() => null);
	if (retired?.owner !== owner) {
		await rename(retired_directory, lease_directory).catch(() => {});
		return false;
	}
	await rm(retired_directory, { recursive: true, force: true });
	return true;
}

export function createKeyedSerializer() {
	const entries = new Map();
	return {
		async run(key, operation) {
			let entry = entries.get(key);
			if (!entry) {
				entry = { tail: Promise.resolve(), users: 0 };
				entries.set(key, entry);
			}
			const previous = entry.tail;
			let release;
			const gate = new Promise((resolve) => {
				release = resolve;
			});
			entry.tail = previous.then(() => gate);
			entry.users += 1;
			await previous;
			try {
				return await operation();
			} finally {
				release();
				entry.users -= 1;
				if (entry.users === 0) entries.delete(key);
			}
		},
		get size() {
			return entries.size;
		},
	};
}

export function isRetryableDeliveryError(error) {
	if (typeof error?.retryable === "boolean") return error.retryable;
	const status = Number(error?.status);
	if (!Number.isFinite(status)) return true;
	return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function boundedError(error) {
	return String(error?.message || "Unknown delivery failure").slice(0, 1000);
}

export class DeliveryOutboxProcessor {
	constructor(options) {
		this.storage_root = options.storage_root;
		this.targets = options.targets;
		this.deliver = options.deliver;
		this.clock = options.clock ?? { now: () => Date.now() };
		this.lease_ms = options.lease_ms ?? 120_000;
		this.interval_ms = options.interval_ms ?? 30_000;
		this.base_delay_ms = options.base_delay_ms ?? 5_000;
		this.maximum_delay_ms = options.maximum_delay_ms ?? 15 * 60_000;
		this.maximum_attempts = options.maximum_attempts ?? 10;
		this.batch_size = options.batch_size ?? 20;
		this.serializer = createKeyedSerializer();
		this.timer = null;
		this.closed = false;
		this.scan_promise = null;
	}

	async start() {
		await mkdir(this.storage_root, { recursive: true, mode: 0o700 });
		await this.processDue();
		if (!this.closed && this.interval_ms > 0) {
			this.timer = setInterval(() => void this.processDue().catch((error) => console.error("Outbox scan failed.", error)), this.interval_ms);
			this.timer.unref?.();
		}
	}

	async close() {
		this.closed = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		await this.scan_promise;
	}

	async processDue() {
		if (this.scan_promise) return this.scan_promise;
		this.scan_promise = this.#scan();
		try {
			return await this.scan_promise;
		} finally {
			this.scan_promise = null;
		}
	}

	async #scan() {
		const entries = await readdir(this.storage_root, { withFileTypes: true });
		let processed = 0;
		for (const entry of entries) {
			if (processed >= this.batch_size || !entry.isDirectory() || !SUBMISSION_ID_PATTERN.test(entry.name)) continue;
			let delivery = await readDeliveryRecord(this.storage_root, entry.name);
			if (!delivery) {
				const record = JSON.parse(await readFile(path.join(this.storage_root, entry.name, "submission.json"), "utf8"));
				delivery = await ensureDeliveryRecord(this.storage_root, record, this.targets, this.clock.now());
			}
			if (delivery.status === "delivered" || delivery.status === "dead_letter") continue;
			if (delivery.next_attempt_at && Date.parse(delivery.next_attempt_at) > this.clock.now()) continue;
			processed += 1;
			await this.process(entry.name);
		}
		return processed;
	}

	async process(submission_id, { force = false } = {}) {
		return this.serializer.run(submission_id, async () => {
			let delivery = await readDeliveryRecord(this.storage_root, submission_id);
			if (!delivery || delivery.status === "delivered" || delivery.status === "dead_letter") return delivery;
			const now = this.clock.now();
			if (!force && delivery.next_attempt_at && Date.parse(delivery.next_attempt_at) > now) return delivery;
			const lease = await acquireDeliveryLease(this.storage_root, submission_id, { now, lease_ms: this.lease_ms });
			if (!lease) return readDeliveryRecord(this.storage_root, submission_id);
			let heartbeat_error = null;
			let heartbeat_promise = Promise.resolve();
			const heartbeat_interval = Math.max(100, Math.floor(this.lease_ms / 3));
			const heartbeat = setInterval(() => {
				heartbeat_promise = heartbeat_promise
					.then(() =>
						renewDeliveryLease(this.storage_root, submission_id, lease.owner, {
							now: this.clock.now(),
							lease_ms: this.lease_ms,
						}),
					)
					.catch((error) => {
						heartbeat_error = error;
					});
			}, heartbeat_interval);
			heartbeat.unref?.();
			try {
				delivery = await readDeliveryRecord(this.storage_root, submission_id);
				if (!delivery || delivery.status === "delivered" || delivery.status === "dead_letter") return delivery;
				delivery = {
					...delivery,
					status: "processing",
					attempt_count: delivery.attempt_count + 1,
					lease,
					updated_at: new Date(now).toISOString(),
				};
				await writeJsonAtomic(path.join(this.storage_root, submission_id, "delivery.json"), delivery);

				const record = JSON.parse(await readFile(path.join(this.storage_root, submission_id, "submission.json"), "utf8"));
				const artwork_buffer = await readFile(path.join(this.storage_root, submission_id, record.artwork.filename));
				let failure = null;
				for (const target_name of Object.keys(delivery.targets)) {
					if (delivery.targets[target_name].status === "delivered") continue;
					try {
						const result = await this.deliver(target_name, { record, artwork_buffer, submission_id });
						if (heartbeat_error) throw heartbeat_error;
						if (!(await verifyDeliveryLease(this.storage_root, submission_id, lease.owner, this.clock.now()))) {
							return readDeliveryRecord(this.storage_root, submission_id);
						}
						delivery.targets[target_name] = {
							status: "delivered",
							message_id: result.message_id ?? result.id ?? null,
							method: result.method ?? null,
							last_error: null,
							updated_at: new Date(this.clock.now()).toISOString(),
						};
						await writeJsonAtomic(path.join(this.storage_root, submission_id, "delivery.json"), delivery);
					} catch (error) {
						failure = { error, target_name };
						break;
					}
				}

				if (heartbeat_error) throw heartbeat_error;
				if (!(await verifyDeliveryLease(this.storage_root, submission_id, lease.owner, this.clock.now()))) {
					return readDeliveryRecord(this.storage_root, submission_id);
				}
				const finished_at = this.clock.now();
				if (!failure) {
					delivery = {
						...delivery,
						status: "delivered",
						last_error: null,
						next_attempt_at: null,
						lease: null,
						updated_at: new Date(finished_at).toISOString(),
						delivered_at: new Date(finished_at).toISOString(),
					};
				} else {
					const message = boundedError(failure.error);
					const permanent = !isRetryableDeliveryError(failure.error) || delivery.attempt_count >= this.maximum_attempts;
					delivery.targets[failure.target_name] = {
						...delivery.targets[failure.target_name],
						status: permanent ? "permanently_failed" : "pending",
						last_error: message,
						updated_at: new Date(finished_at).toISOString(),
					};
					const delay = Math.min(this.maximum_delay_ms, this.base_delay_ms * 2 ** Math.max(0, delivery.attempt_count - 1));
					delivery = {
						...delivery,
						status: permanent ? "dead_letter" : "pending",
						last_error: message,
						next_attempt_at: permanent ? null : new Date(finished_at + delay).toISOString(),
						lease: null,
						updated_at: new Date(finished_at).toISOString(),
						dead_lettered_at: permanent ? new Date(finished_at).toISOString() : null,
					};
				}
				await writeJsonAtomic(path.join(this.storage_root, submission_id, "delivery.json"), delivery);
				return delivery;
			} finally {
				clearInterval(heartbeat);
				await heartbeat_promise;
				await releaseDeliveryLease(this.storage_root, submission_id, lease.owner);
			}
		});
	}
}
