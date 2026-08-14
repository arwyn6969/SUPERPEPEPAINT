import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
	SUBMISSION_STATES,
	SubmissionRetryClient,
	formDataFromAttempt,
	openPepepaintDatabase,
} from "../submission-retry.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const UUID_TWO = "123e4567-e89b-42d3-a456-426614174001";
const FIELDS = {
	title: "Frozen title",
	description: "Frozen description",
	editions: "2",
	wallet_address: "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb",
	website: "",
};
const TRAITS = {
	croakage: 50,
	rsi: 6,
	quietus_elapsed: "00:00:30",
	quietus: 0.000001,
	wanderlust: 120,
	chaos: 20,
	brushiness: 4,
};

class MemoryStore {
	constructor() {
		this.records = new Map();
		this.fail_put = false;
	}
	async get(uuid) {
		return this.records.get(uuid) || null;
	}
	async getCurrent() {
		return [...this.records.values()].sort((left, right) => right.updated_at - left.updated_at)[0] || null;
	}
	async put(record) {
		if (this.fail_put) throw new Error("QuotaExceededError");
		this.records.set(record.uuid, structuredClone(record));
		return record;
	}
	async putIfEmpty(record) {
		if (this.records.size > 0) return false;
		await this.put(record);
		return true;
	}
	async delete(uuid) {
		this.records.delete(uuid);
	}
}

function cryptoSequence(...uuids) {
	let index = 0;
	return { subtle: webcrypto.subtle, randomUUID: () => uuids[index++] || UUID_TWO };
}

function jsonResponse(status, body) {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function readyAttempt(client, blob = new Blob(["artwork-bytes"], { type: "image/png" })) {
	const preparing = await client.begin(FIELDS, TRAITS);
	return client.makeReady(preparing.uuid, { blob, filename: "artwork.png" });
}

test("persists the UUID before encoding and refuses to send before the exact Blob is durable", async () => {
	const store = new MemoryStore();
	let fetch_calls = 0;
	const client = new SubmissionRetryClient({
		store,
		crypto_impl: cryptoSequence(UUID),
		fetch_impl: async () => {
			fetch_calls += 1;
		},
	});
	const preparing = await client.begin(FIELDS, TRAITS);
	assert.equal((await store.getCurrent()).uuid, UUID);
	assert.equal((await store.getCurrent()).state, SUBMISSION_STATES.PREPARING);
	await client.send(preparing.uuid);
	assert.equal(fetch_calls, 0);

	store.fail_put = true;
	await assert.rejects(client.makeReady(UUID, { blob: new Blob(["png"], { type: "image/png" }), filename: "artwork.png" }), /QuotaExceededError/);
	assert.equal(fetch_calls, 0);
});

test("lost response survives restart and retries identical fields, UUID, and artwork bytes", async () => {
	const store = new MemoryStore();
	const requests = [];
	const first_client = new SubmissionRetryClient({
		store,
		crypto_impl: cryptoSequence(UUID, UUID_TWO),
		fetch_impl: async (_url, options) => {
			assert.equal((await store.get(UUID)).state, SUBMISSION_STATES.SENDING);
			assert.equal(options.headers["X-Submission-ID"], UUID);
			requests.push(options.body);
			throw new TypeError("connection lost after acceptance");
		},
	});
	const ready = await readyAttempt(first_client);
	const frozen_digest = ready.artwork_sha256;
	const first = await first_client.send(UUID);
	assert.equal(first.record.state, SUBMISSION_STATES.UNCERTAIN);

	const restarted_client = new SubmissionRetryClient({
		store,
		crypto_impl: cryptoSequence(UUID_TWO),
		fetch_impl: async (_url, options) => {
			assert.equal(options.headers["X-Submission-ID"], UUID);
			requests.push(options.body);
			return jsonResponse(200, { submission_id: UUID, status: "submitted" });
		},
	});
	assert.equal((await restarted_client.getCurrent()).uuid, UUID);
	const retry = await restarted_client.send(UUID);
	assert.equal(retry.record.state, SUBMISSION_STATES.DELIVERED);
	assert.equal(retry.record.artwork_sha256, frozen_digest);
	assert.equal(retry.record.attempt_count, 2);

	for (const request of requests) {
		assert.equal(request.get("submission_id"), UUID);
		assert.deepEqual(JSON.parse(request.get("traits")), TRAITS);
		assert.deepEqual(Buffer.from(await request.get("artwork").arrayBuffer()), Buffer.from("artwork-bytes"));
	}
	assert.deepEqual([...requests[0].entries()].filter(([key]) => key !== "artwork"), [...requests[1].entries()].filter(([key]) => key !== "artwork"));
});

test("live edits cannot mutate a frozen retry package", async () => {
	const store = new MemoryStore();
	const client = new SubmissionRetryClient({ store, crypto_impl: cryptoSequence(UUID), fetch_impl: async () => jsonResponse(202, { submission_id: UUID, status: "queued" }) });
	const mutable_fields = { ...FIELDS };
	const mutable_traits = { ...TRAITS };
	const ready = await client.begin(mutable_fields, mutable_traits);
	mutable_fields.title = "Changed title";
	mutable_traits.rsi = 999;
	await client.makeReady(ready.uuid, { blob: new Blob(["original"], { type: "image/png" }), filename: "artwork.png" });
	const frozen = await store.get(UUID);
	assert.equal(frozen.form_fields.title, FIELDS.title);
	assert.equal(frozen.traits.rsi, TRAITS.rsi);
	assert.equal(formDataFromAttempt(frozen).get("title"), FIELDS.title);
	assert.equal((await client.send(UUID)).record.state, SUBMISSION_STATES.ARCHIVED_QUEUED);
});

test("malformed replies, 5xx responses, and recovered sending state remain uncertain", async () => {
	for (const response of [
		new Response("not json", { status: 200 }),
		jsonResponse(200, { status: "submitted" }),
		jsonResponse(502, { error: "upstream failed" }),
	]) {
		const store = new MemoryStore();
		const client = new SubmissionRetryClient({ store, crypto_impl: cryptoSequence(UUID), fetch_impl: async () => response });
		await readyAttempt(client);
		assert.equal((await client.send(UUID)).record.state, SUBMISSION_STATES.UNCERTAIN);
	}
	const store = new MemoryStore();
	store.records.set(UUID, { uuid: UUID, state: SUBMISSION_STATES.SENDING, updated_at: 1, artwork_blob: new Blob(["x"]) });
	const restarted = new SubmissionRetryClient({ store, crypto_impl: cryptoSequence(UUID_TWO), now: () => 10 });
	assert.equal((await restarted.getCurrent()).state, SUBMISSION_STATES.UNCERTAIN);
});

test("server-confirmed archival with uncertain provider delivery is terminal for browser retry", async () => {
	const store = new MemoryStore();
	const client = new SubmissionRetryClient({
		store,
		crypto_impl: cryptoSequence(UUID),
		fetch_impl: async () => jsonResponse(202, { submission_id: UUID, status: "queued", delivery_status: "uncertain" }),
	});
	await readyAttempt(client);
	const result = await client.send(UUID);
	assert.equal(result.accepted, true);
	assert.equal(result.record.state, SUBMISSION_STATES.ARCHIVED_QUEUED);
	assert.equal(result.record.server_delivery_state, "uncertain");
	assert.equal(result.record.uuid, UUID);
});

test("legacy server uncertain response is treated as durably archived, not browser-retryable", async () => {
	const store = new MemoryStore();
	const client = new SubmissionRetryClient({
		store,
		crypto_impl: cryptoSequence(UUID),
		fetch_impl: async () => jsonResponse(202, { submission_id: UUID, status: "uncertain", message: "Provider confirmation is pending." }),
	});
	await readyAttempt(client);
	const result = await client.send(UUID);
	assert.equal(result.accepted, true);
	assert.equal(result.record.state, SUBMISSION_STATES.ARCHIVED_QUEUED);
	assert.equal(result.record.server_state, "uncertain");
});

test("a request timeout preserves the frozen UUID and retry package", async () => {
	const store = new MemoryStore();
	const client = new SubmissionRetryClient({
		store,
		crypto_impl: cryptoSequence(UUID, UUID_TWO),
		timeout_ms: 1,
		fetch_impl: async (_url, { signal }) =>
			new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })),
	});
	const ready = await readyAttempt(client);
	const result = await client.send(UUID);
	assert.equal(result.record.uuid, UUID);
	assert.equal(result.record.state, SUBMISSION_STATES.UNCERTAIN);
	assert.equal(result.record.artwork_sha256, ready.artwork_sha256);
	assert.match(result.record.last_client_error, /timed out/i);
});

test("validation and UUID conflicts are definitive rejections while dismissal enables a new UUID", async () => {
	for (const status of [400, 409]) {
		const store = new MemoryStore();
		const client = new SubmissionRetryClient({ store, crypto_impl: cryptoSequence(UUID), fetch_impl: async () => jsonResponse(status, { submission_id: UUID, status: status === 409 ? "conflict" : "rejected", error: "fix it" }) });
		await readyAttempt(client);
		assert.equal((await client.send(UUID)).record.state, SUBMISSION_STATES.REJECTED);
	}
	const store = new MemoryStore();
	const client = new SubmissionRetryClient({ store, crypto_impl: cryptoSequence(UUID, UUID_TWO) });
	await readyAttempt(client);
	await assert.rejects(client.begin(FIELDS, TRAITS), /Resolve the saved submission/);
	await client.dismiss(UUID);
	assert.equal((await client.begin(FIELDS, TRAITS)).uuid, UUID_TWO);
});

test("duplicate clicks are blocked within the active page", async () => {
	const store = new MemoryStore();
	let release_fetch;
	let fetch_calls = 0;
	const fetch_impl = async () => {
		fetch_calls += 1;
		await new Promise((resolve) => {
			release_fetch = resolve;
		});
		return jsonResponse(200, { submission_id: UUID, status: "submitted" });
	};
	const client = new SubmissionRetryClient({ store, crypto_impl: cryptoSequence(UUID), fetch_impl });
	await readyAttempt(client);
	const active = client.send(UUID);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal((await client.send(UUID)).busy, true);
	assert.equal(fetch_calls, 1);
	release_fetch();
	await active;
});

test("IndexedDB version 2 migration adds submission storage without replacing canvas storage", async () => {
	const created = [];
	const database = {
		objectStoreNames: { contains: (name) => name === "canvas_saves" || created.includes(name) },
		createObjectStore: (name) => created.push(name),
		close: () => {},
	};
	const fake_indexed_db = {
		open(name, version) {
			assert.equal(name, "pepepaint");
			assert.equal(version, 2);
			const request = { result: database };
			queueMicrotask(() => {
				request.onupgradeneeded();
				request.onsuccess();
			});
			return request;
		},
	};
	assert.equal(await openPepepaintDatabase(fake_indexed_db), database);
	assert.deepEqual(created, ["submission_attempts"]);
});

test("accepted submission handling resets only the form and leaves canvas persistence untouched", async () => {
	const source = await readFile(new URL("../main.js", import.meta.url), "utf8");
	const accepted_handler = source.slice(source.indexOf("async function sendCurrentSubmission"), source.indexOf('submission_form?.addEventListener("submit"'));
	assert.match(accepted_handler, /if \(result\.accepted\)[\s\S]*submission_form\.reset\(\)/);
	assert.doesNotMatch(accepted_handler, /resetCanvas|deleteLatestStoredCanvas|clearRect|draw_canvas/);
});
