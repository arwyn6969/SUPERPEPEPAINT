import { createSubmissionApp } from "./app.js";
import { loadConfiguration } from "./config.js";

let configuration;
let app;
let server;
try {
	configuration = loadConfiguration();
	app = createSubmissionApp({ configuration });
	await app.locals.ready;
	server = app.listen(configuration.port, configuration.bind_host, () => {
		console.log(`PEPEPAINT submissions listening on ${configuration.bind_host}:${configuration.port}`);
	});
} catch (error) {
	console.error("PEPEPAINT startup failed.", {
		key: error?.key ?? null,
		reason: error?.key ? error.message : "startup initialization failed",
		code: error?.code ?? "UNKNOWN",
	});
	process.exitCode = 1;
}

let shutting_down = false;
async function shutdown() {
	if (shutting_down) return;
	shutting_down = true;
	app?.locals.beginShutdown();
	if (!server) {
		await app?.locals.close?.();
		return;
	}
	const closed = new Promise((resolve) => server.close(resolve));
	await app.locals.close();
	await closed;
	process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
