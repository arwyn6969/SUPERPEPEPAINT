import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");

test("deployment tests before SSH and ships every frontend runtime file", () => {
	assert.ok(workflow.indexOf("Run frontend tests") < workflow.indexOf("Configure deployment SSH key"));
	assert.ok(workflow.indexOf("Install and test backend") < workflow.indexOf("Configure deployment SSH key"));
	for (const filename of ["index.html", "main.js", "submission-retry.js", "traits.js", "filters.js", "styles.css"]) {
		assert.match(workflow, new RegExp(`--include='/${filename.replace(".", "\\.")}'`));
	}
});

test("deployment preserves private state and has a tested-file rollback step", () => {
	assert.match(workflow, /Back up current application on the runner/);
	assert.match(workflow, /Restore previous application if deployment failed/);
	assert.match(workflow, /failure\(\) && steps\.backup\.outcome == 'success'/);
	assert.match(workflow, /--exclude='\/\.env'/);
	assert.match(workflow, /--exclude='\/var\/\*\*\*'/);
	assert.doesNotMatch(workflow, /versioned-release|release-manifest|migrate-to-versioned/);
});
