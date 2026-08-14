export const SUBMISSION_STATES = Object.freeze({
	PREPARING: "preparing",
	READY: "ready",
	SENDING: "sending",
	UNCERTAIN: "uncertain",
	ARCHIVED_QUEUED: "archived_queued",
	DELIVERED: "delivered",
	REJECTED: "rejected",
});

export const PEPEPAINT_DATABASE_NAME = "pepepaint";
export const PEPEPAINT_DATABASE_VERSION = 2;
export const CANVAS_STORE_NAME = "canvas_saves";
export const SUBMISSION_STORE_NAME = "submission_attempts";

const TERMINAL_STATES = new Set([
	SUBMISSION_STATES.ARCHIVED_QUEUED,
	SUBMISSION_STATES.DELIVERED,
	SUBMISSION_STATES.REJECTED,
]);
const RETRYABLE_STATES = new Set([
	SUBMISSION_STATES.READY,
	SUBMISSION_STATES.SENDING,
	SUBMISSION_STATES.UNCERTAIN,
]);
let database_promise = null;

export function openPepepaintDatabase(indexed_db = globalThis.indexedDB) {
	if (!indexed_db) return Promise.reject(new Error("IndexedDB is not available."));
	if (!database_promise) {
		database_promise = new Promise((resolve, reject) => {
			const request = indexed_db.open(PEPEPAINT_DATABASE_NAME, PEPEPAINT_DATABASE_VERSION);
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(CANVAS_STORE_NAME)) {
					database.createObjectStore(CANVAS_STORE_NAME, { keyPath: "id" });
				}
				if (!database.objectStoreNames.contains(SUBMISSION_STORE_NAME)) {
					database.createObjectStore(SUBMISSION_STORE_NAME, { keyPath: "uuid" });
				}
			};
			request.onsuccess = () => {
				const database = request.result;
				database.onversionchange = () => database.close();
				resolve(database);
			};
			request.onerror = () => reject(request.error || new Error("Could not open local storage."));
			request.onblocked = () => reject(new Error("Local storage upgrade was blocked by another tab. Close other PEPEPAINT tabs and retry."));
		}).catch((error) => {
			database_promise = null;
			throw error;
		});
	}
	return database_promise;
}

function transactionPromise(transaction, message) {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error || new Error(message));
		transaction.onabort = () => reject(transaction.error || new Error(message));
	});
}

export class IndexedDbSubmissionStore {
	constructor({ open_database = openPepepaintDatabase } = {}) {
		this.open_database = open_database;
	}

	async get(uuid) {
		const database = await this.open_database();
		return new Promise((resolve, reject) => {
			const request = database.transaction(SUBMISSION_STORE_NAME, "readonly").objectStore(SUBMISSION_STORE_NAME).get(uuid);
			request.onsuccess = () => resolve(request.result || null);
			request.onerror = () => reject(request.error || new Error("Could not read the saved submission."));
		});
	}

	async getCurrent() {
		const database = await this.open_database();
		return new Promise((resolve, reject) => {
			const request = database.transaction(SUBMISSION_STORE_NAME, "readonly").objectStore(SUBMISSION_STORE_NAME).getAll();
			request.onsuccess = () => {
				const records = request.result || [];
				records.sort((left, right) => right.updated_at - left.updated_at);
				resolve(records[0] || null);
			};
			request.onerror = () => reject(request.error || new Error("Could not read saved submissions."));
		});
	}

	async put(record) {
		const database = await this.open_database();
		const transaction = database.transaction(SUBMISSION_STORE_NAME, "readwrite");
		transaction.objectStore(SUBMISSION_STORE_NAME).put(record);
		await transactionPromise(transaction, "Could not save the submission for retry.");
		return record;
	}

	async putIfEmpty(record) {
		const database = await this.open_database();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction(SUBMISSION_STORE_NAME, "readwrite");
			const store = transaction.objectStore(SUBMISSION_STORE_NAME);
			const request = store.count();
			let created = false;
			request.onsuccess = () => {
				if (request.result === 0) {
					store.add(record);
					created = true;
				}
			};
			transaction.oncomplete = () => resolve(created);
			transaction.onerror = () => reject(transaction.error || new Error("Could not save the submission identity."));
			transaction.onabort = () => reject(transaction.error || new Error("Saving the submission identity was aborted."));
		});
	}

	async delete(uuid) {
		const database = await this.open_database();
		const transaction = database.transaction(SUBMISSION_STORE_NAME, "readwrite");
		transaction.objectStore(SUBMISSION_STORE_NAME).delete(uuid);
		await transactionPromise(transaction, "Could not dismiss the saved submission.");
	}

	async acquireLease(uuid, owner, now, lease_ms) {
		const database = await this.open_database();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction(SUBMISSION_STORE_NAME, "readwrite");
			const store = transaction.objectStore(SUBMISSION_STORE_NAME);
			const request = store.get(uuid);
			let acquired = false;
			request.onsuccess = () => {
				const record = request.result;
				if (!record) return;
				if (record.send_lease?.expires_at > now && record.send_lease.owner !== owner) return;
				store.put({ ...record, send_lease: { owner, expires_at: now + lease_ms } });
				acquired = true;
			};
			transaction.oncomplete = () => resolve(acquired);
			transaction.onerror = () => reject(transaction.error || new Error("Could not coordinate the submission retry."));
			transaction.onabort = () => reject(transaction.error || new Error("Submission retry coordination was aborted."));
		});
	}

	async releaseLease(uuid, owner) {
		const database = await this.open_database();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction(SUBMISSION_STORE_NAME, "readwrite");
			const store = transaction.objectStore(SUBMISSION_STORE_NAME);
			const request = store.get(uuid);
			request.onsuccess = () => {
				const record = request.result;
				if (record?.send_lease?.owner === owner) store.put({ ...record, send_lease: null });
			};
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error || new Error("Could not release submission retry coordination."));
			transaction.onabort = () => reject(transaction.error || new Error("Submission retry coordination was aborted."));
		});
	}
}

function bytesToHex(buffer) {
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Blob(blob, crypto_impl = globalThis.crypto) {
	if (!crypto_impl?.subtle) throw new Error("Secure artwork verification is not available in this browser.");
	return bytesToHex(await crypto_impl.subtle.digest("SHA-256", await blob.arrayBuffer()));
}

export function formDataFromAttempt(record) {
	const data = new FormData();
	data.set("submission_id", record.uuid);
	data.set("title", record.form_fields.title);
	data.set("description", record.form_fields.description);
	data.set("editions", record.form_fields.editions);
	data.set("wallet_address", record.form_fields.wallet_address);
	data.set("website", record.form_fields.website || "");
	data.set("traits", JSON.stringify(record.traits));
	data.set("artwork", record.artwork_blob, record.artwork_filename);
	return data;
}

export function classifySubmissionResponse(response, result, parse_ok) {
	if (!parse_ok || !result || typeof result !== "object") return { state: SUBMISSION_STATES.UNCERTAIN, accepted: false };
	if (response.ok && result.status === "submitted") return { state: SUBMISSION_STATES.DELIVERED, accepted: true };
	if (response.ok && result.status === "queued") return { state: SUBMISSION_STATES.ARCHIVED_QUEUED, accepted: true };
	if (response.ok && result.status === "uncertain") return { state: SUBMISSION_STATES.UNCERTAIN, accepted: true };
	if ([400, 409, 413, 422].includes(response.status) && typeof result.error === "string") {
		return { state: SUBMISSION_STATES.REJECTED, accepted: false };
	}
	return { state: SUBMISSION_STATES.UNCERTAIN, accepted: false };
}

export class SubmissionRetryClient {
	constructor({
		store,
		fetch_impl = globalThis.fetch,
		crypto_impl = globalThis.crypto,
		locks = globalThis.navigator?.locks,
		now = () => Date.now(),
		timeout_ms = 60_000,
		lease_ms = 90_000,
	} = {}) {
		this.store = store;
		this.fetch_impl = fetch_impl;
		this.crypto_impl = crypto_impl;
		this.locks = locks;
		this.now = now;
		this.timeout_ms = timeout_ms;
		this.lease_ms = lease_ms;
		this.in_flight = new Set();
	}

	async getCurrent() {
		const record = await this.store.getCurrent();
		if (record?.state === SUBMISSION_STATES.SENDING && !(record.send_lease?.expires_at > this.now())) {
			const recovered = {
				...record,
				state: SUBMISSION_STATES.UNCERTAIN,
				updated_at: this.now(),
				last_client_error: "The page closed before the submission result was known. Safe retry is available.",
				send_lease: null,
			};
			await this.store.put(recovered);
			return recovered;
		}
		return record;
	}

	async begin(form_fields, traits) {
		const timestamp = this.now();
		const record = {
			schema_version: 1,
			uuid: this.crypto_impl.randomUUID(),
			state: SUBMISSION_STATES.PREPARING,
			created_at: timestamp,
			updated_at: timestamp,
			form_fields: { ...form_fields },
			traits: structuredClone(traits),
			attempt_count: 0,
			last_attempt_at: null,
			next_retry_at: null,
			last_client_error: null,
			server_state: null,
			server_message: null,
			send_lease: null,
		};
		const created = this.store.putIfEmpty
			? await this.store.putIfEmpty(record)
			: !(await this.store.getCurrent()) && Boolean(await this.store.put(record));
		if (!created) throw new Error("Resolve the saved submission before starting another one.");
		return record;
	}

	async makeReady(uuid, { blob, filename }) {
		const record = await this.store.get(uuid);
		if (!record || record.state !== SUBMISSION_STATES.PREPARING) throw new Error("The submission is not being prepared.");
		const digest = await sha256Blob(blob, this.crypto_impl);
		const ready = {
			...record,
			state: SUBMISSION_STATES.READY,
			updated_at: this.now(),
			artwork_blob: blob,
			artwork_filename: filename,
			artwork_type: blob.type,
			artwork_size: blob.size,
			artwork_sha256: digest,
		};
		await this.store.put(ready);
		return ready;
	}

	async send(uuid) {
		if (this.in_flight.has(uuid)) return { busy: true, record: await this.store.get(uuid) };
		this.in_flight.add(uuid);
		try {
			if (this.locks?.request) {
				return await this.locks.request(`pepepaint-submission-${uuid}`, { ifAvailable: true }, async (lock) => {
					if (!lock) return { busy: true, record: await this.store.get(uuid) };
					return this.sendWithLease(uuid);
				});
			}
			return await this.sendWithLease(uuid);
		} finally {
			this.in_flight.delete(uuid);
		}
	}

	async sendWithLease(uuid) {
		const owner = this.crypto_impl.randomUUID();
		const acquired = await this.store.acquireLease(uuid, owner, this.now(), this.lease_ms);
		if (!acquired) return { busy: true, record: await this.store.get(uuid) };
		try {
			let record = await this.store.get(uuid);
			if (!record || !RETRYABLE_STATES.has(record.state) || !(record.artwork_blob instanceof Blob)) {
				return { busy: false, record };
			}
			const attempt_time = this.now();
			record = {
				...record,
				state: SUBMISSION_STATES.SENDING,
				updated_at: attempt_time,
				attempt_count: record.attempt_count + 1,
				last_attempt_at: attempt_time,
				next_retry_at: null,
				last_client_error: null,
			};
			await this.store.put(record);

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), this.timeout_ms);
			try {
				const response = await this.fetch_impl("/api/submissions", {
					method: "POST",
					headers: { "X-Submission-ID": uuid },
					body: formDataFromAttempt(record),
					signal: controller.signal,
				});
				const text = await response.text();
				let result;
				let parse_ok = false;
				try {
					result = JSON.parse(text);
					parse_ok = true;
				} catch {
					result = null;
				}
				const classification = classifySubmissionResponse(response, result, parse_ok);
				const id_matches = result?.submission_id === uuid;
				const final_state = classification.accepted && !id_matches ? SUBMISSION_STATES.UNCERTAIN : classification.state;
				record = {
					...record,
					state: final_state,
					updated_at: this.now(),
					server_state: parse_ok ? result?.status || null : null,
					server_message: parse_ok ? result?.message || result?.error || null : null,
					last_client_error:
						final_state === SUBMISSION_STATES.UNCERTAIN
							? "The server response did not definitively confirm this submission. Safe retry is available."
							: null,
					next_retry_at:
						final_state === SUBMISSION_STATES.UNCERTAIN
							? this.now() + Math.min(60_000, 2 ** Math.min(record.attempt_count - 1, 5) * 2_000)
							: null,
				};
				await this.store.put(record);
				return { busy: false, accepted: classification.accepted && id_matches, record };
			} catch (error) {
				record = {
					...record,
					state: SUBMISSION_STATES.UNCERTAIN,
					updated_at: this.now(),
					last_client_error: error?.name === "AbortError" ? "The submission timed out. Safe retry is available." : "The network result is uncertain. Safe retry is available.",
					next_retry_at: this.now() + Math.min(60_000, 2 ** Math.min(record.attempt_count - 1, 5) * 2_000),
				};
				await this.store.put(record);
				return { busy: false, accepted: false, record };
			} finally {
				clearTimeout(timeout);
			}
		} finally {
			await this.store.releaseLease(uuid, owner).catch(() => {});
		}
	}

	async dismiss(uuid) {
		const record = await this.store.get(uuid);
		if (!record) return;
		await this.store.delete(uuid);
	}
}

export function isTerminalSubmission(record) {
	return Boolean(record && TERMINAL_STATES.has(record.state));
}
