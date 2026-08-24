# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-08-24

First release published to npm as `@apatureai/sigil`. Earlier versions existed
only as git tags.

### Added

- `CHANGELOG.md` and a tag-triggered npm publish workflow
  (`.github/workflows/release.yml`) that publishes `@apatureai/sigil` with
  provenance from an `NPM_TOKEN` secret. See `CONTRIBUTING.md` for the one-time
  token setup the maintainer must do before the first tag is pushed.

## [0.1.0] - 2026-08-10

First tagged release. The library had been usable for a while, but until now
there was no version to point at.

### Added

- **Calibration metrics.** Expected calibration error, Brier score and a binned
  reliability table, scored against your human labels before any quality claim
  is made.
- **Finite-sample risk certificates.** Exact one-sided Clopper-Pearson bounds on
  the judge's error rate, and a certified abstention threshold via fixed-sequence
  Learn-Then-Test. When nothing certifies at the level you asked for, it refuses
  and says so rather than returning an uncertified number.
- **Pass^k run-to-run reliability**, with a certified lower bound.
- **Cost-at-equal-quality frontier**, gated by an exact McNemar test, so "switch
  to the cheaper model" is an evidenced claim rather than a comparison of two
  averages.
- **Anytime-valid drift monitors**: a fixed-null e-process and a changepoint
  e-detector, with their two different guarantees kept distinct.
- **Adaptive conformal intervals**, which abstain when the history is too short.
- **Four output artifacts**: `report.json`, `report.md`, `router-policy.json`
  and `governance.json`, plus an egress guard with a golden test that plants a
  PII leak and asserts it cannot escape.
- **A CLI** over a captured input bundle: `node dist/bin.js <bundle-dir> [out-dir]`.
- Packaging for publication under the scoped name `@apatureai/sigil`: `bin`,
  `files`, `exports`, `engines` and a `prepublishOnly` build.

Zero runtime dependencies.

[Unreleased]: https://github.com/apatureai/sigil/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/apatureai/sigil/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/apatureai/sigil/releases/tag/v0.1.0
