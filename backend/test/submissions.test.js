import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	SubmissionValidationError,
	archiveSubmission,
	createSubmissionEmail,
	createSubmissionTelegramPost,
	sendWithTelegram,
	updateEmailDelivery,
	updateTelegramDelivery,
	validateSubmission,
} from "../submissions.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = Buffer.from("GIF89a-test", "ascii");
const VALID_WALLET = "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb";

function createSubmission(submission_id = crypto.randomUUID(), artwork = PNG) {
	return validateSubmission(
		{
			submission_id,
			title: "Test artwork",
			description: "A test submission",
			editions: "3",
			wallet_address: VALID_WALLET,
			traits: JSON.stringify({
				pepeness: 12.5,
				number_of_strokes: 4,
				duration: "00:01:23",
				distance_travelled: 456.7,
				chaos: 45.6,
				variety: 3,
			}),
		},
		{ buffer: artwork, mimetype: "image/png" },
	);
}

test("archives a submission with only the selected traits", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-submissions-"));
	const submission = createSubmission();
	const archived = await archiveSubmission(storage_root, submission);
	const emailed = await updateEmailDelivery(storage_root, archived.record, "sent", "email-test-id");
	const delivered = await updateTelegramDelivery(storage_root, emailed, "sent", 42, "sendPhoto");

	const record = JSON.parse(await readFile(path.join(storage_root, submission.submission_id, "submission.json"), "utf8"));
	assert.deepEqual(record.traits, {
		pepeness: 12.5,
		number_of_strokes: 4,
		duration: "00:01:23",
		distance_travelled: 456.7,
		chaos: 45.6,
		variety: 3,
	});
	assert.equal(record.email_delivery.status, "sent");
	assert.equal(delivered.email_delivery.message_id, "email-test-id");
	assert.equal(record.telegram_delivery.status, "sent");
	assert.equal(delivered.telegram_delivery.message_id, 42);
	assert.equal(delivered.telegram_delivery.method, "sendPhoto");
	assert.deepEqual(await readFile(path.join(storage_root, submission.submission_id, "artwork.png")), PNG);
});

test("recognizes an already archived submission", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-submissions-"));
	const submission = createSubmission();
	const first = await archiveSubmission(storage_root, submission);
	const second = await archiveSubmission(storage_root, submission);
	assert.equal(first.duplicate, false);
	assert.equal(second.duplicate, true);
	assert.equal(second.record.submission_id, submission.submission_id);
});

test("builds an email containing the selected values and artwork", () => {
	const submission = createSubmission();
	const record = {
		...submission,
		received_at: new Date().toISOString(),
		artwork: { filename: "artwork.png", content_type: "image/png", size_bytes: PNG.length },
	};
	const email = createSubmissionEmail(record, PNG, "submissions@example.com", "owner@example.com");
	assert.match(email.text, /PEPENESS: 12.5/);
	assert.match(email.text, /Duration: 00:01:23/);
	assert.equal(email.attachments[0].filename, "artwork.png");
	assert.equal(email.attachments[0].content, PNG.toString("base64"));
});

test("builds a compact Telegram photo post containing the selected values", () => {
	const submission = createSubmission();
	const record = {
		...submission,
		description: "x".repeat(1000),
		received_at: new Date().toISOString(),
		artwork: { filename: "artwork.png", content_type: "image/png", size_bytes: PNG.length },
	};
	const post = createSubmissionTelegramPost(record);
	assert.equal(post.method, "sendPhoto");
	assert.equal(post.media_field, "photo");
	assert.ok(post.caption.length <= 1024);
	assert.match(post.caption, /PEPENESS: 12.5/);
	assert.match(post.caption, new RegExp(`Submission ID: ${record.submission_id}`));
	assert.match(post.caption, /…/);
});

test("selects Telegram animation and document methods for GIFs and large PNGs", () => {
	const submission = createSubmission();
	const base_record = {
		...submission,
		received_at: new Date().toISOString(),
		artwork: { filename: "artwork.gif", content_type: "image/gif", size_bytes: GIF.length },
	};
	assert.equal(createSubmissionTelegramPost(base_record).method, "sendAnimation");
	assert.equal(
		createSubmissionTelegramPost({
			...base_record,
			artwork: { filename: "artwork.png", content_type: "image/png", size_bytes: 10 * 1024 * 1024 + 1 },
		}).method,
		"sendDocument",
	);
});

test("uploads Telegram artwork and returns its message identifier", async () => {
	const submission = createSubmission();
	const record = {
		...submission,
		received_at: new Date().toISOString(),
		artwork: { filename: "artwork.png", content_type: "image/png", size_bytes: PNG.length },
	};
	let request;
	const delivery = await sendWithTelegram({
		bot_token: "test-token",
		chat_id: "-100123",
		record,
		artwork_buffer: PNG,
		fetch_impl: async (url, options) => {
			request = { url, options };
			return {
				ok: true,
				status: 200,
				json: async () => ({ ok: true, result: { message_id: 73 } }),
			};
		},
	});

	assert.equal(request.url, "https://api.telegram.org/bottest-token/sendPhoto");
	assert.equal(request.options.method, "POST");
	assert.equal(request.options.body.get("chat_id"), "-100123");
	assert.equal(request.options.body.get("photo").name, "artwork.png");
	assert.deepEqual(delivery, { message_id: 73, method: "sendPhoto" });
});

test("reports Telegram API errors without treating them as delivered", async () => {
	const submission = createSubmission();
	const record = {
		...submission,
		received_at: new Date().toISOString(),
		artwork: { filename: "artwork.png", content_type: "image/png", size_bytes: PNG.length },
	};
	await assert.rejects(
		sendWithTelegram({
			bot_token: "test-token",
			chat_id: "-100123",
			record,
			artwork_buffer: PNG,
			fetch_impl: async () => ({
				ok: false,
				status: 403,
				json: async () => ({ ok: false, description: "Forbidden: bot cannot send messages" }),
			}),
		}),
		/Forbidden: bot cannot send messages/,
	);
});

test("rejects a non-image upload", () => {
	assert.throws(() => createSubmission(crypto.randomUUID(), Buffer.from("not an image")), SubmissionValidationError);
});

test("accepts and archives animated GIF artwork", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-submissions-"));
	const submission = validateSubmission(
		{
			submission_id: crypto.randomUUID(),
			title: "Animated test",
			description: "",
			editions: "1",
			wallet_address: VALID_WALLET,
			traits: JSON.stringify({ pepeness: 1, number_of_strokes: 2, duration: "00:00:03", distance_travelled: 4, chaos: 5, variety: 1 }),
		},
		{ buffer: GIF, mimetype: "image/gif" },
	);
	const archived = await archiveSubmission(storage_root, submission);
	assert.equal(archived.record.artwork.filename, "artwork.gif");
	assert.deepEqual(await readFile(path.join(storage_root, submission.submission_id, "artwork.gif")), GIF);
});
