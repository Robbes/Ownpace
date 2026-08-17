# Workplan 0060 — fakes that answer like servers

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the pattern, named | ✅ **Stated 2026-08-17** | Three defects in two days, all certified green by unit tests: **0058** — `GraphDriveItem.path` was a field Graph never returns, so every OneDrive file keyed off `/${name}` and the tree flattened onto the root; the fixtures invented the field. **0059** — the Graph calendar and contacts delta loops re-requested page one forever; their mock answered by CALL ORDER and ignored the URL, handing back page two for a repeat of the identical request. The common cause is not carelessness about tests — both suites were thorough — it is that **a fake which answers something no server could answer certifies code that cannot work**. A test can only be evidence about a provider if it is addressed the way the provider is addressed. |
| T2 the rule | ✅ **Applied 2026-08-17** | A fake must be **addressed by what the real API is addressed by**, never by call count: pagination answers the token in the request (marker, cursor, `nextLink`), not the Nth response in a list; item shapes carry the fields the provider documents, not fields the code wishes for. Two consequences fall out for free — a request that forgets its token gets the page it asked for (a loop, exactly like production), and a field the provider does not send is absent in the test too. |
| T3 the connectors I wrote | ✅ **Fixed 2026-08-17** | Applying the rule to my own work first, since 0058/0059 were other people's code. **Box**: `fakeBox` served pages by an incrementing per-folder counter and ignored `marker` entirely — it would have passed whether or not `listChildren` sent one, and sending it is the whole mechanism. Now the marker is the address (`m3` → page 3, absent → page 0), with assertions that each request carried the previous page's marker. **Dropbox**: `fakeDropbox` served `list_folder/continue` by an incrementing counter and ignored the cursor in the body — same blind spot, and the continue endpoint is a single URL so the cursor is the ONLY address there is. Now served by cursor, with assertions that each continue carried the previous page's. Mutation-verified both ways: dropping Box's `marker` and pinning Dropbox's cursor to a constant makes three tests fail with the connectors' own page guards; restoring passes 27. |
| T4 not done, honestly | ⛔ | (a) The rule is applied to the four file connectors' pagination and to Graph's delta; it is NOT applied everywhere — DAV, JMAP and mail fakes were not audited in this pass, and `createMockHttpClient(responses[])` in the Graph calendar/contacts suites still answers by call order for every test except the two URL-aware ones added in 0059. Converting the rest is mechanical and unstarted. (b) No lint rule or harness enforces this; it is a written-down convention, which is exactly the kind that erodes. (c) None of this substitutes for integration coverage against a real endpoint — a fake addressed correctly still only proves the code agrees with my reading of the API. Three defects came from misreadings, and only a tenant settles those. |

## What this is

The lesson from 0058 and 0059, applied to my own connectors before it is applied to anyone
else's, and written down because it will otherwise be rediscovered a fourth time.

Both defects shipped through suites that looked careful. What they had in common was a mock that
was *convenient* rather than *faithful*: it answered by the order the code happened to ask, so it
agreed with any code that asked the right number of times, including code that asked the same
question repeatedly and never advanced. Addressing a fake the way the provider is addressed costs
a few lines and turns those suites back into evidence.
