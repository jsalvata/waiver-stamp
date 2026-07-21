# Setting up `waiver-stamp` to auto-approve your waivered PRs

This guide wires `waiver stamp --json` into your own repo's CI/CD, so a correctly waivered
PR is auto-approved and a human never reads the mechanical part.

## How it works, and why it's safe

The automation layer is split across two workflows that communicate through exactly one
artifact:

- **The producer** (`waiver-stamp`, unprivileged) runs as ordinary `pull_request` CI. It
  computes the verdict over the PR's commit range and publishes it as a named check plus
  a report artifact. It never holds a write token, so it's exactly as trustworthy — and
  as attacker-reachable — as any other CI job that runs your repo's toolchain on a PR.
- **The reviewer** (`waiver-stamp-review`, privileged) wakes on your CI's completion,
  confirms your required checks are green on that exact commit, downloads and validates
  the producer's artifact, re-derives two trust guards from git data alone (no PR code
  ever executes in this job), and — only if everything holds — posts the mapped GitHub
  review.

The **non-negotiable invariant**: the layer is downside-bounded and fail-closed. The
*only* verdict that removes human review is `APPROVE`, posted only when every guard and
every required check passes on the exact head SHA being reviewed. Any failure, ambiguity,
timeout, or API error yields no review or a neutral note — never a fabricated one. Worst
case is always today's normal review, unchanged.

This is possible because of one fixed point GitHub gives us for free: a `workflow_run`
job always runs the **workflow definition from your default branch**, never the PR
author's version. The reviewer's own code and its configuration are tamper-proof from a
PR. On top of that, it re-derives trust from git data alone, via two guards:

1. **G1** — no commit in the PR range touches `.github/**` (checked per-commit, not just
   the net diff, so a change-and-revert can't slip through).
2. **G2** — if any commit touches `package.json` or the lockfile, the reviewer
   independently re-runs the dependency-bump gates over the range, reading both manifests
   as git data (no execution).

Concretely: the reviewer job checks out **your default branch** (trusted code) and pulls
the PR's head commit in with a plain `git fetch` — never a checkout, never an execution —
so the guards above can read it as data. This shape is the load-bearing property of the
reviewer, and it lives in the pinned reusable workflow your caller invokes — versioned and
unforkable, so a paste-and-edit can't reopen the hole. See that workflow's header
(`jsalvata/waiver-stamp` → `.github/workflows/reusable-review.yml`) for the full reasoning,
the design doc §3.4 for the threat model this defends against (the classic GitHub Actions
"pwn request"), and [`automation-layer.md`](automation-layer.md) for the complete rationale.

## Which ref to pin

Each caller ships pinned to a release tag (`@v1.22.1`, kept current on every release), so **you
can paste them as-is** — we keep `v*` tags immutable via a repo ruleset. If your policy is
hash-pin-only (e.g. [zizmor](https://github.com/zizmorcore/zizmor)'s default `unpinned-uses`), or
you'd rather not rely on a setting you can't see, swap in the SHA the tag points at:
`gh api repos/jsalvata/waiver-stamp/commits/v1.22.1 --jq .sha`. Each caller has exactly one
`uses:` ref — the reusable workflow — so you pin one ref per file (two total); keep both on the
same ref, and never a mutable one (a branch, `@main`). The pinned reusable workflow pins the
action and `actions/checkout` internally, so you don't.

Either way the pin also fixes the CLI version — it ships at the ref you pinned — so the verdict is
fully reproducible, not just the shell script. Upgrading means bumping those two pins to the new
release.

## Adopter checklist

Each step is one action; the indented note under it is the *why*, there only if you want
it. The two workflow files it refers to are in [`examples/`](../examples/).

1. **Add the producer.** Drop
   [`examples/waiver-stamp-ci.yml`](../examples/waiver-stamp-ci.yml) into `.github/workflows/`
   as-is — a standalone `pull_request` workflow that touches nothing you already have.
   > It runs unprivileged, computes the verdict over the PR range, and publishes the check
   > + report artifact the reviewer consumes.

2. **Add the privileged reviewer caller.** Drop
   [`examples/waiver-stamp-review.yml`](../examples/waiver-stamp-review.yml) in, editing its
   one `# <-- EDIT` point: your CI workflow name(s). The `uses:` ref already points at the
   current release; if your policy is hash-pin-only, swap that single ref for its SHA. See
   [Which ref to pin](#which-ref-to-pin).
   > This caller holds the write token, but its security-load-bearing checkout shape lives in
   > the pinned reusable workflow it calls — read that workflow's header, not this caller,
   > before relying on it.
   >
   > The reviewer's required-check set is auto-discovered from the base branch's protection —
   > read from both the rules endpoint and classic protection and unioned, since each surfaces
   > only its own mechanism — so the check-run names, matrix legs included, need no manual
   > listing. Autodiscovery needs the App's `administration: read` token (step 8); without it
   > the read fails and the reviewer falls back to the optional `ci-checks` override (empty ⇒
   > fail-closed). If you set `ci-checks`, it takes **check-run names, not workflow job ids** —
   > they diverge whenever a job sets `name:` or uses a matrix. Read the real names off any
   > recent PR with `gh api repos/OWNER/REPO/commits/<head-sha>/check-runs --jq '.check_runs[].name'`.

3. **Decide your `.waiver-stamp.json` policy — or knowingly skip it.** The file is optional and
   **every policy in it is closed by default**: with no config, `changeDocs.allow` is empty, so
   the `change-docs` op confines *nothing* and no `.md` file can be waived away — not
   `CLAUDE.md`, not `README.md`, not anything. `allowBumping` is likewise empty, so every
   dependency bump falls to review. Skipping the file is safe; it costs you the two ops, it
   never grants them.
   > Stated outright because the inverse would be a security-relevant default: a permissive
   > `change-docs` would let any adopter who skipped the config auto-approve edits to
   > agent-instruction files. It doesn't. To *use* `change-docs` you must opt in explicitly,
   > and the recommended shape keeps AI-instruction assets denied:
   >
   > ```json
   > {
   >   "changeDocs": {
   >     "allow": ["docs/**", "**/README.md", "CHANGELOG.md"],
   >     "deny": [".claude/**", "**/CLAUDE.md", "**/AGENTS.md", ".cursor/**"]
   >   }
   > }
   > ```
   >
   > Policy is always read from the commit's **base**, so a PR can't widen its own permissions
   > in the same commit — and `.waiver-stamp.json` is itself unwaivable, so any edit to it is a
   > review-forcing diff. See the [README](../README.md#configuration--waiver-stampjson) and
   > [`docs/spec.md` §6.5](spec.md).

4. **Mark both checks required, and dismiss stale approvals.** In branch protection, make
   **both** your CI check **and** the `waiver-stamp` check required status checks, and enable
   **"Dismiss stale pull request approvals when new commits are pushed."**
   > Without dismiss-stale, a bot APPROVE from an earlier, smaller commit range could linger
   > after new commits land.

5. *(Recommended)* **Prefer merge-commit or rebase-merge over squash-merge.** This lands the
   individually-verified commits on your default branch as-is, waivers intact.
   > Not required for auto-approval — the stamp has already done its job by merge time. It's a
   > traceability nicety: a squash-merge discards the per-commit waivers, so the merged history
   > no longer carries the proof.

6. **Disable `commitlint`'s `body-max-line-length`** (`[0]`) if your repo enforces it.
   > Pretty-printed waiver JSON in a commit body can exceed the default 100-char limit, and a
   > rejecting `commit-msg` hook would block waivered commits from ever being written.

7. *(Recommended)* **Protect `.github/**` with CODEOWNERS or a ruleset.**
   > Defense in depth behind G1, which already blocks any `.github/**` change from producing an
   > APPROVE — but an extra branch-protection layer costs little.

8. *(Optional)* **Upgrade `github-token` to a GitHub App token** so the reviewer's APPROVE
   counts toward "required approving reviews" branch protection.
   > The default `${{ github.token }}` can't even *post* an APPROVE — GitHub blocks the Actions
   > identity from approving PRs — and a bot APPROVE that did post still wouldn't *count*. Both
   > are deliberate: with the default token the layer leaves the approving click to a human and
   > publishes the green `waiver-stamp` check as its trust signal, bounding the blast radius of
   > any residual forgery. Opting in removes that human click. (A machine-user PAT with repo
   > write access also counts and sidesteps the App-permission subtlety below, at the cost of
   > running a bot account.)
   >
   > For the App path, **two things must both hold**, and it's easy to get only the first:
   >
   > 1. **Give the caller the App credentials.** `waiver setup-repository` creates the App and
   >    writes these two secrets for you (you still click **Create GitHub App** and **Install** in
   >    the browser it opens — §3.3). To do it by hand: set repo/environment secrets
   >    `WAIVER_STAMP_APP_ID` and `WAIVER_STAMP_APP_PRIVATE_KEY`, and map them to the reusable
   >    workflow's inputs with an explicit `secrets:` block in your `waiver-stamp-review.yml`
   >    (`app_id: ${{ secrets.WAIVER_STAMP_APP_ID }}`,
   >    `app_private_key: ${{ secrets.WAIVER_STAMP_APP_PRIVATE_KEY }}`) — the namespaced names
   >    won't forward by `secrets: inherit`.
   >    Adopting a second repository doesn't need a second App: an org-owned repo puts the
   >    secrets at org scope (later repos need only the Install click), and for a personal
   >    account setup offers to keep the key in `~/.waiver-install/` for reuse.
   >    The reusable workflow mints the token, scopes it (`permission-pull-requests: write`, so
   >    zizmor's `github-app` audit stays clean), and wires it into the action's `github-token`
   >    — you don't add a `create-github-app-token` step yourself.
   > 2. **Grant the App `Contents: write`, *not just* `Pull requests: write`.** GitHub counts an
   >    approving review only from an identity with **repository write access**, which for a
   >    GitHub App *is* `Contents: write`. With `pull_requests`-only the App can *submit* the
   >    review, but GitHub silently won't count it: PR up to date, all required checks green, and
   >    `mergeable_state` stays `blocked` / `reviewDecision: REVIEW_REQUIRED`. Granting `contents`
   >    and re-accepting the install flips it to counted immediately — counting is evaluated
   >    against the reviewer's *current* access, so no re-run is needed. (GitHub docs:
   >    [available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets),
   >    "approving reviews from people with write permissions".)
   >
   > The two halves interact: scoping the mint to `permission-pull-requests: write` is correct,
   > but it does **not** relax the requirement that the App itself hold `Contents: write` —
   > configure both.
   >
   > **The security tradeoff:** `Contents: write` is code-push. A leaked App key now carries write
   > to your code, not just the ability to approve. It's bounded — the App is not a ruleset bypass
   > actor, so protected branches (e.g. `main`) stay PR-gated — but weigh it against keeping a
   > human/admin final click and treating the green `waiver-stamp` *check* as the trust signal.
   > This token also runs **our** code with **your** write credential, so this is the case where
   > hash-pinning earns its keep — see [Which ref to pin](#which-ref-to-pin).

9. *(If you set `allowBumping`)* **Name your lockfile-honesty check** in
   `.waiver-stamp.json`'s `lockfileHonestyCheck` field (e.g. the lockfile-assay job/check
   name) — autodiscovery then confirms it's a required check.
   > The APPROVE body carries the "assumes the lockfile is honest" warning only when
   > `allowBumping` is set and no required check matches `lockfileHonestyCheck`. With
   > `allowBumping` empty, no bump can ride in, so the caveat never appears.

## When a waivered PR falls behind `main`

**Rebase it — never merge-update it.** A "Update branch" merge adds a merge commit, and a merge
commit carries no waiver, so the aggregate verdict drops from APPROVE to COMMENT and auto-approval
is lost. If `main` has drifted around the code you touched, GitHub's rebase button will conflict;
do a local reset to `main` + a fresh `waiver apply` + force-push rather than replaying the stale
commit.
