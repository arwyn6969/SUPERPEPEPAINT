import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import express from "express";
import multer from "multer";
import {
	SubmissionConflictError,
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
import { withProviderDeadline } from "./provider-delivery.js";
import { loadConfiguration } from "./config.js";
import { ReadinessManager } from "./readiness.js";

const backend_directory = path.dirname(fileURLToPath(import.meta.url));
const project_directory = path.resolve(backend_directory, "..");

const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DURABILITY_ERROR_CODES = new Set([
	"EACCES", "EBUSY", "EDQUOT", "EIO", "EMFILE", "ENFILE", "ENOSPC", "ENOTDIR", "EPERM", "EROFS", "ESTALE", "EXDEV",
]);

function isDurabilityError(error) {
	return DURABILITY_ERROR_CODES.has(error?.code);
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
	const configuration = options.configuration ?? loadConfiguration(options, options.environment ?? process.env);
	const deliver_email = options.deliver_email ?? sendWithResend;
	const deliver_telegram = options.deliver_telegram ?? sendWithTelegram;
	const archive_submission = options.archive_submission ?? archiveSubmission;
	const delivery_targets = [configuration.email_enabled ? "email" : null, configuration.telegram_enabled ? "telegram" : null].filter(Boolean);
	const telegram_destination_fingerprint = configuration.telegram_enabled
		? createHash("sha256").update(String(configuration.telegram_chat_id)).digest("hex").slice(0, 16)
		: null;
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
	const readiness = options.readiness_manager ?? new ReadinessManager({
		storage_root: configuration.storage_root,
		probe: options.readiness_probe,
		probe_timeout_ms: configuration.readiness_probe_timeout_ms,
		probe_interval_ms: configuration.readiness_probe_interval_ms,
		clock: options.clock,
		logger: options.logger,
		capacity_check: async () => {
			if (configuration.storage_maximum_bytes === 0) return false;
			try {
				await enforceSubmissionStoragePolicy(configuration.storage_root, {
					submission_id: "00000000-0000-4000-8000-000000000000",
					incoming_bytes: 1,
					maximum_bytes: configuration.storage_maximum_bytes,
					retention_ms: 0,
				});
				return false;
			} catch (error) {
				if (error instanceof SubmissionStorageCapacityError) return true;
				throw error;
			}
		},
	});
	const delivery_processor = options.delivery_processor ?? new DeliveryOutboxProcessor({
		storage_root: configuration.storage_root,
		targets: delivery_targets,
		lease_ms: configuration.lease_ms,
		interval_ms: configuration.outbox_interval_ms,
		base_delay_ms: configuration.retry_base_delay_ms,
		maximum_delay_ms: configuration.retry_maximum_delay_ms,
		maximum_attempts: configuration.retry_maximum_attempts,
		uncertain_delay_ms: configuration.uncertain_delay_ms,
		maximum_uncertain_attempts: configuration.maximum_uncertain_attempts,
		retry_after_maximum_ms: configuration.telegram_retry_after_maximum_ms,
		jitter_ratio: configuration.retry_jitter_percent / 100,
		random: options.random,
		logger: options.logger,
		on_durability_fault: (error) => readiness.markDurabilityFailure("outbox_write_failed", error),
		on_provider_outcome: (outcome) => readiness.markDeliveryDegraded(outcome.classification !== "delivered"),
		batch_size: configuration.outbox_batch_size,
		clock: options.clock,
		deliver: async (target_name, { record, artwork_buffer, submission_id, signal }) => {
			if (target_name === "email") {
				return withProviderDeadline("resend", (provider_signal) => deliver_email({
					api_key: configuration.api_key,
					idempotency_key: `pepepaint-${submission_id}`,
					email: createSubmissionEmail(record, artwork_buffer, configuration.from, configuration.to),
					signal: provider_signal,
				}), { timeout_ms: configuration.delivery_timeout_ms, signal });
			}
			if (target_name === "telegram") {
				const result = await withProviderDeadline("telegram", (provider_signal) => deliver_telegram({
					bot_token: configuration.telegram_bot_token,
					chat_id: configuration.telegram_chat_id,
					record,
					artwork_buffer,
					signal: provider_signal,
				}), { timeout_ms: configuration.delivery_timeout_ms, signal });
				return { ...result, destination_fingerprint: telegram_destination_fingerprint };
			}
			const error = new Error(`Unknown delivery target: ${target_name}`);
			error.retryable = false;
			throw error;
		},
	});
	const ready = (async () => {
		try {
			await readiness.initialize();
			await cleanupAbandonedStagingDirectories(configuration.storage_root, {
				maximum_age_ms: configuration.staging_maximum_age_ms,
			});
			if (delivery_targets.length > 0) await delivery_processor.start({ defer_processing: true });
			readiness.markWorkerReady();
		} catch (error) {
			readiness.markDurabilityFailure("startup_initialization_failed", error);
			await delivery_processor.close().catch(() => {});
			throw error;
		}
	})();
	app.locals.delivery_processor = delivery_processor;
	app.locals.configuration = configuration;
	app.locals.readiness = readiness;
	app.locals.ready = ready;
	app.locals.beginShutdown = () => readiness.beginShutdown();
	app.locals.close = async () => {
		readiness.beginShutdown();
		await delivery_processor.close();
		readiness.close();
	};

	app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
	app.get("/api/ready", (_request, response) => response.status(readiness.ready ? 200 : 503).json(readiness.publicSnapshot()));
	const readiness_gate = async (request, response, next) => {
		if (readiness.ready) return next();
		const submission_id = request.get("X-Submission-ID");
		if (submission_id && SUBMISSION_ID_PATTERN.test(submission_id)) {
			try {
				const archived = await readArchivedSubmission(configuration.storage_root, submission_id);
				if (archived) {
					const delivery = await readDeliveryRecord(configuration.storage_root, submission_id);
					if (delivery?.status === "delivered") return response.status(200).json({ submission_id, status: "submitted", delivery_status: "delivered" });
					if (delivery?.status === "dead_letter") return response.status(502).json({ submission_id, status: "failed", delivery_status: "dead_letter", error: "The archived submission requires operator review." });
					if (delivery?.status === "uncertain") return response.status(202).json({ submission_id, status: "queued", delivery_status: "uncertain", message: "Your artwork is safely archived; provider confirmation is pending." });
					return response.status(202).json({ submission_id, status: "queued", delivery_status: delivery?.status ?? "pending", message: "Your artwork is safely archived and queued for delivery." });
				}
			} catch (error) {
				readiness.markDurabilityFailure("archive_read_failed", error);
			}
		}
		if (readiness.storage_full) {
			response.status(507).json({ error: "Submission storage is currently full. Please try again later." });
			return;
		}
		response.set("Retry-After", String(configuration.readiness_retry_after_seconds));
		response.status(503).json({ error: "Submission service is temporarily unavailable. Please try again." });
	};
	app.post("/api/submissions", rate_limit, readiness_gate, concurrency_limit, upload.single("artwork"), async (request, response, next) => {
		let release_storage = () => {};
		let storage_committed = false;
		try {
			await ready;
			const submission = validateSubmission(request.body, request.file, {
				max_width: configuration.max_artwork_width,
				max_height: configuration.max_artwork_height,
				max_pixels: configuration.max_artwork_pixels,
				max_frames: configuration.max_gif_frames,
			});
			const result = await uuid_serializer.run(submission.submission_id, async () => {
				release_storage = await reserve_storage(submission);
				const archived = await archive_submission(configuration.storage_root, submission, {
					delivery_targets,
					staging_maximum_age_ms: configuration.staging_maximum_age_ms,
				});
				storage_committed = !archived.duplicate;
				let delivery = archived.delivery ?? (await readDeliveryRecord(configuration.storage_root, submission.submission_id));
				if (!delivery) {
					delivery = await ensureDeliveryRecord(configuration.storage_root, archived.record, delivery_targets);
				}
				if (delivery.status !== "delivered" && delivery.status !== "dead_letter") {
					delivery = await delivery_processor.process(submission.submission_id);
				}
				return { archived, delivery };
			});

			if (result.delivery?.status === "delivered") {
				response.status(result.archived.duplicate ? 200 : 201).json({
					submission_id: submission.submission_id,
					status: "submitted",
					delivery_status: "delivered",
				});
				return;
			}
			if (result.delivery?.status === "dead_letter") {
				response.status(502).json({
					submission_id: submission.submission_id,
					status: "failed",
					delivery_status: "dead_letter",
					error: "The archived submission could not be delivered and requires operator review.",
				});
				return;
			}
			if (result.delivery?.status === "uncertain") {
				response.status(202).json({
					submission_id: submission.submission_id,
					status: "queued",
					delivery_status: "uncertain",
					message: "Your artwork is safely archived; provider confirmation is pending.",
				});
				return;
			}
			response.status(202).json({
				submission_id: submission.submission_id,
				status: "queued",
				delivery_status: result.delivery?.status ?? "pending",
				message: "Your artwork is safely archived and queued for delivery.",
			});
		} catch (error) {
			if (error instanceof SubmissionStorageCapacityError) void readiness.runProbe().catch(() => {});
			else if (isDurabilityError(error)) {
				readiness.markDurabilityFailure("archive_write_failed", error);
			}
			next(error);
		} finally {
			release_storage(storage_committed);
		}
	});

	if (options.serve_frontend !== false) {
		for (const filename of ["index.html", "main.js", "submission-retry.js", "traits.js", "filters.js", "styles.css"]) {
			app.get(`/${filename}`, (_request, response) => response.sendFile(path.join(project_directory, filename)));
		}
		app.get("/", (_request, response) => response.sendFile(path.join(project_directory, "index.html")));
		app.use("/brushes", express.static(path.join(project_directory, "brushes"), { dotfiles: "deny", fallthrough: false }));
		app.use("/fonts", express.static(path.join(project_directory, "fonts"), { dotfiles: "deny", fallthrough: false }));
	}

	app.use((error, _request, response, _next) => {
		if (error instanceof SubmissionConflictError) {
			response.status(409).json({
				submission_id: error.submission_id,
				status: "conflict",
				error: "This submission ID is already associated with different content.",
			});
			return;
		}
		if (error instanceof SubmissionValidationError) {
			response.status(400).json({ error: error.message });
			return;
		}
		if (error instanceof SubmissionStorageCapacityError) {
			response.status(507).json({ error: "Submission storage is currently full. Please try again later." });
			return;
		}
		if (isDurabilityError(error)) {
			response.set("Retry-After", String(configuration.readiness_retry_after_seconds));
			response.status(503).json({ error: "Submission service is temporarily unavailable. Please try again." });
			return;
		}
		if (error instanceof multer.MulterError) {
			const message = error.code === "LIMIT_FILE_SIZE" ? "Artwork is too large." : "The submission upload is invalid.";
			response.status(400).json({ error: message });
			return;
		}
		console.error("PEPEPAINT submission failed.", { name: error?.name ?? "Error", code: error?.code ?? "UNKNOWN" });
		response.status(502).json({ error: "The submission could not be delivered. Your artwork is still on this device; please try again." });
	});

	return app;
}
