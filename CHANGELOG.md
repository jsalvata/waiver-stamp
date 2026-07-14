# [1.12.0](https://github.com/jsalvata/waiver-stamp/compare/v1.11.2...v1.12.0) (2026-07-14)


### Features

* drop the waiver-version input ([cfdf3db](https://github.com/jsalvata/waiver-stamp/commit/cfdf3dbb181ebd2105fabb00eb4df1dc3a15b3ce))
* ship immutable tag pins in the templates ([7d48a12](https://github.com/jsalvata/waiver-stamp/commit/7d48a123bb536470f4e63520fe1e6660c4389772))

## [1.11.2](https://github.com/jsalvata/waiver-stamp/compare/v1.11.1...v1.11.2) (2026-07-14)


### Bug Fixes

* pin cli version to the action's own ref ([0ad8796](https://github.com/jsalvata/waiver-stamp/commit/0ad8796cb6046ae258ad4c9cdc01772be1a2f165))

## [1.11.1](https://github.com/jsalvata/waiver-stamp/compare/v1.11.0...v1.11.1) (2026-07-07)


### Bug Fixes

* use full author name in license and metadata ([3308b83](https://github.com/jsalvata/waiver-stamp/commit/3308b83a1b6424115d1f88103d92f52e52865341))

# [1.11.0](https://github.com/jsalvata/waiver-stamp/compare/v1.10.0...v1.11.0) (2026-07-07)


### Features

* publish json schema for .waiver-stamp.json ([9a59483](https://github.com/jsalvata/waiver-stamp/commit/9a59483f3551305f67a98cacac4f57efac0a1071))

# [1.10.0](https://github.com/jsalvata/waiver-stamp/compare/v1.9.0...v1.10.0) (2026-07-07)


### Features

* support ESLint in lint-fix ([a8d9ac1](https://github.com/jsalvata/waiver-stamp/commit/a8d9ac1eaeeef919030103e0f4970c58a3276d97))

# [1.9.0](https://github.com/jsalvata/waiver-stamp/compare/v1.8.2...v1.9.0) (2026-07-07)


### Bug Fixes

* derive the guard range from the trusted pr base ([e714ba0](https://github.com/jsalvata/waiver-stamp/commit/e714ba0a6959875350c5a9dc086b1467c7d4772d))
* fold resolution inputs into the g2 guard ([4ff1c66](https://github.com/jsalvata/waiver-stamp/commit/4ff1c663b26c1c712dea853863ee912de8e554c0))
* isolate reviewer self-heal dismiss failures ([51d0a14](https://github.com/jsalvata/waiver-stamp/commit/51d0a14301f8e2de00fac91a3702aa7dcb812e97))
* keep the action out of the published package ([4f9f592](https://github.com/jsalvata/waiver-stamp/commit/4f9f592c2328e09029c3a9082435c442c7553517))
* point lockfile-honesty warning at setup docs ([5332d5e](https://github.com/jsalvata/waiver-stamp/commit/5332d5ee6e9aee57790013b53ea45c6f368e8d59))
* read g2 manifests as blobs, widen pnpmfile ([ecef84b](https://github.com/jsalvata/waiver-stamp/commit/ecef84bc391c8fc823c6bbfab1320803b5b3943b))


### Features

* add dogfood .waiver-stamp.json ([5d65b7b](https://github.com/jsalvata/waiver-stamp/commit/5d65b7b4ec6c7db4ad7f6138b49936310418a3b9))
* add forged-approve e2e fixture ([ff6a9c6](https://github.com/jsalvata/waiver-stamp/commit/ff6a9c627faa1ff7d8c41fb5a4049f554bb28bf4))
* add real-pr e2e acceptance harness ([0ad1cbb](https://github.com/jsalvata/waiver-stamp/commit/0ad1cbb113b8240791d724552059bc461afd9fba))
* add the g1 workflow-integrity guard ([d5c34dc](https://github.com/jsalvata/waiver-stamp/commit/d5c34dc6ac822b525eb306fa10d4ec708f5111f8))
* add the g2 manifest-envelope guard ([9f4f453](https://github.com/jsalvata/waiver-stamp/commit/9f4f4530da1a11526ff6f0cc063d0ed34e717cdb))
* add the waiver-stamp producer action ([6896dbe](https://github.com/jsalvata/waiver-stamp/commit/6896dbe854ca55e5e236afb7c5245ae97226e32a))
* confirm backstop checks green on the head sha ([968a989](https://github.com/jsalvata/waiver-stamp/commit/968a9891342d292624ec95368dc0537b7e8a874b))
* lint workflows with actionlint and zizmor ([596af05](https://github.com/jsalvata/waiver-stamp/commit/596af054a18f16be3e8456e3e8f115c96730ddb5))
* log guard offenders before deciding review outcome ([ce68795](https://github.com/jsalvata/waiver-stamp/commit/ce68795f7fe9abbfdd56b9d6c55cebcda8a7843d))
* map the verdict to a review decision ([16453a3](https://github.com/jsalvata/waiver-stamp/commit/16453a3f6fcda2a815df7671862bc3614874850f))
* orchestrate the reviewer, fail-closed ([3f30c19](https://github.com/jsalvata/waiver-stamp/commit/3f30c19ebd2b350149013ea8946b0e9f748ecdd9))
* post the review outcome with self-heal ([e58905e](https://github.com/jsalvata/waiver-stamp/commit/e58905e2e6b3c697093eca1f88f824e623061e40))
* scaffold the waiver-stamp-review action ([2c2a7c4](https://github.com/jsalvata/waiver-stamp/commit/2c2a7c448e85e3bdfe3ecef24f57585bf14262ed))
* surface base/head shas in the stamp report ([63c277d](https://github.com/jsalvata/waiver-stamp/commit/63c277dfe19d0b51c521ebe4d4c27be145db4244))
* validate the reviewer artifact with zod ([66d7606](https://github.com/jsalvata/waiver-stamp/commit/66d7606ba12f19f24ec878bf80a72a56831c1492))
* wire waiver-stamp into this repo's ci ([cf231ff](https://github.com/jsalvata/waiver-stamp/commit/cf231ff3194b4b11a8248a4c58d76f9ac59de1a2))

## [1.8.2](https://github.com/jsalvata/waiver-stamp/compare/v1.8.1...v1.8.2) (2026-07-04)


### Bug Fixes

* preserve .ts import endings in move-file ([73cb880](https://github.com/jsalvata/waiver-stamp/commit/73cb880a8d26c6cffe5ef60f588c859690c4cc18))

## [1.8.1](https://github.com/jsalvata/waiver-stamp/compare/v1.8.0...v1.8.1) (2026-07-04)


### Bug Fixes

* parse .waiver-stamp.json once via one schema ([742d309](https://github.com/jsalvata/waiver-stamp/commit/742d30921d3ce83a828f0ada030194c3433fe4eb))
* tighten config module boundaries ([7bbbe46](https://github.com/jsalvata/waiver-stamp/commit/7bbbe460aedcf0ec128ad91348af3c477a71aa67))

# [1.8.0](https://github.com/jsalvata/waiver-stamp/compare/v1.7.0...v1.8.0) (2026-07-04)


### Features

* implement the lint-fix op ([cb84c7a](https://github.com/jsalvata/waiver-stamp/commit/cb84c7a5e674eb60a9987d79006c12ef5c58a983))

# [1.7.0](https://github.com/jsalvata/waiver-stamp/compare/v1.6.0...v1.7.0) (2026-07-04)


### Features

* gate change-docs behind allow/deny policy ([5df6cb9](https://github.com/jsalvata/waiver-stamp/commit/5df6cb959299150aa6950622d3045ddf488561d0))

# [1.6.0](https://github.com/jsalvata/waiver-stamp/compare/v1.5.0...v1.6.0) (2026-07-04)


### Features

* delegate lockfile honesty to an external gate ([bd24ef3](https://github.com/jsalvata/waiver-stamp/commit/bd24ef3dd3ca8c87a6e6ed2dfef86f7d7d4e4cec))

# [1.5.0](https://github.com/jsalvata/waiver-stamp/compare/v1.4.0...v1.5.0) (2026-07-04)


### Bug Fixes

* use dotted .waiver-stamp.json config name ([7087455](https://github.com/jsalvata/waiver-stamp/commit/7087455e0724209bb1b2f7aa0fd61a5554187016))


### Features

* cover dependency removals in the bump policy ([5745813](https://github.com/jsalvata/waiver-stamp/commit/5745813e3cbdbd502420f6529bc68e884d1c5655))
* dependency-bump confinement gates ([10d7f18](https://github.com/jsalvata/waiver-stamp/commit/10d7f1836c8e543f6e1c9d1748074bfb782e339d))
* drop the unimplemented bump op ([a841595](https://github.com/jsalvata/waiver-stamp/commit/a841595cd411193d75c053075136221ff920b711))
* standing dependency-bump policy ([2427650](https://github.com/jsalvata/waiver-stamp/commit/2427650c94d05a93b9483a6ff39dee366380ef34))

# [1.4.0](https://github.com/jsalvata/waiver-stamp/compare/v1.3.0...v1.4.0) (2026-07-03)


### Features

* use .ts extensions in relative imports ([784b5eb](https://github.com/jsalvata/waiver-stamp/commit/784b5ebf252cb2ed99d4efad78beded089039040))

# [1.3.0](https://github.com/jsalvata/waiver-stamp/compare/v1.2.0...v1.3.0) (2026-07-03)


### Features

* enable rewriteRelativeImportExtensions ([628c90a](https://github.com/jsalvata/waiver-stamp/commit/628c90a084b340d2873a6578b0fc36cfd14653ee))

# [1.2.0](https://github.com/jsalvata/waiver-stamp/compare/v1.1.2...v1.2.0) (2026-07-03)


### Features

* drop parameter properties from emit guard ([6fda113](https://github.com/jsalvata/waiver-stamp/commit/6fda1139f366e71743b7ef5d8aa67118c247c71f))

## [1.1.2](https://github.com/jsalvata/waiver-stamp/compare/v1.1.1...v1.1.2) (2026-07-03)


### Bug Fixes

* make waiver mcp connect inside the repo ([c5442b0](https://github.com/jsalvata/waiver-stamp/commit/c5442b0cc17096410c249f45120264608285fc11))

## [1.1.1](https://github.com/jsalvata/waiver-stamp/compare/v1.1.0...v1.1.1) (2026-07-03)


### Bug Fixes

* keep .js extension when move-file renames ([3475c9f](https://github.com/jsalvata/waiver-stamp/commit/3475c9f0ccca3ebace6191a988f01348921e401b)), closes [SourceFile#move](https://github.com/SourceFile/issues/move)

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
