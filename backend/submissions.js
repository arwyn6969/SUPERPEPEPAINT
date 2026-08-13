import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { createDeliveryRecord, syncDirectory, writeFileSynced, writeJsonAtomic } from "./delivery-outbox.js";

const TEZOS_ADDRESS_PATTERN = /^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;
const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ARTWORK_TYPES = new Map([
	["image/png", { extension: "png" }],
	["image/gif", { extension: "gif" }],
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_COLOR_CHANNELS = new Map([
	[0, 1],
	[2, 3],
	[3, 1],
	[4, 2],
	[6, 4],
]);
const PNG_ALLOWED_BIT_DEPTHS = new Map([
	[0, new Set([1, 2, 4, 8, 16])],
	[2, new Set([8, 16])],
	[3, new Set([1, 2, 4, 8])],
	[4, new Set([8, 16])],
	[6, new Set([8, 16])],
]);
const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
const TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export class SubmissionValidationError extends Error {
	constructor(message) {
		super(message);
		this.name = "SubmissionValidationError";
	}
}

export class SubmissionStorageCapacityError extends Error {
	constructor(message) {
		super(message);
		this.name = "SubmissionStorageCapacityError";
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

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function assertArtworkDimensions(width, height, limits) {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		width > limits.max_width ||
		height > limits.max_height ||
		width * height > limits.max_pixels
	) {
		throw new SubmissionValidationError(
			`Artwork dimensions must not exceed ${limits.max_width}×${limits.max_height} pixels.`,
		);
	}
}

function parsePng(buffer, limits) {
	if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		throw new SubmissionValidationError("Artwork must be a valid PNG or GIF file.");
	}

	let offset = PNG_SIGNATURE.length;
	let width;
	let height;
	let bit_depth;
	let color_type;
	let saw_header = false;
	let saw_palette = false;
	let saw_image_data = false;
	let finished_image_data = false;
	let saw_end = false;
	const compressed_parts = [];

	while (offset < buffer.length) {
		if (offset + 12 > buffer.length) {
			throw new SubmissionValidationError("PNG artwork is truncated.");
		}
		const data_length = buffer.readUInt32BE(offset);
		const type_start = offset + 4;
		const data_start = offset + 8;
		const data_end = data_start + data_length;
		const chunk_end = data_end + 4;
		if (!Number.isSafeInteger(chunk_end) || chunk_end > buffer.length) {
			throw new SubmissionValidationError("PNG artwork is truncated.");
		}

		const type_buffer = buffer.subarray(type_start, data_start);
		const type = type_buffer.toString("ascii");
		if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) {
			throw new SubmissionValidationError("PNG artwork contains an invalid chunk.");
		}
		const expected_crc = buffer.readUInt32BE(data_end);
		if (crc32(buffer.subarray(type_start, data_end)) !== expected_crc) {
			throw new SubmissionValidationError("PNG artwork failed its integrity check.");
		}

		if (!saw_header && type !== "IHDR") {
			throw new SubmissionValidationError("PNG artwork has an invalid header.");
		}
		if (saw_image_data && type !== "IDAT") finished_image_data = true;
		if (type === "IHDR") {
			if (saw_header || data_length !== 13) {
				throw new SubmissionValidationError("PNG artwork has an invalid header.");
			}
			saw_header = true;
			width = buffer.readUInt32BE(data_start);
			height = buffer.readUInt32BE(data_start + 4);
			bit_depth = buffer[data_start + 8];
			color_type = buffer[data_start + 9];
			const compression = buffer[data_start + 10];
			const filter = buffer[data_start + 11];
			const interlace = buffer[data_start + 12];
			assertArtworkDimensions(width, height, limits);
			if (
				!PNG_ALLOWED_BIT_DEPTHS.get(color_type)?.has(bit_depth) ||
				compression !== 0 ||
				filter !== 0 ||
				interlace !== 0
			) {
				throw new SubmissionValidationError("PNG artwork uses unsupported encoding settings.");
			}
		} else if (type === "PLTE") {
			const palette_entries = data_length / 3;
			if (
				saw_palette ||
				saw_image_data ||
				color_type === 0 ||
				color_type === 4 ||
				data_length === 0 ||
				data_length % 3 !== 0 ||
				data_length > 768 ||
				(color_type === 3 && palette_entries > 2 ** bit_depth)
			) {
				throw new SubmissionValidationError("PNG artwork has an invalid palette.");
			}
			saw_palette = true;
		} else if (type === "IDAT") {
			if (saw_end || finished_image_data || data_length === 0) {
				throw new SubmissionValidationError("PNG artwork has invalid image data.");
			}
			saw_image_data = true;
			compressed_parts.push(buffer.subarray(data_start, data_end));
		} else if (type === "IEND") {
			if (data_length !== 0 || !saw_image_data || chunk_end !== buffer.length) {
				throw new SubmissionValidationError("PNG artwork has an invalid ending.");
			}
			saw_end = true;
		} else if (type[0] === type[0].toUpperCase() && !new Set(["IHDR", "PLTE", "IDAT", "IEND"]).has(type)) {
			throw new SubmissionValidationError("PNG artwork contains an unsupported critical chunk.");
		}

		offset = chunk_end;
	}

	if (!saw_header || !saw_image_data || !saw_end || (color_type === 3 && !saw_palette)) {
		throw new SubmissionValidationError("PNG artwork is incomplete.");
	}

	const channels = PNG_COLOR_CHANNELS.get(color_type);
	const row_bytes = Math.ceil((width * channels * bit_depth) / 8);
	const expected_length = (row_bytes + 1) * height;
	let pixels;
	try {
		pixels = inflateSync(Buffer.concat(compressed_parts), { maxOutputLength: expected_length + 1 });
	} catch {
		throw new SubmissionValidationError("PNG artwork contains invalid compressed image data.");
	}
	if (pixels.length !== expected_length) {
		throw new SubmissionValidationError("PNG artwork contains invalid pixel data.");
	}
	for (let row = 0; row < height; row++) {
		if (pixels[row * (row_bytes + 1)] > 4) {
			throw new SubmissionValidationError("PNG artwork contains an invalid row filter.");
		}
	}

	return { width, height, frame_count: 1 };
}

function readGifSubBlocks(buffer, start_offset) {
	const parts = [];
	let offset = start_offset;
	while (true) {
		if (offset >= buffer.length) throw new SubmissionValidationError("GIF artwork is truncated.");
		const length = buffer[offset++];
		if (length === 0) return { data: Buffer.concat(parts), offset };
		if (offset + length > buffer.length) throw new SubmissionValidationError("GIF artwork is truncated.");
		parts.push(buffer.subarray(offset, offset + length));
		offset += length;
	}
}

function validateGifLzw(data, minimum_code_size, expected_pixels, palette_size) {
	if (minimum_code_size < 2 || minimum_code_size > 8) {
		throw new SubmissionValidationError("GIF artwork has an invalid LZW code size.");
	}
	const clear_code = 1 << minimum_code_size;
	const end_code = clear_code + 1;
	const prefixes = new Uint16Array(4096);
	const suffixes = new Uint8Array(4096);
	const stack = new Uint8Array(4097);
	let code_size = minimum_code_size + 1;
	let next_code = end_code + 1;
	let bit_offset = 0;
	let previous_code = -1;
	let output_count = 0;
	let saw_end = false;
	let is_first_code = true;

	const read_code = () => {
		if (bit_offset + code_size > data.length * 8) return null;
		let code = 0;
		for (let bit = 0; bit < code_size; bit++) {
			code |= ((data[(bit_offset + bit) >> 3] >> ((bit_offset + bit) & 7)) & 1) << bit;
		}
		bit_offset += code_size;
		return code;
	};

	while (true) {
		let code = read_code();
		if (code === null) break;
		if (is_first_code) {
			is_first_code = false;
			if (code !== clear_code) throw new SubmissionValidationError("GIF artwork contains invalid LZW data.");
		}
		if (code === clear_code) {
			code_size = minimum_code_size + 1;
			next_code = end_code + 1;
			previous_code = -1;
			continue;
		}
		if (code === end_code) {
			saw_end = true;
			break;
		}

		const incoming_code = code;
		let stack_size = 0;
		if (code === next_code && previous_code !== -1) {
			code = previous_code;
			while (code >= clear_code) {
				if (code >= next_code || stack_size >= 4096) throw new SubmissionValidationError("GIF artwork contains invalid LZW data.");
				stack[stack_size++] = suffixes[code];
				code = prefixes[code];
			}
			stack[stack_size++] = code;
			stack[stack_size++] = code;
		} else {
			if (code >= next_code) throw new SubmissionValidationError("GIF artwork contains invalid LZW data.");
			while (code >= clear_code) {
				if (stack_size >= 4096) throw new SubmissionValidationError("GIF artwork contains invalid LZW data.");
				stack[stack_size++] = suffixes[code];
				code = prefixes[code];
			}
			stack[stack_size++] = code;
		}

		const first_character = stack[stack_size - 1];
		if (first_character >= palette_size) throw new SubmissionValidationError("GIF artwork references an invalid colour.");
		output_count += stack_size;
		if (output_count > expected_pixels) throw new SubmissionValidationError("GIF artwork contains too much pixel data.");

		if (previous_code !== -1 && next_code < 4096) {
			prefixes[next_code] = previous_code;
			suffixes[next_code] = first_character;
			next_code += 1;
			if (next_code === 1 << code_size && code_size < 12) code_size += 1;
		}
		previous_code = incoming_code;
	}

	if (!saw_end || output_count !== expected_pixels || Math.ceil(bit_offset / 8) !== data.length) {
		throw new SubmissionValidationError("GIF artwork contains incomplete image data.");
	}
}

function parseGif(buffer, limits) {
	if (buffer.length < 14 || !new Set(["GIF87a", "GIF89a"]).has(buffer.subarray(0, 6).toString("ascii"))) {
		throw new SubmissionValidationError("Artwork must be a valid PNG or GIF file.");
	}
	const width = buffer.readUInt16LE(6);
	const height = buffer.readUInt16LE(8);
	assertArtworkDimensions(width, height, limits);
	const packed = buffer[10];
	const has_global_palette = Boolean(packed & 0x80);
	const global_palette_size = has_global_palette ? 1 << ((packed & 0x07) + 1) : 0;
	let offset = 13 + global_palette_size * 3;
	if (offset > buffer.length) throw new SubmissionValidationError("GIF artwork is truncated.");

	let frame_count = 0;
	let saw_trailer = false;
	while (offset < buffer.length) {
		const marker = buffer[offset++];
		if (marker === 0x3b) {
			if (offset !== buffer.length) throw new SubmissionValidationError("GIF artwork has trailing data.");
			saw_trailer = true;
			break;
		}
		if (marker === 0x21) {
			if (offset >= buffer.length) throw new SubmissionValidationError("GIF artwork is truncated.");
			const label = buffer[offset++];
			if (![0x01, 0xf9, 0xfe, 0xff].includes(label)) {
				throw new SubmissionValidationError("GIF artwork contains an unsupported extension.");
			}
			if (label === 0xf9) {
				if (offset + 6 > buffer.length || buffer[offset] !== 4 || buffer[offset + 5] !== 0) {
					throw new SubmissionValidationError("GIF artwork has an invalid graphic control block.");
				}
				offset += 6;
			} else {
				if (label === 0x01) {
					if (offset >= buffer.length || buffer[offset] !== 12 || offset + 13 > buffer.length) {
						throw new SubmissionValidationError("GIF artwork has an invalid text extension.");
					}
					offset += 13;
				} else if (label === 0xff) {
					if (offset >= buffer.length || buffer[offset] !== 11 || offset + 12 > buffer.length) {
						throw new SubmissionValidationError("GIF artwork has an invalid application extension.");
					}
					offset += 12;
				}
				offset = readGifSubBlocks(buffer, offset).offset;
			}
			continue;
		}
		if (marker !== 0x2c || offset + 9 > buffer.length) {
			throw new SubmissionValidationError("GIF artwork contains an invalid block.");
		}

		const left = buffer.readUInt16LE(offset);
		const top = buffer.readUInt16LE(offset + 2);
		const frame_width = buffer.readUInt16LE(offset + 4);
		const frame_height = buffer.readUInt16LE(offset + 6);
		const frame_packed = buffer[offset + 8];
		offset += 9;
		if (frame_width < 1 || frame_height < 1 || left + frame_width > width || top + frame_height > height) {
			throw new SubmissionValidationError("GIF artwork contains invalid frame dimensions.");
		}
		const has_local_palette = Boolean(frame_packed & 0x80);
		const local_palette_size = has_local_palette ? 1 << ((frame_packed & 0x07) + 1) : 0;
		const palette_size = local_palette_size || global_palette_size;
		if (palette_size === 0) throw new SubmissionValidationError("GIF artwork does not contain a colour table.");
		offset += local_palette_size * 3;
		if (offset >= buffer.length) throw new SubmissionValidationError("GIF artwork is truncated.");
		const minimum_code_size = buffer[offset++];
		const image_data = readGifSubBlocks(buffer, offset);
		offset = image_data.offset;
		validateGifLzw(image_data.data, minimum_code_size, frame_width * frame_height, palette_size);
		frame_count += 1;
		if (frame_count > limits.max_frames) {
			throw new SubmissionValidationError(`Animated artwork must contain at most ${limits.max_frames} frames.`);
		}
	}

	if (!saw_trailer || frame_count === 0) throw new SubmissionValidationError("GIF artwork is incomplete.");
	return { width, height, frame_count };
}

function validateArtwork(file, limits) {
	if (!file || !Buffer.isBuffer(file.buffer)) {
		throw new SubmissionValidationError("Artwork is required.");
	}

	const type = ALLOWED_ARTWORK_TYPES.get(file.mimetype);
	if (!type) {
		throw new SubmissionValidationError("Artwork must be a valid PNG or GIF file.");
	}
	const metadata = file.mimetype === "image/png" ? parsePng(file.buffer, limits) : parseGif(file.buffer, limits);

	return {
		buffer: file.buffer,
		content_type: file.mimetype,
		extension: type.extension,
		size_bytes: file.buffer.length,
		...metadata,
	};
}

export function validateSubmission(
	body,
	file,
	artwork_limits = { max_width: 400, max_height: 560, max_pixels: 400 * 560, max_frames: 32 },
) {
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
		artwork: validateArtwork(file, artwork_limits),
	};
}

async function directorySize(directory) {
	let size = 0;
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entry_path = path.join(directory, entry.name);
		if (entry.isDirectory()) size += await directorySize(entry_path);
		else if (entry.isFile()) size += (await stat(entry_path)).size;
	}
	return size;
}

export async function enforceSubmissionStoragePolicy(
	storage_root,
	{ submission_id, incoming_bytes, maximum_bytes, retention_ms = 0, now = Date.now() },
) {
	await mkdir(storage_root, { recursive: true, mode: 0o700 });
	const existing_submission = await readArchivedSubmission(storage_root, submission_id);
	const entries = await readdir(storage_root, { withFileTypes: true });
	let used_bytes = 0;
	for (const entry of entries) {
		if (!entry.isDirectory() || !SUBMISSION_ID_PATTERN.test(entry.name)) continue;
		const submission_directory = path.join(storage_root, entry.name);
		if (retention_ms > 0 && entry.name !== submission_id) {
			let received_at = Number.NaN;
			let delivery_status = null;
			try {
				const record = JSON.parse(await readFile(path.join(submission_directory, "submission.json"), "utf8"));
				received_at = Date.parse(record.received_at);
			} catch (error) {
				if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
			}
			try {
				delivery_status = JSON.parse(await readFile(path.join(submission_directory, "delivery.json"), "utf8")).status;
			} catch (error) {
				if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
			}
			if (!Number.isFinite(received_at)) received_at = (await stat(submission_directory)).mtimeMs;
			if (received_at <= now - retention_ms && new Set(["delivered", "dead_letter"]).has(delivery_status)) {
				await rm(submission_directory, { recursive: true, force: false });
				continue;
			}
		}
		used_bytes += await directorySize(submission_directory);
	}

	const reserved_bytes = existing_submission ? 0 : incoming_bytes + 16 * 1024;
	if (maximum_bytes > 0 && used_bytes + reserved_bytes > maximum_bytes) {
		throw new SubmissionStorageCapacityError("Submission storage is currently full.");
	}
	return {
		used_bytes,
		reserved_bytes,
		existing_submission: Boolean(existing_submission),
		available_bytes: maximum_bytes > 0 ? Math.max(0, maximum_bytes - used_bytes - reserved_bytes) : null,
	};
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

export async function cleanupAbandonedStagingDirectories(storage_root, options = {}) {
	const now = options.now ?? Date.now();
	const maximum_age_ms = options.maximum_age_ms ?? 60 * 60 * 1000;
	await mkdir(storage_root, { recursive: true, mode: 0o700 });
	for (const entry of await readdir(storage_root, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith(".staging-")) continue;
		const staging_path = path.join(storage_root, entry.name);
		const details = await stat(staging_path).catch(() => null);
		if (details && details.mtimeMs <= now - maximum_age_ms) {
			await rm(staging_path, { recursive: true, force: true });
		}
	}
}

export async function archiveSubmission(storage_root, submission, options = {}) {
	const write_file = options.write_file_impl ?? writeFileSynced;
	const write_json = options.write_json_impl ?? writeJsonAtomic;
	const rename_directory = options.rename_impl ?? rename;
	const submission_directory = path.join(storage_root, submission.submission_id);
	const existing = await readArchivedSubmission(storage_root, submission.submission_id);
	if (existing) {
		return { record: existing, duplicate: true, submission_directory };
	}

	await mkdir(storage_root, { recursive: true, mode: 0o700 });
	await cleanupAbandonedStagingDirectories(storage_root, {
		now: options.now,
		maximum_age_ms: options.staging_maximum_age_ms,
	});
	const staging_directory = await mkdtemp(path.join(storage_root, `.staging-${submission.submission_id}-`));
	const artwork_filename = `artwork.${submission.artwork.extension}`;
	const artwork_path = path.join(staging_directory, artwork_filename);

	const record = {
		schema_version: 4,
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
			width: submission.artwork.width,
			height: submission.artwork.height,
			frame_count: submission.artwork.frame_count,
		},
	};
	const targets = options.delivery_targets ?? ["email", "telegram"];
	const delivery = createDeliveryRecord(submission.submission_id, targets, options.now ?? Date.now());
	try {
		await write_file(artwork_path, submission.artwork.buffer);
		await write_json(path.join(staging_directory, "submission.json"), record);
		await write_json(path.join(staging_directory, "delivery.json"), delivery);
		await syncDirectory(staging_directory);
		try {
			await rename_directory(staging_directory, submission_directory);
		} catch (error) {
			if (!new Set(["EEXIST", "ENOTEMPTY"]).has(error.code)) throw error;
			const raced_record = await readArchivedSubmission(storage_root, submission.submission_id);
			if (!raced_record) throw error;
			await rm(staging_directory, { recursive: true, force: true });
			return { record: raced_record, duplicate: true, submission_directory };
		}
		await syncDirectory(storage_root);
		return { record, delivery, duplicate: false, submission_directory };
	} catch (error) {
		await rm(staging_directory, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
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

export async function sendWithResend({ api_key, idempotency_key, email, signal, fetch_impl = fetch }) {
	const response = await fetch_impl("https://api.resend.com/emails", {
		method: "POST",
		signal,
		headers: {
			Authorization: `Bearer ${api_key}`,
			"Content-Type": "application/json",
			"Idempotency-Key": idempotency_key,
		},
		body: JSON.stringify(email),
	});
	const result = await response.json().catch(() => ({}));
	if (!response.ok || typeof result.id !== "string") {
		const error = new Error(result.message || `Resend returned HTTP ${response.status}.`);
		error.status = response.status;
		throw error;
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

export async function sendWithTelegram({ bot_token, chat_id, record, artwork_buffer, signal, fetch_impl = fetch }) {
	const post = createSubmissionTelegramPost(record);
	const form = new FormData();
	form.set("chat_id", String(chat_id));
	form.set("caption", post.caption);
	form.set(post.media_field, new Blob([artwork_buffer], { type: record.artwork.content_type }), record.artwork.filename);

	const response = await fetch_impl(`https://api.telegram.org/bot${bot_token}/${post.method}`, {
		method: "POST",
		body: form,
		signal,
	});
	const result = await response.json().catch(() => ({}));
	if (!response.ok || result.ok !== true || !Number.isSafeInteger(result.result?.message_id)) {
		const error = new Error(result.description || `Telegram returned HTTP ${response.status}.`);
		error.status = response.status;
		throw error;
	}
	return { message_id: result.result.message_id, method: post.method };
}
