# AGENTS.md

Project: PEPEPAINT V1

PEPEPAINT is a small browser-based drawing application with a lightweight Node.js submission backend.

The project is intentionally simple.

It is expected to have a small number of users. Do not design or refactor it as though it were a large-scale application.

The most important goals are:

1. Keep the drawing application working reliably.
2. Protect users from losing their artwork.
3. Keep the codebase simple and understandable.
4. Make the smallest change that adequately solves a real problem.

---

## Core philosophy

**Simplicity is a feature of this project.**

Prefer:

- simple code over abstractions
- existing working behaviour over speculative improvements
- small local changes over broad refactors
- understandable solutions over architecturally sophisticated ones
- fixing demonstrated problems over preventing hypothetical future problems

Do not introduce complexity simply because it represents general software-development best practice.

A solution appropriate for a large production service may be inappropriate for PEPEPAINT.

If existing code is slightly inelegant but reliable and easy to understand, it is usually better to leave it alone.

---

## Before changing code

Before making a substantial change, establish:

- What concrete problem does this solve?
- Does that problem actually exist in PEPEPAINT?
- Could it affect normal users?
- Is there a simpler fix?
- Could the change introduce regressions?
- Does it affect artwork persistence?

Do not create work merely because an audit, linter, design pattern, or theoretical edge case suggests that something could be improved.

When asked to audit the project, prioritise real failures over completeness.

A short audit containing two genuine issues is better than a long audit containing twenty speculative ones.

---

## Highest priority: protect artwork

Users' drawings are the most important state in the application.

PEPEPAINT uses IndexedDB to preserve artwork between sessions.

Changes involving canvas state, drawing state, startup, IndexedDB, undo/redo, exports, animation, submissions, page lifecycle events, or error handling must not accidentally:

- clear a drawing
- overwrite a valid saved drawing with an empty state
- prevent a drawing from being restored
- corrupt saved drawing state
- clear artwork after submission
- clear artwork after a failed network request
- make normal reloads lose work

Do not redesign the persistence system unless there is a demonstrated problem with it.

If changing persistence-related code, favour the smallest possible modification and test reload/restore behaviour manually.

---

## Preserve working behaviour

PEPEPAINT is an experimental creative tool.

Unusual drawing behaviour, strange controls, unconventional rendering techniques, or deliberately awkward interactions may be intentional.

Do not "correct" creative behaviour merely because it differs from conventional application design.

When modifying drawing code:

- preserve existing brush behaviour unless the task explicitly requires changing it
- preserve existing controls and keyboard behaviour
- avoid broad cleanup while fixing an unrelated bug
- avoid changing rendering order or canvas state unless necessary
- avoid moving large amounts of working code solely to improve organisation

A refactor should have a concrete benefit.

"Cleaner architecture" on its own is not sufficient justification.

---

## Project structure

The frontend uses plain HTML, CSS and JavaScript with no build step.

Important files include:

- `index.html` — interface and controls
- `styles.css` — application styling
- `main.js` — drawing logic, brushes, canvas state and interaction
- `filters.js` — canvas/image filters
- `traits.js` — artwork trait calculations
- `brushes/` — brush assets
- `fonts/` — custom fonts
- `backend/` — submission service

Keep additions consistent with the existing structure unless there is a strong reason not to.

Do not introduce a frontend framework, bundler, state-management library, component system, database, queue, cache, or other architectural layer unless explicitly requested or clearly required by a real problem.

---

## Coding style

Follow the surrounding code rather than imposing a new style.

In particular:

- keep existing naming conventions
- put related brush logic near existing brush logic
- keep UI controls consistent with the existing control system
- avoid extracting small pieces of code into additional modules merely for abstraction
- avoid helper functions that make simple behaviour harder to follow
- avoid dependencies when a small amount of straightforward JavaScript is sufficient

Duplication is not automatically a problem.

Remove duplication only when it is causing bugs or making a change significantly harder.

---

## Backend and submissions

The backend exists primarily to receive artwork submissions and deliver them through configured services such as Resend and Telegram.

Submission behaviour must remain straightforward and reliable.

Important requirements:

- secrets must remain server-side
- user input should receive sensible server-side validation
- failed submissions must not clear artwork
- successful submissions must not clear artwork
- network, email, or Telegram failures must not destroy user work
- users should not be told a submission succeeded when the backend knows it failed

Avoid building elaborate reliability infrastructure for hypothetical traffic or failure scenarios.

PEPEPAINT is expected to receive a small volume of submissions.

Rate limiting, retry logic, duplicate handling, validation, archiving, and similar mechanisms should remain proportional to the actual risk and complexity of the project.

Do not add databases, queues, background workers, distributed locks, elaborate retry systems, or additional services unless explicitly required.

---

## Security

Take obvious security problems seriously, particularly:

- committed secrets
- API keys exposed to browser JavaScript
- command/code injection
- path traversal
- obvious cross-site scripting involving user-controlled content
- dangerous file handling
- unrestricted access to private submission data

However, do not attempt to harden PEPEPAINT against every theoretical attack.

Security work should address a concrete and realistic risk.

Prefer a small validation or escaping fix over a major architectural change whenever it adequately addresses the problem.

Never print or expose secret values while debugging.

Never commit `.env` files, API keys, Telegram tokens, Resend credentials, deployment keys, or private submission data.

---

## Performance

Only optimise performance when there is evidence of an actual problem or a clearly expensive operation in a frequently executed path.

For the drawing application, pay particular attention to:

- animation loops
- canvas allocations
- large image operations
- per-frame work
- event handlers
- obvious memory leaks

Do not perform speculative micro-optimisation.

Readable working code is preferable to a faster but substantially more complicated implementation when the performance difference is irrelevant in normal use.

---

## Dependencies

Keep dependencies minimal.

Before adding a dependency, consider whether the task can reasonably be solved with the browser APIs, Node.js, or packages already present.

Do not upgrade dependencies as part of unrelated work.

Do not perform broad dependency or tooling migrations unless specifically requested.

---

## Testing changes

Testing should be proportional to the change.

For frontend changes, manually verify the relevant behaviour in a browser.

When relevant, check:

- drawing
- brush previews
- controls
- keyboard behaviour
- undo/redo
- filters
- animation
- IndexedDB save and reload
- PNG/GIF export
- submission behaviour

For persistence-related changes, explicitly test:

1. Draw something.
2. Confirm it is saved.
3. Reload the page.
4. Confirm the artwork returns correctly.

For submission changes, explicitly confirm that both successful and failed submission attempts leave the artwork intact.

Use existing automated tests where available.

Do not build a large testing infrastructure merely to support a small change.

---

## Deployment

Production deployment should not be modified incidentally.

Do not change:

- DNS
- Nginx
- TLS certificates
- server users
- systemd services
- filesystem permissions
- production secrets

unless the task specifically requires it.

A change to application code should normally remain a change to application code.

---

## Audits and reviews

When auditing PEPEPAINT, use the following severity standard.

### MUST FIX

Report issues that could realistically:

- lose or corrupt artwork
- break normal drawing behaviour
- break normal application startup
- prevent IndexedDB restoration
- make exports unusable
- lose submissions
- expose secrets
- create a serious and plausible security vulnerability

### SHOULD CONSIDER

Report a small number of meaningful reliability or maintainability issues where the benefit of fixing them clearly outweighs the complexity introduced.

### LEAVE ALONE

Actively identify code that may look imperfect but is working and does not need changing.

Do not produce a large backlog for its own sake.

Do not treat theoretical edge cases, stylistic preferences, possible future scale, or architectural fashion as bugs.

---

## Making fixes

When fixing a problem:

1. Understand the existing behaviour.
2. Identify the smallest safe change.
3. Change only what is needed.
4. Avoid opportunistic refactoring.
5. Test the affected behaviour.
6. Stop when the problem is solved.

Do not turn one bug fix into a general rewrite.

If a proposed solution substantially increases the amount or complexity of code, reconsider whether the problem can be solved more simply.

---

## Final principle

For PEPEPAINT:

**simple + understandable + reliable + difficult to lose artwork**

is better than:

**comprehensive + abstract + scalable + complex**

When in doubt, preserve the working application.
