# Contributing to Sigil

Contributions are welcome. Issues and pull requests are read.

The fastest way to help is to pick something off the roadmap in
[README.md](README.md#status-and-roadmap). If you are unsure whether an idea fits, open an issue
first and describe the change; that is cheaper for both of us than a rejected pull request.

## Setup

Requires **Node 24 or newer** (`.node-version` pins 24, which is what CI and every verification run
uses; `package.json` sets `engines.node` to `>=24`) and **pnpm 9 or 10** (the repo ships a
`pnpm-lock.yaml`; CI uses pnpm 9, and pnpm 10 works). No credentials, no API keys, no network
access beyond the install itself.

```sh
git clone https://github.com/apatureai/sigil.git
cd sigil
pnpm install --frozen-lockfile
```

## The gate

```sh
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run  -> 23 test files, 192 tests
pnpm lint        # eslint .
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

Those four are the whole gate, and exactly what `.github/workflows/ci.yml` runs after the install,
in that order. All of them pass on a clean checkout (verified 2026-08-18 on Node 24.14.0 with pnpm
10.34.3: 23 test files, 192 tests, ~2s).

A single test file:

```sh
pnpm vitest run test/golden-fs.test.ts
```

End to end, after a build:

```sh
pnpm build
node dist/bin.js examples/credit-memo out/
```

`pnpm build` is not part of the day-to-day source loop: `tsconfig.json` sets `noEmit: true`, so
`pnpm typecheck` is the real compile gate. The build exists so `src/bin.ts`, the CLI entry point,
can actually be run. `package.json` does declare a `bin` (`sigil` -> `./dist/bin.js`), so a local
install of the packed tarball gets that command, but the package is not on npm, so nothing installs
it from a registry today; see the roadmap.

## Conventions that matter

- **ESM with explicit `.js` extensions in imports.** The source is `.ts` and `"type": "module"`;
  relative imports must be written as `./metrics.js`, not `./metrics`. TypeScript resolves it, Node
  runs it.
- **Zero runtime dependencies.** Everything imported from outside the repo is a Node built-in
  (`node:crypto`, `node:fs`, `node:path`). A pull request that adds a runtime dependency needs to
  argue for it explicitly. Dev dependencies are pinned in `pnpm-lock.yaml`; use
  `--frozen-lockfile`.
- **One module per pipeline stage.** `src/` is flat, and `test/` mirrors it one-to-one. New
  behaviour usually belongs in the module that owns that stage, with a matching `test/<module>.test.ts`.
- **Public surface goes through `src/index.ts`.** If it is meant to be used from outside, export it
  there.
- **No em dashes in prose or in program output**: docs, code comments, and every string the code
  emits (report headings, statements, CLI text). Use a colon, a comma, a full stop, or rewrite the
  clause. `test/no-em-dash.test.ts` enforces this from both directions: it renders a fully
  populated report and checks the shipped strings, and it scans the checked-in files. This is not
  only a style rule. `report.ts` writes the content-addressed document whose hash the README pins
  as reproducible, so punctuation that reaches the report body moves that hash.

## The one rule that matters if you touch the code

Sigil is **offline and deterministic by construction**, and the tests enforce it:

- The panel runs through an injected `Gateway` port. Tests use `StubGateway` with fixtures.
  **No test may call a real model, key, or network.** The live adapter
  (`src/gateway-openai-compat.ts`) is exercised only through an injected `fetchImpl`.
- No wall clock and no RNG in the analysis path. The same frozen corpus and frozen panel must
  produce the same frontier and a byte-identical report. That reproducibility is the product, not a
  nicety. `test/golden-fs.test.ts` and `test/canonical.test.ts` will catch you.
- Artifacts that leave the boundary carry derived facts only; `assertSafeEgress` fails closed. Do
  not widen what crosses that line without saying so in the pull request.
- Statistical claims stay honest. "No detected loss" is never upgraded to "equal", a certificate
  that cannot be issued is refused rather than approximated, and any new estimator states its
  assumptions in its output, not only in a comment.

## Contributions that are especially wanted

- **Cross-validating `drift.ts` against an external reference** (CRAN `stcpR6`) as golden fixtures.
  This is the highest-value item in the repo.
- **Exercising `src/gateway-openai-compat.ts` against a real OpenAI-compatible endpoint** and
  contributing recorded-response fixture tests for whatever the wire format actually does.
- **The persistence and scheduling layer for continuous mode**, built on the serializable
  `EProcessState` / `EDetectorState` / `AciState` values.
- **More property tests** over the certificate math (`fast-check` is already a dev dependency).
- **Documentation fixes.** If something in the README did not work exactly as written, that is a
  bug and a pull request fixing it is welcome.

## Pull requests

- Branch off `main` and keep the change focused. Small, single-purpose pull requests get reviewed
  faster.
- Explain what breaks without the change, and include the numbers if the change touches the math.
- Make sure `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` all pass locally. CI runs
  the same four on Node 24 / ubuntu-latest.
- New behaviour needs a test. Changed math needs a test that would have failed before.
- Review is by the maintainer, usually as a round of comments rather than a silent merge or close.
  Expect questions about assumptions if you touch anything statistical.
- No CLA. MIT in, MIT out.

## Releasing (maintainer)

Publishing is automated by `.github/workflows/release.yml`, which runs the gate
and then `pnpm publish --provenance` whenever a `v*` tag is pushed. One-time
setup is required before the first tag, or the publish step fails:

1. Create an npm **automation** token with publish rights on the `@apatureai`
   scope at https://www.npmjs.com/settings/apatureai/tokens.
2. Add it as a repository secret named `NPM_TOKEN`:

   ```sh
   gh secret set NPM_TOKEN --repo apatureai/sigil
   ```

To cut a release:

1. Bump `version` in `package.json`.
2. Move the `Unreleased` items in `CHANGELOG.md` under a new dated version
   heading and refresh the compare links at the bottom.
3. Merge that to `main`, then tag and push:

   ```sh
   git tag v0.1.1 && git push origin v0.1.1
   ```

4. The workflow publishes the tarball with provenance. Author the GitHub Release
   from the same tag with notes drawn from the changelog.

## Reporting bugs

Open an issue with the command you ran, what you expected, and what happened, plus your Node and
pnpm versions. For a security problem, do not open a public issue; see [SECURITY.md](SECURITY.md).

`README.md` is the reference documentation: the module table, the pipeline sketch, the input bundle
contract, a runnable quickstart and library example, the stated failure modes, and the roadmap.
