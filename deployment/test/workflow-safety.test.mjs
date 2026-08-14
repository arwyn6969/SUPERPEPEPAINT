#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repository = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflow = await readFile(path.join(repository, ".github/workflows/deploy.yml"), "utf8");
const position = (value) => {
	const index = workflow.indexOf(value);
	assert.notEqual(index, -1, `workflow is missing ${value}`);
	return index;
};
const ssh = position("Configure deployment SSH key");
for (const prerequisite of [
	"Validate frontend JavaScript",
	"Run frontend tests",
	"Validate deployment programs",
	"Run backend tests",
	"Audit production dependencies",
	"Build immutable release payload",
]) assert.ok(position(prerequisite) < ssh, `${prerequisite} must precede SSH configuration`);
assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
assert.match(workflow, /concurrency:[\s\S]*cancel-in-progress: false/);
assert.match(workflow, /COMMIT_SHA:[\s\S]*RUN_ID:[\s\S]*RUN_ATTEMPT:/);
assert.match(workflow, /build-release\.mjs/);
assert.match(workflow, /rollback \/var\/www\/pepepaint/);
assert.ok(position("PEPEPAINT_DEPLOY_KEY") >= ssh, "deployment secret must not be referenced before SSH setup");
console.log("workflow safety tests passed");
