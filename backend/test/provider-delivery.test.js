import assert from "node:assert/strict";
import test from "node:test";
import {
	ProviderDeliveryError,
	classifyProviderError,
	parseRetryAfter,
	sanitizeProviderSummary,
	withProviderDeadline,
} from "../provider-delivery.js";

test("provider deadline returns success and clears its timer", async (t) => {
	let cleared = 0;
	t.mock.method(globalThis, "clearTimeout", (handle) => {
		cleared += 1;
		return handle;
	});
	assert.equal(await withProviderDeadline("resend", async () => "ok", { timeout_ms: 1_000 }), "ok");
	await assert.rejects(withProviderDeadline("resend", async () => { throw new Error("ordinary failure"); }, { timeout_ms: 1_000 }), /ordinary failure/);
	assert.equal(cleared, 2);
});

test("provider deadline aborts a hanging request as uncertain", async () => {
	let observed_signal;
	await assert.rejects(
		withProviderDeadline("telegram", (signal) => {
			observed_signal = signal;
			return new Promise(() => {});
		}, { timeout_ms: 5 }),
		(error) => {
			assert.equal(error.kind, "timeout");
			assert.equal(classifyProviderError("telegram", error).classification, "uncertain");
			return true;
		},
	);
	assert.equal(observed_signal.aborted, true);
});

test("shutdown cancellation is distinct from timeout", async () => {
	const controller = new AbortController();
	const pending = withProviderDeadline("resend", () => new Promise(() => {}), { timeout_ms: 1_000, signal: controller.signal });
	controller.abort();
	await assert.rejects(pending, (error) => classifyProviderError("resend", error).classification === "cancelled_for_shutdown");
});

test("a pre-aborted caller does not dispatch provider work", async () => {
	const controller = new AbortController();
	controller.abort();
	let calls = 0;
	await assert.rejects(withProviderDeadline("resend", async () => { calls += 1; }, { timeout_ms: 1_000, signal: controller.signal }), (error) => {
		const outcome = classifyProviderError("resend", error);
		return outcome.classification === "cancelled_for_shutdown" && outcome.request_may_have_reached_provider === false;
	});
	assert.equal(calls, 0);
});

test("central classifier handles transport, retryable HTTP, throttling, permanent errors, and ambiguity", () => {
	for (const status of [408, 425, 500, 503]) {
		assert.equal(classifyProviderError("resend", { status }).classification, "retryable");
	}
	assert.equal(classifyProviderError("telegram", { status: 429, retry_after_ms: 2_000 }).classification, "throttled");
	assert.equal(classifyProviderError("resend", { status: 401 }).classification, "permanent_failure");
	assert.equal(classifyProviderError("resend", { code: "ENOTFOUND" }).classification, "retryable");
	assert.equal(classifyProviderError("resend", { name: "TypeError", request_may_have_reached_provider: true }).classification, "uncertain");
	assert.equal(classifyProviderError("telegram", { code: "ECONNRESET", request_may_have_reached_provider: true }).classification, "uncertain");
	assert.equal(classifyProviderError("resend", new ProviderDeliveryError("bad response", { kind: "response_parse", request_may_have_reached_provider: true })).classification, "uncertain");
});

test("retry-after parsing and stored summaries are bounded and sanitized", () => {
	assert.equal(parseRetryAfter("3"), 3_000);
	assert.equal(parseRetryAfter("-1"), null);
	const summary = sanitizeProviderSummary(`Bearer secret-token\nhttps://example.invalid/private ${"x".repeat(500)}`);
	assert.ok(summary.length <= 240);
	assert.doesNotMatch(summary, /secret-token|example\.invalid/);
});
