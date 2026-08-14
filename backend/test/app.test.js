import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSubmissionApp } from "../app.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const VALID_WALLET = "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb";

function createSubmissionForm(submission_id) {
	const form = new FormData();
	form.set("submission_id", submission_id);
	form.set("title", "Integration test artwork");
	form.set("description", "Submission delivery test");
	form.set("editions", "2");
	form.set("wallet_address", VALID_WALLET);
	form.set(
		"traits",
		JSON.stringify({
			pepeness: 50,
			number_of_strokes: 6,
			duration: "00:00:30",
			quietus: 9.506e-7,
			distance_travelled: 120,
			chaos: 20,
			variety: 4,
		}),
	);
	form.set("artwork", new Blob([PNG], { type: "image/png" }), "artwork.png");
	return form;
}

async function startApp(options) {
	const app = createSubmissionApp({ ...options, serve_frontend: false, rate_maximum: 100 });
	const server = await new Promise((resolve, reject) => {
		const listening_server = app.listen(0, "127.0.0.1");
		listening_server.once("listening", () => resolve(listening_server));
		listening_server.once("error", reject);
	});
	const address = server.address();
	return {
		url: `http://127.0.0.1:${address.port}`,
		close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
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

		const record = JSON.parse(await readFile(path.join(storage_root, submission_id, "submission.json"), "utf8"));
		assert.equal(record.email_delivery.status, "sent");
		assert.equal(record.telegram_delivery.status, "sent");
		assert.equal(record.telegram_delivery.message_id, 88);
	} finally {
		await server.close();
	}
});

test("retries only the failed Telegram delivery", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-app-"));
	const submission_id = crypto.randomUUID();
	let email_calls = 0;
	let telegram_calls = 0;
	const server = await startApp(
		configuredOptions(storage_root, {
			deliver_email: async () => {
				email_calls += 1;
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
		assert.equal(first.status, 502);

		let record = JSON.parse(await readFile(path.join(storage_root, submission_id, "submission.json"), "utf8"));
		assert.equal(record.email_delivery.status, "sent");
		assert.equal(record.telegram_delivery.status, "failed");

		const retry = await fetch(`${server.url}/api/submissions`, { method: "POST", body: createSubmissionForm(submission_id) });
		assert.equal(retry.status, 201);
		assert.equal(email_calls, 1);
		assert.equal(telegram_calls, 2);
		record = JSON.parse(await readFile(path.join(storage_root, submission_id, "submission.json"), "utf8"));
		assert.equal(record.telegram_delivery.status, "sent");
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
