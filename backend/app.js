import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import {
	SubmissionValidationError,
	archiveSubmission,
	createSubmissionEmail,
	sendWithTelegram,
	sendWithResend,
	updateEmailDelivery,
	updateTelegramDelivery,
	validateSubmission,
} from "./submissions.js";

const backend_directory = path.dirname(fileURLToPath(import.meta.url));
const project_directory = path.resolve(backend_directory, "..");

function positiveInteger(value, fallback) {
	const parsed = Number.parseInt(value, 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createRateLimiter({ window_ms, maximum }) {
	const clients = new Map();
	let next_cleanup_at = Date.now() + window_ms;
	return (request, response, next) => {
		const now = Date.now();
		if (now >= next_cleanup_at) {
			for (const [client_key, client] of clients) {
				if (client.reset_at <= now) {
					clients.delete(client_key);
				}
			}
			next_cleanup_at = now + window_ms;
		}

		const key = request.ip;
		const current = clients.get(key);
		if (!current || current.reset_at <= now) {
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

export function createSubmissionApp(options = {}) {
	const configuration = {
		storage_root: path.resolve(options.storage_root ?? process.env.SUBMISSION_STORAGE_ROOT ?? path.join(backend_directory, "var/submissions")),
		api_key: options.api_key ?? process.env.RESEND_API_KEY,
		from: options.from ?? process.env.SUBMISSION_FROM_EMAIL,
		to: options.to ?? process.env.SUBMISSION_TO_EMAIL,
		telegram_bot_token: options.telegram_bot_token ?? process.env.TELEGRAM_BOT_TOKEN,
		telegram_chat_id: options.telegram_chat_id ?? process.env.TELEGRAM_CHAT_ID,
		max_file_bytes: positiveInteger(options.max_file_bytes ?? process.env.SUBMISSION_MAX_FILE_BYTES, 25 * 1024 * 1024),
		rate_window_ms: positiveInteger(options.rate_window_ms ?? process.env.SUBMISSION_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
		rate_maximum: positiveInteger(options.rate_maximum ?? process.env.SUBMISSION_RATE_LIMIT_MAX, 5),
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
	const app = express();
	app.disable("x-powered-by");
	app.set("trust proxy", "loopback");

	const upload = multer({
		storage: multer.memoryStorage(),
		limits: { fileSize: configuration.max_file_bytes, files: 1, fields: 10 },
	});
	const rate_limit = createRateLimiter({ window_ms: configuration.rate_window_ms, maximum: configuration.rate_maximum });

	app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
	app.post("/api/submissions", rate_limit, upload.single("artwork"), async (request, response, next) => {
		try {
			if (delivery_partially_configured || (!email_configured && !telegram_configured)) {
				response.status(503).json({ error: "Submission delivery is not fully configured." });
				return;
			}

			const submission = validateSubmission(request.body, request.file);
			const archived = await archiveSubmission(configuration.storage_root, submission);
			const email_complete = !email_configured || archived.record.email_delivery?.status === "sent";
			const telegram_complete = !telegram_configured || archived.record.telegram_delivery?.status === "sent";
			if (archived.duplicate && email_complete && telegram_complete) {
				response.json({ submission_id: submission.submission_id, status: "submitted" });
				return;
			}

			let record = archived.record;
			const artwork_buffer = archived.duplicate
				? await readFile(path.join(archived.submission_directory, record.artwork.filename))
				: submission.artwork.buffer;

			if (email_configured && record.email_delivery?.status !== "sent") {
				const email = createSubmissionEmail(record, artwork_buffer, configuration.from, configuration.to);
				try {
					const delivery = await deliver_email({
						api_key: configuration.api_key,
						idempotency_key: `pepepaint-${submission.submission_id}`,
						email,
					});
					record = await updateEmailDelivery(configuration.storage_root, record, "sent", delivery.id);
				} catch (error) {
					await updateEmailDelivery(configuration.storage_root, record, "failed", null, error.message);
					throw error;
				}
			}

			if (telegram_configured && record.telegram_delivery?.status !== "sent") {
				try {
					const delivery = await deliver_telegram({
						bot_token: configuration.telegram_bot_token,
						chat_id: configuration.telegram_chat_id,
						record,
						artwork_buffer,
					});
					record = await updateTelegramDelivery(
						configuration.storage_root,
						record,
						"sent",
						delivery.message_id,
						delivery.method,
					);
				} catch (error) {
					await updateTelegramDelivery(configuration.storage_root, record, "failed", null, null, error.message);
					throw error;
				}
			}

			response.status(201).json({ submission_id: submission.submission_id, status: "submitted" });
		} catch (error) {
			next(error);
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
