# TDD v3 preexec: reproducible SDK source inputs

This directory keeps the SDK correction in the Gentle Pi fork, without a second
SDK fork or checked-in generated binaries. `manifest.json` is the input lock.
The four mail patches preserve the original SDK commits and authors.

| Component | Identity |
| --- | --- |
| Custom release | `4.3.0-tdd-v3-preexec-1fb7741c0` |
| Gentle Pi runtime source | `1fb7741c0f9e3f1bc6bad2ffaffa7d884ba68570` |
| SDK upstream base | `71023aec1546d6d677a65669c5665c0927ce0dd0` |
| Original SDK correction | `63b19124136f348b65979ffde3d34dfc70f82c51` |
| Required SDK Git tree | `560001bc910bf54c502103362db8b1ba1bd22e37` |

The packaging checkout commit must be recorded separately from the runtime
source commit. Applying mail patches can change committer metadata and produce a
different commit ID: verify the **tree**, not a fabricated match to the original
SDK commit. This reproduces source contents and records artifact integrity; it
does not claim bit-identical archives across different toolchains.

## Boundaries

- Linux/Node >=22.19.0; use an explicitly chosen **new**, private build directory.
- Never use a source checkout, its ancestor, an existing installation, or `$HOME`
  as the output root. Refuse an existing output directory; do not use `--force`.
- Keep npm cache, HOME, TMPDIR and evidence inside that private directory. Do not
  copy credentials, use live provider catalogs, or make model requests.
- Keep the existing SDK source checkout read-only. Start from the pinned public
  upstream base; do not trust its ignored local `dist/` or provider JSON files.
- Do not run `local-release.mjs`: it regenerates live model data. Do not run
  `npm run check` here: that SDK command includes formatting writes.
- Packing and consumer installation use `--ignore-scripts`. Do not run Gentle
  Pi postinstall, install/change Go Gentle AI, edit active settings/launchers, or
  restart other sessions as part of this recipe.

## 1. Verify and reconstruct the SDK

Let `GP` be a checkout of this fork containing this directory, and `BUILD` be a
new output path granted to the operator. Record `git -C "$GP" rev-parse HEAD`,
Node/npm versions and the input manifest hash. Refuse an existing `$BUILD`, then
create private HOME/cache/tmp subdirectories there.

1. Verify every ordered patch SHA-256 against `manifest.json`; reject paths that
   are not direct children of this directory. Verify the model-data input pins
   before extraction or build.
2. Initialize `$BUILD/sdk`, add the manifest's SDK upstream as `origin`, and fetch
   only its exact base commit. Check out detached and require the recorded base
   tree. No upstream push is involved.
3. Apply the four patches in manifest order with ordinary `git am`. Use an
   explicit build-only committer identity, preserve the original authors, and
   do not disable hooks or rewrite the authoritative source checkout.
4. Require `git rev-parse HEAD^{tree}` to equal the required SDK tree above, a
   clean tracked tree, and the manifest's SHA-256 for `package-lock.json` and
   `packages/ai/src/models.generated.ts`. Record the reconstructed commit ID as
   such. Stop on a digest, patch, tree or catalog mismatch.

## 2. Restore only the pinned model-data input

The SDK ignores `packages/ai/src/providers/data/*.json` and `.manifest.json`.
Those files are required even by its offline build. The input lock records the
public `@earendil-works/pi-ai@1.3.0` tarball URL, SHA-512 integrity and SHA-256.
Verify both byte digests before opening the archive.

Extract only regular, flat JSON members under
`package/dist/providers/data/`, including `.manifest.json`, into the reconstructed
SDK's matching source directory. Reject links, traversal, unexpected paths and
unbounded files. Verify the pinned manifest hash and all per-file hashes. Do not
hydrate current provider catalogs. The SDK's validator additionally checks the
manifest's structure stamp against the tracked generated catalog.

## 3. Build and produce a coherent artifact set

In the reconstructed SDK, with private HOME/cache/TMPDIR and the committed npm
lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:model-data
npm run build:offline
node scripts/pack-packages.mjs --skip-build --out "$BUILD/sdk-artifacts"
```

`--skip-build` above packs the outputs of the immediately preceding successful
fresh offline build; it is not permission to reuse old local outputs. The
standard offline build includes prerequisite SDK workspaces as well as
coding-agent, agent-core, AI and TUI. Keep the complete local artifact set and
its manifest. The packer records and verifies each tarball's SHA-512 integrity.
Check that the tracked SDK tree and lockfile remain unchanged after the build.

## 4. Prepare an isolated consumer, not the active installation

For a new isolated release prefix, copy the verified SDK artifact set beneath
that release root first. Re-read the copied artifact manifest with the existing
`scripts/package-artifacts.mjs` helper; verify every copied tarball. The consumer
must refer to these retained release-local artifacts, not temporary build paths.

Create a private consumer `package.json`, then use the existing SDK command:

```sh
node scripts/use-local-packages.mjs \
  --manifest "$RELEASE/artifacts/sdk/manifest.json" \
  --consumer "$RELEASE/prefix" \
  --package @earendil-works/pi-coding-agent
```

It writes direct dependencies and overrides for **all** packages in the local
artifact set. Install with `npm install --ignore-scripts --omit=dev --no-audit
--no-fund`. Do not allow registry `1.3.0` packages to replace any local SDK member.
Run the existing `smokeTestNpmConsumer` against the coding-agent package; it checks
literal exports, entry files and every installed SDK lockfile resolution against
the artifact set.

Archive the pinned Gentle Pi runtime commit separately, pack it using
`npm pack --ignore-scripts`, verify the pack metadata/integrity, and add that
local artifact to the same consumer without removing the SDK overrides. Preserve
all existing Go configuration and active selectors. The runtime CLI is
`prefix/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`; its
component version remains 1.3.0, not a fictitious new upstream release.

## Acceptance and provenance

Record the release ID, GP runtime commit, packaging checkout commit, original SDK
commit, reconstructed SDK commit/tree, patch/input/lock hashes, tool versions,
artifact integrities and installed local resolutions. A version label alone is
not proof. Test the real bundled and unbundled graph and native invocation
behavior; do not substitute names, fabricated binders or schema markers.

Source reproduction, package smoke tests and isolated staging do **not** activate
the host or certify external providers, Windows/Bun, Playwright mutations, or a
live deployment. Active selector changes, rollback preimages and a fresh Pi
process require their own exact-target plan and authorization. Retain the
previous installation; never prune or remove it through this recipe.
