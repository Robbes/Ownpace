# Workplan 0145 — Phones, screen readers and in-app browsers

> **In one line:** The web app on phones, screen readers and in-app browsers: phone menu focus, `CreateMapping` wizard focus, the consent popup opened on the press, grant page language, ARIA state, axe and WebKit tests, an accessibility statement.

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24, build: T1 built on branch
`claude/ownpace-public-readiness-y7orc6-a-menu-that-gives-focus-back`, not merged, except the skip
link, which §3 puts after.** Everything is in `apps/web/src/components/Layout.tsx`. Below `lg`, a
closed drawer is `inert`. Opening it moves focus to its close button and makes the page behind it
`inert`. Escape, the close button and the backdrop close it and give focus back to the menu
button. Following a link closes it as before, and where focus goes on the new page is still
T3 (b). A link to the page already shown is not a route change, so T3 (b) will never move focus
for it: that link closes the drawer the way Escape does and gives focus back to the menu button.
Without that, the focused link went `inert` with its drawer and focus fell to the body. The menu
button now carries `aria-controls`, naming the drawer, and `aria-expanded` says whether the drawer
is open on this screen. From `lg` up nothing is `inert`. The guard is
`apps/web/src/components/a-menu-that-gives-focus-back.unit.test.tsx`. Of its 13 cases, 11 failed
on the unchanged code. The two that passed are wide-screen cases: nothing is `inert`, and a
sidebar link to the page already shown leaves no focus owed for later. Each mutation made the
guard fail: removing the focus move (3 cases), removing the return of focus (3), closing on any
key (1), asking `(min-width: 1024px)` (1), `inert` at every width (2), not closing the drawer when
the window widens (1), giving focus back after a same-page link on a wide screen too (1), and a
`--breakpoint-lg` set in `apps/web/src/index.css` (1). The Tailwind case compiles the app's own
stylesheet, not a bare `@import "tailwindcss"`, so a breakpoint moved there moves the answer.
Where the build differs from §3:

- **The media condition is `(width >= 64rem)`, not `(min-width: 1024px)`.** It is the condition
  Tailwind 4 puts `lg:` behind, word for word. In a media query a rem follows the browser's font
  size, so for a reader whose default font is larger than 16 px, 1024 px and the stylesheet
  disagree on a band of widths. That reader is who this task is for. The guard asks the
  installed Tailwind for the condition. Safari 16.4, the iPhone floor in the README, reads this
  syntax, and the stylesheet already depends on it.
- **`aria-controls` is not in §3.** The build brief asked for it. It names the drawer through
  React's `useId`.
- **Without `matchMedia` the layout counts as wide.** That is how it behaved before, with the
  drawer never `inert`. Every supported browser has `matchMedia`, and jsdom does not. So the
  menu case in `Layout.unit.test.tsx` now stubs a narrow screen, because without one the drawer
  never opens.
- **Escape is heard on the document, not only in the drawer.** A tap on the drawer's own text
  leaves focus on the body, and Escape has to work from there too.
- **Widening the window with the drawer open closes the drawer.** Otherwise it would come back
  over the page, and take focus, when the window was narrowed again.
- **A link to the page already shown gives focus back to the menu button.** §3 says focus goes
  to the new page (T3 (b)), and here there is none. The query string is ignored, as a route
  change ignores it.
- **The guard has 13 cases, not §3's four.** The additions are `aria-controls`, the close
  button and the backdrop giving focus back, a key other than Escape doing nothing, a followed
  link closing the drawer, a link to the page already shown (narrow and wide), the window
  crossing the breakpoint both ways, and the Tailwind condition.

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 went through
the managed edition the way a tester would meet it on a phone: with and without a screen reader,
and inside the browser another app opens. Six of its findings were mechanical, and #1137, merged
on 2026-09-24, fixed them:

- the page's language follows the EN/NL switch;
- the consent and grant endings are whole documents that a phone lays out at its own width;
- the phone menu, its close button and a migration's open link have names;
- the menu's backdrop is grey at 75%;
- four form fields draw the focus ring they name a colour for;
- the web app's README gives the iPhone floor the build actually produces.

This plan is the rest. The alpha is Dutch and small, and the owner supports each tester in person
(§2). So the plan asks what a Dutch tester on a phone needs before the first invitation, and
leaves the full audit for after. The owner chose to write it: *"W11 write, W12 write, W13 write,
W14 write, W15 explaoin, W16 write, W17 write, W18 explain, W19 write"*. 0131 §5 calls this work
W16.

Later the same day the owner put testers on a stack of their own, `ownpace-live`, at the
production names, beside the OTA stack on the same machine (0131 D3; 0132 D7 carries it). For
this plan that moves one thing: T10, the walk that checks what testers will meet, is walked on
live. T0 asks only how today's code behaves, so it stays on the OTA stack, which the nightly gate
rebuilds from `main` (D3).

Nothing in this plan is built. One thing it relies on was reported by the review and has not been
verified: that Safari blocks the consent window the wizard opens after it has waited for the API.
Nothing in this repository runs WebKit, so T0 checks it on the owner's iPhone before anything is
built. Two further problems came up while writing this plan; the review does not list them:

- the Connect buttons say why they are greyed out only in a tooltip (T7);
- a same-tab fallback for the owner's consent cannot work with the code as it is, because the
  result is handed back to the window that opened the consent (T5).

**Before the first invitation.** This is the minimum, and it is kept small:

- T0, one press of *Connect with Google* on an iPhone, on today's code;
- T1, the phone menu takes focus and gives it back;
- T3 (a), each wizard step and each new page starts at the top, and the step says which one it is;
- T5, the consent window opens on the press itself and says so when it cannot, with T7 (a), the
  reason a Connect button is greyed out, in the same change;
- T6, the consent endings in Dutch; the grant page and its ending too, if testers send grant links
  during the alpha (0140 open question 2);
- T9 (a), one paragraph in the tester guide: which phones, what has not been checked, and whom to
  tell;
- T10, the walk on two phones, which is the phone half of 0141 T12.

**After the first invitation**, during or after the alpha: T2, T3 (b), T4, T7 (b), T8 and T9 (b).
None of them stops a sighted tester on a phone. Several stop a tester who uses a screen reader or
only a keyboard, and T9 (a) says so before anyone starts.

| Task | Status | Notes |
|---|---|---|
| T0 One press of *Connect with Google* on an iPhone, today | ⏳ **Owner** | §3. Settles the review's unverified popup claim on the code as it is. **Before the first invitation**, and before T5 is built. |
| T1 The phone menu takes focus and gives it back | 🔨 **Built on branch `claude/ownpace-public-readiness-y7orc6-a-menu-that-gives-focus-back`, not merged** (2026-09-24), all but the skip link; the skip link 📋 **Proposed**, after — *was:* 📋 **Proposed** | §3. Closed below 1024 px, the menu is `inert`. When it opens, focus goes into it and the page behind is `inert`. Escape closes it, and focus returns to the menu button. A skip link comes **after**. **Before the first invitation.** |
| T2 State said in words, not only in colour | 📋 **Proposed** (D5) | §3. `aria-pressed` on the chooser cards, `aria-current` on the wizard step, step labels that can be read, the Finish states in text, and two labels translated. **After.** |
| T3 A new step or page starts at the top and says where you are | 📋 **Proposed** | §3. (a) Each wizard step and each route change starts at the top, and the new step's heading takes focus. **Before.** (b) A title for each screen, and focus on the page heading. **After.** |
| T4 Errors are announced | 📋 **Proposed** | §3. `role="alert"` on the refusals and failures that have none, and `role="status"` on the waiting lines. **After**; the Grant and View lines go in with T6, which rewrites them. |
| T5 The consent window opens on the press itself | 📋 **Proposed** | §3. The window opens in the click and is pointed at the provider afterwards. A blocked window says so and offers a link. One shared helper serves both call sites. A same-tab fallback is 🅿️ **Parked (trigger: a phone or browser in T0 or T10 where neither the window nor the link comes back)**. **Before.** |
| T6 The grant flow and the consent endings in one language | 📋 **Proposed**; the Dutch wording ⏳ **Owner** | §3. The "reads" phrase comes from the dictionary. The link-holder refusals come in pairs, as `credential-refusals.ts` does it. The endings are rendered in the language the page was in, and the public pages get a language switch. **Before**, the grant half only if grant links are used in the alpha. |
| T7 Help a finger can reach | 📋 **Proposed** | §3. (a) The reason a Connect button is greyed out, as text under it, in T5's change: **before**. (b) Verify's help moves into the Hint fold, and the Mappings row actions get names and targets a thumb can hit: **after**. |
| T8 Checks that run: phone width, axe, WebKit | 📋 **Proposed** | §3. A 390 px case, an axe scan of the key pages and a WebKit run, all in `test/ui`. Adding the dev dependency and the CI minutes is the maintainer's decision. **After.** |
| T9 An accessibility statement in Dutch and English | (a) 📋 **Proposed**, **before**; (b) 📋 **Proposed**, **after**; whether the European Accessibility Act applies ⏳ **Owner**, with 0139's legal pass (D4) | §3. (a) One paragraph in 0144 T1's guide. (b) A page on the site: the target, what has been checked, what has not, known limitations, a contact and a date. |
| T10 The walk on two phones | ⏳ **Owner** (the walk); 📋 **Proposed** (the runbook stage) | §3. An iPhone with Safari and an Android phone with Chrome, both in Dutch, with one pass under VoiceOver and one under TalkBack. It also produces the list of in-app browsers. **Before the first invitation**, on `ownpace-live`, once a release that carries the minimum runs there. |

## 1. What there is today

Every fact below was checked on 2026-09-24 at `987cb06`, which is `origin/main` after #1137 was
merged, and the line numbers are that commit's. Where a fact comes from the review and was not
checked again here, the text says so.

The review's findings this plan carries:

- `a11ym-no-a11y-or-phone-test-coverage`
- `a11ym-mobile-drawer-focus`
- `a11ym-state-visual-only`
- `a11ym-wizard-focus-scroll-status`
- `a11ym-popup-consent-webkit`
- `a11ym-grant-mixed-language`
- `a11ym-grant-inapp-webview`, which 0140 T3 carries; this plan carries its device list
- `a11ym-title-only-help`
- `a11ym-eaa-no-accessibility-statement`

`a11ym-html-lang-static`, `a11ym-grant-result-page-no-viewport`, `a11ym-unnamed-icon-controls`,
`a11ym-backdrop-bg-opacity-v4`, `a11ym-focus-ring-without-width` and
`a11ym-readme-browser-support-claim` are fixed by #1137. Two findings were only partly confirmed
by the review's own verifier: the in-app browser finding and the statement finding. Their limits
are stated where they come up below.

### What #1137 fixed, merged 2026-09-24

- **The document's language.** `LocaleProvider` sets `document.documentElement.lang` from the
  locale (`apps/web/src/i18n/index.tsx`:83). The UI smoke asserts `lang="nl"` for a Dutch browser
  (`test/ui/managed-ui.ui.test.ts`:541). `index.html` still says `lang="en"`, and the effect
  overrides it. The page title is still the static English
  `Ownpace - Sovereign Data Migration` (`index.html`:16), and no screen sets `document.title`
  (T3 (b)).
- **The endings a phone lands on.** `shell()` in `apps/api/src/routes/migrations/google-consent.ts`
  (:522-527) wraps both the owner's consent ending and the grant ending in a document with a
  doctype, a viewport and a title. It says `lang="en"`, which is true for as long as both endings
  are English only (T6).
- **Names.** The menu button has `aria-label={t('nav.menu')}` and `aria-expanded`
  (`apps/web/src/components/Layout.tsx`:349-350). The close button has `common.close` (:241). A
  migration's open link has `mappings.action.open` (`apps/web/src/pages/Mappings.tsx`:325). The
  guards are in `Layout.unit.test.tsx` and `Mappings.unit.test.tsx`.
- **Two classes that drew nothing.** The backdrop is `bg-gray-600/75` (`Layout.tsx`:221). The
  sign-in, request, report and support fields draw `focus:ring-2`. The guard
  `apps/web/src/a-class-tailwind-draws-nothing-for.unit.test.ts` compiles every such class with the
  installed Tailwind.
- **The iPhone floor.** `apps/web/README.md`:248 says *"Mobile Safari (iOS 16.4+ …)"*, the floor of
  both Vite 8's default build target and Tailwind v4's output.
- **The request page's language.** `?locale=` from the site now sets the form's language
  (`apps/web/src/pages/RequestAccess.tsx`:47-60).

### A tester on a phone

- **The menu.** Below 1024 px the navigation is a drawer that is only moved off screen when closed:
  `<aside … ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}>` (`Layout.tsx`:227-231), with
  no `inert`, `hidden` or `aria-hidden`. The drawer comes before the page in the document (`<div
  className="lg:pl-64">` at :344, `<main>` at :415). So its links and buttons stay in the tab
  order, and in a screen reader's swipe order, while nobody can see them. Opening the drawer does
  not move focus into it. `apps/web/src` has no `onKeyDown`, `tabIndex`, `.focus()`, `autoFocus` or
  `inert` outside tests: the only hit is the word "inert" in a comment in `MappingHubLink.tsx`:7.
  Escape therefore does nothing, and closing the drawer does not return focus. The app has no skip
  link either.
- **The wizard's Next.** `handleNext` only calls `setCurrentStep(currentStep + 1)`
  (`apps/web/src/pages/CreateMapping.tsx`:723-726). The Next button sits at the bottom of the step
  (:2640-2656). On a phone the next step therefore opens scrolled to where the last one ended,
  and a screen reader stays on "Next" and hears nothing. The four steps (:211-219) have no heading
  in common: the source and target steps open with an `h3` (:2114, :2264), the migration step opens
  with a name field (:2345), and the review step's `h3` sits inside a green box (:2463).
- **A new page.** The router is the declarative `<BrowserRouter>` (`apps/web/src/App.tsx`:27),
  which neither resets nor restores scroll, and nothing in `apps/web/src` calls `scrollTo` or
  `scrollIntoView`. A page opened from further down a list therefore opens part of the way down.
- **The consent window.** Both places that start a consent wait for the API and only then open the
  window: `await begin()` and then `window.open(url, …, 'popup,width=520,height=640')`, in
  `apps/web/src/components/ProviderConsent.tsx`:208 and :212 (the Connections page) and in
  `CreateMapping.tsx`:1117 and :1136 (the wizard's own copy). The window `window.open` returns is
  thrown away, so a blocked window leaves a button that seems to do nothing. `Grant.tsx`:107-109
  names this failure itself: *"a popup blocked by the browser would look exactly like a button that
  does nothing"*. The review says Safari's blocker is *"widely reported"* to refuse
  `window.open` after an `await`, and adds: *"That is not verified here because nothing runs
  WebKit."* This plan has not verified it either (T0).
- **Why a same-tab fallback is not small.** The owner's consent result travels back in the browser:
  the ending posts it to `window.opener` and closes itself (`google-consent.ts`:565). The API
  serves that page with `Cross-Origin-Opener-Policy: unsafe-none` so that the opener survives the
  trip to Google (`callbackPageHeaders`, :707-722). If there is no opener, the ending says *"This
  window was not opened by Ownpace, so the result could not be handed back"* (:571). The wizard
  keeps only its non-secret half in `sessionStorage` (`CreateMapping.tsx`:347-410, 0069), so a
  same-tab trip would lose the form's credentials and would bring back a token with nowhere to go.
  The grant page can navigate in the same tab (`Grant.tsx`:110) only because the server stores a
  grant link's result itself.
- **A greyed-out Connect.** When the account address is empty, no data type is ticked, or a client
  ID and secret the button needs are missing or half typed, the Connect button is disabled, and it
  gives its reason only in `title`:
  `ProviderConsent.tsx`:285-296 and `CreateMapping.tsx`:2223-2233. A title never shows on touch.
  The wizard's Next already says its reason in text beside it (`role="status"`, :2625), so the
  pattern exists.
- **Help that lives in a tooltip.** Verify's explanations of PASS, WARN and FAIL, and of each kind
  of evidence, are only in `title` (`apps/web/src/pages/Verify.tsx`:99, :128, :151). The repository
  already records the lesson: *"a hover fails on touch, keyboard and screen reader"*
  (`docs/workplans/0090-the-cap-we-do-not-count.md`:10). The Hint fold (`components/Hint.tsx`,
  0118) is the pattern that replaced it. On the Mappings list, *sync now*, *start* and *delete* are
  named only by `title` (`Mappings.tsx`:287, :318, :338). A screen reader can use that name; a
  finger cannot see it. Their icons are 20 px with no padding (:283-290). Across `apps/web/src`,
  58 non-test `title={t(…)}` remain. Many of them are a component's `title` prop that is rendered
  as a visible heading, such as Support's sections and Finish's steps; the others have not been
  sorted one by one here.

### A tester with a screen reader

- **Selection shown by colour alone.** A chooser card's selected state only changes its class
  (`apps/web/src/components/FrontDoorChooser.tsx`:60-68). It has no `aria-pressed` or
  `aria-checked`, and both wizard steps that choose a source or a target use it
  (`CreateMapping.tsx`:2115, :2265).
- **The step you are on.** The progress list is `<nav aria-label="Progress">` (:2543). The label is
  an English literal, and the list has no `aria-current`. Nothing but colour marks the current
  step: its circle's border and its label turn blue (:2549, :2553-2558). Steps still to come are
  `text-gray-400`
  (:2549). By the review's compile of Tailwind 4.3.3 that is about `#99a1af`, roughly 2.6:1 on
  white, where normal text needs 4.5:1 (WCAG 1.4.3). The arithmetic from that colour agrees; the
  compile was not repeated here.
- **Done or not done.** A Finish step's state is only an icon: a check, a warning triangle or a
  circle (`apps/web/src/pages/Finish.tsx`:81-103). lucide marks an icon with no accessibility prop
  `aria-hidden` (`buildLucideIconNode.mjs`:48 in lucide-react 1.47.0, the version the lockfile
  resolves), so the state is not read out.
- **A machine label.** `aria-label="scope-manifest"`
  (`apps/web/src/components/confirm/ScopeManifestPanel.tsx`:70) is read aloud as it is written.
- **Errors that are not announced.** None of these has `role="alert"` or `role="status"`:
  - the grant page's refusal (`apps/web/src/pages/Grant.tsx`:123-128), its failure after the
    button (:215) and its waiting line (:121);
  - the view page's refusal (`apps/web/src/pages/View.tsx`:159-164) and its waiting line (:157);
  - the wizard's create failure (`CreateMapping.tsx`:2592);
  - the consent notes (`ProviderConsent.tsx`:300-303, `CreateMapping.tsx`:2239-2246).

  Other screens already use `role="alert"`: `Login.tsx`, `RequestAccess.tsx`, `ReportProblem.tsx`,
  `Invitations.tsx`, `AuthCallback.tsx`, `AccessRequests.tsx`, `Confirm.tsx` and
  `ConfirmMigration.tsx`. `Login.tsx`:73 records why one failure gets one alert and not two.

### A Dutch reader of the grant flow

The grant page is for somebody a tester asks to grant access: a family member or a colleague with
a Google account. Grant links cover Google only (`docs/grant-links.md`:47).

- **Half a sentence in English.** The server builds the phrase for what will be read in English
  only (`READS`, `apps/api/src/routes/grant.ts`:109-115) and joins the items with English "and"
  (`listed`, :118-121, used at :201). The Dutch frame is
  `'U staat op het punt toegang te geven tot {reads}.'` (`apps/web/src/i18n/strings.ts`:3033), so
  a Dutch reader sees *"U staat op het punt toegang te geven tot your email — messages, folders and
  labels."* (`Grant.tsx`:183).
- **Refusals in English.** The page renders the server's refusal verbatim (`Grant.tsx`:123-128,
  `View.tsx`:159-164). Those refusals are sentences written for this reader:
  - `MAPPING_LINK_REFUSAL` (`packages/ledger/src/mapping-link-store.ts`:96-99);
  - the *"not ready"* frame and its seven reasons (`grant.ts`:139-171);
  - the two *"cannot use a Google sign-in yet"* wrappers (`grant.ts`:291, :304);
  - the callback's own endings (`google-oauth-routes.ts`:270-341, with `EXCHANGE_FOR_THE_LINK_HOLDER`
    at :194).

  All of them are English only. `docs/i18n-prose-boundary.md` already names the sanctioned way to
  make server prose bilingual: the Dutch goes beside the English in `@openmig/shared`, as
  `APPLY_FLAG_WARNING_NL` and `credential-refusals.ts` do it (its class 4, :38-54). A provider's
  own words are a different case: *"Google reported: …"* stays verbatim.
- **The endings are English.** `grantResultPage` and `consentResultPage` (`google-consent.ts`:620,
  :538) have no locale parameter. The grant ending tells a person to *"Bookmark it"* (:661), which
  an app's embedded browser often cannot do (the review; not checked here).
- **No way to switch.** The only language switch is in `Layout` (`Layout.tsx`:303), and
  `/request-access`, `/grant/:link` and `/view/:link` are routed outside it
  (`apps/web/src/AppRoutes.tsx`:160, :174, :187). A Dutch person whose phone is set to English
  therefore reads English and cannot change it. #1137 gave the request page `?locale=`; the grant
  and view pages still read only the browser (`detectLocale`, `i18n/index.tsx`:32-42).

### In-app browsers

0140 §1 records what is known, and 0140 T3 adds the line *"open it in Safari or Chrome"* on the
grant page and in the consent panel. According to the review, Google refuses consent inside an
embedded web view and allows the in-app tabs of Safari and Chrome. That is outside knowledge,
confirmed only in part, and which apps fall on which side has to be tried on phones. Two points
touch this plan:

- **Windows in an app's browser.** A web view that an app embeds may open no window for
  `window.open` at all. What each app does is not known (T10). T5's blocked-window sentence is also
  the answer for an in-app browser that refuses windows.
- **Safari clears stored data.** The review adds, from outside knowledge, that Safari clears
  storage a script wrote once a week has passed without a visit. The sign-in token lives in
  `localStorage` (`apps/web/src/services/api.ts`:75), so a Safari tester who stays away for a week
  signs in again. This was not verified here. Sign-in is 0135's, and this plan does not change it.

### What is checked automatically

- **One browser, desktop size.** The UI smoke imports only `chromium`
  (`test/ui/managed-ui.ui.test.ts`:59) and launches it at :365. `open()` sets a locale and no
  viewport (:312-314), so Playwright's desktop default applies. CI installs only Chromium
  (`.github/workflows/ci.yml`:601, job `ui-tests` at :550, `pnpm test:ui` at :605). The routes
  the suite opens are `/login`, `/mappings` and `/access-requests`. It never opens `/grant`,
  `/view`, `/request-access` or the wizard.
- **Only the site at phone width.** Only the marketing site is checked at 390 px: *"does not
  scroll sideways on a phone"*, for `/`, `/pricing.html` and `/privacy.html`
  (`test/ui/site.ui.test.ts`:134-138).
- **No accessibility tooling.** No `package.json` names `axe-core`, `jsx-a11y`, `pa11y` or
  `lighthouse`. `eslint.config.js` applies the two recommended sets and two promise rules, and it
  says why it keeps the list short: *"a rule everybody suppresses is not a rule"* (:35).
- **The guards that exist.** `apps/web/src/a-label-that-labels-nothing.unit.test.ts` checks that
  labels are tied to their controls. #1137 added the Tailwind class guard, the `lang` assertion and
  the name assertions above.

### What the product promises

- **The target.** `docs/architecture/solution-architecture.md` §23 (:381): *"**Accessibility:**
  target **WCAG 2.2 AA** — keyboard navigation, screen-reader labels, sufficient contrast, clear
  focus"*.
- **An audit that has not happened.** `docs/workplans/0011-managed-edition-hardening.md`:302 left
  *"EN/NL i18n completion and WCAG audit (§23) — a later web-polish slice."* Nothing records that
  audit since.
- **No statement.** `site/legal/` holds `README.md`, `dpa.md`, `privacy.md`, `privacy.nl.md`,
  `subprocessors.md`, `terms.md` and `terms.nl.md`. None of them is an accessibility statement, and
  neither `site/` nor `docs/` mentions the European Accessibility Act, this plan apart.

### What already holds

The review spot-checked these, and this plan checked the first four again. Nobody needs to spend
test time on them:

- `index.html`:15 allows pinch zoom;
- the tables sit inside `overflow-x-auto` (for example `Mappings.tsx`:206 and `Verify.tsx`:169);
- `main` keeps `pb-24` on small screens, so that the Android keyboard's overlay does not hide the
  wizard's Next (`Layout.tsx`:412-415);
- the language buttons already use `aria-pressed` (`Layout.tsx`:304);
- no sign-in or consent flow depends on third-party cookies.

The owner has tested the wizard on a phone before. 0075 T5 fixed about thirty unlabelled inputs
that the owner raised *"after testing on a phone"*. 0069 keeps the wizard's non-secret half, which
the owner asked for *"after losing a half-finished wizard on a phone"*
(`apps/web/src/pages/wizard-draft.unit.test.tsx`:5-6).

## 2. The owner's decisions (2026-09-24)

No question to the owner was about accessibility itself. The answers below set how much of it
the alpha needs. Each decision gives the question in plain words and then the answer as given,
typos included. Where an answer needed a reading, the reading is 0131's.

**D1 — a small, Dutch, free alpha.** *Is the test free or paid, for how many people, and in which
language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the posture of the test:
*"Free. A few weeks. No obligations both sides."*

So what a tester reads is Dutch first (0144 D1), and a half-English grant page is a defect, not a
detail (T6). The group is at most 20 known people for a few weeks, so the minimum is what those
people meet on a phone. The full audit comes after.

**D2 — the owner lets people in and supports them.** *What may a member and a viewer do, and
should only owners and admins invite?* — *"I am the gate for letting people in the test."* *A
tester stack separate from CI and the nightly gate, reachable from the internet?* — *"Yes, but
its a controlled rest. I Let people in and support them. Max 10/20 people"* ("rest" is read as
"test").

So the owner can hear from each tester, before they start, which phone and which apps they use
(T10). A tester who uses a screen reader, magnification or a keyboard alone can say so and be
helped in person. T9 (a) invites them to, and nothing about it is recorded in the product.

**D3 — where the alpha runs, and where the checks run.** *Where do testers run, and under which
host names?* — *"This machine, ci states. The OTA address. It's all controlled by me and invite
only."* ("ci states" is read as "CI stays".) On who gets onto the machine: *"Who would need/het
credentials? I aupporrthe test. No one will be added to NetBird network. Devs need to setup own
private test/dev environments. GitHub PRs and git is the bridge."* ("het" is read as "get", and
"aupporrthe" as "support the".)

So the alpha runs on the reference machine, and CI stays on it. The first answer placed testers at
the OTA address. Later the same day the owner chose a second stack for testers, `ownpace-live`,
beside the OTA stack on the same machine, at the production names `app.ownpace.eu` and
`id.ownpace.eu`. The OTA stack stays the nightly gate's target and the demo. 0131 D3 and 0132 D7
quote the owner's words.

For this plan, T0, which asks only how today's code behaves, is pressed on the OTA stack at
`app.ota.ownpace.eu`: the nightly gate rebuilds it from `main`, and it exists now. T10, which
checks what testers will meet, is walked on `ownpace-live`, like 0141 T12's walk. The automated
checks (T8) run on pull requests, on GitHub's hosted runners. The WebKit run in particular runs
there, so nothing new is installed on the reference machine that carries both stacks (0132).

**D4 — the legal texts first, and the word "alpha".** *A lawyer's pass before the first
invitation, or a labelled test notice? And can you supply the facts the drafts leave open?* —
*"Yes before, Alpha, and i can supply."*

So whether the European Accessibility Act applies goes to that pass as a question (0139). This
plan does not answer it. The statement (T9) is not a legal text, but it has to agree with the
texts that are.

**D5 — unproven sources are labelled.** *For sources nobody has run against a real account: prove
them first, hide them, or label them experimental?* — *"Label"*.

0131 T2's tag is a word inside the card, so a screen reader reads it as part of the card's name.
T2's guard makes sure it stays that way.

## 3. What each task does

### T0 — one press on an iPhone, today (owner; before the first invitation)

This check runs on the OTA stack, which the nightly gate rebuilds from `main` (D3), before T5 is
built. On the owner's iPhone in Safari, the owner opens the wizard or the Connections page,
chooses a Google account and presses *Connect with Google*. The owner records:

- whether a tab with Google's page opened;
- whether the result came back and the tab closed;
- the iOS version.

The owner repeats it once from inside the mail app's browser, by opening the sign-in link from
the access-granted mail. The results go in this block as a date, an outcome and a version, with
no address.

If Safari blocked the window, T5 is urgent, and the review's claim holds. If it did not, T5 still
goes in, because the blocked-window sentence serves every browser with a strict blocker and every
in-app browser that refuses windows. The record then corrects the review.

### T1 — the phone menu takes focus and gives it back (before the first invitation)

In `apps/web/src/components/Layout.tsx`:

- **Closed, below 1024 px** (a `matchMedia('(min-width: 1024px)')` hook, since `lg` is 1024): the
  `aside` is `inert`. Its links leave the tab order and the screen reader's swipe order. From 1024
  px up, the drawer is the sidebar and nothing changes.
- **Opening** moves focus to the close button (:239-245). While the drawer is open, the page behind
  it (`<div className="lg:pl-64">`, :344) is `inert`, so focus cannot wander behind the backdrop.
  React 19 takes `inert` as a boolean attribute.
- **Escape** closes the drawer. **Closing** by Escape, by the close button or by the backdrop
  returns focus to the menu button (:347-354). Following a link closes the drawer as it does today,
  and focus goes to the new page (T3 (b)).
- **After:** a *"Naar de inhoud"* / *"Skip to content"* link as the first thing in the page, shown
  when focused, pointing at `<main>` (WCAG 2.4.1).

**Guard:** `apps/web/src/components/a-menu-that-gives-focus-back.unit.test.tsx`. It mocks a narrow
`matchMedia` and checks four things:

- while closed, the `aside` has `inert`;
- after the menu button is pressed, `document.activeElement` is the close button and the page
  behind has `inert`;
- after Escape, the drawer is closed and focus is on the menu button;
- with a wide `matchMedia`, the `aside` never has `inert`.

It fails today, because nothing sets `inert` or moves focus. T8 (a) checks the same thing in a real
browser.

### T2 — state said in words, not only in colour (after)

- **Chooser cards** (`FrontDoorChooser.tsx`:60-68): `aria-pressed={selected}` and a small check mark
  on the selected card, so that the selection is not shown by colour alone (WCAG 1.4.1, 4.1.2).
- **The wizard's progress** (`CreateMapping.tsx`:2543-2580):
  - `aria-label={t('wizard.progress')}`, *"Progress"* / *"Voortgang"*;
  - `aria-current="step"` on the current item;
  - labels no lighter than `text-gray-500`;
  - a visually hidden *"(done)"* / *"(klaar)"* after each completed step.
- **Finish** (`Finish.tsx`:81-103): the step's state as visually hidden text beside its icon.
  EN: *"done"*, *"needs attention"*, *"not yet"*. NL: *"klaar"*, *"vraagt aandacht"*, *"nog niet"*.
- **The scope manifest** (`ScopeManifestPanel.tsx`:70): a translated name in place of
  `"scope-manifest"`. The panel has no heading of its own: `Confirm.tsx` puts one above it (:326),
  and `ConfirmMigration.tsx` renders it with none (:170). So it takes `aria-labelledby` where a
  heading exists, and a label from the dictionary where none does.
- **The experimental tag** (0131 T2, D5): it stays text inside the card's button, never an icon
  alone. 0131 T2 also gives the tag a Hint *why*. A fold inside the card's `<button>` could not
  be opened on its own, so the fold sits beside the card, not inside it.

**Guard:** `apps/web/src/components/a-state-said-in-words.unit.test.tsx`, in both languages. It
checks that:

- the selected card is `aria-pressed="true"` and the others `"false"`;
- the current step has `aria-current="step"`;
- each Finish step's state is in its accessible text;
- a card with 0131 T2's tag has that word in its accessible name, once 0131 T2 exists;
- no `aria-label` in `apps/web/src` is a lowercase hyphenated identifier (a scan).

It fails today on every one of these.

### T3 — a new step or page starts at the top and says where you are

**(a) Before the first invitation.**

- **The wizard.** `CreateMapping.tsx` gets one heading at the top of the step card that is the same
  on every step: *"Step 2 of 4: Target"* / *"Stap 2 van 4: Doel"*, from the existing step names
  (:543-573 and :2716-2742 in `strings.ts`). It is visible, because on a phone the progress row is
  small. When `currentStep` changes, and never on first render, the page scrolls to the top and the
  heading, with `tabIndex={-1}`, takes focus. A screen reader then reads the new step without a
  live region. Scrolling is instant when the reader prefers reduced motion.
- **A new page.** In `Layout`, an effect on `location.pathname` scrolls to the top. It is skipped
  when the navigation is Back or Forward (`useNavigationType() === 'POP'`), where the browser's own
  restoration is what a person expects.

**Guard:** `apps/web/src/pages/a-step-that-starts-at-the-top.unit.test.tsx`. It reuses
`walkToReview`, the step-through helper in `CreateMapping.unit.test.tsx`:118, which moves to a
shared test file because it is not exported. Pressing Next calls `window.scrollTo` with the top
and leaves focus on a heading that names step 2 of 4, in EN and NL. A route change calls
`scrollTo`, and Back does not. It fails today.

**(b) After.** Each screen sets `document.title` to *"<screen> — Ownpace"* in the reader's
language (WCAG 2.4.2), from the `SCREEN_TITLE_KEY` and navigation names `Layout` already has. On a
route change, focus goes to the page's `h1`. `index.html`'s static English title stays only as
the title before the bundle loads. The guard is the same file, with the title and the focus case
added.

### T4 — errors are announced (after; Grant and View with T6)

- `role="alert"` on:
  - `Grant.tsx`:123-128 and :215;
  - `View.tsx`:159-164;
  - the create failure at `CreateMapping.tsx`:2592;
  - the consent notes (`ProviderConsent.tsx`:300-303, `CreateMapping.tsx`:2239-2246) when the note
    is a refusal. When a note says the result was received, it gets `role="status"`.
- `role="status"` on the waiting lines, `Grant.tsx`:121 and `View.tsx`:157.
- One alert per failure, as `Login.tsx`:73 explains.

**Guard:** `apps/web/src/pages/an-error-that-is-announced.unit.test.tsx`. It renders each screen
with a refusal and finds the refusal with `getByRole('alert')`. It fails today.

### T5 — the consent window opens on the press itself (before the first invitation)

**One helper, two call sites.** `apps/web/src/services/consent-window.ts` exports
`openConsentWindow(name)`, which must be called inside the click handler before anything is
awaited. It calls `window.open('', name, 'popup,width=520,height=640')` and returns the window,
or `null` if one was not opened. After `await begin()`:

- with a window, it sets `w.location.href = url`. Navigating a window we opened is allowed across
  origins, and the opener survives as it does today (`callbackPageHeaders`);
- when `begin()` fails, the blank window is closed, and the refusal shows as it does now;
- when `w` is `null`, the panel shows one sentence and a link. EN: *"Your browser did not open
  {provider}'s page. Open it with this link:"*. NL: *"Uw browser heeft de pagina van {provider}
  niet geopend. Open die met deze link:"*. The link is `<a href={url} target={name}
  rel="opener">`. Tapping it is a fresh press, so no blocker stops it. It opens a named window,
  not `_blank`, and keeps its opener, so the ending can still hand the result back. That
  `rel="opener"` behaves like this in Safari has to be confirmed in T8 (c) and T10.

`ProviderConsent.tsx`'s `start` (:172-216) and `CreateMapping.tsx`'s `startConsent` (:1078-1140)
both use the helper. The wizard's copy keeps its own state, which is its business; only the
opening is shared. 0140 T3's line (*"open it in Safari or Chrome"*) sits under the same button, and
the two sentences are written so that together they read as one instruction.

**The same-tab fallback is parked.** The consent result goes back to the opener and is not kept by
the server (§1). A same-tab trip would therefore need two builds. The owner's consent result would
have to be stored server-side under the state, as the grant path does, and saved as a connection
as a test does (0069). The wizard would then have to reopen with its draft and that connection.
That is a small feature of its own. It waits until T0 or T10 finds a browser where neither the
window nor the link comes back. 🅿️ **Parked (trigger: that browser, recorded here).**

**T7 (a) goes in the same change** (below), because it is the same button.

**Guards:**

- `apps/web/src/components/a-consent-window-opened-by-the-press.unit.test.tsx`. `window.open` is
  spied, and `begin` is held pending. A click on the Connections panel's button and a click on
  the wizard's button each call `window.open` before `begin` resolves. With `window.open`
  returning `null`, the sentence and a link to the consent URL are shown, in EN and NL. It fails
  today, because the call comes after the `await`.
- A scan in the same file: `window.open(` appears nowhere in `apps/web/src` outside
  `consent-window.ts`, so a third copy cannot come back.

### T6 — the grant flow and the consent endings in one language

**Before the first invitation.** The consent endings always, because every tester who connects a
Google, Microsoft or Dropbox account sees one. The
grant half only if testers send grant links during the alpha, which is 0140's open question 2.
If they migrate only their own accounts, the grant half moves to after. The owner reads all of the
Dutch before it ships (0144 D1: Dutch first). The wording below is a proposal.

- **"What will be read" from the dictionary.** `GET /api/grant/:link` also answers `domains`, the
  codes it already decides at `grant.ts`:201. `Grant.tsx` builds the sentence from new keys
  `grant.reads.email` … `grant.reads.task` and joins them with `Intl.ListFormat(locale, { type:
  'conjunction' })`. NL: *"uw e-mail: berichten, mappen en labels"*, *"uw agenda's en de
  afspraken erin"*, *"uw contactpersonen"*, *"uw bestanden in Google Drive"*, *"uw taken"*.
  This is copy the page authors, not a finding, so it belongs in the dictionary. `READS` and
  `reads` go.
- **Refusals in pairs.** Each sentence written for the link holder gets its Dutch beside it in
  `@openmig/shared`, class 4 of `docs/i18n-prose-boundary.md`:
  - `MAPPING_LINK_REFUSAL`, which moves or is re-exported so that the ledger and the page read one
    pair;
  - the *"not ready"* frame and `FOR_THE_LINK_HOLDER`;
  - the two sign-in wrappers;
  - the callback's `EXCHANGE_FOR_THE_LINK_HOLDER` and its own sentences.

  The JSON answers carry `reason` as today and `reasonNl` beside it, and the page shows the one in
  its language. What Google says (*"Google reported: {said}"*) keeps `{said}` verbatim inside a
  translated frame. Example NL for the refusal of a link: *"Deze link kan niet worden gebruikt.
  Misschien is hij al gebruikt, verlopen of ingetrokken door wie hem stuurde. Vraag om een nieuwe
  link; die is zo gemaakt."*
- **Endings in the page's language.** `POST /api/grant/:link/google/authorize`, and the owner's
  three authorize calls, take `locale` (`en` or `nl`). It is recorded on `PendingConsent`
  (`google-consent.ts`:85) beside `link`, server-side, and never round-tripped through the
  redirect. `grantResultPage` and `consentResultPage` take the locale, and `shell()` takes its
  `lang`. Anything else, or nothing, means `en`. The *"Bookmark it"* sentence becomes, in EN: *"Keep
  this link: bookmark it or copy it somewhere safe. If this page opened inside another app, that
  app may not keep it for you."* In NL: *"Bewaar deze link: zet hem bij uw favorieten of kopieer
  hem naar een veilige plek. Is deze pagina in een andere app geopend, dan bewaart die app hem
  misschien niet."*
- **A switch on the public pages.** `Grant` and `View` get the same two text buttons `Layout` has,
  with `aria-pressed`, in their top corner. The request page has `?locale=` since #1137.

**Guards:**

- `apps/web/src/pages/a-grant-page-in-one-language.unit.test.tsx`. Under `nl`, with a fixture that
  answers `domains: ['email', 'calendar']`, the sentence is all Dutch and contains none of the
  English `READS` phrases. A refused link shows its Dutch half. The switch changes both.
- `apps/api/src/routes/migrations/a-consent-ending-in-the-readers-language.unit.test.ts`. Both
  endings with `nl` are Dutch and carry `<html lang="nl">`. The callback renders the locale that
  the authorize call recorded, and an unknown locale renders English.
- In shared: every pair has a non-empty `en` and `nl`, and they differ.

All three fail today.

### T7 — help a finger can reach

**(a) Before the first invitation, in T5's change.** When a Connect button is disabled, its reason
is shown under it as text with `role="status"`, and the `title` goes. This is the pattern of
Next's reason (`CreateMapping.tsx`:2625), in `ProviderConsent.tsx`:285-296 and
`CreateMapping.tsx`:2223-2233. **Guard:**
`apps/web/src/components/a-reason-a-finger-can-read.unit.test.tsx`. With no data type ticked, the
reason is visible (`toBeVisible`) in both places, in EN and NL. It fails today.

**(b) After.**

- **Verify.** The help moves out of `title` and into the Hint fold (`Verify.tsx`:99, :128, :151).
  `docs/i18n-prose-boundary.md`:31, which still says *"hover help on verdict words"*, is updated in
  the same change.
- **The Mappings row actions** (`Mappings.tsx`:283-341):
  - `aria-label` beside each `title`;
  - a target of at least 24 px (WCAG 2.5.8), measured by T8 (b);
  - below `sm`, the action's word next to its icon.
- **The other `title={t(…)}` uses.** They are read through once. Any that carries information shown
  nowhere else moves into text or a fold.

**Guard:** the same file, extended with Verify's help being reachable without hovering.

### T8 — checks that run: phone width, axe, WebKit (after)

All three live in `test/ui/managed-ui.ui.test.ts`. That suite serves the shipped bundle with
fixtures and no API (its header), and its project runs one browser and one build at a time
(`vitest.config.ts`, project `ui`). The grant and view fixtures are 0141 T12 (b)'s. Whichever plan
lands first adds them.

- **(a) A phone.** `open()` gets a device option: 390 × 844, `isMobile`, `hasTouch`. The pages
  are:
  - `/login` in Dutch;
  - `/request-access?locale=nl`;
  - `/mappings`;
  - `/mappings/new`;
  - a grant link;
  - a view link.

  Each asserts that the page does not scroll sideways, with the expression from
  `site.ui.test.ts`:137-139. On `/mappings`, the menu opens, focus lands on its close button, and
  Escape brings focus back to the menu button (T1). In the wizard, Next leaves the page at the top
  (T3). Whether the progress row fits at 390 px is not known today. This case finds out.
- **(b) axe.** `axe-core` becomes a root dev dependency. It is injected with `page.addScriptTag`
  from the installed package and run on the same pages at both widths, with the WCAG 2.0, 2.1 and
  2.2 A and AA tags. A `serious` or `critical` violation fails the case. A violation this plan
  already has a task for is listed with that task's number, and an entry whose violation no longer
  occurs fails too, so the list can only shrink. The review's compile suggests that the wizard's
  step labels will be the first entry, as a contrast violation (T2), and the Mappings icons may
  meet `target-size`. Neither has been run.
- **(c) WebKit.** `webkit` from `playwright-core` opens `/login` and a grant link once each, on the
  pull-request leg only. That is GitHub's hosted runner, which installs WebKit with its system
  dependencies there. On a push to `main` the job runs on the self-hosted runner (`ci.yml`:552),
  and the case says it was skipped and why (D3). The browser cache key gains the browser's name.
  Linux WebKit is not iPhone Safari. It catches a bundle that current WebKit will not parse, and
  WebKit's own layout. It does not catch what an older iPhone will not parse, iOS's popup rules or
  an app's embedded browser, which is why T0 and T10 stay.
- **Considered, not proposed:** `eslint-plugin-jsx-a11y`. It reads source, not the rendered page,
  and many of its rules would have to be switched off. axe in a browser sees the names and the
  contrast that are actually there.

**Proved by breaking.** Each case is shown to fail once before it counts: T1's focus move removed,
a card's `aria-pressed` removed, and a fixed `width: 500px` added to the wizard. The dependency and
the CI minutes are the maintainer's decision (open question 4).

### T9 — an accessibility statement in Dutch and English

**(a) Before the first invitation: one paragraph in the tester guide (0144 T1).** It is written
after T10 and says only what T10 found. Dutch first:

> Ownpace werkt op telefoon en computer. Voor de alfa is het geprobeerd op een iPhone (iOS 16.4
> of nieuwer, met Safari) en een Android-telefoon met Chrome. Op een oudere iPhone kan de pagina
> leeg blijven. Met een schermlezer, alleen met een toetsenbord of met sterke vergroting is het nog
> niet volledig nagelopen. Gebruikt u een van die hulpmiddelen, laat het ons weten via [het adres
> uit 0144 T0]; dan kijken we samen of het werkt.

> Ownpace works on phones and computers. For the alpha it has been tried on an iPhone (iOS 16.4 or
> later, with Safari) and an Android phone with Chrome. On an older iPhone the page may stay blank.
> It has not yet been checked in full with a screen reader, with a keyboard alone or at high
> magnification. If you use one of these, tell us at [the address from 0144 T0], and we will see
> with you whether it works.

**(b) After: the statement.** `site/pages/en/accessibility.md` and
`site/pages/nl/toegankelijkheid.md` are a new page key in `site/build.mjs` (`SOURCE` :859-862,
`META`, `PAGE_KEYS` :428) and in `site/copy.mjs` (`files`, :42 and :192). The footer links them
beside the privacy policy and the terms (:509-519). The statement says:

- the target, as the architecture document puts it: WCAG 2.2 AA (§23). It says "target", not
  "conforms";
- what has been checked, and how: the guards in §1, T8's pages once they run, and T10's phones,
  with their dates;
- what has not: a full audit (0011's, still open), screen readers beyond T10, and the pages that
  are not ours. Those are the identity provider's sign-in and Google's, Microsoft's and Dropbox's
  consent screens;
- the known limitations, one line for each open task here, linked to 0144 T2's list;
- how to report a problem, which is the address from 0144 T0 or the report form (0130), and the
  date of the statement.

**The Act.** Directive (EU) 2019/882 has applied since 28 June 2025, and by the review's account
it is implemented in Dutch law. It exempts microenterprises that provide services. Whether it
applies to the managed service, during a free alpha and once the service is sold, is a question of
fact and law. It goes to 0139's legal pass (D4) as a question, and nothing here answers it.

**Guard:** `site/site.unit.test.ts`. The statement exists in both languages, each links the
other, it names WCAG 2.2 and carries a date, and the footer links it. `test/ui/site.ui.test.ts`'s
390 px list gains the two pages. It fails today, because the page does not exist.

### T10 — the walk on two phones (owner; before the first invitation)

This is 0141 T12's walk, on phones. It becomes `docs/owner-test-runbook.md` *"Stage 9 — the same
walk on two phones"*, after 0141 T12's Stage 8, with an expected outcome for each step. It is
walked on `ownpace-live` (D3), once a release that carries the minimum runs there (0146 T5):

- **The phones.** An iPhone on iOS 16.4 or later, with Safari, and an Android phone with Chrome.
  Both are set to Dutch.
- **The screen readers.** Steps 3 to 5 are walked once with VoiceOver on the iPhone and once with
  TalkBack on the Android phone.

The steps:

1. The Dutch site's *Toegang aanvragen* link (`ctaOrder`, `site/copy.mjs`:209) opens the request
   form in Dutch, and it does not scroll sideways.
2. The identity provider's sign-in page lays out at phone width. If it does not, the finding goes
   to 0135.
3. The menu opens, and the screen reader is on its close button. The menu closes, and the reader
   is back on the menu button (T1).
4. *Connect with Google* opens Google's page, the result arrives, and the tab closes (T5). A
   greyed-out Connect says why (T7 (a)).
5. Each Next starts at the top of the step, and the screen reader says *"Stap 2 van 4: Doel"*
   (T3).
6. A grant link is opened from WhatsApp and from the owner's mail app. The in-app browser half is
   0140 T3's check and is recorded there. On the phone, the grant page, Google's return and the
   ending are all Dutch, and the ending fits the screen (T6, #1137).
7. The view link can be read on the phone and does not scroll sideways.
8. At 200% page zoom in Safari, the wizard's text and buttons can still be reached (WCAG 1.4.4).

**The in-app browsers.** For the grant link and for the sign-in link in the access-granted mail,
the owner records, for each app:

- which browser opened: the system browser, an in-app tab or an embedded view;
- whether Google's page and our ending worked.

The list starts with the apps the first testers say they use. The owner asks them when granting
their request (D2). Each row records pass or fail, the date, the release live runs (the build
stamp at the foot of the menu, or of a page outside it, shows it; 0146 names it), the kind of
phone, the OS version, the browser and the language. It never records an address.

## 4. Order

1. **T0 now**, because it is one press, and it decides how urgent T5 is.
2. **T5 with T7 (a)**, as one PR. **T1** and **T3 (a)** are one PR each. They are independent.
3. **T6**, once 0140's open question 2 is answered: the consent endings in any case, and the grant
   half if grant links are used. T4's Grant and View lines go in with it.
4. **T10**, after 0141 T12's desktop walk, then **T9 (a)**, written from what T10 found, into
   0144 T1's guide.
5. After the first invitation: **T2**, **T3 (b)**, **T4**, **T7 (b)**, then **T8**, which is
   proved against them, and **T9 (b)**, once 0139's pass has answered the Act question.

## Not in this plan

- The *"open it in Safari or Chrome"* line on the grant page and in the consent panel, and the
  first check of a grant link opened from a chat app: 0140 T3.
- The identity provider's sign-in page and its providers: 0135.
- The "read-only" wording on the grant page: 0144 T3. The tester guide and the known-limitations
  page this plan's paragraph and statement live in: 0144 T1 and T2.
- The alpha note and the experimental tag: 0131 T1 and T2.
- The desktop walk and the fixture-backed grant, view and wizard cases: 0141 T12.
- A build name a tester can quote: 0146.
- The in-app guides (`Docs.tsx` serves the English `docs/*-setup.md`), and whether they become
  Dutch and written for customers: W15, now 0148, which the owner answered with Dutch customer
  guides for each source and target (0148 D1, D4).

## Open questions

1. **The minimum.** Is it T0, T1, T3 (a), T5 with T7 (a), T6 (the grant half only if grant links
   are used), T9 (a) and T10, with everything else after? The recommendation is yes. T2 and T4
   matter to a tester who uses a screen reader. If the owner learns that one of the first testers
   does (D2), T2 and T4 move before that tester's invitation. T1 matters to the same testers, and
   to somebody on a keyboard alone; a sighted tester who taps does not meet it. If none of the
   first testers uses a screen reader or a keyboard alone, T1 could move after too, and T10's
   screen-reader passes would then skip step 3.
2. **The grant reader's language (T6).** Adding a language switch to the grant and view pages is
   recommended over carrying the issuer's language in the link. The reader of a grant link is not
   the person who made it, and that person's language says nothing about the reader's. The Dutch
   wording on this page asks people to trust it, so the owner reads it first.
3. **The same-tab fallback (T5).** Park it as proposed, until T0 or T10 finds a browser where
   neither the window nor the link comes back? Or build the server-held result for the owner's
   consent now? Parking is recommended: nothing so far shows the window and the link both failing.
4. **T8's cost.** Adding `axe-core` as a dev dependency, a WebKit download on the pull-request
   leg, and roughly a minute more of `ui-tests`. Is that acceptable, and is it right to keep WebKit
   off the self-hosted runner (D3)?
5. **The European Accessibility Act (T9).** Add it to the questions for 0139's legal pass: does it
   apply to the managed service, during the alpha and once the service is sold?
6. **The phones for T10.** Which iPhone and which Android phone does the owner have to hand, and
   which apps do the first testers read their mail and chats in? The list in T10 starts from those
   answers.
