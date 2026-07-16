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
so the guards above can read it as data. This is the load-bearing property of the two
templates; see the inline comments in
[`examples/waiver-stamp-review.yml`](../examples/waiver-stamp-review.yml) for the full
reasoning, the design doc §3.4 for the threat model this defends against (the classic
GitHub Actions "pwn request"), and [`automation-layer.md`](automation-layer.md) for the
complete design rationale.

## Which ref to pin

The templates ship pinned to a release tag (`@v1.15.0`, kept current on every release), so **you
can paste them as-is** — we keep `v*` tags immutable via a repo ruleset. If your policy is
hash-pin-only (e.g. [zizmor](https://github.com/zizmorcore/zizmor)'s default `unpinned-uses`), or
you'd rather not rely on a setting you can't see, swap in the SHA the tag points at:
`gh api repos/jsalvata/waiver-stamp/commits/v1.15.0 --jq .sha`. You pin twice — the producer's
`uses:` (in `waiver-stamp-ci.yml`) and the reviewer's (in `waiver-stamp-review.yml`); keep both on
the same ref, and never a mutable one (a branch, `@main`).

Either way the pin also fixes the CLI version — it ships at the ref you pinned — so the verdict is
fully reproducible, not just the shell script. Upgrading means bumping those two pins to the new
release.

## Adopter checklist

Each step is one action; the indented note under it is the *why*, there only if you want
it. The two workflow files it refers to are in [`examples/`](../examples/).

1. **Run the `waiver-stamp` job on every PR.** Add the `waiver-stamp` job from
   [`examples/waiver-stamp-ci.yml`](../examples/waiver-stamp-ci.yml) to your CI (it's shown
   as a whole workflow, but only the `waiver-stamp` job is new — merge it into your existing
   `pull_request` workflow, or add it as a standalone one).
   > It runs unprivileged, computes the verdict over the PR range, and publishes the check
   > + report artifact the reviewer consumes.

2. **Add the privileged reviewer caller.** Copy
   [`examples/waiver-stamp-review.yml`](../examples/waiver-stamp-review.yml) in as-is,
   editing its marked `# <-- EDIT` points: your CI workflow name(s) and `ci-checks` (plus
   `lockfile-honesty-checks` if you have a lockfile-honesty gate). The `uses:` ref already
   points at the current release; if your policy is hash-pin-only you can't paste it verbatim —
   also swap its `uses:` refs (the action and `actions/checkout`) for SHAs. See
   [Which ref to pin](#which-ref-to-pin).
   > This is the only workflow that holds a write token. Its checkout shape is
   > security-load-bearing — read its header before changing anything else.
   >
   > `ci-checks` takes **check-run names, not workflow job ids** — they diverge whenever a job
   > sets `name:` or uses a matrix. A matrix job `integration` over two Node versions produces
   > `integration (9.12.0)` and `integration (10.0.0)`, and each leg needs its own entry; the
   > bare id `integration` matches nothing, and the reviewer then waits forever rather than
   > approve on an unverified check (fail-closed). For the same reason, list only checks that
   > run on pull requests — a push-only job like `release` never reports on the PR head SHA, so
   > listing it hangs the reviewer just as surely. Read the real names off any recent PR with
   > `gh api repos/OWNER/REPO/commits/<head-sha>/check-runs --jq '.check_runs[].name'`.

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
   > 1. **Mint an App token and pass it as `github-token`.** Add an `environment:`, a
   >    `create-github-app-token` step, and wire its output into the action's `github-token`
   >    input. Scope the mint — zizmor's `github-app` audit (High) flags an unscoped one and
   >    wants a `permission-*` input — with `permission-pull-requests: write`.
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

9. *(Optional caveat)* **If you set `allowBumping` without wiring a lockfile-honesty check**
   into `lockfile-honesty-checks`, know the accepted residual.
   > waiver-stamp assumes the lockfile is honest, so a poisoned tarball behind an allowlisted
   > package name (version string unchanged) could pass the dependency-bump gates undetected.
   > The reviewer's APPROVE body names this caveat whenever `lockfile-honesty-checks` is empty —
   > not silent, but a real gap until a lockfile-honesty tool (e.g. a lockfile-firewall product)
   > is wired in as a required check.

## When a waivered PR falls behind `main`

**Rebase it — never merge-update it.** A "Update branch" merge adds a merge commit, and a merge
commit carries no waiver, so the aggregate verdict drops from APPROVE to COMMENT and auto-approval
is lost. If `main` has drifted around the code you touched, GitHub's rebase button will conflict;
do a local reset to `main` + a fresh `waiver apply` + force-push rather than replaying the stale
commit.
