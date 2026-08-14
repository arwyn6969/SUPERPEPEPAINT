import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSubmissionApp } from "../app.js";
import { ProviderDeliveryError } from "../provider-delivery.js";
import { createPng } from "./fixtures.js";

const PNG = createPng();
const VALID_WALLET = "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb";

function createSubmissionForm(submission_id, artwork = PNG, content_type = "image/png") {
	const form = new FormData();
	form.set("submission_id", submission_id);
	form.set("title", "Integration test artwork");
	form.set("description", "Submission delivery test");
	form.set("editions", "2");
	form.set("wallet_address", VALID_WALLET);
	form.set(
		"traits",
		JSON.stringify({
			croakage: 50,
			rsi: 6,
			quietus_elapsed: "00:00:30",
			quietus: 9.506e-7,
			wanderlust: 120,
			chaos: 20,
			brushiness: 4,
		}),
	);
	form.set("artwork", new Blob([artwork], { type: content_type }), content_type === "image/gif" ? "artwork.gif" : "artwork.png");
	return form;
}

async function startApp(options) {
	const app = createSubmissionApp({ ...options, serve_frontend: false, rate_maximum: 100 });
	await app.locals.ready;
	const server = await new Promise((resolve, reject) => {
		const listening_server = app.listen(0, "127.0.0.1");
		listening_server.once("listening", () => resolve(listening_server));
		listening_server.once("error", reject);
	});
	const address = server.address();
	return {
		url: `http://127.0.0.1:${address.port}`,
		close: async () => {
			await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			await app.locals.close();
		},
		app,
	};
}

function configuredOptions(storage_root, overrides = {}) {
	return {
		storage_root,
		api_key: "email-test-key",
		from: "PEPEPAINT <submissions@example.com>",
		to: "owner@example.com",
		telegram_bot_token: "telegram-test-token",
		telegram_chat_id: "-100123",
		...overrides,
	};
}

test("archives before delivery and does not redeliver a completed duplicate", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	const submission_id = crypto.randomUUID();
	let email_calls = 0;
	let telegram_calls = 0;
	const server = await startApp(
		configuredOptions(storage_root, {
			deliver_email: async () => {
				email_calls += 1;
				await readFile(path.join(storage_root, submission_id, "submission.json"));
				await readFile(path.join(storage_root, submission_id, "artwork.png"));
				return { id: "email-message-id" };
			},
			deliver_telegram: async () => {
				telegram_calls += 1;
				return { message_id: 88, method: "sendPhoto" };
			},
		}),
	);

	try {
		const first = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) });
		assert.equal(first.status, 201);
		const duplicate = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) });
		assert.equal(duplicate.status, 200);
		assert.equal(email_calls, 1);
		assert.equal(telegram_calls, 1);

		const delivery = JSON.parse(await readFile(path.join(storage_root, submission_id, "delivery.json"), "utf8"));
		assert.equal(delivery.status, "delivered");
		assert.equal(delivery.targets.email.status, "delivered");
		assert.equal(delivery.targets.telegram.message_id, 88);
	} finally {
		await server.close();
	}
});

test("returns 409 for a same-UUID payload conflict without redelivery", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	const submission_id = crypto.randomUUID();
	let delivery_calls = 0;
	const server = await startApp(
		configuredOptions(storage_root, {
			telegram_bot_token: "",
			telegram_chat_id: "",
			deliver_email: async () => {
				delivery_calls += 1;
				return { id: "one-message" };
			},
		}),
	);

	try {
		assert.equal((await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) })).status, 201);
		const conflicting_form = createSubmissionForm(submission_id);
		conflicting_form.set("title", "Different accepted title");
		const conflict = await fetch(`${server.url}/api/submissions`, { method: "POST", body: conflicting_form });
		assert.equal(conflict.status, 409);
		assert.deepEqual(await conflict.json(), {
			submission_id,
			status: "conflict",
			error: "This submission ID is already associated with different content.",
		});
		assert.equal(delivery_calls, 1);
		assert.equal(JSON.parse(await readFile(path.join(storage_root, submission_id, "submission.json"), "utf8")).title, "Integration test artwork");
	} finally {
		await server.close();
	}
});

test("serializes two concurrent requests for the same UUID", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	const submission_id = crypto.randomUUID();
	let delivery_calls = 0;
	const server = await startApp(
		configuredOptions(storage_root, {
			telegram_bot_token: "",
			telegram_chat_id: "",
			deliver_email: async () => {
				delivery_calls += 1;
				await new Promise((resolve) => setTimeout(resolve, 10));
				return { id: "one-message" };
			},
		}),
	);

	try {
		const responses = await Promise.all([
			fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) }),
			fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) }),
		]);
		assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
		assert.equal(delivery_calls, 1);
		assert.equal(JSON.parse(await readFile(path.join(storage_root, submission_id, "delivery.json"), "utf8")).status, "delivered");
	} finally {
		await server.close();
	}
});

test("retries only the failed Telegram delivery", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	const submission_id = crypto.randomUUID();
	let email_calls = 0;
	let telegram_calls = 0;
	const idempotency_keys = [];
	let now = Date.now() + 10_000;
	const server = await startApp(
		configuredOptions(storage_root, {
			clock: { now: () => now },
			retry_base_delay_ms: 1_000,
			retry_jitter_percent: 0,
			deliver_email: async ({ idempotency_key }) => {
				email_calls += 1;
				idempotency_keys.push(idempotency_key);
				return { id: "email-message-id" };
			},
			deliver_telegram: async () => {
				telegram_calls += 1;
				if (telegram_calls === 1) throw new Error("Temporary Telegram failure");
				return { message_id: 89, method: "sendPhoto" };
			},
		}),
	);

	try {
		const original_console_error = console.error;
		console.error = () => {};
		let first;
		try {
			first = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) });
		} finally {
			console.error = original_console_error;
		}
		assert.equal(first.status, 202);
		assert.equal((await first.json()).status, "queued");

		let delivery = JSON.parse(await readFile(path.join(storage_root, submission_id, "delivery.json"), "utf8"));
		assert.equal(delivery.targets.email.status, "delivered");
		assert.equal(delivery.targets.telegram.status, "pending");

		now += 1_000;
		const retry = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) });
		assert.equal(retry.status, 200);
		assert.equal(email_calls, 1);
		assert.equal(telegram_calls, 2);
		assert.deepEqual(idempotency_keys, [`pepepaint-${submission_id}`]);
		delivery = JSON.parse(await readFile(path.join(storage_root, submission_id, "delivery.json"), "utf8"));
		assert.equal(delivery.targets.telegram.status, "delivered");
	} finally {
		await server.close();
	}
});

test("reuses the exact Resend idempotency key across retries", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	const submission_id = crypto.randomUUID();
	const keys = [];
	let now = Date.now() + 10_000;
	const server = await startApp(
		configuredOptions(storage_root, {
			clock: { now: () => now },
			retry_base_delay_ms: 1_000,
			retry_jitter_percent: 0,
			telegram_bot_token: "",
			telegram_chat_id: "",
			deliver_email: async ({ idempotency_key }) => {
				keys.push(idempotency_key);
				if (keys.length === 1) throw new Error("temporary Resend timeout");
				return { id: "resend-message-id" };
			},
		}),
	);

	try {
		const first = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) });
		assert.equal(first.status, 202);
		now += 1_000;
		const retry = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) });
		assert.equal(retry.status, 200);
		assert.deepEqual(keys, [`pepepaint-${submission_id}`, `pepepaint-${submission_id}`]);
		const delivered = JSON.parse(await readFile(path.join(storage_root, submission_id, "delivery.json"), "utf8"));
		assert.equal(delivered.targets.email.message_id, "resend-message-id");
	} finally {
		await server.close();
	}
});

test("supports Telegram-only delivery when Resend has no API key", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	const submission_id = crypto.randomUUID();
	let email_calls = 0;
	let telegram_calls = 0;
	const server = await startApp(
		configuredOptions(storage_root, {
			api_key: "",
			email_enabled: false,
			deliver_email: async () => {
				email_calls += 1;
				return { id: "unexpected-email" };
			},
			deliver_telegram: async () => {
				telegram_calls += 1;
				return { message_id: 90, method: "sendPhoto" };
			},
		}),
	);

	try {
		const response = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) });
		assert.equal(response.status, 201);
		assert.equal(email_calls, 0);
		assert.equal(telegram_calls, 1);
	} finally {
		await server.close();
	}
});

test("an archived provider timeout reports uncertain and a browser retry preserves its schedule and key", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	const submission_id = crypto.randomUUID();
	const keys = [];
	const server = await startApp(configuredOptions(storage_root, {
		telegram_bot_token: "",
		telegram_chat_id: "",
		uncertain_delay_ms: 60_000,
		deliver_email: async ({ idempotency_key }) => {
			keys.push(idempotency_key);
			throw new ProviderDeliveryError("Provider deadline exceeded", { provider: "resend", kind: "timeout", request_may_have_reached_provider: true });
		},
	}));
	try {
		const first = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) });
		assert.equal(first.status, 202);
		assert.equal((await first.json()).status, "uncertain");
		const retry = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) });
		assert.equal(retry.status, 202);
		assert.equal((await retry.json()).status, "uncertain");
		assert.deepEqual(keys, [`pepepaint-${submission_id}`]);
	} finally {
		await server.close();
	}
});

test("rejects a second request while global submission processing is at capacity", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	let release_delivery;
	let delivery_started;
	const started = new Promise((resolve) => {
		delivery_started = resolve;
	});
	const blocked_delivery = new Promise((resolve) => {
		release_delivery = resolve;
	});
	const server = await startApp(
		configuredOptions(storage_root, {
			concurrent_maximum: 1,
			telegram_bot_token: "",
			telegram_chat_id: "",
			deliver_email: async () => {
				delivery_started();
				await blocked_delivery;
				return { id: "email-message-id" };
			},
		}),
	);

	try {
		const first_request = fetch(`${server.url}/api/submissions`, {
			method: "POST",
			body: createSubmissionForm(crypto.randomUUID()),
		});
		await started;
		const busy = await fetch(`${server.url}/api/submissions`, {
			method: "POST",
			body: createSubmissionForm(crypto.randomUUID()),
		});
		assert.equal(busy.status, 503);
		assert.equal(busy.headers.get("retry-after"), "5");
		release_delivery();
		assert.equal((await first_request).status, 201);
	} finally {
		release_delivery();
		await server.close();
	}
});

test("returns storage capacity errors without calling delivery services", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	let delivery_calls = 0;
	const server = await startApp(
		configuredOptions(storage_root, {
			storage_maximum_bytes: 1,
			telegram_bot_token: "",
			telegram_chat_id: "",
			deliver_email: async () => {
				delivery_calls += 1;
				return { id: "unexpected-email" };
			},
		}),
	);

	try {
		const response = await fetch(`${server.url}/api/submissions`, {
			method: "POST",
			body: createSubmissionForm(crypto.randomUUID()),
		});
		assert.equal(response.status, 507);
		assert.equal(delivery_calls, 0);
	} finally {
		await server.close();
	}
});

test("rejects signature-prefixed malformed artwork before delivery", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	let delivery_calls = 0;
	const server = await startApp(
		configuredOptions(storage_root, {
			telegram_bot_token: "",
			telegram_chat_id: "",
			deliver_email: async () => {
				delivery_calls += 1;
				return { id: "unexpected-email" };
			},
		}),
	);

	try {
		const response = await fetch(`${server.url}/api/submissions`, {
			method: "POST",
			body: createSubmissionForm(crypto.randomUUID(), PNG.subarray(0, 8)),
		});
		assert.equal(response.status, 400);
		assert.equal(delivery_calls, 0);
	} finally {
		await server.close();
	}
});

test("enforces the configured multipart file-size limit", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	let delivery_calls = 0;
	const server = await startApp(
		configuredOptions(storage_root, {
			max_file_bytes: PNG.length - 1,
			telegram_bot_token: "",
			telegram_chat_id: "",
			deliver_email: async () => {
				delivery_calls += 1;
				return { id: "unexpected-email" };
			},
		}),
	);

	try {
		const response = await fetch(`${server.url}/api/submissions`, {
			method: "POST",
			body: createSubmissionForm(crypto.randomUUID()),
		});
		assert.equal(response.status, 400);
		assert.deepEqual(await response.json(), { error: "Artwork is too large." });
		assert.equal(delivery_calls, 0);
	} finally {
		await server.close();
	}
});

test("health stays live while readiness gates new uploads and reconciles an archived UUID read-only", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-ready-"));
	const submission_id = crypto.randomUUID();
	let delivery_calls = 0;
	const server = await startApp(configuredOptions(storage_root, {
		telegram_bot_token: "",
		telegram_chat_id: "",
		deliver_email: async () => {
			delivery_calls += 1;
			return { id: "delivered-before-fault" };
		},
	}));
	try {
		assert.deepEqual(await (await fetch(`${server.url}/api/health`)).json(), { status: "ok" });
		assert.equal((await fetch(`${server.url}/api/ready`)).status, 200);
		assert.equal((await fetch(`${server.url}/api/submissions`, {
			method: "POST",
			headers: { "X-Submission-ID": submission_id },
			body: createSubmissionForm(submission_id),
		})).status, 201);
		server.app.locals.readiness.markDurabilityFailure("test_fault", Object.assign(new Error("private /path"), { code: "EROFS" }));
		const readiness = await fetch(`${server.url}/api/ready`);
		assert.equal(readiness.status, 503);
		assert.deepEqual(await readiness.json(), {
			status: "not_ready",
			checks: { configuration: "ok", archive: "failed", outbox: "failed", delivery: "ok" },
		});
		assert.equal((await fetch(`${server.url}/api/health`)).status, 200);
		const rejected = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(crypto.randomUUID()) });
		assert.equal(rejected.status, 503);
		assert.equal(rejected.headers.get("retry-after"), "10");
		const reconciled = await fetch(`${server.url}/api/submissions`, {
			method: "POST",
			headers: { "X-Submission-ID": submission_id },
			body: createSubmissionForm(submission_id),
		});
		assert.equal(reconciled.status, 200);
		assert.equal(delivery_calls, 1);
	} finally {
		await server.close();
	}
});

test("a runtime archive write failure returns 503 and invalidates readiness", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-write-fault-"));
	const server = await startApp(configuredOptions(storage_root, {
		telegram_bot_token: "",
		telegram_chat_id: "",
		archive_submission: async () => { throw Object.assign(new Error("private archive path"), { code: "EROFS" }); },
		deliver_email: async () => { throw new Error("provider must not be called"); },
	}));
	try {
		const response = await fetch(`${server.url}/api/submissions`, {
			method: "POST",
			headers: { "X-Submission-ID": crypto.randomUUID() },
			body: createSubmissionForm(crypto.randomUUID()),
		});
		assert.equal(response.status, 503);
		assert.equal((await fetch(`${server.url}/api/ready`)).status, 503);
		assert.deepEqual(await readdir(storage_root), []);
	} finally {
		await server.close();
	}
});

test("startup probe and worker failures reject initialization before provider work", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-startup-fault-"));
	let provider_calls = 0;
	const probe_failure_app = createSubmissionApp(configuredOptions(storage_root, {
		serve_frontend: false,
		telegram_bot_token: "",
		telegram_chat_id: "",
		logger: { error() {}, info() {} },
		readiness_probe: async () => { throw Object.assign(new Error("unusable archive"), { code: "EROFS" }); },
		deliver_email: async () => { provider_calls += 1; },
	}));
	await assert.rejects(probe_failure_app.locals.ready, /unusable archive/);
	assert.equal(provider_calls, 0);
	await probe_failure_app.locals.close();

	let worker_started = 0;
	const worker_failure = {
		async start() { worker_started += 1; throw new Error("worker schema incompatible"); },
		async close() {},
		async process() { provider_calls += 1; },
	};
	const worker_failure_app = createSubmissionApp(configuredOptions(storage_root, {
		serve_frontend: false,
		telegram_bot_token: "",
		telegram_chat_id: "",
		logger: { error() {}, info() {} },
		delivery_processor: worker_failure,
		deliver_email: async () => { provider_calls += 1; },
	}));
	await assert.rejects(worker_failure_app.locals.ready, /worker schema incompatible/);
	assert.equal(worker_started, 1);
	assert.equal(provider_calls, 0);
	await worker_failure_app.locals.close();
});
