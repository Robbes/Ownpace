# A Takeout the size of a sentence

The smallest Google Takeout that is still a Takeout, for the self-hosted E2E's
archive-import gate (workplan 0116 T10). Laid out exactly as Google lays one
out — `Takeout/Google Photos/<album or year>/…` — so the Takeout reader meets
every shape it has to handle:

- `IMG_0001.jpg` twice, byte-identical, in the `Holiday` album and under its
  year: one item the reader collapses, placed under the album and NOT under
  the year as well.
- `IMG_0001-edited.jpg`: an edited version, a distinct item linked to its
  original, filed under the year only.
- `IMG_0002.jpg`: a photo in no album, which lands under its year.
- one sidecar, so the manifest has something Google knew to carry.

The bytes are text rather than JPEG on purpose: the reader hashes bytes and
never decodes them, and a file a person can `cat` is a fixture a person can
check. Mounted read-only into the appliance by `deploy/selfhost/compose.dev.yml`
at `/data/fixtures/takeout`; never baked into the product image.
