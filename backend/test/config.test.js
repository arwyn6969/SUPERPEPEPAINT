import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ConfigurationError, loadConfiguration } from "../config.js";

function productionEnvironment(overrides = {}) {
	return {
		APP_ENV: "production",
		PORT: "3101",
		SUBMISSION_STORAGE_ROOT: "/var/lib/pepepaint-test/submissions",
		RESEND_ENABLED: "true",
		RESEND_API_KEY: "re_structurally-valid-test-key",
		SUBMISSION_FROM_EMAIL: "PEPEPAINT <submissions@pepepaint.invalid>",
		SUBMISSION_TO_EMAIL: "operator@pepepaint.invalid",
		TELEGRAM_ENABLED: "false",
		...overrides,
	};
}

test("loads, normalizes, and freezes a valid production configuration", () => {
	const configuration = loadConfiguration({}, productionEnvironment());
	assert.equal(configuration.production, true);
	assert.equal(configuration.email_enabled, true);
	assert.equal(configuration.telegram_enabled, false);
	assert.equal(configuration.port, 3101);
	assert.ok(Object.isFrozen(configuration));
});

test("production requires an archive root and explicit complete provider configuration", () => {
	assert.throws(() => loadConfiguration({}, productionEnvironment({ SUBMISSION_STORAGE_ROOT: "" })), /SUBMISSION_STORAGE_ROOT/);
	assert.throws(() => loadConfiguration({}, productionEnvironment({ RESEND_ENABLED: "", TELEGRAM_ENABLED: "false" })), /RESEND_ENABLED/);
	assert.throws(() => loadConfiguration({}, productionEnvironment({ RESEND_API_KEY: "" })), /RESEND_API_KEY/);
	assert.throws(() => loadConfiguration({}, productionEnvironment({ SUBMISSION_TO_EMAIL: "not-an-address" })), /SUBMISSION_TO_EMAIL/);
	assert.throws(() => loadConfiguration({}, productionEnvironment({ RESEND_ENABLED: "false", TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: "123456:valid_bot_token_1234567890", TELEGRAM_CHAT_ID: "" })), /TELEGRAM_BOT_TOKEN\/TELEGRAM_CHAT_ID/);
	assert.throws(() => loadConfiguration({}, productionEnvironment({ RESEND_ENABLED: "false", TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: "not-a-production-token", TELEGRAM_CHAT_ID: "-100123" })), /TELEGRAM_BOT_TOKEN/);
	assert.throws(() => loadConfiguration({}, productionEnvironment({ SUBMISSION_STORAGE_ROOT: path.resolve("..", "unsafe-archive") })), /SUBMISSION_STORAGE_ROOT/);
});

test("invalid scalar values fail rather than falling back", () => {
	for (const value of ["0", "-1", "1.5", "NaN", "Infinity", "999999999999999999999"]) {
		assert.throws(() => loadConfiguration({}, { APP_ENV: "test", SUBMISSION_CONCURRENT_MAX: value }), /SUBMISSION_CONCURRENT_MAX/);
	}
	assert.throws(() => loadConfiguration({}, { APP_ENV: "test", RESEND_ENABLED: "yes" }), /RESEND_ENABLED/);
	assert.throws(() => loadConfiguration({}, { APP_ENV: "test", SUBMISSION_RETRY_JITTER_PERCENT: "51" }), /SUBMISSION_RETRY_JITTER_PERCENT/);
	assert.throws(() => loadConfiguration({}, { APP_ENV: "test", BIND_HOST: "bad host/name" }), /BIND_HOST/);
});

test("cross-field retry, lease, and production capacity relationships are enforced", () => {
	assert.throws(() => loadConfiguration({}, { APP_ENV: "test", SUBMISSION_RETRY_BASE_DELAY_MS: "5000", SUBMISSION_RETRY_MAX_DELAY_MS: "4000" }), /SUBMISSION_RETRY_MAX_DELAY_MS/);
	assert.throws(() => loadConfiguration({}, { APP_ENV: "test", SUBMISSION_DELIVERY_TIMEOUT_MS: "30000", SUBMISSION_DELIVERY_LEASE_MS: "34999" }), /SUBMISSION_DELIVERY_LEASE_MS/);
	assert.throws(() => loadConfiguration({}, productionEnvironment({ SUBMISSION_STORAGE_MAX_BYTES: "1000" })), /SUBMISSION_STORAGE_MAX_BYTES/);
	assert.throws(() => loadConfiguration({}, productionEnvironment({ BIND_HOST: "0.0.0.0" })), /BIND_HOST/);
	assert.throws(() => loadConfiguration({}, { APP_ENV: "test", SUBMISSION_MAX_ARTWORK_WIDTH: "10", SUBMISSION_MAX_ARTWORK_HEIGHT: "10", SUBMISSION_MAX_ARTWORK_PIXELS: "101" }), /SUBMISSION_MAX_ARTWORK_PIXELS/);
});

test("development and test can use injected providers without production API credentials", () => {
	const configuration = loadConfiguration({
		app_env: "test",
		storage_root: "/tmp/pepepaint-config-test",
		deliver_email: async () => ({}),
		from: "sender@test.invalid",
		to: "recipient@test.invalid",
	}, {});
	assert.equal(configuration.email_enabled, true);
	assert.equal(configuration.api_key, null);
});

test("configuration errors name keys without exposing secret values", () => {
	const secret = "short-secret-value";
	assert.throws(
		() => loadConfiguration({}, productionEnvironment({ RESEND_API_KEY: secret })),
		(error) => error instanceof ConfigurationError && error.message.includes("RESEND_API_KEY") && !error.message.includes(secret),
	);
});
