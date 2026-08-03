import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	SubmissionValidationError,
	archiveSubmission,
	createSubmissionEmail,
	updateEmailDelivery,
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
	const delivered = await updateEmailDelivery(storage_root, archived.record, "sent", "email-test-id");

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
