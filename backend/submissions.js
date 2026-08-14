import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const TEZOS_ADDRESS_PATTERN = /^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;
const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ARTWORK_TYPES = new Map([
	["image/png", { extension: "png", signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }],
	["image/gif", { extension: "gif", signature: Buffer.from("GIF8", "ascii") }],
]);
const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
const TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export class SubmissionValidationError extends Error {
	constructor(message) {
		super(message);
		this.name = "SubmissionValidationError";
	}
}

function requireString(value, field_name, { min = 0, max }) {
	if (typeof value !== "string") {
		throw new SubmissionValidationError(`${field_name} is required.`);
	}

	const normalized = value.trim();
	if (normalized.length < min || normalized.length > max) {
		throw new SubmissionValidationError(`${field_name} must contain between ${min} and ${max} characters.`);
	}
	return normalized;
}

function requireNumber(value, field_name, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
		throw new SubmissionValidationError(`${field_name} is invalid.`);
	}
	return value;
}

function parseTraits(value) {
	let traits;
	try {
		traits = JSON.parse(value);
	} catch {
		throw new SubmissionValidationError("Traits must be valid JSON.");
	}

	if (!traits || typeof traits !== "object" || Array.isArray(traits)) {
		throw new SubmissionValidationError("Traits are invalid.");
	}

	return {
		croakage: requireNumber(traits.croakage, "Croakage (%)", { max: 100 }),
		rsi: requireNumber(traits.rsi, "RSi (num)", { integer: true }),
		quietus_elapsed: requireString(traits.quietus_elapsed, "Quietus elapsed time", { min: 1, max: 40 }),
		quietus: requireNumber(traits.quietus, "Quietus (%)"),
		wanderlust: requireNumber(traits.wanderlust, "Wanderlust (px)"),
		chaos: requireNumber(traits.chaos, "Cows", { max: 100 }),
		brushiness: requireNumber(traits.brushiness, "Brushiness (num)", { integer: true }),
	};
}

function normalizeArchivedTraits(traits) {
	return {
		croakage: traits.croakage ?? traits.pepeness,
		rsi: traits.rsi ?? traits.number_of_strokes,
		quietus_elapsed: traits.quietus_elapsed ?? traits.duration,
		quietus: traits.quietus,
		wanderlust: traits.wanderlust ?? traits.distance_travelled,
		chaos: traits.chaos,
		brushiness: traits.brushiness ?? traits.variety,
	};
}

function validateArtwork(file) {
	if (!file || !Buffer.isBuffer(file.buffer)) {
		throw new SubmissionValidationError("Artwork is required.");
	}

	const type = ALLOWED_ARTWORK_TYPES.get(file.mimetype);
	if (!type || file.buffer.length < type.signature.length || !file.buffer.subarray(0, type.signature.length).equals(type.signature)) {
		throw new SubmissionValidationError("Artwork must be a valid PNG or GIF file.");
	}

	return {
		buffer: file.buffer,
		content_type: file.mimetype,
		extension: type.extension,
		size_bytes: file.buffer.length,
	};
}

export function validateSubmission(body, file) {
	if (body.website) {
		throw new SubmissionValidationError("Submission rejected.");
	}

	const submission_id = requireString(body.submission_id, "Submission ID", { min: 36, max: 36 });
	if (!SUBMISSION_ID_PATTERN.test(submission_id)) {
		throw new SubmissionValidationError("Submission ID is invalid.");
	}

	const editions = Number(body.editions);
	if (!Number.isSafeInteger(editions) || editions < 1 || editions > 10000) {
		throw new SubmissionValidationError("Editions must be a whole number between 1 and 10000.");
	}

	const wallet_address = requireString(body.wallet_address, "Wallet address", { min: 36, max: 120 });
	if (!TEZOS_ADDRESS_PATTERN.test(wallet_address)) {
		throw new SubmissionValidationError("Wallet address must be a valid Tezos tz or KT1 address.");
	}

	return {
		submission_id,
		title: requireString(body.title, "Title", { min: 1, max: 120 }),
		description: requireString(body.description ?? "", "Description", { max: 1000 }),
		editions,
		wallet_address,
		traits: parseTraits(body.traits),
		artwork: validateArtwork(file),
	};
}

async function writeJsonAtomic(file_path, value) {
	const temporary_path = `${file_path}.${randomUUID()}.tmp`;
	await writeFile(temporary_path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
	await rename(temporary_path, file_path);
}

export async function readArchivedSubmission(storage_root, submission_id) {
	const json_path = path.join(storage_root, submission_id, "submission.json");
	try {
		return JSON.parse(await readFile(json_path, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

export async function archiveSubmission(storage_root, submission) {
	const submission_directory = path.join(storage_root, submission.submission_id);
	const existing = await readArchivedSubmission(storage_root, submission.submission_id);
	if (existing) {
		return { record: existing, duplicate: true, submission_directory };
	}

	await mkdir(submission_directory, { recursive: true, mode: 0o700 });
	const artwork_filename = `artwork.${submission.artwork.extension}`;
	const artwork_path = path.join(submission_directory, artwork_filename);
	await writeFile(artwork_path, submission.artwork.buffer, { flag: "wx", mode: 0o600 });

	const record = {
		schema_version: 2,
		submission_id: submission.submission_id,
		received_at: new Date().toISOString(),
		title: submission.title,
		description: submission.description,
		editions: submission.editions,
		wallet_address: submission.wallet_address,
		traits: submission.traits,
		artwork: {
			filename: artwork_filename,
			content_type: submission.artwork.content_type,
			size_bytes: submission.artwork.size_bytes,
		},
		email_delivery: {
			status: "pending",
			message_id: null,
			updated_at: null,
		},
		telegram_delivery: {
			status: "pending",
			message_id: null,
			method: null,
			updated_at: null,
		},
	};
	await writeJsonAtomic(path.join(submission_directory, "submission.json"), record);
	return { record, duplicate: false, submission_directory };
}

export async function updateEmailDelivery(storage_root, record, status, message_id = null, error_message = null) {
	const updated_record = {
		...record,
		email_delivery: {
			status,
			message_id,
			error: error_message,
			updated_at: new Date().toISOString(),
		},
	};
	await writeJsonAtomic(path.join(storage_root, record.submission_id, "submission.json"), updated_record);
	return updated_record;
}

export async function updateTelegramDelivery(storage_root, record, status, message_id = null, method = null, error_message = null) {
	const updated_record = {
		...record,
		telegram_delivery: {
			status,
			message_id,
			method,
			error: error_message,
			updated_at: new Date().toISOString(),
		},
	};
	await writeJsonAtomic(path.join(storage_root, record.submission_id, "submission.json"), updated_record);
	return updated_record;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function formatQuietusPercentage(value) {
	return value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

export function createSubmissionEmail(record, artwork_buffer, from, to) {
	const description = record.description || "(none)";
	const traits = normalizeArchivedTraits(record.traits);
	const rows = [
		["Submission ID", record.submission_id],
		["Received", record.received_at],
		["Title", record.title],
		["Description", description],
		["Editions", record.editions],
		["Wallet address", record.wallet_address],
		["Croakage (%)", traits.croakage],
		["RSi (num)", traits.rsi],
		["Quietus elapsed time", traits.quietus_elapsed],
		["Quietus (%)", formatQuietusPercentage(traits.quietus)],
		["Wanderlust (px)", traits.wanderlust],
		["Cows", traits.chaos],
		["Brushiness (num)", traits.brushiness],
	];
	const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
	const html_rows = rows
		.map(([label, value]) => `<tr><th align="left" valign="top">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
		.join("");

	return {
		from,
		to: [to],
		subject: `PEPEPAINT submission: ${record.title}`,
		text,
		html: `<h1>PEPEPAINT submission</h1><table cellpadding="6" cellspacing="0">${html_rows}</table>`,
		attachments: [
			{
				filename: record.artwork.filename,
				content: artwork_buffer.toString("base64"),
			},
		],
	};
}

export async function sendWithResend({ api_key, idempotency_key, email }) {
	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${api_key}`,
			"Content-Type": "application/json",
			"Idempotency-Key": idempotency_key,
		},
		body: JSON.stringify(email),
	});
	const result = await response.json().catch(() => ({}));
	if (!response.ok || typeof result.id !== "string") {
		throw new Error(result.message || `Resend returned HTTP ${response.status}.`);
	}
	return result;
}

function truncateText(value, maximum_length) {
	if (value.length <= maximum_length) return value;
	if (maximum_length <= 0) return "";
	if (maximum_length === 1) return "…";
	return `${value.slice(0, maximum_length - 1)}…`;
}

export function createSubmissionTelegramPost(record) {
	const header = `PEPEPAINT submission\nTitle: ${record.title}\nDescription: `;
	const traits = normalizeArchivedTraits(record.traits);
	const quietus_percentage = formatQuietusPercentage(traits.quietus);
	const suffix = [
		`Editions: ${record.editions}`,
		`Wallet address: ${record.wallet_address}`,
		`Croakage (%): ${traits.croakage}`,
		`RSi (num): ${traits.rsi}`,
		`Quietus (%): ${quietus_percentage}`,
		`Wanderlust (px): ${traits.wanderlust}`,
		`Cows: ${traits.chaos}`,
		`Brushiness (num): ${traits.brushiness}`,
		`Submission ID: ${record.submission_id}`,
	].join("\n");
	const description = record.description || "(none)";
	const description_length = Math.max(0, TELEGRAM_CAPTION_MAX_LENGTH - header.length - suffix.length - 1);
	const caption = `${header}${truncateText(description, description_length)}\n${suffix}`;

	if (record.artwork.content_type === "image/gif") {
		return { method: "sendAnimation", media_field: "animation", caption };
	}
	if (record.artwork.size_bytes > TELEGRAM_PHOTO_MAX_BYTES) {
		return { method: "sendDocument", media_field: "document", caption };
	}
	return { method: "sendPhoto", media_field: "photo", caption };
}

export async function sendWithTelegram({ bot_token, chat_id, record, artwork_buffer, fetch_impl = fetch }) {
	const post = createSubmissionTelegramPost(record);
	const form = new FormData();
	form.set("chat_id", String(chat_id));
	form.set("caption", post.caption);
	form.set(post.media_field, new Blob([artwork_buffer], { type: record.artwork.content_type }), record.artwork.filename);

	const response = await fetch_impl(`https://api.telegram.org/bot${bot_token}/${post.method}`, {
		method: "POST",
		body: form,
	});
	const result = await response.json().catch(() => ({}));
	if (!response.ok || result.ok !== true || !Number.isSafeInteger(result.result?.message_id)) {
		throw new Error(result.description || `Telegram returned HTTP ${response.status}.`);
	}
	return { message_id: result.result.message_id, method: post.method };
}
