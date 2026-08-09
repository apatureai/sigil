# Contributing

**This project is archived.** It is published for reference and reuse, not as an active
project. Pull requests and issues may go unread, and there is no commitment to review,
merge, or respond to anything.

**Fork it.** That is the encouraged path. The MIT License lets you take this code, rename
it, change it, and ship it without asking. If you build something on top of Sigil, you do
not owe this repository a patch.

If you do open a PR anyway: keep it small, explain what breaks without it, and make sure
`pnpm typecheck`, `pnpm test`, and `pnpm lint` all pass. No CLA, no template, no process.

## Building it locally

Requires **Node 24** (`.node-version`; `package.json` pins `engines.node` to `>=24 <25`) and
**pnpm** (the repo ships a `pnpm-lock.yaml`; CI uses pnpm 9, and pnpm 10 works).

```sh
pnpm install --frozen-lockfile
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run  -> 20 test files, 160 tests
pnpm lint        # eslint .
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

Those five are the whole gate — they are exactly what `.github/workflows/ci.yml` runs, in
that order. All of them pass on a clean checkout (verified on Node 24.14.0 with pnpm
10.34.3).

`pnpm build` is not part of the day-to-day source workflow: the package is `private`, was
never published to npm, and `tsconfig.json` sets `noEmit: true`, so `pnpm typecheck` is the
real compile gate. The build exists so `src/bin.ts` — the CLI entry point, `audit
<corpus-dir> [out-dir]` — can actually be run:

```sh
pnpm build
node dist/bin.js examples/credit-memo out/
```

There is no `bin` field in `package.json`, so there is no installable `audit` command.

## The one rule that matters if you touch the code

Sigil is **offline and deterministic by construction**, and the tests enforce it:

- The panel runs through an injected `Gateway` port. Tests use `StubGateway` with fixtures.
  **No test may call a real model, key, or network.** The live adapter
  (`src/gateway-openai-compat.ts`) is exercised only through an injected `fetchImpl`.
- No wall clock and no RNG in the analysis path. The same frozen corpus and frozen panel
  must produce the same frontier and a byte-identical report — that reproducibility is the
  product, not a nicety. `test/golden-fs.test.ts` and `test/canonical.test.ts` will catch you.
- Artifacts that leave the client boundary carry derived facts only; `assertSafeEgress`
  fails closed. Do not widen what crosses that line.

`README.md` is the documentation: it carries the module table, the pipeline sketch, the input
bundle contract, a runnable quickstart and library example, and the stated failure modes.
