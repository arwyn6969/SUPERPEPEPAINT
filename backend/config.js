import path from "node:path";
import { fileURLToPath } from "node:url";

const backend_directory = path.dirname(fileURLToPath(import.meta.url));
const project_directory = path.resolve(backend_directory, "..");
const EMAIL_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

export class ConfigurationError extends Error {
	constructor(key, reason) {
		super(`${key} ${reason}`);
		this.name = "ConfigurationError";
		this.key = key;
	}
}

function missing(value) {
	return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function text(value) {
	return missing(value) ? null : String(value).trim();
}

function integer(key, value, fallback, minimum, maximum) {
	if (missing(value)) return fallback;
	if (typeof value === "string" && !/^(0|[1-9]\d*)$/.test(value.trim())) {
		throw new ConfigurationError(key, "must be a base-10 integer.");
	}
	const parsed = typeof value === "number" ? value : Number(value.trim());
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new ConfigurationError(key, `must be an integer from ${minimum} through ${maximum}.`);
	}
	return parsed;
}

function boolean(key, value, fallback) {
	if (missing(value)) return fallback;
	if (value === true || value === false) return value;
	const normalized = String(value).trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	throw new ConfigurationError(key, "must be true or false.");
}

function mailbox(key, value) {
	const normalized = text(value);
	if (!normalized) throw new ConfigurationError(key, "is required when email delivery is enabled.");
	const bracketed = normalized.match(/^[^<>\r\n]*<([^<>]+)>$/);
	const address = bracketed ? bracketed[1].trim() : normalized;
	if (!EMAIL_PATTERN.test(address)) throw new ConfigurationError(key, "must contain a structurally valid email address.");
	return normalized;
}

function providerEnabled({ key, option, environment, inferred, production }) {
	const raw = option ?? environment[key];
	if (production && missing(raw)) throw new ConfigurationError(key, "must be explicitly set in production.");
	return boolean(key, raw, inferred);
}

function option(options, name, environment, key) {
	return options[name] !== undefined ? options[name] : environment[key];
}

export function loadConfiguration(options = {}, environment = process.env) {
	const app_env = text(option(options, "app_env", environment, "APP_ENV")) ?? "development";
	if (!new Set(["development", "test", "production"]).has(app_env)) {
		throw new ConfigurationError("APP_ENV", "must be development, test, or production.");
	}
	const production = app_env === "production";
	const raw_storage_root = option(options, "storage_root", environment, "SUBMISSION_STORAGE_ROOT");
	if (production && missing(raw_storage_root)) throw new ConfigurationError("SUBMISSION_STORAGE_ROOT", "is required in production.");
	const storage_root = path.resolve(text(raw_storage_root) ?? path.join(backend_directory, "var/submissions"));
	if (production && (storage_root === project_directory || storage_root.startsWith(`${project_directory}${path.sep}`))) {
		throw new ConfigurationError("SUBMISSION_STORAGE_ROOT", "must be outside the deployed public application tree in production.");
	}

	const api_key = text(option(options, "api_key", environment, "RESEND_API_KEY"));
	const raw_from = text(option(options, "from", environment, "SUBMISSION_FROM_EMAIL"));
	const raw_to = text(option(options, "to", environment, "SUBMISSION_TO_EMAIL"));
	const telegram_bot_token = text(option(options, "telegram_bot_token", environment, "TELEGRAM_BOT_TOKEN"));
	const telegram_chat_id = text(option(options, "telegram_chat_id", environment, "TELEGRAM_CHAT_ID"));
	const email_enabled = providerEnabled({
		key: "RESEND_ENABLED",
		option: options.email_enabled,
		environment,
		inferred: Boolean(api_key || raw_from || raw_to || options.deliver_email),
		production,
	});
	const telegram_enabled = providerEnabled({
		key: "TELEGRAM_ENABLED",
		option: options.telegram_enabled,
		environment,
		inferred: Boolean(telegram_bot_token || telegram_chat_id || options.deliver_telegram),
		production,
	});
	if (production && !email_enabled && !telegram_enabled) {
		throw new ConfigurationError("RESEND_ENABLED/TELEGRAM_ENABLED", "must enable at least one delivery provider in production.");
	}

	let from = raw_from;
	let to = raw_to;
	if (email_enabled) {
		if (!api_key && !(app_env !== "production" && options.deliver_email)) {
			throw new ConfigurationError("RESEND_API_KEY", "is required when email delivery is enabled.");
		}
		if (api_key && (api_key.length < 8 || /^(example|changeme|replace-me)$/i.test(api_key))) {
			throw new ConfigurationError("RESEND_API_KEY", "does not have the expected structure.");
		}
		if (production && api_key && !/^re_[A-Za-z0-9_-]{8,}$/.test(api_key)) {
			throw new ConfigurationError("RESEND_API_KEY", "does not have the expected production structure.");
		}
		from = mailbox("SUBMISSION_FROM_EMAIL", from);
		to = mailbox("SUBMISSION_TO_EMAIL", to);
		if (production && /@example\.(com|org|net)>?$/i.test(from)) throw new ConfigurationError("SUBMISSION_FROM_EMAIL", "must not use an example placeholder in production.");
		if (production && /@example\.(com|org|net)>?$/i.test(to)) throw new ConfigurationError("SUBMISSION_TO_EMAIL", "must not use an example placeholder in production.");
	}
	if (telegram_enabled) {
		if ((!telegram_bot_token || !telegram_chat_id) && !(app_env !== "production" && options.deliver_telegram)) {
			throw new ConfigurationError("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID", "must both be present when Telegram delivery is enabled.");
		}
		if (telegram_bot_token && !/^[A-Za-z0-9:_-]{8,}$/.test(telegram_bot_token)) {
			throw new ConfigurationError("TELEGRAM_BOT_TOKEN", "does not have the expected structure.");
		}
		if (production && telegram_bot_token && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(telegram_bot_token)) {
			throw new ConfigurationError("TELEGRAM_BOT_TOKEN", "does not have the expected production structure.");
		}
		if (telegram_chat_id && !/^-?\d+$/.test(telegram_chat_id)) {
			throw new ConfigurationError("TELEGRAM_CHAT_ID", "must be a numeric chat identifier.");
		}
	}

	const configuration = {
		app_env,
		production,
		port: integer("PORT", option(options, "port", environment, "PORT"), 3101, 1, 65535),
		bind_host: text(option(options, "bind_host", environment, "BIND_HOST")) ?? "127.0.0.1",
		storage_root,
		api_key,
		from,
		to,
		telegram_bot_token,
		telegram_chat_id,
		email_enabled,
		telegram_enabled,
		max_file_bytes: integer("SUBMISSION_MAX_FILE_BYTES", option(options, "max_file_bytes", environment, "SUBMISSION_MAX_FILE_BYTES"), 12 * 1024 * 1024, 1, 64 * 1024 * 1024),
		max_artwork_width: integer("SUBMISSION_MAX_ARTWORK_WIDTH", option(options, "max_artwork_width", environment, "SUBMISSION_MAX_ARTWORK_WIDTH"), 400, 1, 10_000),
		max_artwork_height: integer("SUBMISSION_MAX_ARTWORK_HEIGHT", option(options, "max_artwork_height", environment, "SUBMISSION_MAX_ARTWORK_HEIGHT"), 560, 1, 10_000),
		max_artwork_pixels: integer("SUBMISSION_MAX_ARTWORK_PIXELS", option(options, "max_artwork_pixels", environment, "SUBMISSION_MAX_ARTWORK_PIXELS"), 400 * 560, 1, 100_000_000),
		max_gif_frames: integer("SUBMISSION_MAX_GIF_FRAMES", option(options, "max_gif_frames", environment, "SUBMISSION_MAX_GIF_FRAMES"), 32, 1, 512),
		rate_window_ms: integer("SUBMISSION_RATE_LIMIT_WINDOW_MS", option(options, "rate_window_ms", environment, "SUBMISSION_RATE_LIMIT_WINDOW_MS"), 15 * 60 * 1000, 1_000, 24 * 60 * 60_000),
		rate_maximum: integer("SUBMISSION_RATE_LIMIT_MAX", option(options, "rate_maximum", environment, "SUBMISSION_RATE_LIMIT_MAX"), 5, 1, 10_000),
		rate_maximum_clients: integer("SUBMISSION_RATE_LIMIT_MAX_CLIENTS", option(options, "rate_maximum_clients", environment, "SUBMISSION_RATE_LIMIT_MAX_CLIENTS"), 10_000, 1, 1_000_000),
		concurrent_maximum: integer("SUBMISSION_CONCURRENT_MAX", option(options, "concurrent_maximum", environment, "SUBMISSION_CONCURRENT_MAX"), 2, 1, 128),
		storage_maximum_bytes: integer("SUBMISSION_STORAGE_MAX_BYTES", option(options, "storage_maximum_bytes", environment, "SUBMISSION_STORAGE_MAX_BYTES"), 5 * 1024 * 1024 * 1024, 0, Number.MAX_SAFE_INTEGER),
		storage_retention_days: integer("SUBMISSION_STORAGE_RETENTION_DAYS", option(options, "storage_retention_days", environment, "SUBMISSION_STORAGE_RETENTION_DAYS"), 0, 0, 36_500),
		lease_ms: integer("SUBMISSION_DELIVERY_LEASE_MS", option(options, "lease_ms", environment, "SUBMISSION_DELIVERY_LEASE_MS"), 120_000, 5_000, 10 * 60_000),
		delivery_timeout_ms: integer("SUBMISSION_DELIVERY_TIMEOUT_MS", option(options, "delivery_timeout_ms", environment, "SUBMISSION_DELIVERY_TIMEOUT_MS"), 30_000, 1_000, 120_000),
		outbox_interval_ms: integer("SUBMISSION_OUTBOX_INTERVAL_MS", option(options, "outbox_interval_ms", environment, "SUBMISSION_OUTBOX_INTERVAL_MS"), 30_000, 0, 10 * 60_000),
		retry_base_delay_ms: integer("SUBMISSION_RETRY_BASE_DELAY_MS", option(options, "retry_base_delay_ms", environment, "SUBMISSION_RETRY_BASE_DELAY_MS"), 5_000, 1_000, 60 * 60_000),
		retry_maximum_delay_ms: integer("SUBMISSION_RETRY_MAX_DELAY_MS", option(options, "retry_maximum_delay_ms", environment, "SUBMISSION_RETRY_MAX_DELAY_MS"), 15 * 60_000, 1_000, 24 * 60 * 60_000),
		retry_maximum_attempts: integer("SUBMISSION_RETRY_MAX_ATTEMPTS", option(options, "retry_maximum_attempts", environment, "SUBMISSION_RETRY_MAX_ATTEMPTS"), 10, 1, 100),
		uncertain_delay_ms: integer("SUBMISSION_UNCERTAIN_RETRY_DELAY_MS", option(options, "uncertain_delay_ms", environment, "SUBMISSION_UNCERTAIN_RETRY_DELAY_MS"), 5 * 60_000, 1_000, 24 * 60 * 60_000),
		maximum_uncertain_attempts: integer("SUBMISSION_UNCERTAIN_MAX_ATTEMPTS", option(options, "maximum_uncertain_attempts", environment, "SUBMISSION_UNCERTAIN_MAX_ATTEMPTS"), 2, 1, 10),
		telegram_retry_after_maximum_ms: integer("TELEGRAM_RETRY_AFTER_MAX_MS", option(options, "telegram_retry_after_maximum_ms", environment, "TELEGRAM_RETRY_AFTER_MAX_MS"), 60 * 60_000, 1_000, 24 * 60 * 60_000),
		retry_jitter_percent: integer("SUBMISSION_RETRY_JITTER_PERCENT", option(options, "retry_jitter_percent", environment, "SUBMISSION_RETRY_JITTER_PERCENT"), 20, 0, 50),
		outbox_batch_size: integer("SUBMISSION_OUTBOX_BATCH_SIZE", option(options, "outbox_batch_size", environment, "SUBMISSION_OUTBOX_BATCH_SIZE"), 20, 1, 1_000),
		staging_maximum_age_ms: integer("SUBMISSION_STAGING_MAX_AGE_MS", option(options, "staging_maximum_age_ms", environment, "SUBMISSION_STAGING_MAX_AGE_MS"), 60 * 60_000, 1_000, 7 * 24 * 60 * 60_000),
		readiness_probe_interval_ms: integer("READINESS_PROBE_INTERVAL_MS", option(options, "readiness_probe_interval_ms", environment, "READINESS_PROBE_INTERVAL_MS"), 30_000, 1_000, 10 * 60_000),
		readiness_probe_timeout_ms: integer("READINESS_PROBE_TIMEOUT_MS", option(options, "readiness_probe_timeout_ms", environment, "READINESS_PROBE_TIMEOUT_MS"), 5_000, 100, 30_000),
		readiness_retry_after_seconds: integer("READINESS_RETRY_AFTER_SECONDS", option(options, "readiness_retry_after_seconds", environment, "READINESS_RETRY_AFTER_SECONDS"), 10, 1, 300),
	};
	if (configuration.retry_maximum_delay_ms < configuration.retry_base_delay_ms) {
		throw new ConfigurationError("SUBMISSION_RETRY_MAX_DELAY_MS", "must not be below SUBMISSION_RETRY_BASE_DELAY_MS.");
	}
	if (!/^(?:localhost|(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+|\d{1,3}(?:\.\d{1,3}){3}|::1)$/.test(configuration.bind_host)) {
		throw new ConfigurationError("BIND_HOST", "must be a structurally valid host or IP address.");
	}
	if (production && !new Set(["127.0.0.1", "::1", "localhost"]).has(configuration.bind_host)) {
		throw new ConfigurationError("BIND_HOST", "must be a loopback address in production.");
	}
	if (configuration.max_artwork_pixels > configuration.max_artwork_width * configuration.max_artwork_height) {
		throw new ConfigurationError("SUBMISSION_MAX_ARTWORK_PIXELS", "must not exceed the configured width multiplied by height.");
	}
	if (configuration.lease_ms < configuration.delivery_timeout_ms + 5_000) {
		throw new ConfigurationError("SUBMISSION_DELIVERY_LEASE_MS", "must exceed SUBMISSION_DELIVERY_TIMEOUT_MS by at least 5000ms.");
	}
	if (production && configuration.storage_maximum_bytes > 0 && configuration.storage_maximum_bytes < configuration.max_file_bytes + 16 * 1024) {
		throw new ConfigurationError("SUBMISSION_STORAGE_MAX_BYTES", "must leave room for one maximum-size submission and metadata.");
	}
	return Object.freeze(configuration);
}
