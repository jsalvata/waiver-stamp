---
description: Generate and validate a waiver-stamp waiver for a code change
argument-hint: [base-ref] [head-ref]
---

Author a **waiver-stamp** waiver for the current change and validate it.

Invoke the `generate-waiver` skill and follow it to:

1. Inspect the change. If `$1` (base ref) and `$2` (head ref) are provided, diff
   `$1..$2`; otherwise diff the working tree against the merge-base with the
   default branch.
2. Translate **production-code** changes into transform ops (`rename`,
   `extract-function`, `move-to-new-file`, `bump`) and **test/doc** changes into
   `change-test` / `change-docs` exclusion ops. Leave anything that can't be
   proven safe out of the waiver — it falls to human review (fail-closed).
3. Write the waiver JSON conforming to `schema/waiver-stamp.v0.schema.json`.
4. Validate it and report the result:
   - `waiver check <waiver>` (always)
   - `waiver stamp <waiver> --base $1 --head $2 --json` (when refs are available)

Show the final waiver JSON and the validation output.
