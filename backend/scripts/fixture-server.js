import { createSubmissionApp } from "../app.js";

const app = createSubmissionApp({
	storage_root: process.env.SUBMISSION_STORAGE_ROOT,
	api_key: "test-key",
	from: "PEPEPAINT <submissions@example.com>",
	to: "owner@example.com",
	telegram_bot_token: "",
	telegram_chat_id: "",
	rate_maximum: 100,
	deliver_email: async () => ({ id: "fixture-email-id" }),
});

app.listen(3102, "127.0.0.1", () => console.log("Fixture server listening on http://127.0.0.1:3102"));
