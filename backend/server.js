import { createSubmissionApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3101", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
	throw new Error("PORT must be a valid TCP port.");
}

const app = createSubmissionApp();
app.listen(port, "127.0.0.1", () => {
	console.log(`PEPEPAINT submissions listening on http://127.0.0.1:${port}`);
});
