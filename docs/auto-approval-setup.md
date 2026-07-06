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
templates below; see the inline comments in
[`examples/waiver-stamp-review.yml`](../examples/waiver-stamp-review.yml) for the full
reasoning, the design doc §3.4 for the threat model this defends against (the classic
GitHub Actions "pwn request"), and [`automation-layer.md`](automation-layer.md) for the
complete design rationale.

## Adopter checklist

Each step is one action; the indented note under it is the *why*, there only if you want
it. The two workflow files it refers to are in [`examples/`](../examples/) and reproduced
under [Templates](#templates) below.

1. **Run the `waiver-stamp` job on every PR.** Add the `waiver-stamp` job from
   [`examples/waiver-stamp-ci.yml`](../examples/waiver-stamp-ci.yml) to your CI (it's shown
   as a whole workflow, but only the `waiver-stamp` job is new — merge it into your existing
   `pull_request` workflow, or add it as a standalone one).
   > It runs unprivileged, computes the verdict over the PR range, and publishes the check
   > + report artifact the reviewer consumes.

2. **Add the privileged reviewer caller.** Copy
   [`examples/waiver-stamp-review.yml`](../examples/waiver-stamp-review.yml) in as-is,
   editing only its marked `# <-- EDIT` points: your CI workflow name(s), the pinned action
   SHA, and `ci-checks` (plus `lockfile-honesty-checks` if you have a lockfile-honesty gate).
   > This is the only workflow that holds a write token. Its checkout shape is
   > security-load-bearing — read its header before changing anything else.

3. **Mark both checks required, and dismiss stale approvals.** In branch protection, make
   **both** your CI check **and** the `waiver-stamp` check required status checks, and enable
   **"Dismiss stale pull request approvals when new commits are pushed."**
   > Without dismiss-stale, a bot APPROVE from an earlier, smaller commit range could linger
   > after new commits land.

4. *(Recommended)* **Prefer merge-commit or rebase-merge over squash-merge.** This lands the
   individually-verified commits on your default branch as-is, waivers intact.
   > Not required for auto-approval — the stamp has already done its job by merge time. It's a
   > traceability nicety: a squash-merge discards the per-commit waivers, so the merged history
   > no longer carries the proof.

5. **Disable `commitlint`'s `body-max-line-length`** (`[0]`) if your repo enforces it.
   > Pretty-printed waiver JSON in a commit body can exceed the default 100-char limit, and a
   > rejecting `commit-msg` hook would block waivered commits from ever being written.

6. *(Recommended)* **Protect `.github/**` with CODEOWNERS or a ruleset.**
   > Defense in depth behind G1, which already blocks any `.github/**` change from producing an
   > APPROVE — but an extra branch-protection layer costs little.

7. *(Optional)* **Upgrade `github-token` to an App or bot-PAT token** so the reviewer's APPROVE
   counts toward "required approving reviews" branch protection.
   > The default `${{ github.token }}` posts a visible APPROVE that does **not** satisfy that
   > rule — deliberately conservative, bounding the blast radius of any residual forgery until
   > you opt in. If you upgrade, this token runs **our** code with **your** write credential, so
   > pin the action ref by full commit SHA (as in steps 1–2).

8. *(Optional caveat)* **If you set `allowBumping` without wiring a lockfile-honesty check**
   into `lockfile-honesty-checks`, know the accepted residual.
   > waiver-stamp assumes the lockfile is honest, so a poisoned tarball behind an allowlisted
   > package name (version string unchanged) could pass the dependency-bump gates undetected.
   > The reviewer's APPROVE body names this caveat whenever `lockfile-honesty-checks` is empty —
   > not silent, but a real gap until a lockfile-honesty tool (e.g. a lockfile-firewall product)
   > is wired in as a required check.

## Templates

Both templates live in [`examples/`](../examples/):

- [`examples/waiver-stamp-ci.yml`](../examples/waiver-stamp-ci.yml) — the producer, shown as
  a **complete `pull_request` workflow** so you can see where the `waiver-stamp` job sits next
  to a normal build. If you already have a CI workflow, lift just the `waiver-stamp` job into
  it; the rest is a stand-in for what you already have. It runs unprivileged and publishes the
  check + artifact.
- [`examples/waiver-stamp-review.yml`](../examples/waiver-stamp-review.yml) — the privileged
  reviewer caller, meant to be **copied in whole** and edited only at the marked `# <-- EDIT`
  points. It reproduces the exact security-reviewed checkout/fetch pattern; read its header
  comment before changing anything else — the checkout target (your default branch, never the
  PR head) is what keeps a PR from ever running code with the reviewer's write token.
