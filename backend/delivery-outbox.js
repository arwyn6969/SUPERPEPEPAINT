import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { classifyProviderError, sanitizeProviderSummary } from "./provider-delivery.js";

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
		schema_version: 2,
		submission_id,
		status: "pending",
		attempt_count: 0,
		last_error: null,
		next_attempt_at: timestamp,
		lease: null,
		targets: Object.fromEntries(targets.map((name) => [name, {
			provider: name === "email" ? "resend" : name,
			status: "pending",
			attempt_count: 0,
			uncertain_attempt_count: 0,
			last_attempt_at: null,
			next_attempt_at: timestamp,
			throttle_until: null,
			lease: null,
			last_outcome: null,
			message_id: null,
			method: null,
			idempotency_key: name === "email" ? `pepepaint-${submission_id}` : null,
			destination_fingerprint: null,
			delivered_at: null,
			failed_at: null,
			dead_lettered_at: null,
			updated_at: timestamp,
		}])),
		created_at: timestamp,
		updated_at: timestamp,
		delivered_at: null,
		dead_lettered_at: null,
	};
}

function migrateDeliveryRecord(delivery) {
	if (delivery?.schema_version === 2) return delivery;
	if (delivery?.schema_version !== 1 || !delivery.submission_id || !delivery.targets) {
		throw new Error("Unsupported delivery outbox schema version.");
	}
	const migrated = createDeliveryRecord(delivery.submission_id, Object.keys(delivery.targets), Date.parse(delivery.created_at) || Date.now());
	migrated.attempt_count = Number.isSafeInteger(delivery.attempt_count) ? delivery.attempt_count : 0;
	for (const [name, legacy] of Object.entries(delivery.targets)) {
		migrated.targets[name] = {
			...migrated.targets[name],
			status: legacy.status === "delivered" ? "delivered" : legacy.status === "permanently_failed" ? "permanently_failed" : "pending",
			attempt_count: migrated.attempt_count,
			message_id: legacy.message_id ?? null,
			method: legacy.method ?? null,
			last_outcome: legacy.last_error ? { classification: legacy.status === "permanently_failed" ? "permanent_failure" : "retryable", error_summary: sanitizeProviderSummary(legacy.last_error) } : null,
			next_attempt_at: legacy.status === "delivered" || legacy.status === "permanently_failed" ? null : delivery.next_attempt_at,
			delivered_at: legacy.status === "delivered" ? legacy.updated_at : null,
			failed_at: legacy.status === "permanently_failed" ? legacy.updated_at : null,
			updated_at: legacy.updated_at ?? migrated.created_at,
		};
	}
	return deriveDeliveryState(migrated, Date.parse(delivery.updated_at) || Date.now());
}

export async function readDeliveryRecord(storage_root, submission_id) {
	try {
		return migrateDeliveryRecord(JSON.parse(await readFile(path.join(storage_root, submission_id, "delivery.json"), "utf8")));
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
				...delivery.targets[target_name],
				status: "delivered",
				message_id: legacy.message_id ?? null,
				method: legacy.method ?? null,
				next_attempt_at: null,
				delivered_at: legacy.updated_at ?? delivery.created_at,
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

const TERMINAL_TARGET_STATUSES = new Set(["delivered", "permanently_failed", "manual_review"]);

export function deriveDeliveryState(delivery, now = Date.now()) {
	const targets = Object.values(delivery.targets);
	const pending_dates = targets
		.filter((target) => !TERMINAL_TARGET_STATUSES.has(target.status))
		.map((target) => Date.parse(target.throttle_until || target.next_attempt_at))
		.filter(Number.isFinite);
	let status = "pending";
	if (targets.length > 0 && targets.every((target) => target.status === "delivered")) status = "delivered";
	else if (targets.length > 0 && targets.every((target) => TERMINAL_TARGET_STATUSES.has(target.status))) status = "dead_letter";
	else if (targets.some((target) => target.status === "processing")) status = "processing";
	else if (targets.some((target) => target.status === "uncertain")) status = "uncertain";
	else if (targets.some((target) => target.status === "throttled")) status = "throttled";
	const timestamp = new Date(now).toISOString();
	return {
		...delivery,
		status,
		last_error: targets.find((target) => target.last_outcome?.error_summary)?.last_outcome.error_summary ?? null,
		next_attempt_at: pending_dates.length ? new Date(Math.min(...pending_dates)).toISOString() : null,
		lease: status === "processing" ? delivery.lease : null,
		updated_at: timestamp,
		delivered_at: status === "delivered" ? delivery.delivered_at ?? timestamp : null,
		dead_lettered_at: status === "dead_letter" ? delivery.dead_lettered_at ?? timestamp : null,
	};
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
		this.uncertain_delay_ms = options.uncertain_delay_ms ?? 5 * 60_000;
		this.maximum_uncertain_attempts = options.maximum_uncertain_attempts ?? 2;
		this.retry_after_maximum_ms = options.retry_after_maximum_ms ?? 60 * 60_000;
		this.jitter_ratio = options.jitter_ratio ?? 0;
		this.random = options.random ?? Math.random;
		this.batch_size = options.batch_size ?? 20;
		this.serializer = createKeyedSerializer();
		this.timer = null;
		this.initial_scan_timer = null;
		this.closed = false;
		this.scan_promise = null;
		this.shutdown_controller = new AbortController();
		this.active = new Set();
		this.logger = options.logger ?? console;
		this.on_durability_fault = options.on_durability_fault ?? (() => {});
		this.on_provider_outcome = options.on_provider_outcome ?? (() => {});
	}

	async start(options = {}) {
		await mkdir(this.storage_root, { recursive: true, mode: 0o700 });
		try {
			await this.validateState();
		} catch (error) {
			this.on_durability_fault(error);
			throw error;
		}
		if (options.defer_processing) {
			this.initial_scan_timer = setImmediate(() => {
				this.initial_scan_timer = null;
				void this.processDue().catch((error) => this.logger.error?.("Initial outbox scan failed.", { code: error?.code ?? "UNKNOWN" }));
			});
			this.initial_scan_timer.unref?.();
		} else await this.processDue();
		if (!this.closed && this.interval_ms > 0) {
			this.timer = setInterval(() => void this.processDue().catch((error) => this.logger.error?.("Outbox scan failed.", { code: error?.code ?? "UNKNOWN" })), this.interval_ms);
			this.timer.unref?.();
		}
	}

	async close() {
		this.closed = true;
		this.shutdown_controller.abort(new Error("Outbox is shutting down"));
		if (this.initial_scan_timer) clearImmediate(this.initial_scan_timer);
		this.initial_scan_timer = null;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		await this.scan_promise;
		await Promise.allSettled([...this.active]);
	}

	async validateState() {
		const entries = await readdir(this.storage_root, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory() || !SUBMISSION_ID_PATTERN.test(entry.name)) continue;
			const delivery = await readDeliveryRecord(this.storage_root, entry.name);
			if (!delivery) JSON.parse(await readFile(path.join(this.storage_root, entry.name, "submission.json"), "utf8"));
		}
	}

	async processDue() {
		if (this.scan_promise) return this.scan_promise;
		this.scan_promise = this.#scan();
		try {
			return await this.scan_promise;
		} catch (error) {
			this.on_durability_fault(error);
			throw error;
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
		const work = this.serializer.run(submission_id, async () => {
			let delivery = await readDeliveryRecord(this.storage_root, submission_id);
			if (!delivery || delivery.status === "delivered" || delivery.status === "dead_letter") return delivery;
			const now = this.clock.now();
			if (!force && delivery.next_attempt_at && Date.parse(delivery.next_attempt_at) > now) return delivery;
			if (this.closed) return delivery;
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
				for (const [target_name, target] of Object.entries(delivery.targets)) {
					if (target.status !== "processing") continue;
					const uncertain_count = target.uncertain_attempt_count + 1;
					const manual_review = uncertain_count >= this.maximum_uncertain_attempts;
					delivery.targets[target_name] = {
						...target,
						status: manual_review ? "manual_review" : "uncertain",
						uncertain_attempt_count: uncertain_count,
						last_outcome: {
							provider: target.provider,
							classification: "uncertain",
							provider_status: null,
							provider_code: "worker_interrupted",
							retry_after_ms: null,
							request_may_have_reached_provider: true,
							error_summary: "Previous provider attempt ended before confirmation",
						},
						next_attempt_at: manual_review ? null : new Date(now + this.uncertain_delay_ms).toISOString(),
						lease: null,
						dead_lettered_at: manual_review ? new Date(now).toISOString() : null,
						updated_at: new Date(now).toISOString(),
					};
				}
				delivery = deriveDeliveryState({
					...delivery,
					attempt_count: delivery.attempt_count + 1,
					lease,
				}, now);
				delivery.status = "processing";
				delivery.lease = lease;
				await writeJsonAtomic(path.join(this.storage_root, submission_id, "delivery.json"), delivery);

				const record = JSON.parse(await readFile(path.join(this.storage_root, submission_id, "submission.json"), "utf8"));
				const artwork_buffer = await readFile(path.join(this.storage_root, submission_id, record.artwork.filename));
				for (const target_name of Object.keys(delivery.targets)) {
					let target = delivery.targets[target_name];
					if (TERMINAL_TARGET_STATUSES.has(target.status)) continue;
					const due_at = Date.parse(target.throttle_until || target.next_attempt_at);
					if ((target.status === "throttled" || target.status === "uncertain" || !force) && Number.isFinite(due_at) && due_at > this.clock.now()) continue;
					const attempted_at = this.clock.now();
					target = {
						...target,
						status: "processing",
						attempt_count: target.attempt_count + 1,
						last_attempt_at: new Date(attempted_at).toISOString(),
						lease: { owner: lease.owner, expires_at: lease.expires_at },
						updated_at: new Date(attempted_at).toISOString(),
					};
					delivery.targets[target_name] = target;
					await writeJsonAtomic(path.join(this.storage_root, submission_id, "delivery.json"), delivery);
					try {
						const result = await this.deliver(target_name, { record, artwork_buffer, submission_id, signal: this.shutdown_controller.signal });
						if (heartbeat_error) throw heartbeat_error;
						if (!(await verifyDeliveryLease(this.storage_root, submission_id, lease.owner, this.clock.now()))) {
							return readDeliveryRecord(this.storage_root, submission_id);
						}
						const delivered_at = this.clock.now();
						const outcome = { provider: target.provider, classification: "delivered", provider_status: result.provider_status ?? 200, provider_code: null, retry_after_ms: null, request_may_have_reached_provider: true, error_summary: null };
						delivery.targets[target_name] = {
							...target,
							status: "delivered",
							message_id: result.message_id ?? result.id ?? null,
							method: result.method ?? null,
							last_outcome: outcome,
							next_attempt_at: null,
							throttle_until: null,
							lease: null,
							destination_fingerprint: result.destination_fingerprint ?? target.destination_fingerprint,
							delivered_at: new Date(delivered_at).toISOString(),
							updated_at: new Date(delivered_at).toISOString(),
						};
						this.#log(target_name, submission_id, target.attempt_count, outcome, "delivered", null, attempted_at, delivered_at);
						await writeJsonAtomic(path.join(this.storage_root, submission_id, "delivery.json"), delivery);
					} catch (error) {
						const finished_at = this.clock.now();
						const outcome = classifyProviderError(target.provider, error);
						let status = "pending";
						let delay = 0;
						let uncertain_count = target.uncertain_attempt_count;
						if (outcome.classification === "permanent_failure" || target.attempt_count >= this.maximum_attempts) status = "permanently_failed";
						else if (outcome.classification === "uncertain") {
							uncertain_count += 1;
							status = uncertain_count >= this.maximum_uncertain_attempts ? "manual_review" : "uncertain";
							delay = this.uncertain_delay_ms;
						} else if (outcome.classification === "throttled") {
							status = "throttled";
							delay = Math.max(Math.min(outcome.retry_after_ms ?? 0, this.retry_after_maximum_ms), this.#backoff(target.attempt_count));
						} else if (outcome.classification === "cancelled_for_shutdown") {
							status = "pending";
							delay = this.base_delay_ms;
						} else delay = this.#backoff(target.attempt_count);
						const terminal = status === "permanently_failed" || status === "manual_review";
						const retry_at = terminal ? null : new Date(finished_at + delay).toISOString();
						delivery.targets[target_name] = {
							...target,
							status,
							uncertain_attempt_count: uncertain_count,
							last_outcome: outcome,
							next_attempt_at: retry_at,
							throttle_until: status === "throttled" ? retry_at : null,
							lease: null,
							failed_at: status === "permanently_failed" ? new Date(finished_at).toISOString() : null,
							dead_lettered_at: status === "manual_review" ? new Date(finished_at).toISOString() : null,
							updated_at: new Date(finished_at).toISOString(),
						};
						this.#log(target_name, submission_id, target.attempt_count, outcome, status, retry_at, attempted_at, finished_at);
						await writeJsonAtomic(path.join(this.storage_root, submission_id, "delivery.json"), delivery);
					}
				}

				if (heartbeat_error) throw heartbeat_error;
				if (!(await verifyDeliveryLease(this.storage_root, submission_id, lease.owner, this.clock.now()))) {
					return readDeliveryRecord(this.storage_root, submission_id);
				}
				delivery = deriveDeliveryState({ ...delivery, lease: null }, this.clock.now());
				await writeJsonAtomic(path.join(this.storage_root, submission_id, "delivery.json"), delivery);
				return delivery;
			} finally {
				clearInterval(heartbeat);
				await heartbeat_promise;
				await releaseDeliveryLease(this.storage_root, submission_id, lease.owner);
			}
		});
		this.active.add(work);
		try {
			return await work;
		} catch (error) {
			this.on_durability_fault(error);
			throw error;
		} finally {
			this.active.delete(work);
		}
	}

	#backoff(attempt_count) {
		const exponent = Math.min(30, Math.max(0, attempt_count - 1));
		const base = Math.min(this.maximum_delay_ms, this.base_delay_ms * 2 ** exponent);
		const jitter = Math.min(this.maximum_delay_ms - base, Math.max(0, base * this.jitter_ratio * this.random()));
		return Math.round(base + jitter);
	}

	#log(target_name, submission_id, attempt, outcome, target_status, next_attempt_at, started_at, finished_at) {
		this.on_provider_outcome(outcome);
		this.logger.info?.("Provider delivery outcome", {
			provider: outcome.provider,
			submission: submission_id.slice(0, 8),
			target: target_name,
			outbox_transition: `processing_to_${target_status}`,
			classification: outcome.classification,
			attempt,
			duration_ms: Math.max(0, finished_at - started_at),
			next_attempt_at,
			provider_status: outcome.provider_status,
			provider_code: outcome.provider_code,
		});
	}
}
