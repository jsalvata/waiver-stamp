# Adopting the waiver-stamp automation layer

This guide wires `waiver stamp --json` into your own repo's CI/CD, so a fully-stamped
refactor PR is auto-approved and a human never reads the mechanical part. Full design
rationale: [`docs/automation-layer.md`](automation-layer.md).

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
PR. On top of that, it re-derives trust using only git data:

- **G1** — no commit in the PR range touches `.github/**` (checked per-commit, not just
  the net diff, so a change-and-revert can't slip through).
- **G2** — if any commit touches `package.json` or the lockfile, the reviewer
  independently re-runs the dependency-bump gates over the range, reading both manifests
  via `git show` (pure data, no execution).

Concretely: the reviewer job checks out **your default branch** (trusted code) and pulls
the PR's head commit in with a plain `git fetch` — never a checkout, never an execution —
so the guards above can read it as data. This is the load-bearing property of the two
templates below; see the inline comments in
[`examples/waiver-stamp-review.yml`](../examples/waiver-stamp-review.yml) for the
full reasoning, and design doc §3.4 for the threat model this defends against (the
classic GitHub Actions "pwn request").

## Adopter checklist

1. **Add the `waiver-stamp` step to your CI**, after your install step — copy
   [`examples/waiver-stamp-ci.yml`](../examples/waiver-stamp-ci.yml), which appends a
   `waiver-stamp` job using
   `uses: jsalvata/waiver-stamp/.github/actions/waiver-stamp@<full-SHA>`.

2. **Add the reviewer caller** — copy
   [`examples/waiver-stamp-review.yml`](../examples/waiver-stamp-review.yml), a
   `workflow_run` workflow on all of your backstop-producing workflows, using
   `uses: jsalvata/waiver-stamp/.github/actions/waiver-stamp-review@<full-SHA>`. Set
   `ci-checks` to your required check-run name(s) (and `lockfile-honesty-checks` if you
   have a separate lockfile-honesty gate wired in).

3. **In branch protection**, mark **both** the CI check **and** the `waiver-stamp` check
   as required status checks, and enable **"Require branches to be up to date before
   merging"**'s sibling toggle, **"Dismiss stale pull request approvals when new commits
   are pushed."** Without dismiss-stale, a bot APPROVE from an earlier, smaller commit
   range could linger after new commits land.

4. **Use merge-commit or rebase-merge, not squash-merge**, so the individually-verified
   commits land on your default branch as-is, waivers intact. A squash-merge discards
   them — the new squashed commit carries no waiver and falls back to normal human
   review (safe, but the stamp is lost). If your workflow requires squash-merge, have the
   squash commit carry its own waiver instead.

5. **Set `commitlint`'s `body-max-line-length` to `[0]`** (disabled) if your repo enforces
   it — pretty-printed waiver JSON in a commit body can exceed commitlint's default
   100-character line limit, and a rejecting `commit-msg` hook would block waivered
   commits from ever being written.

6. *(Optional, recommended)* **Protect `.github/**` with CODEOWNERS or a ruleset.** This
   is defense in depth behind G1, which already blocks any `.github/**` change from ever
   producing an APPROVE — but an extra layer at the branch-protection level costs little.

7. *(Optional)* **Upgrade `github-token` to an App or bot-PAT token** so the reviewer's
   APPROVE counts toward "required approving reviews" branch protection. By default the
   reviewer uses `${{ github.token }}` (`GITHUB_TOKEN`), whose APPROVE is visible on the
   PR but does **not** satisfy that branch-protection rule — a deliberately conservative
   default that bounds the blast radius of any residual forgery until you explicitly
   opt in. If you upgrade, understand that this token now runs **our** code with **your**
   write-capable credential — pin the action ref by full commit SHA (not a tag or
   branch), same as step 1/2.

8. *(Optional caveat)* **If you set `allowBumping` in `.waiver-stamp.json` without also
   wiring a lockfile-honesty check** into `lockfile-honesty-checks`, understand the
   accepted residual: waiver-stamp assumes the lockfile is honest, so a poisoned tarball
   behind an allowlisted package name (version string unchanged) could pass the
   dependency-bump gates undetected. The reviewer's APPROVE body names this caveat
   explicitly whenever `lockfile-honesty-checks` is empty — it's not silent, but it is a
   real gap until a lockfile-honesty tool (e.g. a lockfile-firewall product) is wired in
   as a required check.

## Templates

Both templates live in [`examples/`](../examples/) and are meant to be copied in and
edited only at the marked `# <-- EDIT` comments:

- [`examples/waiver-stamp-ci.yml`](../examples/waiver-stamp-ci.yml) — your producer:
  installs your deps, runs `waiver-stamp`, publishes the check + artifact.
- [`examples/waiver-stamp-review.yml`](../examples/waiver-stamp-review.yml) — your
  privileged reviewer caller: reproduces the exact security-reviewed checkout/fetch
  pattern this repo uses for its own dogfood installation. Read its header comment
  before changing anything beyond the two `uses:`/`ci-checks` edit points — the checkout
  target (your default branch, never the PR head) is what keeps a PR from ever running
  code with the reviewer's write token.
