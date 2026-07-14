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

The templates ship pinned to a release tag — `@v1.11.2` — and that tag is kept current for you
on every release, so **you can paste them as-is**. Both files must name the same ref.

The rule that actually matters is: **pin an immutable ref, never a mutable one.** A branch or
`@main` would let the code that holds your write token change under you without you re-pinning.
Two refs qualify, and the choice is a trust question, not a security-vs-insecurity one:

| Pin | What makes it immutable | Use when |
| --- | --- | --- |
| `@v1.11.2` (tag) | A repository ruleset on `jsalvata/waiver-stamp` restricts *update* and *deletion* on `v*` tags, so a published tag cannot be force-moved. | Default. Readable, and upgrading is a one-token edit. |
| `@<40-char SHA>` (hash) | Git itself — a commit SHA is content-addressed, so it needs no trust in our repo settings at all. | Your policy is hash-pin-only (e.g. [zizmor](https://github.com/zizmorcore/zizmor)'s default `unpinned-uses` audit), or you'd rather not rely on a setting you can't see. |

The honest distinction: a tag's immutability is a property of *our* configuration, which you
must take on trust; a SHA's is arithmetic you can verify yourself. That gap is small — you are
already trusting us to run our code against your write token — but it is real, so hash-pinning
stays fully supported and is what we'd choose for the privileged reviewer under a strict policy.

To resolve the tag to its SHA:

```bash
gh api repos/jsalvata/waiver-stamp/commits/v1.11.2 --jq .sha
```

**Whichever you pick, that single pin covers the tool as well as the actions.** The producer
action's `waiver-version` input defaults to *the CLI release that ships at the ref you pinned*
(it reads the version out of its own checkout), so the pin gives you a fully reproducible
verdict — it is not merely pinning the shell script that invokes the tool. You only need
`waiver-version` if you want to deviate: `latest` to float deliberately, or an explicit `x.y.z`
to run a CLI version other than the one the pinned action shipped with.

Upgrading is therefore one edit: bump both refs to the new release.

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
   editing only its marked `# <-- EDIT` points: your CI workflow name(s) and `ci-checks` (plus
   `lockfile-honesty-checks` if you have a lockfile-honesty gate). The `uses:` ref already
   points at the current release — see [Which ref to pin](#which-ref-to-pin) if you'd rather
   hash-pin it.
   > This is the only workflow that holds a write token. Its checkout shape is
   > security-load-bearing — read its header before changing anything else.
   >
   > `ci-checks` takes **check-run names, not workflow job ids** — they diverge whenever a job
   > sets `name:` or uses a matrix. A matrix job `integration` over two Node versions produces
   > `integration (9.12.0)` and `integration (10.0.0)`, and each leg needs its own entry; the
   > bare id `integration` matches nothing, and the reviewer then waits forever rather than
   > approve on an unverified check (fail-closed). Read the real names off any recent PR with
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

8. *(Optional)* **Upgrade `github-token` to an App or bot-PAT token** so the reviewer's APPROVE
   counts toward "required approving reviews" branch protection.
   > The default `${{ github.token }}` posts a visible APPROVE that does **not** satisfy that
   > rule — deliberately conservative, bounding the blast radius of any residual forgery until
   > you opt in. If you upgrade, this token runs **our** code with **your** write credential, so
   > this is the case where hash-pinning earns its keep — see
   > [Which ref to pin](#which-ref-to-pin).

9. *(Optional caveat)* **If you set `allowBumping` without wiring a lockfile-honesty check**
   into `lockfile-honesty-checks`, know the accepted residual.
   > waiver-stamp assumes the lockfile is honest, so a poisoned tarball behind an allowlisted
   > package name (version string unchanged) could pass the dependency-bump gates undetected.
   > The reviewer's APPROVE body names this caveat whenever `lockfile-honesty-checks` is empty —
   > not silent, but a real gap until a lockfile-honesty tool (e.g. a lockfile-firewall product)
   > is wired in as a required check.
