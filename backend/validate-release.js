import { access, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { DeliveryOutboxProcessor } from "./delivery-outbox.js";
import { loadConfiguration } from "./config.js";

// This command is intentionally read-only. It validates the exact production
// configuration and every existing durable outbox record without starting an
// HTTP listener, a delivery worker, a readiness probe, or a provider request.
try {
	const configuration = loadConfiguration();
	const storage = await lstat(configuration.storage_root);
	if (storage.isSymbolicLink() || !storage.isDirectory()) {
		throw Object.assign(new Error("Submission storage root must be a real directory."), { code: "UNSAFE_STORAGE_ROOT" });
	}
	await access(configuration.storage_root, constants.R_OK | constants.W_OK | constants.X_OK);
	const processor = new DeliveryOutboxProcessor({
		storage_root: configuration.storage_root,
		targets: [],
		deliver: async () => { throw new Error("release validation must never deliver"); },
	});
	await processor.validateState();
	console.log("Release configuration and durable state are compatible.");
} catch (error) {
	console.error("Release validation failed.", {
		key: error?.key ?? null,
		code: error?.code ?? "INVALID_RELEASE",
		reason: error?.key ? error.message : "configuration or durable state is incompatible",
	});
	process.exitCode = 1;
}
