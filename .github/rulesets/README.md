# Rulesets

GitHub does not read rulesets from the repo — they live in repository *settings*. The JSON here
is the source of truth for what those settings should say, so the configuration is reviewable in
a PR instead of existing only as invisible clicks in a settings pane.

## `immutable-release-tags.json`

**This ruleset is load-bearing.** `docs/auto-approval-setup.md` tells adopters they may pin
`uses: jsalvata/waiver-stamp/...@v1.11.2` and trust it, *because* a published `v*` tag cannot be
force-moved or deleted. That promise is this ruleset and nothing else. If it is disabled, the
tag pin silently degrades to a mutable ref for every adopter who took us at our word — so treat
turning it off as a breaking change to the security model, not a settings tweak.

It restricts `update` and `deletion` on `refs/tags/v*`, with no bypass actors. It deliberately
does **not** restrict `creation`: semantic-release must still be able to cut new tags.

Apply or re-apply it with:

```bash
gh api --method POST repos/jsalvata/waiver-stamp/rulesets \
  --input .github/rulesets/immutable-release-tags.json
```

Check what is actually live (settings can drift from this file — the file is documentation, not
enforcement):

```bash
gh api repos/jsalvata/waiver-stamp/rulesets \
  --jq '.[] | "\(.id)\t\(.target)\t\(.enforcement)\t\(.name)"'
```
