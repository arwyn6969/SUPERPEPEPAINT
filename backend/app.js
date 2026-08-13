import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import {
	SubmissionValidationError,
	SubmissionStorageCapacityError,
	archiveSubmission,
	cleanupAbandonedStagingDirectories,
	createSubmissionEmail,
	enforceSubmissionStoragePolicy,
	readArchivedSubmission,
	sendWithTelegram,
	sendWithResend,
	validateSubmission,
} from "./submissions.js";
import {
	DeliveryOutboxProcessor,
	createKeyedSerializer,
	ensureDeliveryRecord,
	readDeliveryRecord,
} from "./delivery-outbox.js";

const backend_directory = path.dirname(fileURLToPath(import.meta.url));
const project_directory = path.resolve(backend_directory, "..");

function positiveInteger(value, fallback) {
	const parsed = Number.parseInt(value, 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
	const parsed = Number.parseInt(value, 10);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function createRateLimiter({ window_ms, maximum, maximum_clients }) {
	const clients = new Map();
	let next_cleanup_at = Date.now() + window_ms;
	return (request, response, next) => {
		const now = Date.now();
		const key = request.ip;
		if (now >= next_cleanup_at) {
			for (const [client_key, value] of clients) {
				if (value.reset_at <= now) clients.delete(client_key);
			}
			next_cleanup_at = now + window_ms;
		}
		const current = clients.get(key);
		if (!current || current.reset_at <= now) {
			if (!current && clients.size >= maximum_clients) {
				response.set("Retry-After", String(Math.ceil(window_ms / 1000)));
				response.status(429).json({ error: "Submission capacity is busy. Please wait and try again." });
				return;
			}
			clients.set(key, { count: 1, reset_at: now + window_ms });
			next();
			return;
		}
		if (current.count >= maximum) {
			response.set("Retry-After", String(Math.ceil((current.reset_at - now) / 1000)));
			response.status(429).json({ error: "Too many submissions. Please wait and try again." });
			return;
		}
		current.count += 1;
		next();
	};
}

function createConcurrencyLimiter(maximum) {
	let active = 0;
	return (request, response, next) => {
		if (active >= maximum) {
			response.set("Retry-After", "5");
			response.status(503).json({ error: "Submission processing is busy. Please wait and try again." });
			return;
		}
		active += 1;
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			active -= 1;
		};
		response.once("finish", release);
		response.once("close", release);
		next();
	};
}

function createStorageGuard(configuration) {
	let reserved_bytes = 0;
	let known_used_bytes = null;
	let last_scan_at = 0;
	let lock = Promise.resolve();
	return async (submission) => {
		let unlock;
		const previous = lock;
		lock = new Promise((resolve) => {
			unlock = resolve;
		});
		await previous;
		try {
			const now = Date.now();
			let existing_submission;
			if (known_used_bytes === null || now - last_scan_at >= 60 * 1000) {
				const result = await enforceSubmissionStoragePolicy(configuration.storage_root, {
					submission_id: submission.submission_id,
					incoming_bytes: 0,
					maximum_bytes: 0,
					retention_ms: configuration.storage_retention_days * 24 * 60 * 60 * 1000,
					now,
				});
				known_used_bytes = result.used_bytes;
				last_scan_at = now;
				existing_submission = result.existing_submission;
			} else {
				existing_submission = Boolean(await readArchivedSubmission(configuration.storage_root, submission.submission_id));
			}
			const reservation = existing_submission ? 0 : submission.artwork.size_bytes + 16 * 1024;
			if (
				configuration.storage_maximum_bytes > 0 &&
				known_used_bytes + reserved_bytes + reservation > configuration.storage_maximum_bytes
			) {
				throw new SubmissionStorageCapacityError("Submission storage is currently full.");
			}
			reserved_bytes += reservation;
			let released = false;
			return (committed = false) => {
				if (released) return;
				released = true;
				reserved_bytes -= reservation;
				if (committed) known_used_bytes += reservation;
			};
		} finally {
			unlock();
		}
	};
}

export function createSubmissionApp(options = {}) {
	const configuration = {
		storage_root: path.resolve(options.storage_root ?? process.env.SUBMISSION_STORAGE_ROOT ?? path.join(backend_directory, "var/submissions")),
		api_key: options.api_key ?? process.env.RESEND_API_KEY,
		from: options.from ?? process.env.SUBMISSION_FROM_EMAIL,
		to: options.to ?? process.env.SUBMISSION_TO_EMAIL,
		telegram_bot_token: options.telegram_bot_token ?? process.env.TELEGRAM_BOT_TOKEN,
		telegram_chat_id: options.telegram_chat_id ?? process.env.TELEGRAM_CHAT_ID,
		max_file_bytes: positiveInteger(options.max_file_bytes ?? process.env.SUBMISSION_MAX_FILE_BYTES, 12 * 1024 * 1024),
		max_artwork_width: positiveInteger(options.max_artwork_width ?? process.env.SUBMISSION_MAX_ARTWORK_WIDTH, 400),
		max_artwork_height: positiveInteger(options.max_artwork_height ?? process.env.SUBMISSION_MAX_ARTWORK_HEIGHT, 560),
		max_artwork_pixels: positiveInteger(options.max_artwork_pixels ?? process.env.SUBMISSION_MAX_ARTWORK_PIXELS, 400 * 560),
		max_gif_frames: positiveInteger(options.max_gif_frames ?? process.env.SUBMISSION_MAX_GIF_FRAMES, 32),
		rate_window_ms: positiveInteger(options.rate_window_ms ?? process.env.SUBMISSION_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
		rate_maximum: positiveInteger(options.rate_maximum ?? process.env.SUBMISSION_RATE_LIMIT_MAX, 5),
		rate_maximum_clients: positiveInteger(options.rate_maximum_clients ?? process.env.SUBMISSION_RATE_LIMIT_MAX_CLIENTS, 10000),
		concurrent_maximum: positiveInteger(options.concurrent_maximum ?? process.env.SUBMISSION_CONCURRENT_MAX, 2),
		storage_maximum_bytes: nonNegativeInteger(
			options.storage_maximum_bytes ?? process.env.SUBMISSION_STORAGE_MAX_BYTES,
			5 * 1024 * 1024 * 1024,
		),
		storage_retention_days: nonNegativeInteger(options.storage_retention_days ?? process.env.SUBMISSION_STORAGE_RETENTION_DAYS, 0),
		lease_ms: positiveInteger(options.lease_ms ?? process.env.SUBMISSION_DELIVERY_LEASE_MS, 120_000),
		delivery_timeout_ms: positiveInteger(options.delivery_timeout_ms ?? process.env.SUBMISSION_DELIVERY_TIMEOUT_MS, 60_000),
		outbox_interval_ms: nonNegativeInteger(options.outbox_interval_ms ?? process.env.SUBMISSION_OUTBOX_INTERVAL_MS, 30_000),
		retry_base_delay_ms: positiveInteger(options.retry_base_delay_ms ?? process.env.SUBMISSION_RETRY_BASE_DELAY_MS, 5_000),
		retry_maximum_delay_ms: positiveInteger(
			options.retry_maximum_delay_ms ?? process.env.SUBMISSION_RETRY_MAX_DELAY_MS,
			15 * 60_000,
		),
		retry_maximum_attempts: positiveInteger(options.retry_maximum_attempts ?? process.env.SUBMISSION_RETRY_MAX_ATTEMPTS, 10),
		outbox_batch_size: positiveInteger(options.outbox_batch_size ?? process.env.SUBMISSION_OUTBOX_BATCH_SIZE, 20),
		staging_maximum_age_ms: positiveInteger(
			options.staging_maximum_age_ms ?? process.env.SUBMISSION_STAGING_MAX_AGE_MS,
			60 * 60_000,
		),
	};
	const deliver_email = options.deliver_email ?? sendWithResend;
	const deliver_telegram = options.deliver_telegram ?? sendWithTelegram;
	const email_values = [configuration.api_key, configuration.from, configuration.to];
	const telegram_values = [configuration.telegram_bot_token, configuration.telegram_chat_id];
	const email_requested = Boolean(configuration.api_key);
	const telegram_requested = telegram_values.some(Boolean);
	const email_configured = email_requested && email_values.every(Boolean);
	const telegram_configured = telegram_requested && telegram_values.every(Boolean);
	const delivery_partially_configured =
		(email_requested && !email_configured) || (telegram_requested && !telegram_configured);
	const delivery_targets = [email_configured ? "email" : null, telegram_configured ? "telegram" : null].filter(Boolean);
	const app = express();
	app.disable("x-powered-by");
	app.set("trust proxy", "loopback");

	const upload = multer({
		storage: multer.memoryStorage(),
		limits: {
			fileSize: configuration.max_file_bytes,
			files: 1,
			fields: 10,
			fieldNameSize: 64,
			fieldSize: 8 * 1024,
			parts: 12,
			headerPairs: 50,
		},
	});
	const rate_limit = createRateLimiter({
		window_ms: configuration.rate_window_ms,
		maximum: configuration.rate_maximum,
		maximum_clients: configuration.rate_maximum_clients,
	});
	const concurrency_limit = createConcurrencyLimiter(configuration.concurrent_maximum);
	const reserve_storage = createStorageGuard(configuration);
	const uuid_serializer = createKeyedSerializer();
	const delivery_processor = new DeliveryOutboxProcessor({
		storage_root: configuration.storage_root,
		targets: delivery_targets,
		lease_ms: configuration.lease_ms,
		interval_ms: configuration.outbox_interval_ms,
		base_delay_ms: configuration.retry_base_delay_ms,
		maximum_delay_ms: configuration.retry_maximum_delay_ms,
		maximum_attempts: configuration.retry_maximum_attempts,
		batch_size: configuration.outbox_batch_size,
		clock: options.clock,
		deliver: async (target_name, { record, artwork_buffer, submission_id }) => {
			if (target_name === "email") {
				return deliver_email({
					api_key: configuration.api_key,
					idempotency_key: `pepepaint-${submission_id}`,
					email: createSubmissionEmail(record, artwork_buffer, configuration.from, configuration.to),
					signal: AbortSignal.timeout(configuration.delivery_timeout_ms),
				});
			}
			if (target_name === "telegram") {
				return deliver_telegram({
					bot_token: configuration.telegram_bot_token,
					chat_id: configuration.telegram_chat_id,
					record,
					artwork_buffer,
					signal: AbortSignal.timeout(configuration.delivery_timeout_ms),
				});
			}
			const error = new Error(`Unknown delivery target: ${target_name}`);
			error.retryable = false;
			throw error;
		},
	});
	const ready = (async () => {
		await cleanupAbandonedStagingDirectories(configuration.storage_root, {
			maximum_age_ms: configuration.staging_maximum_age_ms,
		});
		if (!delivery_partially_configured && delivery_targets.length > 0) await delivery_processor.start();
	})();
	app.locals.delivery_processor = delivery_processor;
	app.locals.ready = ready;
	app.locals.close = () => delivery_processor.close();

	app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
	app.post("/api/submissions", rate_limit, concurrency_limit, upload.single("artwork"), async (request, response, next) => {
		let release_storage = () => {};
		let storage_committed = false;
		try {
			if (delivery_partially_configured || (!email_configured && !telegram_configured)) {
				response.status(503).json({ error: "Submission delivery is not fully configured." });
				return;
			}

			await ready;
			const submission = validateSubmission(request.body, request.file, {
				max_width: configuration.max_artwork_width,
				max_height: configuration.max_artwork_height,
				max_pixels: configuration.max_artwork_pixels,
				max_frames: configuration.max_gif_frames,
			});
			const result = await uuid_serializer.run(submission.submission_id, async () => {
				release_storage = await reserve_storage(submission);
				const archived = await archiveSubmission(configuration.storage_root, submission, {
					delivery_targets,
					staging_maximum_age_ms: configuration.staging_maximum_age_ms,
				});
				storage_committed = !archived.duplicate;
				let delivery = archived.delivery ?? (await readDeliveryRecord(configuration.storage_root, submission.submission_id));
				if (!delivery) {
					delivery = await ensureDeliveryRecord(configuration.storage_root, archived.record, delivery_targets);
				}
				if (delivery.status !== "delivered" && delivery.status !== "dead_letter") {
					delivery = await delivery_processor.process(submission.submission_id, { force: true });
				}
				return { archived, delivery };
			});

			if (result.delivery?.status === "delivered") {
				response.status(result.archived.duplicate ? 200 : 201).json({
					submission_id: submission.submission_id,
					status: "submitted",
				});
				return;
			}
			if (result.delivery?.status === "dead_letter") {
				response.status(502).json({
					submission_id: submission.submission_id,
					status: "failed",
					error: "The archived submission could not be delivered and requires operator review.",
				});
				return;
			}
			response.status(202).json({
				submission_id: submission.submission_id,
				status: "queued",
				message: "Your artwork is safely archived and queued for delivery.",
			});
		} catch (error) {
			next(error);
		} finally {
			release_storage(storage_committed);
		}
	});

	if (options.serve_frontend !== false) {
		for (const filename of ["index.html", "main.js", "traits.js", "filters.js", "styles.css"]) {
			app.get(`/${filename}`, (_request, response) => response.sendFile(path.join(project_directory, filename)));
		}
		app.get("/", (_request, response) => response.sendFile(path.join(project_directory, "index.html")));
		app.use("/brushes", express.static(path.join(project_directory, "brushes"), { dotfiles: "deny", fallthrough: false }));
		app.use("/fonts", express.static(path.join(project_directory, "fonts"), { dotfiles: "deny", fallthrough: false }));
	}

	app.use((error, _request, response, _next) => {
		if (error instanceof SubmissionValidationError) {
			response.status(400).json({ error: error.message });
			return;
		}
		if (error instanceof SubmissionStorageCapacityError) {
			response.status(507).json({ error: "Submission storage is currently full. Please try again later." });
			return;
		}
		if (error instanceof multer.MulterError) {
			const message = error.code === "LIMIT_FILE_SIZE" ? "Artwork is too large." : "The submission upload is invalid.";
			response.status(400).json({ error: message });
			return;
		}
		console.error("PEPEPAINT submission failed.", error);
		response.status(502).json({ error: "The submission could not be delivered. Your artwork is still on this device; please try again." });
	});

	return app;
}
