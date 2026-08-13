import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	DeliveryOutboxProcessor,
	acquireDeliveryLease,
	createKeyedSerializer,
	readDeliveryRecord,
	releaseDeliveryLease,
	renewDeliveryLease,
	writeJsonAtomic,
} from "../delivery-outbox.js";
import { ProviderDeliveryError } from "../provider-delivery.js";
import { archiveSubmission, cleanupAbandonedStagingDirectories, validateSubmission } from "../submissions.js";
import { createPng } from "./fixtures.js";

const PNG = createPng();
const VALID_WALLET = "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb";

function createSubmission(submission_id = crypto.randomUUID()) {
	return validateSubmission(
		{
			submission_id,
			title: "Durable delivery test",
			description: "Outbox test",
			editions: "1",
			wallet_address: VALID_WALLET,
			traits: JSON.stringify({
				croakage: 1,
				rsi: 2,
				quietus_elapsed: "00:00:01",
				quietus: 0.1,
				wanderlust: 3,
				chaos: 4,
				brushiness: 5,
			}),
		},
		{ buffer: PNG, mimetype: "image/png" },
	);
}

test("publishes archives atomically and cleans staging after a write failure", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-atomic-"));
	const submission = createSubmission();
	let json_writes = 0;
	await assert.rejects(
		archiveSubmission(storage_root, submission, {
			delivery_targets: ["email"],
			write_json_impl: async (file_path, value) => {
				json_writes += 1;
				if (json_writes === 2) throw new Error("simulated delivery record write failure");
				await writeJsonAtomic(file_path, value);
			},
		}),
		/simulated delivery record write failure/,
	);
	await assert.rejects(access(path.join(storage_root, submission.submission_id)), { code: "ENOENT" });
	assert.deepEqual((await readdir(storage_root)).filter((name) => name.startsWith(".staging-")), []);

	const archived = await archiveSubmission(storage_root, submission, { delivery_targets: ["email"] });
	assert.equal(archived.duplicate, false);
	assert.deepEqual(await readFile(path.join(archived.submission_directory, "artwork.png")), PNG);
	assert.equal((await readDeliveryRecord(storage_root, submission.submission_id)).status, "pending");
});

test("racing archive publishers never overwrite an existing UUID directory", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-publish-race-"));
	const submission = createSubmission();
	const results = await Promise.all([
		archiveSubmission(storage_root, submission, { delivery_targets: ["email"] }),
		archiveSubmission(storage_root, submission, { delivery_targets: ["email"] }),
	]);
	assert.deepEqual(results.map((result) => result.duplicate).sort(), [false, true]);
	assert.deepEqual((await readdir(storage_root)).filter((name) => name.startsWith(".staging-")), []);
	assert.equal(JSON.parse(await readFile(path.join(storage_root, submission.submission_id, "submission.json"), "utf8")).submission_id, submission.submission_id);
});

test("removes only abandoned staging directories", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-staging-"));
	const old_path = path.join(storage_root, ".staging-old");
	const fresh_path = path.join(storage_root, ".staging-fresh");
	await mkdir(old_path);
	await mkdir(fresh_path);
	await utimes(old_path, new Date(0), new Date(0));
	await cleanupAbandonedStagingDirectories(storage_root, { now: 10_000, maximum_age_ms: 5_000 });
	await assert.rejects(access(old_path), { code: "ENOENT" });
	await access(fresh_path);
});

test("valid leases block peers, expired leases recover, and release checks ownership", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-lease-"));
	const submission = createSubmission();
	await archiveSubmission(storage_root, submission, { delivery_targets: ["email"] });
	const first = await acquireDeliveryLease(storage_root, submission.submission_id, {
		owner: "worker-one",
		now: 1_000,
		lease_ms: 1_000,
	});
	assert.equal(first.owner, "worker-one");
	assert.equal(
		await acquireDeliveryLease(storage_root, submission.submission_id, { owner: "worker-two", now: 1_500, lease_ms: 1_000 }),
		null,
	);
	assert.equal(await releaseDeliveryLease(storage_root, submission.submission_id, "worker-two"), false);
	const renewed = await renewDeliveryLease(storage_root, submission.submission_id, "worker-one", {
		now: 1_600,
		lease_ms: 1_000,
	});
	assert.equal(renewed.expires_at, new Date(2_600).toISOString());
	const recovered = await acquireDeliveryLease(storage_root, submission.submission_id, {
		owner: "worker-two",
		now: 2_601,
		lease_ms: 1_000,
	});
	assert.equal(recovered.owner, "worker-two");
	assert.equal(await releaseDeliveryLease(storage_root, submission.submission_id, "worker-one"), false);
	assert.equal(await releaseDeliveryLease(storage_root, submission.submission_id, "worker-two"), true);
});

test("concurrent processors make only one provider call", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-workers-"));
	const submission = createSubmission();
	await archiveSubmission(storage_root, submission, { delivery_targets: ["email"] });
	let calls = 0;
	let unblock;
	let started;
	const delivery_started = new Promise((resolve) => {
		started = resolve;
	});
	const blocked = new Promise((resolve) => {
		unblock = resolve;
	});
	const deliver = async () => {
		calls += 1;
		started();
		await blocked;
		return { id: "provider-id" };
	};
	const first = new DeliveryOutboxProcessor({ storage_root, targets: ["email"], deliver, interval_ms: 0 });
	const second = new DeliveryOutboxProcessor({ storage_root, targets: ["email"], deliver, interval_ms: 0 });
	const first_work = first.process(submission.submission_id, { force: true });
	await delivery_started;
	const second_result = await second.process(submission.submission_id, { force: true });
	assert.equal(second_result.status, "processing");
	assert.equal(calls, 1);
	unblock();
	assert.equal((await first_work).status, "delivered");
	assert.equal(calls, 1);
});

test("a transient failure is resumed by a fresh processor and delivered once", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-restart-"));
	const submission = createSubmission();
	await archiveSubmission(storage_root, submission, { delivery_targets: ["email"] });
	let now = 10_000;
	let calls = 0;
	const first = new DeliveryOutboxProcessor({
		storage_root,
		targets: ["email"],
		clock: { now: () => now },
		base_delay_ms: 100,
		interval_ms: 0,
		deliver: async () => {
			calls += 1;
			throw new Error("temporary network failure");
		},
	});
	const queued = await first.process(submission.submission_id, { force: true });
	assert.equal(queued.status, "pending");
	assert.equal(queued.attempt_count, 1);
	await first.close();

	now = 10_100;
	const restarted = new DeliveryOutboxProcessor({
		storage_root,
		targets: ["email"],
		clock: { now: () => now },
		interval_ms: 0,
		deliver: async () => {
			calls += 1;
			return { id: "recovered-message" };
		},
	});
	await restarted.start();
	assert.equal((await readDeliveryRecord(storage_root, submission.submission_id)).status, "delivered");
	assert.equal(calls, 2);
	await restarted.process(submission.submission_id, { force: true });
	assert.equal(calls, 2);
	await restarted.close();
});

test("permanent errors and exhausted retries enter the dead letter state", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-dead-"));
	const submission = createSubmission();
	await archiveSubmission(storage_root, submission, { delivery_targets: ["email"] });
	const processor = new DeliveryOutboxProcessor({
		storage_root,
		targets: ["email"],
		interval_ms: 0,
		deliver: async () => {
			const error = new Error("invalid recipient");
			error.status = 422;
			throw error;
		},
	});
	const delivery = await processor.process(submission.submission_id, { force: true });
	assert.equal(delivery.status, "dead_letter");
	assert.equal(delivery.targets.email.status, "permanently_failed");
	assert.match(delivery.last_error, /invalid recipient/);
	await processor.close();

	const exhausted_submission = createSubmission();
	await archiveSubmission(storage_root, exhausted_submission, { delivery_targets: ["email"] });
	const exhausted_processor = new DeliveryOutboxProcessor({
		storage_root,
		targets: ["email"],
		interval_ms: 0,
		maximum_attempts: 1,
		deliver: async () => {
			throw new Error("retryable timeout");
		},
	});
	assert.equal((await exhausted_processor.process(exhausted_submission.submission_id, { force: true })).status, "dead_letter");
	await exhausted_processor.close();
});

test("atomic state replacement preserves the prior valid record on failure", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "pepepaint-json-"));
	const file_path = path.join(directory, "delivery.json");
	await writeJsonAtomic(file_path, { status: "pending", attempt_count: 1 });
	await assert.rejects(
		writeJsonAtomic(file_path, { status: "delivered", attempt_count: 2 }, {
			rename_impl: async () => {
				throw new Error("simulated rename failure");
			},
		}),
		/simulated rename failure/,
	);
	assert.deepEqual(JSON.parse(await readFile(file_path, "utf8")), { status: "pending", attempt_count: 1 });
	assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".tmp")), []);
});

test("the keyed serializer cleans up after queued work", async () => {
	const serializer = createKeyedSerializer();
	await Promise.all([serializer.run("same", async () => {}), serializer.run("same", async () => {})]);
	assert.equal(serializer.size, 0);
});

test("outbox timers shut down cleanly", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-timer-"));
	const processor = new DeliveryOutboxProcessor({
		storage_root,
		targets: ["email"],
		interval_ms: 10,
		deliver: async () => ({ id: "unused" }),
	});
	await processor.start();
	assert.ok(processor.timer);
	await processor.close();
	assert.equal(processor.timer, null);
});

test("Telegram throttling is durable and does not resend delivered email", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-throttle-"));
	const submission = createSubmission();
	await archiveSubmission(storage_root, submission, { delivery_targets: ["email", "telegram"] });
	let now = 20_000;
	let email_calls = 0;
	let telegram_calls = 0;
	const processor = new DeliveryOutboxProcessor({
		storage_root,
		targets: ["email", "telegram"],
		clock: { now: () => now },
		interval_ms: 0,
		random: () => 0,
		retry_after_maximum_ms: 10_000,
		deliver: async (target) => {
			if (target === "email") {
				email_calls += 1;
				return { id: "email-id" };
			}
			telegram_calls += 1;
			throw new ProviderDeliveryError("Too Many Requests", { provider: "telegram", status: 429, retry_after_ms: 999_999_999, request_may_have_reached_provider: true });
		},
	});
	const throttled = await processor.process(submission.submission_id, { force: true });
	assert.equal(throttled.status, "throttled");
	assert.equal(throttled.targets.telegram.throttle_until, new Date(30_000).toISOString());
	assert.equal(throttled.targets.email.status, "delivered");
	now = 23_999;
	await processor.process(submission.submission_id, { force: true });
	assert.equal(email_calls, 1);
	assert.equal(telegram_calls, 1);
	await processor.close();
});

test("uncertain Telegram delivery survives restart and becomes bounded manual review", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-uncertain-"));
	const submission = createSubmission();
	await archiveSubmission(storage_root, submission, { delivery_targets: ["telegram"] });
	let now = 30_000;
	const deliver = async () => {
		throw new ProviderDeliveryError("Provider deadline exceeded", { provider: "telegram", kind: "timeout", request_may_have_reached_provider: true });
	};
	const first = new DeliveryOutboxProcessor({ storage_root, targets: ["telegram"], clock: { now: () => now }, interval_ms: 0, uncertain_delay_ms: 1_000, maximum_uncertain_attempts: 2, deliver });
	let delivery = await first.process(submission.submission_id, { force: true });
	assert.equal(delivery.status, "uncertain");
	assert.equal(delivery.targets.telegram.uncertain_attempt_count, 1);
	await first.close();
	now = 31_000;
	const restarted = new DeliveryOutboxProcessor({ storage_root, targets: ["telegram"], clock: { now: () => now }, interval_ms: 0, uncertain_delay_ms: 1_000, maximum_uncertain_attempts: 2, deliver });
	await restarted.start();
	delivery = await readDeliveryRecord(storage_root, submission.submission_id);
	assert.equal(delivery.status, "dead_letter");
	assert.equal(delivery.targets.telegram.status, "manual_review");
	await restarted.close();
});

test("schema v1 records migrate in memory and unknown versions fail safely", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-schema-"));
	const submission = createSubmission();
	const directory = path.join(storage_root, submission.submission_id);
	await mkdir(directory);
	await writeFile(path.join(directory, "delivery.json"), JSON.stringify({
		schema_version: 1,
		submission_id: submission.submission_id,
		status: "pending",
		attempt_count: 1,
		next_attempt_at: new Date(1_000).toISOString(),
		targets: { email: { status: "pending", last_error: "temporary", updated_at: new Date(0).toISOString() } },
		created_at: new Date(0).toISOString(),
		updated_at: new Date(0).toISOString(),
	}));
	assert.equal((await readDeliveryRecord(storage_root, submission.submission_id)).schema_version, 2);
	await writeFile(path.join(directory, "delivery.json"), JSON.stringify({ schema_version: 99 }));
	await assert.rejects(readDeliveryRecord(storage_root, submission.submission_id), /Unsupported delivery outbox schema/);
});

test("shutdown cancels active delivery and releases its lease", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-shutdown-"));
	const submission = createSubmission();
	await archiveSubmission(storage_root, submission, { delivery_targets: ["email"] });
	let started;
	const did_start = new Promise((resolve) => { started = resolve; });
	const processor = new DeliveryOutboxProcessor({
		storage_root,
		targets: ["email"],
		interval_ms: 0,
		deliver: async (_target, { signal }) => new Promise((_resolve, reject) => {
			started();
			signal.addEventListener("abort", () => reject(Object.assign(new Error("shutdown"), { kind: "shutdown" })), { once: true });
		}),
	});
	const work = processor.process(submission.submission_id, { force: true });
	await did_start;
	await processor.close();
	await work;
	const delivery = await readDeliveryRecord(storage_root, submission.submission_id);
	assert.equal(delivery.targets.email.status, "pending");
	assert.equal(delivery.lease, null);
	assert.equal((await acquireDeliveryLease(storage_root, submission.submission_id, { owner: "after-shutdown" }))?.owner, "after-shutdown");
});

test("an expired processing attempt recovers as uncertain without immediate resend", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-interrupted-"));
	const submission = createSubmission();
	const archived = await archiveSubmission(storage_root, submission, { delivery_targets: ["telegram"] });
	const delivery_path = path.join(archived.submission_directory, "delivery.json");
	const delivery = await readDeliveryRecord(storage_root, submission.submission_id);
	delivery.status = "processing";
	delivery.targets.telegram.status = "processing";
	delivery.targets.telegram.attempt_count = 1;
	delivery.targets.telegram.last_attempt_at = new Date(1_000).toISOString();
	await writeJsonAtomic(delivery_path, delivery);
	let calls = 0;
	const processor = new DeliveryOutboxProcessor({
		storage_root,
		targets: ["telegram"],
		clock: { now: () => 2_000 },
		interval_ms: 0,
		uncertain_delay_ms: 5_000,
		deliver: async () => { calls += 1; },
	});
	const recovered = await processor.process(submission.submission_id, { force: true });
	assert.equal(recovered.status, "uncertain");
	assert.equal(recovered.targets.telegram.last_outcome.provider_code, "worker_interrupted");
	assert.equal(recovered.targets.telegram.next_attempt_at, new Date(7_000).toISOString());
	assert.equal(calls, 0);
	await processor.close();
});
