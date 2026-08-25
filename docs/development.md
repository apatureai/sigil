Part of [sigil](../README.md).

## Regenerating the README assets

The banners are hand-authored SVGs; the hero is a screenshot of real CLI output, so it must be
re-derived whenever the report format changes.

### Banners

`docs/assets/banner-light.svg` and `docs/assets/banner-dark.svg` are the org-family typographic
banners (plum accent `#7A4E78` light / `#B784B4` dark). Text stays as `<text>` with a system font
stack; edit the SVG directly, do not convert to paths.

### Hero

The hero is `node dist/bin.js examples/credit-memo out/ && cat out/report.md` captured verbatim into
the shared terminal frame and screenshotted.

1. Recapture the bytes (they must reproduce the pinned document hash):

   ```
   pnpm build
   { node dist/bin.js examples/credit-memo out/ && cat out/report.md; } > docs/assets/hero-transcript.txt
   ```

2. `docs/assets/terminal-frame.html` holds that transcript inside `<pre>` (HTML-escaped). Update it
   if the transcript changed.

3. Screenshot the `.frame` element with a headless Chromium at `deviceScaleFactor: 2`, writing
   `docs/assets/hero.png`. Any `playwright-core` checkout in the org (e.g. lattice's) supplies the
   browser; there is no browser dependency in this repo itself.

The committed `docs/assets/hero.png` and `docs/assets/hero-transcript.txt` are a diffable pair: a
re-run whose report changed will change both.
