# [1.1.0](https://github.com/jsalvata/waiver-stamp/compare/v1.0.3...v1.1.0) (2026-07-03)


### Features

* add move-file reproductive op ([c4e9899](https://github.com/jsalvata/waiver-stamp/commit/c4e9899e55f1d54f4a42ef8e69abc36e35ef8ab4)), closes [SourceFile#move](https://github.com/SourceFile/issues/move)

## [1.0.3](https://github.com/jsalvata/waiver-stamp/compare/v1.0.2...v1.0.3) (2026-07-03)


### Bug Fixes

* scan dynamic references before/after rename ([2120152](https://github.com/jsalvata/waiver-stamp/commit/2120152d81a1c0d137663b2f81a027fce564e119))

## [1.0.2](https://github.com/jsalvata/waiver-stamp/compare/v1.0.1...v1.0.2) (2026-07-02)


### Bug Fixes

* anchor excluded-file matching to the checkout root ([12f030f](https://github.com/jsalvata/waiver-stamp/commit/12f030f310873a11f100f126037cbae9f9c2133e))
* exclude confined files from dynamic-reference guard ([d6ade56](https://github.com/jsalvata/waiver-stamp/commit/d6ade563841038ba8830e32e1896444534c3ec47))

## [1.0.1](https://github.com/jsalvata/waiver-stamp/compare/v1.0.0...v1.0.1) (2026-07-02)


### Bug Fixes

* drop leading ./ from waiver bin path ([5561609](https://github.com/jsalvata/waiver-stamp/commit/55616091df2936f5b93a9eab545bbf8052fdec3f))

# 1.0.0 (2026-07-02)


### Bug Fixes

* accept object or json-string waiver in mcp ([ab7a9b9](https://github.com/jsalvata/waiver-stamp/commit/ab7a9b9c9b1008c11e6e1597c8be0922c80bee0b))
* add repository metadata to package.json ([f1e4616](https://github.com/jsalvata/waiver-stamp/commit/f1e4616d68f9127df37cc1ce537b399621d5cfba))
* carry backtick rule into json schema ([c31d3ac](https://github.com/jsalvata/waiver-stamp/commit/c31d3ac50821df380cc7d0d437dda4325f9b022c))
* drop dead dirtytreeerror class ([cfba2b2](https://github.com/jsalvata/waiver-stamp/commit/cfba2b2b8c5d55e63ca0175680f51ecdea115695))
* drop redundant tool field from bench stamp ([574b23b](https://github.com/jsalvata/waiver-stamp/commit/574b23bf33003f937f6c46bcc1adcc734cd99a01))
* fail closed on broken waiver blocks ([16a6851](https://github.com/jsalvata/waiver-stamp/commit/16a68512e23f0eaa55953aece4a085e326d21352))
* let semantic-release own npm auth ([9626a97](https://github.com/jsalvata/waiver-stamp/commit/9626a97c49f03d05022b3c9c1ac04f1ba72f561a))
* map exit codes per spec section 10 ([d944d59](https://github.com/jsalvata/waiver-stamp/commit/d944d59b7cbc1051682ce235e5ea27d62eb2ebe7))
* restore biome lint to a passing state ([6ac9a4b](https://github.com/jsalvata/waiver-stamp/commit/6ac9a4b8daf61a7ee810794907d9285d9769bf42))
* restore extraction edge-case tests ([a585d4d](https://github.com/jsalvata/waiver-stamp/commit/a585d4d69b99ac51554eb43c258b3ef4db7dd3c8))
* restore stamp-core integration tests ([fb1690c](https://github.com/jsalvata/waiver-stamp/commit/fb1690cc31c32fd6c68492324ef09c5fc37ea175))


### Features

* add mcp server and wire verify/commit/mcp cli commands ([ee806dc](https://github.com/jsalvata/waiver-stamp/commit/ee806dc4c32b3d29d357f4916a6a2d323377338e))
* cli exposes apply/verify/stamp only ([25a6289](https://github.com/jsalvata/waiver-stamp/commit/25a6289659eb31cfa46c4b25eead991a6f5da672))
* commit-embedded waivers, per-commit verify, waiver commit ([eb54d32](https://github.com/jsalvata/waiver-stamp/commit/eb54d32aad372039bab29ae298210033df6b4d20))
* derive schema and types from one zod source ([d555daf](https://github.com/jsalvata/waiver-stamp/commit/d555daf01e28f4fde298274e29409a4ef918e687))
* disable body-max-line-length; fix ci smoke ([77e6296](https://github.com/jsalvata/waiver-stamp/commit/77e6296abb96a14725467803020a4ce8531056cd))
* drop the waiver tool field ([a8d2e5f](https://github.com/jsalvata/waiver-stamp/commit/a8d2e5f099944f77cc76496b2c094800a388dea6))
* embed waivers in a waiver-fenced block ([1bc69c4](https://github.com/jsalvata/waiver-stamp/commit/1bc69c4d3632f394c0a59aa3276ee30c096f50ec))
* git helpers — range walk, %B message read, throwaway worktrees ([0a92eda](https://github.com/jsalvata/waiver-stamp/commit/0a92eda7047e81e4352ddef835ae692d4bd28d5d))
* implement engine core — project load, selector resolve, rename, apply ([bf56eba](https://github.com/jsalvata/waiver-stamp/commit/bf56eba36b24dfebfc1cf7c8c0a47410ff1c5fc5))
* implement stamp — fold + emit-compare + exclusions (paramount feature) ([9711996](https://github.com/jsalvata/waiver-stamp/commit/9711996ff40862bfaaf837ff1a0ef54a42e93e29))
* mcp mirrors the cli (verify/stamp, no check) ([2603eb4](https://github.com/jsalvata/waiver-stamp/commit/2603eb4105dcf2d9def9bd5a29314e66d06fad66))
* persist bench session transcripts ([a40a3ac](https://github.com/jsalvata/waiver-stamp/commit/a40a3ac19b4ffe22ce111a0c2f609a925b1e2866))
* read the waiver from stdin with `-` ([5923c09](https://github.com/jsalvata/waiver-stamp/commit/5923c092f4348c0496eefcc52b4851b47e89bc08))
* refactor-with-waiver skill, plugin mcp server, bench harness ([2ffafd8](https://github.com/jsalvata/waiver-stamp/commit/2ffafd8766153c6d76c3e8a341e0158847d710f4))
* remove waiver commit and check commands ([fdbfff1](https://github.com/jsalvata/waiver-stamp/commit/fdbfff1622b26fb63ad671e72b63d05276bd3405))
* scaffold waiver-stamp cli, schema, plugin ([5ba05cf](https://github.com/jsalvata/waiver-stamp/commit/5ba05cfa39f45b4b805aa39d67f036e897648a0d))
* split stampWaiver into stamp-core module ([efb9637](https://github.com/jsalvata/waiver-stamp/commit/efb96371e6989f6ee7ed1579d59d28a6d3401208))
* static guards — dynamic-reference, public-api, emit-divergence (spec 8) ([ac5af25](https://github.com/jsalvata/waiver-stamp/commit/ac5af2532db8f452bc48280ec576f23c963ecf10))
* swap verify (one commit) and stamp (a pr range) ([d1cf11d](https://github.com/jsalvata/waiver-stamp/commit/d1cf11d84947f92ec1d92294e9767654c76e77c7))
