import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	SubmissionConflictError,
	SubmissionValidationError,
	SubmissionStorageCapacityError,
	archiveSubmission,
	createSubmissionEmail,
	createSubmissionTelegramPost,
	enforceSubmissionStoragePolicy,
	sendWithTelegram,
	sendWithResend,
	updateEmailDelivery,
	updateTelegramDelivery,
	validateSubmission,
} from "../submissions.js";
import { createGif, createPepepaintGif, createPng } from "./fixtures.js";

const PNG = createPng();
const GIF = createGif();
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
				croakage: 12.5,
				rsi: 4,
				quietus_elapsed: "00:01:23",
				quietus: 0.0000026301,
				wanderlust: 456.7,
				chaos: 45.6,
				brushiness: 3,
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

test("rejects the same UUID with different accepted fields or artwork without overwriting the archive", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-submissions-"));
	const submission = createSubmission();
	await archiveSubmission(storage_root, submission);
	const original_record = await readFile(path.join(storage_root, submission.submission_id, "submission.json"), "utf8");
	const original_artwork = await readFile(path.join(storage_root, submission.submission_id, "artwork.png"));

	await assert.rejects(archiveSubmission(storage_root, { ...submission, title: "Different title" }), SubmissionConflictError);
	await assert.rejects(
		archiveSubmission(storage_root, {
			...submission,
			artwork: { ...submission.artwork, buffer: Buffer.concat([submission.artwork.buffer, Buffer.from([0])]), size_bytes: submission.artwork.size_bytes + 1 },
		}),
		SubmissionConflictError,
	);
	assert.equal(await readFile(path.join(storage_root, submission.submission_id, "submission.json"), "utf8"), original_record);
	assert.deepEqual(await readFile(path.join(storage_root, submission.submission_id, "artwork.png")), original_artwork);
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

test("Telegram exposes a valid retry_after and rejects ok:false on HTTP 200", async () => {
	const submission = createSubmission();
	const record = { ...submission, received_at: new Date().toISOString(), artwork: { filename: "artwork.png", content_type: "image/png", size_bytes: PNG.length } };
	await assert.rejects(
		sendWithTelegram({
			bot_token: "test-token",
			chat_id: "-100123",
			record,
			artwork_buffer: PNG,
			fetch_impl: async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } }) }),
		}),
		(error) => error.status === 429 && error.retry_after_ms === 7_000,
	);
});

test("Resend preserves provider code, status, and Retry-After without leaking its request", async () => {
	await assert.rejects(
		sendWithResend({
			api_key: "test-key",
			idempotency_key: "pepepaint-test",
			email: { from: "from@example.com", to: ["to@example.com"], subject: "test", text: "test" },
			fetch_impl: async () => ({
				ok: false,
				status: 429,
				headers: { get: (name) => name === "retry-after" ? "9" : null },
				json: async () => ({ name: "rate_limit_exceeded", message: "Too many requests" }),
			}),
		}),
		(error) => error.status === 429 && error.provider_code === "rate_limit_exceeded" && error.retry_after_ms === 9_000,
	);
});

test("rejects a non-image upload", () => {
	assert.throws(() => createSubmission(crypto.randomUUID(), Buffer.from("not an image")), SubmissionValidationError);
});

test("rejects signature-only, corrupt, oversized, and trailing-data artwork", () => {
	assert.throws(() => createSubmission(crypto.randomUUID(), PNG.subarray(0, 8)), /PNG artwork is (?:truncated|incomplete)/);

	const corrupt_png = Buffer.from(PNG);
	corrupt_png[corrupt_png.indexOf(Buffer.from("IDAT")) + 4] ^= 0xff;
	assert.throws(() => createSubmission(crypto.randomUUID(), corrupt_png), /integrity check/);

	assert.throws(
		() => createSubmission(crypto.randomUUID(), createPng(401, 1)),
		/Artwork dimensions must not exceed 400×560 pixels/,
	);

	const trailing_gif = Buffer.concat([GIF, Buffer.from("trailing")]);
	assert.throws(
		() =>
			validateSubmission(
				{
					submission_id: crypto.randomUUID(),
					title: "Invalid GIF",
					description: "",
					editions: "1",
					wallet_address: VALID_WALLET,
					traits: JSON.stringify({
						croakage: 1,
						rsi: 1,
						quietus_elapsed: "00:00:01",
						quietus: 1,
						wanderlust: 1,
						chaos: 1,
						brushiness: 1,
					}),
				},
				{ buffer: trailing_gif, mimetype: "image/gif" },
			),
		/trailing data/,
	);
});

test("enforces the configured GIF frame limit", () => {
	const body = {
		submission_id: crypto.randomUUID(),
		title: "Too many frames",
		description: "",
		editions: "1",
		wallet_address: VALID_WALLET,
		traits: JSON.stringify({
			croakage: 1,
			rsi: 1,
			quietus_elapsed: "00:00:01",
			quietus: 1,
			wanderlust: 1,
			chaos: 1,
			brushiness: 1,
		}),
	};
	assert.throws(
		() =>
			validateSubmission(body, { buffer: createGif(2), mimetype: "image/gif" }, {
				max_width: 400,
				max_height: 560,
				max_pixels: 400 * 560,
				max_frames: 1,
			}),
		/at most 1 frames/,
	);
});

test("accepts the literal-code GIF stream produced by the browser exporter", () => {
	const submission = validateSubmission(
		{
			submission_id: crypto.randomUUID(),
			title: "Browser GIF",
			description: "",
			editions: "1",
			wallet_address: VALID_WALLET,
			traits: JSON.stringify({
				croakage: 1,
				rsi: 1,
				quietus_elapsed: "00:00:01",
				quietus: 1,
				wanderlust: 1,
				chaos: 1,
				brushiness: 1,
			}),
		},
		{ buffer: createPepepaintGif(), mimetype: "image/gif" },
	);
	assert.deepEqual(
		{ width: submission.artwork.width, height: submission.artwork.height, frame_count: submission.artwork.frame_count },
		{ width: 20, height: 20, frame_count: 1 },
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
	assert.deepEqual(
		{
			width: archived.record.artwork.width,
			height: archived.record.artwork.height,
			frame_count: archived.record.artwork.frame_count,
		},
		{ width: 1, height: 1, frame_count: 1 },
	);
	assert.deepEqual(await readFile(path.join(storage_root, submission.submission_id, "artwork.gif")), GIF);
});

test("blocks archives that would exceed the storage capacity", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-submissions-"));
	await assert.rejects(
		enforceSubmissionStoragePolicy(storage_root, {
			submission_id: crypto.randomUUID(),
			incoming_bytes: PNG.length,
			maximum_bytes: PNG.length,
		}),
		SubmissionStorageCapacityError,
	);
});

test("removes expired archives only when retention is explicitly enabled", async () => {
	const storage_root = await mkdtemp(path.join(os.tmpdir(), "pepepaint-submissions-"));
	const old_submission = createSubmission();
	const archived = await archiveSubmission(storage_root, old_submission);
	const old_record = { ...archived.record, received_at: "2020-01-01T00:00:00.000Z" };
	await writeFile(path.join(archived.submission_directory, "submission.json"), `${JSON.stringify(old_record)}\n`);
	const old_delivery = JSON.parse(await readFile(path.join(archived.submission_directory, "delivery.json"), "utf8"));
	await writeFile(
		path.join(archived.submission_directory, "delivery.json"),
		`${JSON.stringify({ ...old_delivery, status: "delivered" })}\n`,
	);

	await enforceSubmissionStoragePolicy(storage_root, {
		submission_id: crypto.randomUUID(),
		incoming_bytes: PNG.length,
		maximum_bytes: 1024 * 1024,
		retention_ms: 24 * 60 * 60 * 1000,
		now: Date.parse("2020-01-03T00:00:00.000Z"),
	});
	await assert.rejects(access(archived.submission_directory), { code: "ENOENT" });
});
