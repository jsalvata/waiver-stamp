---
description: Author, commit, and verify a waiver-stamp waiver for a refactor
argument-hint: [base-ref] [head-ref]
---

Author a **waiver-stamp** waiver for the current refactor, commit it with the
waiver embedded, and validate it.

Invoke the `refactor-with-waiver` skill and follow it to:

1. Inspect the change. If `$1` (base ref) and `$2` (head ref) are provided, diff
   `$1..$2`; otherwise diff the working tree against the merge-base with the
   default branch.
2. Translate **production-code** changes into transform ops (`rename` in v0) and
   **test/doc** changes into `change-test` / `change-docs` exclusion ops. Leave
   anything that can't be proven safe out of the waiver — it falls to human
   review (fail-closed). Do not use `extract-function` / `move-to-new-file` /
   `bump` — they are not implemented in this build.
3. Write the waiver JSON conforming to `schema/waiver-stamp.v0.schema.json`.
4. Validate and land it:
   - `waiver check <waiver>` (always)
   - `waiver commit <waiver> -m "refactor: …"` — apply, stage, and commit with
     the waiver embedded (recommended path)
   - `waiver verify --base $1 --head $2 --json` — preview the PR verdict (when
     refs are available)

Show the final waiver JSON and the validation output.
