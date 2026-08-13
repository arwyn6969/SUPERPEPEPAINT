const SAFE_TEXT_LIMIT = 240;
const RETRYABLE_NETWORK_CODES = new Set([
	"EAI_AGAIN",
	"ECONNREFUSED",
	"ENETDOWN",
	"ENETUNREACH",
	"EHOSTUNREACH",
	"ENOTFOUND",
	"ETIMEDOUT",
]);

function safeToken(value, maximum = 80) {
	const token = String(value ?? "").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, maximum);
	return token || null;
}

export function sanitizeProviderSummary(value) {
	return String(value || "Provider delivery failed")
		.replace(/https?:\/\/\S+/gi, "[url]")
		.replace(/bearer\s+[a-z0-9._:-]+/gi, "[credential]")
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, SAFE_TEXT_LIMIT);
}

export class ProviderDeliveryError extends Error {
	constructor(message, details = {}) {
		super(sanitizeProviderSummary(message));
		this.name = "ProviderDeliveryError";
		this.provider = details.provider;
		this.status = Number.isInteger(details.status) ? details.status : null;
		this.provider_code = safeToken(details.provider_code);
		this.retry_after_ms = Number.isFinite(details.retry_after_ms) && details.retry_after_ms >= 0 ? details.retry_after_ms : null;
		this.request_may_have_reached_provider = details.request_may_have_reached_provider === true;
		this.response_received = details.response_received === true;
		this.kind = details.kind ?? "provider";
	}
}

export function parseRetryAfter(value, now = Date.now()) {
	if (value === null || value === undefined || value === "") return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : null;
	const date = Date.parse(String(value));
	return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function classifyProviderError(provider, error) {
	const status = Number.isInteger(error?.status) ? error.status : null;
	const code = safeToken(error?.provider_code ?? error?.code ?? error?.cause?.code);
	const summary = sanitizeProviderSummary(error?.message);
	const base = {
		provider,
		provider_status: status,
		provider_code: code,
		retry_after_ms: Number.isFinite(error?.retry_after_ms) ? Math.max(0, error.retry_after_ms) : null,
		request_may_have_reached_provider: error?.request_may_have_reached_provider === true,
		error_summary: summary,
	};
	if (error?.kind === "shutdown" || error?.classification === "cancelled_for_shutdown") {
		return { ...base, classification: "cancelled_for_shutdown" };
	}
	if (error?.kind === "timeout") return { ...base, classification: base.request_may_have_reached_provider ? "uncertain" : "retryable" };
	if (error?.kind === "response_parse" || (base.request_may_have_reached_provider && new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]).has(code))) {
		return { ...base, classification: "uncertain" };
	}
	if (status === 429) return { ...base, classification: "throttled" };
	if (status === 408 || status === 425 || status >= 500) return { ...base, classification: "retryable" };
	if (provider === "resend" && status === 409 && code === "concurrent_idempotent_requests") {
		return { ...base, classification: "retryable" };
	}
	if (status >= 400 && status < 500) return { ...base, classification: "permanent_failure" };
	if (base.request_may_have_reached_provider) return { ...base, classification: "uncertain" };
	if (RETRYABLE_NETWORK_CODES.has(code) || error?.name === "TypeError") return { ...base, classification: "retryable" };
	return { ...base, classification: error?.retryable === false ? "permanent_failure" : "retryable" };
}

export async function withProviderDeadline(provider, operation, options = {}) {
	const timeout_ms = options.timeout_ms;
	const caller_signal = options.signal;
	const controller = new AbortController();
	let timed_out = false;
	let cancelled = false;
	let dispatched = false;
	let reject_deadline;
	const deadline = new Promise((_, reject) => {
		reject_deadline = reject;
	});
	const on_abort = () => {
		cancelled = true;
		controller.abort(caller_signal.reason);
		reject_deadline(new ProviderDeliveryError("Delivery cancelled during shutdown", {
			provider,
			kind: "shutdown",
			request_may_have_reached_provider: dispatched,
		}));
	};
	if (caller_signal?.aborted) on_abort();
	else caller_signal?.addEventListener("abort", on_abort, { once: true });
	const timeout = setTimeout(() => {
		timed_out = true;
		controller.abort(new Error("Provider deadline exceeded"));
		reject_deadline(new ProviderDeliveryError("Provider deadline exceeded", {
			provider,
			kind: "timeout",
			request_may_have_reached_provider: dispatched,
		}));
	}, timeout_ms);
	try {
		if (cancelled) return await deadline;
		dispatched = true;
		return await Promise.race([operation(controller.signal), deadline]);
	} catch (error) {
		if (cancelled) {
			throw new ProviderDeliveryError("Delivery cancelled during shutdown", {
				provider,
				kind: "shutdown",
				request_may_have_reached_provider: dispatched,
			});
		}
		if (timed_out) {
			throw new ProviderDeliveryError("Provider deadline exceeded", {
				provider,
				kind: "timeout",
				request_may_have_reached_provider: dispatched,
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		caller_signal?.removeEventListener("abort", on_abort);
	}
}
