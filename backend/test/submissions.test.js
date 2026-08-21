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

function createSubmission(submission_id = crypto.randomUUID(), artwork = PNG, trait_overrides = {}) {
	return validateSubmission(
		{
			submission_id,
			title: "Test artwork",
			description: "A test submission",
			editions: "3",
			wallet_address: VALID_WALLET,
			traits: JSON.stringify({
				croakage: 12.5,
				rsi: 4,
				quietus_elapsed: "00:01:23",
				quietus: 0.0000026301,
				wanderlust: 456.7,
				chaos: 45.6,
				brushiness: 3,
				...trait_overrides,
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
		croakage: 12.5,
		rsi: 4,
		quietus_elapsed: "00:01:23",
		quietus: 0.0000026301,
		wanderlust: 456.7,
		chaos: 45.6,
		brushiness: 3,
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
	assert.match(email.text, /Croakage \(%\): 12.5/);
	assert.match(email.text, /RSi \(num\): 4/);
	assert.match(email.text, /Quietus elapsed time: 00:01:23/);
	assert.match(email.text, /Quietus \(%\): 0\.0000026301/);
	assert.match(email.text, /Wanderlust \(px\): 456.7/);
	assert.match(email.text, /Cows: 45.6/);
	assert.match(email.text, /Brushiness \(num\): 3/);
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
	assert.match(post.caption, /Croakage \(%\): 12.5/);
	assert.match(post.caption, /RSi \(num\): 4/);
	assert.match(post.caption, /Quietus \(%\): 0\.0000026301/);
	assert.match(post.caption, /Wanderlust \(px\): 456.7/);
	assert.match(post.caption, /Cows: 45.6/);
	assert.match(post.caption, /Brushiness \(num\): 3/);
	assert.match(post.caption, new RegExp(`Submission ID: ${record.submission_id}`));
	assert.match(post.caption, /…/);
});

test("renders delivery output for archives created before the trait rename", () => {
	const submission = createSubmission();
	const record = {
		...submission,
		traits: {
			pepeness: submission.traits.croakage,
			number_of_strokes: submission.traits.rsi,
			duration: submission.traits.quietus_elapsed,
			quietus: submission.traits.quietus,
			distance_travelled: submission.traits.wanderlust,
			chaos: submission.traits.chaos,
			variety: submission.traits.brushiness,
		},
		received_at: new Date().toISOString(),
		artwork: { filename: "artwork.png", content_type: "image/png", size_bytes: PNG.length },
	};

	const email = createSubmissionEmail(record, PNG, "submissions@example.com", "owner@example.com");
	const post = createSubmissionTelegramPost(record);
	assert.match(email.text, /Croakage \(%\): 12.5/);
	assert.match(email.text, /Brushiness \(num\): 3/);
	assert.match(post.caption, /RSi \(num\): 4/);
	assert.match(post.caption, /Wanderlust \(px\): 456.7/);
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

test("rejects Quietus percentages above 100", () => {
	assert.throws(() => createSubmission(crypto.randomUUID(), PNG, { quietus: 100.0001 }), SubmissionValidationError);
});

test("accepts any alphanumeric wallet address", () => {
	const submission = createSubmission();
	const body = {
		submission_id: crypto.randomUUID(),
		title: submission.title,
		description: submission.description,
		editions: String(submission.editions),
		wallet_address: "AnyAddress123",
		traits: JSON.stringify(submission.traits),
	};

	assert.equal(validateSubmission(body, { buffer: PNG, mimetype: "image/png" }).wallet_address, "AnyAddress123");
	assert.throws(
		() => validateSubmission({ ...body, wallet_address: "not an address" }, { buffer: PNG, mimetype: "image/png" }),
		/letters and numbers only/,
	);
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
			traits: JSON.stringify({
				croakage: 1,
				rsi: 2,
				quietus_elapsed: "00:00:03",
				quietus: 9.5064e-8,
				wanderlust: 4,
				chaos: 5,
				brushiness: 1,
			}),
		},
		{ buffer: GIF, mimetype: "image/gif" },
	);
	const archived = await archiveSubmission(storage_root, submission);
	assert.equal(archived.record.artwork.filename, "artwork.gif");
	assert.deepEqual(await readFile(path.join(storage_root, submission.submission_id, "artwork.gif")), GIF);
});
