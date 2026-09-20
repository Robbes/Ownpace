# The same Takeout, as the download Google hands over

The five-file Takeout in `../takeout` once more, this time as a **two-part
`.zip` download** rather than an extracted folder, for the self-hosted E2E's
zip-route gate (workplan 0116 T10, second half; D7's second slice). The photo
tree is split across the parts BY FILE, the way Google splits a large export:

- `takeout-20240506T070810Z-001.zip` — the `Holiday` album's copy of
  `IMG_0001.jpg`, and nothing else;
- `takeout-20240506T070810Z-002.zip` — the `Photos from 2024` year folder:
  the second copy of `IMG_0001.jpg` **with its sidecar**, the edited version,
  and `IMG_0002.jpg`.

So a reader pointed at part 1 finds the sidecar only if it reads part 2 as
well, and collapses the two copies of `IMG_0001.jpg` only if it hashes across
parts — the two things the multi-part rule exists for.

**Written by Info-ZIP, not by our test writer**, on purpose. The unit tests
prove the reader against archives `zip-test-writer.ts` builds shape by shape;
these two are the one place the reader meets a zip somebody else wrote —
directory placeholders, a mix of stored and deflated members, the fields a
real writer fills. `a-zip-somebody-else-wrote.unit.test.ts` reads them too.

Made with, from inside `../takeout` (`-X` leaves out the extra fields that
carry a uid and gid; the member timestamps are whatever the checkout had):

```sh
zip -r -X ../takeout-zip/takeout-20240506T070810Z-001.zip "Takeout/Google Photos/Holiday"
zip -r -X ../takeout-zip/takeout-20240506T070810Z-002.zip "Takeout/Google Photos/Photos from 2024"
```

`unzip -l` on either part lists exactly the members above. Mounted read-only
into the appliance by `deploy/selfhost/compose.dev.yml` at
`/data/fixtures/takeout-zip`; never baked into the product image.
