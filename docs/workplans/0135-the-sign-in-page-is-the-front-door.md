# Workplan 0135 — The sign-in page is the front door

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 read the
identity provider that testers were then to sign in to, Zitadel `v4.17.3` at `id.ota.ownpace.eu`.
Where a public test needs a door closed, it still has upstream's default. The worst case is a
chain of three defaults. Anybody can found an organisation of their own there. An organisation's
owner can create an account whose address the provider calls verified, without any mail being
sent. And the Ownpace project accepts users from every organisation. Ownpace binds a granted
organisation, and an invitation, to a verified address. So the chain ends inside somebody else's
organisation (§1). The owner reported that that instance holds no other organisation, and asked
for advice (§2). The advice is in §4: close public organisation registration and turn on the
project check before the first invitation. Both are settings at the identity provider, not
product code.
The owner can apply them by hand today (T0), and the bring-up then keeps them in place (T1, T2).
The rest of the plan hardens the same page for the weeks of the alpha: T3 counts the
organisations again, T4 adds second factors and a lockout, T5 adds the legal links, T6 puts the
page in Dutch and English in Ownpace's own words, T7 watches the pinned version, and T8 deals
with accounts nobody let in.

Nothing of this plan is built. Three small pieces it relies on were fixed in #1137, merged
2026-09-24, and are on `main`: the identity provider's mail login (`setup-zitadel.sh` creates the
mail provider with `SMTP_USER` and `SMTP_PASSWORD`), which belongs to 0133; the `zitadel`
database in the runbook's backup recipe, which belongs to 0134 and which T7 relies on; and the
wording in `SECURITY.md` that names what Dependabot is told to leave alone (T7).

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137 merged.**
Testers sign in at live's own identity provider at `id.ownpace.eu` (0132 T1d), which starts
fresh, so T1 and T2 must be in place there before its first invitation: from its first start if
the tag it is first brought up from carries them, otherwise by T0; the same hardening is applied
to the OTA instance too, and the owner's count of one organisation (D1) covers that instance only
(D7). T7 no longer rests on a paused gate, because the gate keeps proving upgrades on the OTA
stack before a tag carries them to live.

Names used from here on: **live** is the identity provider of `ownpace-live`, at `id.ownpace.eu`;
**the OTA instance** is the one of `ownpace-managed`, at `id.ota.ownpace.eu`. Where D1 below says
"the live identity provider", it was asked before D7 and means the OTA instance.

| Task | Status | Notes |
|---|---|---|
| T0 The owner applies T1 and T2 by hand, on each instance, and reads both back | ⏳ **Owner** (D2, D7) | §3 and §4. The OTA instance now. Live before its first invitation and before 0133 T3; if live's first tag carries T1 and T2, only the read-backs are left there. Minutes each, and no deploy. |
| T1 Public organisation registration off | 📋 **Proposed**; in place on live before its first invitation (D2, D7) | §3. The instance restriction `disallowPublicOrgRegistration`, set by `setup-zitadel.sh` and read back, and set by `managed.yml` for a fresh instance, which live's is. |
| T2 The project admits its own organisation only | 📋 **Proposed**; in place on live before its first invitation (D2, D7) | §3. `hasProjectCheck` on the Ownpace project, set at creation and on an existing project, and read back. Live's project is created at its first bring-up. This sits beside `tenant_member`, not in its place. |
| T3 One organisation, recorded and counted again | 📋 **Decided 2026-09-24** (D1) for the record; the count is 📋 **Proposed** | §3. The owner's answer covers the OTA instance; live's starts with one. The count is per instance: a count anybody can repeat, a line in the bring-up's summary, daily on live by 0132 T7, nightly on the OTA instance by the gate's own run of `setup-zitadel.sh`. |
| T4 Second factors for the accounts that hold the keys, and a lockout | ⏳ **Owner** for the enrolment; 📋 **Proposed** for the lockout and forced MFA | §3. The first human and every operator, on each instance, live first; the machine user cannot have one and relies on its token's short life. A lockout threshold. Whether a second factor is forced is open question 2. |
| T5 Privacy and terms links on the registration and sign-in pages | 📋 **Proposed**; lands with 0139's publication (D5) | §3. The instance privacy policy, from `.env`, read back. Live's first. |
| T6 Dutch and English, in Ownpace's own words | 📋 **Decided 2026-09-24** (D4) for the languages; 📋 **Proposed** for the brand | §3. Only `nl` and `en` allowed, a default from `.env`, and the verification and reset mails rewritten. Logo, colours and the organisation's name follow; live's fresh instance can carry the name from its first start. |
| T7 A watch on the pinned identity provider | 📋 **Proposed** | §3. Read the three newer releases now, choose a watch, set a response window, and take a dump before an upgrade. |
| T8 Accounts nobody let in, and erasure that reaches the identity provider | 📋 **Proposed**; the retention period is the owner's (→ 0139) | §3. A retention rule, an operator script in `deploy/compose`, and a runbook step. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24, and the ones #1137 touched
were checked again at `main` after it merged. Upstream facts were read in Zitadel's source at the
pinned tag, `v4.17.3`. None of this was exercised against a running instance: the OTA instance
was not called, and live's does not exist yet.

**Two instances, one recipe (D7).** Live's identity provider is brought up from the same
`managed.yml` and `setup-zitadel.sh` as the OTA instance, in a second compose project with its
own database, masterkey and provisioning token (0132 T1d). So everything below holds for live too,
from its first start, unless a task of this plan is in the tag live is first brought up from.

The review's findings this plan carries are `idp-public-org-registration-verified-email-takeover`,
`idp-no-mfa-no-lockout-privileged`, `idp-admin-consoles-exposure`,
`idp-registration-no-privacy-tos-links`, `idp-language-and-mail-copy`, `idp-branding-is-zitadel`,
`idp-zitadel-release-watch-gap`, `idp-security-md-dependabot-overclaim`,
`idp-orphan-accounts-no-deletion-path` and `legal-idp-identity-not-erased`. The review verified
`idp-language-and-mail-copy`, `idp-security-md-dependabot-overclaim` and
`idp-admin-consoles-exposure` only in part, and each is stated below as far as it holds.

### What the bring-up configures

- **The image.** `managed.yml` runs `ghcr.io/zitadel/zitadel:v4.17.3` as `ownpace-idp`, with the
  built-in login (v1, at `/ui/login`). Of the `ZITADEL_DEFAULTINSTANCE_*` values it sets exactly
  one, `FEATURES_LOGINV2_REQUIRED: "false"`, plus the first organisation's human and machine
  users (`ZITADEL_FIRSTINSTANCE_ORG_*`).
- **The project.** `setup-zitadel.sh` creates the project `Ownpace` with the body `{name:$n}` and
  nothing else. When the project already exists, the script says "found it" and changes nothing.
- **The login policy.** When its probe finds that the policy people resolve is not the described
  one, the script first deletes the first organisation's own login policy
  (`api_try DELETE /management/v1/policies/login`). It then writes the instance login policy with
  `allowRegister: true`, `allowUsernamePassword: true` and `allowExternalIdp` set by whether any
  sign-in provider is configured, and copies every other field back from the instance as it found
  it, including `forceMfa: (.forceMfa // false)`. So a setting made on the organisation's page
  does not survive a bring-up, and `docs/managed-bring-up.md` says so: *"an organisation-page
  toggle is undone by the next bring-up"*.
- **Nothing else.** A grep over `deploy/`, `scripts/` and `docs/managed-bring-up.md` finds none of
  `restrictions`, `register/org`, `hasProjectCheck`, `LOCKOUT`, `PRIVACYPOLICY`,
  `DEFAULTLANGUAGE`, `ALLOWEDLANGUAGES` or `LABELPOLICY`.

So the instance keeps upstream's defaults from `cmd/defaults.yaml` (and, for the first
instance's name, language and organisation, from `cmd/setup/steps.yaml`, which says the same):

- `DisallowPublicOrgRegistration` is empty, so `/ui/login/register/org` is served;
- `ForceMFA: false`;
- `MaxPasswordAttempts: 0` and `MaxOTPAttempts: 0`, which means no lockout;
- `IgnoreUnknownUsernames: false`, so the login page says whether a login name exists;
- `TOSLink`, `PrivacyLink`, `HelpLink` and `SupportEmail` are all empty;
- `DefaultLanguage: en`, and `AllowedLanguages` is empty, which allows every language upstream
  supports;
- `InstanceName: ZITADEL`, a first organisation named `ZITADEL`, and upstream's colours, logo and
  watermark.

**The repository's own comments assume the door is shut.** `setup-zitadel.sh`, above the
self-registration block, says *"THIS IS NOT AN OPEN DOOR"*. A few paragraphs later it says
*"This instance serves ONE organisation … and nothing creates a second"*. The mail block relaxes
the sender-domain policy because the instance is *"single-org"*. And 0095 says *"What A is *not*
is a security hole."* Each statement holds only while nobody founds a second organisation, and
nothing stops anybody from doing so.

### The chain the review described

Each link below was read in code. None was exercised.

1. **Anybody can found an organisation.** Upstream `register_org_handler.go` serves
   `/ui/login/register/org`. Its handler checks one thing, the instance restriction
   `DisallowPublicOrgRegistration`, and answers 404 (GET) or 409 (POST) when it is set. It does
   not look at the login policy's `allowRegister`. The repository never sets the restriction.
2. **The founder can create users.** The handler calls `SetUpOrg` with no roles, so the founder
   gets upstream's default, `ORG_OWNER` (`orgAdminRoles` in `org.go`). In `defaults.yaml`,
   `ORG_OWNER` includes `user.write`.
3. **A created user can have a verified address without any mail.** Upstream `user_human.go`
   records the address as verified when the creator says so (`if human.Email.Verified`). This
   repository's own smoke test does exactly that in the first organisation:
   `smoke-managed.sh` creates its people with `email:{email:$e,isVerified:true}`.
4. **The project accepts every organisation.** `projectRequired` in upstream `auth_request.go`
   returns early `if !project.HasProjectCheck || project.ResourceOwner == request.UserOrgID`.
   The project is created without the check (above). The token's audience is the project's id,
   which is the same for users of every organisation. That id is what the API checks:
   `verifyManagedToken` in `apps/api/src/middleware/auth.ts` verifies issuer, audience and the
   claims `sub` and `email`, and nothing about the organisation.
5. **The API binds by verified address.** At the first `GET /api/me`, `claimRequestedMembership`
   binds every `requested` row addressed to the token's `email`, provided `email_verified` is
   true. That is the organisation an operator granted, with that person as its only owner.
   `pendingInvitations` lists the invitations sent to the same address, and `acceptInvitation`
   binds the one the person says yes to.

**What the chain gives.** Suppose somebody knows the address a tester was granted under, or
invited under, and signs in before the tester does. For a granted request, that person becomes
the organisation's only owner. For an invitation, they join with the invited role, and 0137
explains what a role does and does not restrict today. The window for a row closes when its
rightful person binds it, because both functions match `status = 'invited'` only.

**What it does not give.** It does not make anybody an operator. `platform_operator` is keyed on
the subject, not the address: `isPlatformOperator` looks up `userId`.

**What stops it today, by accident.** The founder of a new organisation has to verify their own
address before the provider lets them sign in. The OTA stack's mail goes to Mailpit, and 0133
keeps it there, so on the OTA instance that mail never arrives. Live is different (D7). 0133 T3
points live's mail at a relay, and from that moment nothing holds the chain back on live. Before
the relay, live's mail is caught by its own Mailpit, and a verification code the owner passes on
by hand would do the same, which is why 0133 T1 passes on only codes for addresses the owner
granted.

### The accounts that hold the keys

- **The first human.** Upstream's comment on this user: *"the initial organization's admin user
  with the role IAM_OWNER"*. `managed.yml` creates it with a password only
  (`ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORDCHANGEREQUIRED: "true"`). The repository's default
  user name is `owner` (`managed.env.example`). The owner's *"Usernamea changed"* (D1) answered a
  question about the database passwords, so this plan does not read it as covering this account.
  On live the account is new: `ensure-env-secrets.sh` generates `ZITADEL_ADMIN_PASSWORD` at the
  first bring-up, the password must be changed at the first sign-in, and the user name is `owner`
  unless live's `.env` sets `ZITADEL_ADMIN_USERNAME` before the first start.
- **The machine user `ownpace-setup`.** Upstream's `setupAdminMembers` gives it both `ORG_OWNER`
  and `IAM_OWNER`. Its token is the provisioning token. `setup-zitadel.sh` rotates that token. On
  the OTA instance the nightly gate's runs of the script keep it alive; on live, 0132 T7's daily
  duties do.
- **The operators.** `docs/managed-bring-up.md` gives each operator `"roles":["ORG_OWNER"]` on the
  first organisation, so that the support screen's links into the console work. Each instance has
  its own operators; on live the first is the owner (0132 T0).
- **What Ownpace checks.** No second factor. `isPlatformOperator` is a row lookup, and nothing
  under `apps/api/src` or `packages/*/src` reads an `amr` or `acr` claim.
- **Where the console is.** On the same public origin as the sign-in page: the bring-up's summary
  prints `console ${ISSUER}/ui/console`.

### What a registrant sees, and what is kept

- **The form.** The registration form asks for a first name, a last name, an address, a user name
  (when the policy shows one) and a password. Upstream renders the footer links and the
  acceptance of terms and privacy only when a link is set, and none is.
- **The privacy policy.** `site/legal/privacy.md` is a *"draft for legal review — not yet
  published"*. Its §4.4 lists *"Your email address, the tenant you belong to, your role, sign-in
  timestamps"* and nothing the identity provider holds. Its §9 says *"Account and sign-in data |
  While your account exists, then 30 days"*.
- **Language.** Login v1 has no visible language picker; the form's `language` field is hidden.
  So the page's language comes from the browser. The review did not verify whether the OTA
  instance honours the browser's language. Dutch texts exist upstream. The English verification
  mail's subject is plain, and only its HTML title names Zitadel.
- **Branding.** The page shows upstream's logo and watermark. The first organisation is named
  `ZITADEL`, so the owner's login name ends in `@zitadel.<ZITADEL_EXTERNALDOMAIN>`, and
  `managed.env.example` says as much. Whether a label policy was set by hand in the OTA
  instance's console is recorded nowhere. Live's instance starts with upstream's.
- **Nothing removes an account.** Registering without an invitation creates an account at the
  identity provider that nothing removes. The housekeeping findings (`FindingKind` in
  `apps/api/src/scripts/operator-housekeeping.ts`) have no kind for the identity provider.
  `packages/managed/src/offboarding.ts` never mentions it, and neither does the runbook's *Tenant
  offboarding*. ADR-0042 forbids the product from calling the provider's user-management API.

### The pinned version

- **Nothing watches it.** `.github/dependabot.yml` ignores `ghcr.io/zitadel/zitadel` by name,
  with the comment *"One way: Zitadel migrates its schema at boot, on the persistent gate
  stack."* `security-scan.yml` runs Trivy with `scan-type: fs`, which scans files, not images.
  0119's row for the image says *"owner; ignored by name"*. No workflow looks up Zitadel's
  releases; the only release lookups in workflows fetch the Stalwart CLI installer.
- **SECURITY.md now says so.** Until #1137 it said dependencies are *"kept current by
  Dependabot"*, with no exception. Since #1137, merged 2026-09-24, it adds *"except what
  `.github/dependabot.yml` ignores by name (the Trigger.dev images and SDK, the identity provider,
  ClickHouse and MinIO, plus some major versions)"*.
- **The pin is behind.** `git ls-remote` on 2026-09-24 lists `v4.18.0`, `v4.19.0` and `v4.19.1`
  after the pinned `v4.17.3`. Their release notes were not read for this plan.
- **Upgrades are by hand.** ADR-0042: *"Pinned by version; upgrades are deliberate, never
  automatic."*

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words and the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — where the sign-in page runs, and what is on it.** *Are the ports 5432, 3001, 3090, 3443
and 3126 reachable from outside? Were the database passwords changed? Does the live identity
provider hold other organisations?* — *"No, these ports are not reachable outside of private
network/NetBird. Usernamea changed. No other organisations are hosted."* ("Usernamea" is read as
"usernames".) *Where do testers run, and under which host names?* — *"This machine, ci states.
The OTA address. It's all controlled by me and invite only."* ("ci states" is read as "CI
stays".)

For this plan, that means:

- the sign-in page was `id.ota.ownpace.eu` on the reference machine; D7 moves the testers to
  live's own instance at `id.ownpace.eu`, on the same machine;
- the OTA instance holds one organisation, which is T3's starting point there; the question was
  asked before D7, so the answer does not cover live, which starts with one (D7);
- "Usernamea changed" answers the question about the database passwords, and 0132 carries it;
  this plan does not assume it covers the identity provider's first human (§1, T4);
- 3126 is the OTA instance's own port, over plain HTTP, and it is not reachable from outside.
  Live's has a port of its own (0132 T1b).

How testers reach `id.ownpace.eu` is 0132's (T1e).

**D2 — advice on public organisation registration.** *Anybody can found an organisation of their
own at the identity provider. Close that before strangers are let in?* — *"Advice"*. The advice
is §4.

**D3 — the owner is the gate.** *What may a member and a viewer do, and should only owners and
admins invite?* — *"I am the gate for letting people in the test."* On the blocker that called for
a tester stack, separate from CI and the nightly gate and reachable from the internet: *"Yes, but
its a controlled rest. I Let people in and support them. Max 10/20 people"* ("rest" is read as
"test").

The access queue is meant to be the only way in. T1 and T2 close the way around it at the
identity provider. With at most 20 people, the owner can also help each tester set up a second
factor (T4).

**D4 — Dutch.** *Is the test free or paid, for how many people, and in which language?* —
*"Free and invite only. 10 to 20 people max. Dutch."* This is T6.

**D5 — the legal pass comes first.** *A lawyer's pass before the first invitation, or a labelled
beta notice? And can you supply the address, the btw-id and the hosting details?* — *"Yes
before, Alpha, and i can supply."* On the legal surface: *"I will update"*. T5's links and T8's
retention sentence go into 0139's pass.

**D6 — no backups.** *How much loss is acceptable, how fast must service come back, and where are
backups kept?* — *"None during the test"*. On the missing database backup: *"No obligations
during controlled test"*.

An upgrade of the identity provider migrates its schema one way. Unless T7 takes a copy first,
an upgrade cannot be undone.

**D7 — `ownpace-live` beside `ownpace-managed` (0132 D-new).** Later on 2026-09-24 the owner
asked: *"check, can't i just (as a start) host a 'ownpace-live' as production, next to the
current 'ownpace-managed' on OTA-domain? What would i need to do to keep alle seperate from each
other?"* The proposal back was to make that the decision in 0132, with testers on
`ownpace-live`. The owner's answer: *"Yes! The spark has a lot free memory and disk, it will
fit."* For this plan that means:

- testers sign in at live's own identity provider at `id.ownpace.eu` (0132 T1d), with its own
  database, masterkey, provisioning token and mail relay (0133). T0 to T8 apply there first;
- the OTA instance at `id.ota.ownpace.eu` stays the nightly gate's and the demo's. Its page is
  as public, so the same hardening is applied there too. The gate runs `setup-zitadel.sh` on it
  every night, so a change to the script is proven there before a tag carries it to live (0132
  T1g);
- D1's single organisation is the OTA instance's. Live's instance starts fresh, with the one
  organisation its first start creates, so T3 counts each instance separately;
- live's instance starts fresh, so every setting `managed.yml` gives a fresh instance takes effect
  there from the first start, provided the tag live is first brought up from carries it. Either
  way, T1 and T2 are in place on live, and read back, before its first invitation (T0).

## 3. What each task does

### T0 — the owner applies T1 and T2 by hand, on each instance (owner)

§4 gives the calls. They use the provisioning token the way `docs/managed-bring-up.md` already
does, change two settings, and read both back. Nothing is deployed, and nothing restarts. Once
T1 and T2 are merged, every bring-up applies and reads back the same settings, so the hand step
is not something that has to be remembered.

- **The OTA instance: now.**
- **Live: before its first invitation.** If the tag live is first brought up from carries T1 and
  T2, its instance never serves the organisation form and its project is created with the check,
  so T0 on live is the three read-backs. If live is stood up before they merge, T0 is applied
  there as soon as its identity provider answers at `id.ownpace.eu`, and before the first
  invitation and before 0133 T3 points live's mail at the relay, whichever comes first. T3's count
  on live then shows whether anybody founded an organisation in between.

0132 T0 lists the owner's steps on the machine, and T0 on live belongs among them, once live is
stood up and its names are routed (its steps 3 and 4).

### T1 — public organisation registration off

**The setting.** It is the instance restriction `disallowPublicOrgRegistration`. At the pinned
tag, `admin.proto` declares `SetRestrictions` as `PUT /admin/v1/restrictions` (permission
`iam.restrictions.write`) and `GetRestrictions` as `GET /admin/v1/restrictions` (permission
`iam.restrictions.read`). `IAM_OWNER` holds both permissions in `defaults.yaml`, so the
provisioning token can call them. The proto says *"Undefined values don't change the current
restriction"*. A body that carries only this field therefore leaves the allowed languages (T6)
alone.

**Two populations, as the login-v2 flag beside it has.**

- **A fresh instance.** `managed.yml` sets
  `ZITADEL_DEFAULTINSTANCE_RESTRICTIONS_DISALLOWPUBLICORGREGISTRATION: "true"`, which is the
  environment name `defaults.yaml` gives. Zitadel reads it once, at first init. Live's instance
  is one (0132 T1d): if the tag live is first brought up from carries T1, live never serves the
  form. On the OTA stack the same happens only if 0132 T5's route (a), parked with 0026 row 24,
  is ever taken; it removes the database volume and with it the identity provider's own database.
- **An existing instance.** `setup-zitadel.sh`, in a new block after the login-page block, reads
  the restriction and writes it only when it is not already true. Then it reads it back and
  stops with the `curl` line to run by hand if the value still is not true. The read treats an
  absent field as false, because proto3 JSON leaves a false out. The script's `policy_flag`
  comment explains the same thing for the login policy. This is the OTA instance, and live's too
  if it was first brought up without T1.

**The outside check.** By the handler's code, `GET <issuer>/ui/login/register/org` answers 404
once the restriction is set, at `https://id.ownpace.eu` and at `https://id.ota.ownpace.eu`
alike. By the same reading the OTA instance serves the form today; nobody has fetched it to see.
The smoke's sign-in section already fetches the page a browser is sent to, and it gains this
fetch as well. 0132 T3's outside probe, which tries the production and the OTA names, fetches it
too; 0132 records the ask.

**The comments that become true.** The *"NOT AN OPEN DOOR"* and *"ONE organisation"* paragraphs
in `setup-zitadel.sh` name the restriction as what makes them true. 0095 gets a dated line that
points here.

**Guard.** `scripts/an-organisation-a-stranger-could-found.unit.test.ts` checks three things,
and all three fail today:

- `managed.yml`'s `zitadel` environment sets the variable to `"true"`;
- in `setup-zitadel.sh`, with comment lines removed, the `api PUT /admin/v1/restrictions` line
  carries `disallowPublicOrgRegistration` set to true. The check is anchored on the call, not on
  the file, because `the-login-page-nobody-chose.unit.test.ts` found that the script's own error
  text can satisfy a file-wide match;
- a `GET /admin/v1/restrictions` follows the write, and a `die` names the setting.

### T2 — the project admits its own organisation only

**The setting.** `hasProjectCheck` on the Ownpace project. `management.proto` describes it as:
*"Before a user can be authenticated, it is verified that their affiliated organization has been
granted access to this project."*

**Who it lets in.** The project belongs to the first organisation. Upstream's
`determineResourceOwner` puts a person who registers there, or who arrives through Google,
Microsoft, GitHub or Apple, into the organisation the sign-in request names. When the request
names none, it uses the instance's default organisation. `apps/web/src/services/oidc.ts` asks
for `scope: 'openid profile email'` and names none. So testers are in the project's own
organisation and pass the check. A user of any other organisation is refused unless that
organisation holds a grant on the project, and nothing creates one.

**Not `projectRoleCheck`.** That setting needs roles at the issuer, and ADR-0042 rules those out.

**In `setup-zitadel.sh`:**

- A new project is created with `{name:$n, hasProjectCheck:true}`. Live's project is created at
  its first bring-up, so a tag that carries T2 gives it the check from the start.
- For a project that already exists, the script reads `GET /management/v1/projects/{id}`. When
  `hasProjectCheck` is not true, it sends `PUT /management/v1/projects/{id}` with the name and
  the three other fields copied from the read: `projectRoleAssertion`, `projectRoleCheck` and
  `privateLabelingSetting`. The update takes the project's settings from the body, which is the
  same trap the login-policy block documents.
- It reads the project back and stops if the check is still off.
- At the pinned tag an update that changes nothing is not refused (`ChangeProject` in upstream
  `project.go` returns without an event), unlike the login policy's "has not been changed". The
  read-back decides either way.

**ADR-0042 is untouched.** The API does not read this setting. It lives in `deploy/`, beside the
provider paths that are already there, and `no-issuer-lock-in.unit.test.ts` does not change.
Each check has its own job. `tenant_member` still decides what a signed-in person may act on.
The project check decides who can get a token for the app at all.

**Not proposed: a check in the API as well.** The API could also refuse a token from an
unexpected organisation, but it would need a claim only Zitadel issues, and so an amendment to
ADR-0042. T2 does the same job at the issuer (open question 9).

**Unverified.** The gate's smoke creates its people with `POST /v2/users/human` and names no
organisation. By our reading they land in the first organisation and pass the check. T2's PR
runs the managed gate once to see, on the OTA instance. Until then, the owner's own sign-in after
T0, on each instance, is the evidence.

**Guard.** `scripts/a-project-for-one-organisation.unit.test.ts` fails today, because the create
body is `{name:$n}`. It checks that:

- the create body carries `hasProjectCheck:true`;
- a project that already exists is updated when the check is off;
- the value is read back.

### T3 — one organisation, recorded and counted again

**Recorded.** On 2026-09-24 the owner reported that no other organisations are hosted (D1). The
question was asked before D7, about the instance then in use, so the answer covers the OTA
instance. This plan does not know how that was checked. Live's instance starts fresh, with the one
organisation its first start creates; its first count should read 1 by construction, and T3
checks that it does.

**The count anybody can repeat.** It is per instance, run from that instance's checkout (§4).
Using the token recipe from `docs/managed-bring-up.md`, send `POST /admin/v1/orgs/_search` with
`{}`. The answer's `details.totalResult` should be `1` (proto3 JSON writes that 64-bit count as
the string `"1"`, so read it with `jq -r`). When it is more than one:

1. Stop granting.
2. List the users with `POST /v2/users`. Each user names its organisation in
   `details.resourceOwner`.
3. Check whether any of those user ids appears in `tenant_member.user_id`, in the same stack's
   database. Such a row was bound through the chain in §1. It is removed, and the organisation's
   owner is told.

**When the count runs:**

- once after T0, on each instance;
- once on live, on the day of the first invitation;
- on every run of `setup-zitadel.sh`, which prints the number in its summary and warns loudly when
  there is more than one. It warns rather than refuses, because an `IAM_OWNER` may create a
  second organisation on purpose. The line gives the number only, never names, because the
  gate's log is public;
- daily on live, by 0132 T7's duties, read-only, where a count above one fails the duty.

**The OTA instance is counted too, by the gate.** 0132 T7 leaves it to this plan whether the OTA
instance is counted, and from where. The proposal: by the nightly gate, which runs
`setup-zitadel.sh` on the OTA stack every night (`e2e-managed.yml`), so the summary line above
counts it with no new job. Live's duties stay on live, as D7 keeps the two stacks apart. On the
OTA instance a count above one warns and does not fail the gate: that instance holds no tester's
grant, and the gate tests the code.

With T1 in place, only an `IAM_OWNER` can create a second organisation. In the pinned role
mappings, `org.create` is also held by `IAM_ORG_MANAGER` and `SELF_MANAGEMENT_GLOBAL`, and
nothing in this repository gives either role to anybody.

**Guard.** `scripts/one-organisation-counted.unit.test.ts` fails today. It checks that the script
searches `/admin/v1/orgs/_search`, prints the count, and has a warning that fires above one.

### T4 — second factors for the accounts that hold the keys, and a lockout

**Why these accounts.** After T1 and T2, one way is left to make an address the API trusts without
receiving mail at it: an account with `user.write` in the first organisation. (GitHub sign-in may
be a second; that is open question 10.) Three kinds of account have `user.write` there:

- the first human (`IAM_OWNER`);
- the machine user (`IAM_OWNER`);
- every operator (`ORG_OWNER`).

The first human and every operator can also open the console on the public origin. A tester's
own password matters as well, for a different reason. Whoever signs in as a tester acts as that
tester, and the product exists to copy what a person has connected to a target that person
chooses.

**T4a, the owner.** On each instance, live first.

- Enrol TOTP or a passkey on the first human and on every operator account. On live, the first
  human's first sign-in, where its generated password is changed (§1), is the moment.
- Sign in once with each, to confirm the second factor is asked. By our reading of the pinned
  login code (`mfaChecked`), a user who has enrolled a factor is asked for it once the check
  lifetime has passed, whether or not MFA is forced. The sign-in is the check of that reading.
- Read each account back with `POST /management/v1/users/{id}/auth_factors/_search`, which lists
  the factor.

The machine user cannot have a second factor. Its protection is its token's short life, kept
short by the nightly gate on the OTA instance and by 0132 T7 on live.

**T4b, the lockout.**

- **The calls.** `PUT /admin/v1/policies/password/lockout` (the path is as `admin.proto` spells
  it) with `maxPasswordAttempts` and `maxOtpAttempts`. `GET /admin/v1/policies/lockout` reads it
  back. A fresh instance gets
  `ZITADEL_DEFAULTINSTANCE_LOCKOUTPOLICY_MAXPASSWORDATTEMPTS` and `…_MAXOTPATTEMPTS`.
- **The numbers.** 10 and 5 are proposed (open question 3). The count resets after a correct
  entry. By the proto's description, a locked user *"has to be unlocked by an administrator
  afterward"*. During the alpha that means the owner, in the console.
- **The cost.** Anyone who knows a tester's login name can lock that tester out by guessing
  wrong. That is the price of stopping password guessing on a public page. For at most 20 people
  whom the owner supports, it is acceptable.
- **With it, and proposed.** `ignoreUnknownUsernames` set to true, so that the page no longer
  tells a guesser which login names exist.
- **Who it does not affect.** A person who signs in only with Google, and never set a password
  here, has no password to lock.

**T4c, forcing a second factor (open question 2).**

- **(a)** `forceMfa` together with `forceMfaLocalOnly`. Every account with a password must enrol
  a factor at its first sign-in. A sign-in through Google, Microsoft, GitHub or Apple relies on
  that provider's own factor, if the person has one there. The proto: *"only local authenticated
  users are forced to use MFA."* *Recommended*, because of what a tester's password gives away
  (above) and because the owner supports each tester (D3).
- **(b)** `forceMfa` for everyone, social sign-ins included.
- **(c)** Not forced. Every user is offered it, and may skip it for 30 days at a time (the
  instance's `mfaInitSkipLifetime`, which the script's comment records).

Today the script copies `forceMfa` from the instance, so a change made in the console survives
a bring-up. That is not converging on a described state. The script gets a `.env` setting
(working name `IDP_FORCE_MFA=off|local|all`, default `off`), writes it, and includes it in its
"already right" probe.

**Unverified.** The gate's smoke signs its people in through the session API. Whether it still
passes with MFA forced was not checked. The default of `off` leaves the OTA stack as it is; the
setting is per `.env`, so live's can differ.

**The console.** It sits on each instance's public origin. The ingress is the mesh provider's,
and it is not in this repository. Whether it can refuse `/ui/console` to anyone off the mesh, on
both names, is open question 4.

**Guard.** `scripts/a-second-factor-for-the-keys.unit.test.ts` fails today, because nothing sets
a lockout. It checks that:

- `setup-zitadel.sh` writes the lockout policy from `.env`, with both values above zero, and reads
  it back;
- `policy_is_right` compares `forceMfa` and `forceMfaLocalOnly` with `IDP_FORCE_MFA`;
- `managed.yml` passes the lockout values to a fresh instance.

### T5 — privacy and terms links on the registration and sign-in pages (→ 0139)

**The setting.** The instance privacy policy: `PUT /admin/v1/policies/privacy` with `tosLink`,
`privacyLink`, `helpLink`, `supportEmail`, `docsLink`, `customLink` and `customLinkText`, and
`GET /admin/v1/policies/privacy` to read it back.

- This plan assumes the update replaces the whole policy, as the login policy's update does. So
  the script sends all seven fields and copies back the ones it does not set.
- A fresh instance gets `ZITADEL_DEFAULTINSTANCE_PRIVACYPOLICY_*`.
- The values come from `.env`. Working names: `IDP_TOS_URL`, `IDP_PRIVACY_URL`, `IDP_HELP_URL`,
  `IDP_SUPPORT_EMAIL`. Live's `.env` carries them first, pointing at the pages 0139 publishes
  for the production names; the OTA instance's `.env` can carry the same.
- Empty means the script leaves the policy as it is, and it says that registration collects
  personal data without a notice.

**What it changes, by upstream's templates.** The footer shows each link that is set. The
registration form shows an acceptance of the terms and the privacy policy when either link is
set.

**One value per link.** Zitadel stores one value per link. Login v1 fills a `{{.Lang}}` in it with
the page's language (`setLinksOnBaseData` in upstream `renderer.go`), and the proto says so
(*"Variable {{.Lang}} can be set to have different links based on the language"*). That does not
fit the site as built: it serves English at the root (`/privacy.html`) and Dutch under `/nl/`,
and the Dutch terms page has its own name (`voorwaarden.html`). So the proposal is the Dutch
pages, because the alpha is Dutch. The site's pages carry a language switcher and `hreflang`
links to the other language.

**What it is not.** The acceptance at the identity provider is not the record 0139 keeps, which
is each tester's acceptance with the version and the time. It is the notice at the moment the
data is collected.

**When.** With 0139's publication. The legal pass comes first (D5). 0139 T4 lists these pages,
and 0139 §4 recommends them before the first invitation; 0131 T5's minimum for 0139 names only
the request page and the grant page (0139 open question 8). The privacy policy's §4.4 and §9 also
have to name what the identity provider holds: name, address, user name, a password hash, links
to social sign-ins, and sessions. That text is 0139's.

**Guard.** `scripts/a-notice-before-a-password.unit.test.ts` fails today. It checks that:

- the script writes the privacy policy with both links taken from `.env`, and reads them back;
- `managed.yml` passes them to a fresh instance.

### T6 — Dutch and English, in Ownpace's own words

**The languages (decided, D4).**

- **Allowed languages.** The same `PUT /admin/v1/restrictions` as T1, with
  `allowedLanguages: {list: ["nl","en"]}`, read back from `allowedLanguages`. `managed.yml` can
  set `ZITADEL_DEFAULTINSTANCE_RESTRICTIONS_ALLOWEDLANGUAGES` as well. How a list is written in
  that variable was not checked, so the API call is the one the script relies on.
- **The default language.** `PUT /admin/v1/languages/default/{language}`, from `.env` (working
  name `IDP_DEFAULT_LANGUAGE`), set to `nl` on live, where the testers are. The OTA instance
  follows its own `.env`. The script sets the default before
  the allowed list. At the pinned tag Zitadel refuses a list that leaves the default out
  (`Errors.Restrictions.DefaultLanguageMustBeAllowed` in upstream `restrictions.go`), and a
  default that the list does not allow (`prepareSetDefaultLanguage` in `instance.go`). With the
  default `en` and no list today, `nl` first and then `["nl","en"]` passes both checks. Setting
  the default it already has is refused as `Errors.Instance.NotChanged`, which the script
  treats as an answer, not a failure; the read-back decides.
- **Check once on live's instance** that a Dutch browser gets the Dutch page. The review left
  this unverified.

**The mails a tester gets (decided).**

- The verification mail and the password-reset mail, in `nl` and `en`, set with
  `PUT /admin/v1/text/message/verifyemail/{language}` and `…/passwordreset/{language}`.
- They name Ownpace, say that the account is for signing in to Ownpace, and say who to write to.
- The texts live in the repository, in a file under `deploy/compose/`, not only in the console.
- 0133's T1 table lists these same mails. Their wording is written here.

**The page's texts (proposed).** Only where a login text names Zitadel or reads wrongly for
somebody registering for Ownpace, with `PUT /admin/v1/text/login/{language}`. Which texts need it
was not checked. One pass through the pages on a throwaway stack decides.

**The brand (proposed).**

- **Label policy.** An instance label policy with Ownpace's colours and the watermark off:
  `PUT /admin/v1/policies/label`, then `POST /admin/v1/policies/label/_activate`.
- **Logo.** The logo from `site/brand/`, uploaded through Zitadel's assets API. That API's path
  was not checked against the pinned tag.
- **Organisation name.** Renaming the first organisation from `ZITADEL` to `Ownpace`
  (`PUT /management/v1/orgs/me`), and setting `ZITADEL_FIRSTINSTANCE_ORG_NAME` for a fresh
  instance, needs care. The organisation's generated domain comes from its name, and that domain
  is part of every login name that uses a user name, the owner's included. Whether a rename
  changes existing login names was not checked. Try it on a throwaway stack first (open question
  8). Live's instance is fresh, so it needs no rename: if the tag live is first brought up from
  passes `ZITADEL_FIRSTINSTANCE_ORG_NAME`, its organisation is `Ownpace` from the first start,
  before any login name exists. `setup-zitadel.sh` reads the owner's login name from the
  instance rather than building it from the default name, and a grep of `deploy/` finds the
  default organisation name only in that code's comment and in `managed.env.example`'s note on
  the login name. The rename question is then the OTA instance's only.

**Guard.** `scripts/a-sign-in-page-in-our-own-words.unit.test.ts` fails today. It checks that:

- the allowed languages are exactly `nl` and `en`;
- the default comes from `.env`;
- the verification and reset texts are written for both `nl` and `en`;
- the texts name Ownpace and do not name Zitadel.

### T7 — a watch on the pinned identity provider

**Now (owner).** Read the release notes of `v4.18.0`, `v4.19.0` and `v4.19.1`. Record here whether
any security fix touches login v1, the OIDC endpoints or the admin API this stack calls.

**The watch (open question 5).**

- **(a)** The owner subscribes to the `zitadel/zitadel` repository's releases and security
  advisories on GitHub.
- **(b)** A weekly job compares `managed.yml`'s pin with the newest `v4` tag, using
  `git ls-remote` as this plan did, and keeps one issue open while the two differ.
- **(c)** A weekly Trivy scan of the pinned image in `security-scan.yml`.

(a) and (b) are recommended. Letting Dependabot open PRs for the image is not: ADR-0042 keeps
upgrades deliberate, and a merge to `main` reaches the OTA instance at the next nightly gate run,
where the schema then moves one way. Under D7 the gate is not paused. It keeps proving an upgrade
on the OTA instance, and live takes the upgrade only from a tag (0132 T1g, 0146). Live runs the
pin of its tag, which can be older than `main`'s, so the watch compares `main`'s pin and 0146
says which tag live runs.

**The response window.** During the alpha, a release that fixes a security issue in something the
stack uses is applied within N days, in the owner's window, by 0119 §3's route: its own PR,
proven by the gate on the OTA instance, and then on live from a tag. Seven days is proposed, and
it counts until live runs the fix.

**Before an upgrade.** The schema moves one way, and D6 says no backups. So dump the `zitadel`
database before the upgrade, on live above all. That dump is a way back for the owner, not a
promise to testers. 0134 decides whether it becomes a rule. The runbook's recipe
(`docs/operator-runbook.md`, *Backup & restore*) covers that database since #1137, merged
2026-09-24, and says that a dump is of no use without the stack's `.env`, whose
`ZITADEL_MASTERKEY` decrypts the provider's data.

**SECURITY.md.** Since #1137, merged 2026-09-24, it names the identity provider among what
Dependabot leaves alone, so `idp-security-md-dependabot-overclaim` is fixed. T7 names the watch
that takes Dependabot's place for the identity provider.

**Guard for (b).** `scripts/a-pin-that-knows-it-is-behind.unit.test.ts` fails today, because
nothing exists. Given a stubbed tag list, the comparison reports "behind" for `v4.19.1` against
`v4.17.3`, and "current" when the two are equal. It reads the pin from `managed.yml`, not from a
copy.

### T8 — accounts nobody let in, and erasure that reaches the identity provider (→ 0139)

**The retention rule (open question 6).** An account at the identity provider is removed when it
matches all four of these:

- it has no membership;
- it has no operator row;
- no open access request carries its address;
- it is older than N days.

30 days is proposed, which is the figure the privacy policy's §9 already uses. Self-registration
stays on (0095 T0), so strangers can still register. They must verify their address to sign in,
and they reach nothing. This rule is what removes them later.

**The procedure.** A script in `deploy/compose/`, with the working name `idp-strays.sh`. It goes
there because provider paths belong there and not in shipped source: `setup-zitadel.sh` says so,
and `no-issuer-lock-in.unit.test.ts` scans only `apps/api/src`, `apps/web/src` and `packages`.
It is run from the checkout of the instance it is for, so it compares an instance's accounts with
the same stack's database; live's matter first, because testers register there. The script:

1. lists the human users with `POST /v2/users`, reading `details.creationDate` and
   `details.resourceOwner`;
2. reads the subjects in `tenant_member.user_id` and `platform_operator.user_id`, and the
   addresses on open `access_request` rows;
3. prints the accounts that match none of them and are older than N days. The machine user and
   the members of the instance and of the organisation are never listed.

`--remove` deletes the listed accounts with `DELETE /v2/users/{id}`, which the smoke already
uses, after printing them. Nothing runs on a timer.

**Erasure.** The runbook's *Tenant offboarding* gets one more step. After the purge, for each
member subject that belongs to no other organisation and is not an operator, the identity
provider's account is removed, with `idp-strays.sh --subject <sub>` or in the console. 0131 T4
(a) uses the same step when the alpha ends.

**Unverified.** Zitadel stores every change as an event. Whether removing a user also removes the
personal data in that user's earlier events was not checked. 0139 needs the answer before §9
promises erasure.

**Guard.** `scripts/an-account-nobody-let-in.unit.test.ts` runs the script with stubbed `curl`
and `psql`, and fails today because the script does not exist. It checks that:

- the script lists an account that is older than N days and matches nothing;
- it does not list a member, an operator, somebody with an open request, the machine user, the
  first human or an account that is too young;
- without `--remove`, it sends no `DELETE`.

## 4. Explaining the risk: public organisation registration, and the advice (D2)

**The risk in plain words.** Today, anyone who can load the sign-in page can found an
organisation of their own at the identity provider. That person can then create an account whose
address the provider calls verified. Ownpace trusts that claim. The account can therefore take
the place of a tester whose grant or invitation it has not yet answered (§1). On the OTA instance
one thing holds it back: the founder must confirm their own address, and that stack's mail stays
in Mailpit. Live's instance is where the testers are, and it starts with the same defaults (D7).
0133 T3 points live's mail at a relay for good reasons, and from that day nothing holds the chain
back there. Before the relay, the owner passing a stranger's verification code on by hand would
open it too (0133 T1).

**How likely it is during this alpha.** Not very. An attacker has to know a tester's address and
act between the grant and the tester's first sign-in. The owner grants every organisation (D3),
at most 20 people are in the alpha, and no request is public. The owner reports that no second
organisation exists on the OTA instance (D1), and live's starts with one.

**What closing it costs.** Two settings and two read-backs per instance, a few minutes each. On
live, only the read-backs, if the tag it is first brought up from carries T1 and T2. Neither
setting is product code. Neither changes anything for a tester: every tester registers in the
organisation that owns the project. Neither touches ADR-0042.

**The advice.**

1. **Now, on the OTA instance:** apply T1 and T2 by hand (T0, below) and read both back. Then
   sign in to `app.ota.ownpace.eu` as yourself once, to see that your own sign-in still works.
2. **Before live's first bring-up, if that can be arranged:** merge T1 and T2, so that live's
   fresh instance never serves the organisation form, creates its project with the check, and
   keeps both through every later bring-up. Run T3's count on live once it is up.
3. **Before live's first invitation, and before 0133 T3 points live's mail at the relay,
   whichever comes first:** if live came up without T1 and T2, apply them there by hand (T0).
   Either way, read both back on live, run T3's count there, and sign in to `app.ownpace.eu` as
   yourself once. Nobody is invited to live before these read-backs.
4. **In the same week:** enrol a second factor on the first human and every operator account,
   on live first and then on the OTA instance (T4a). After steps 2 and 3, those accounts are the
   only ones that can make an address the API trusts without mail reaching it (open question 10
   asks whether GitHub sign-in is another).
5. **Keep self-registration in the first organisation on** (0095 T0). It is how a granted person
   gets an account without the product creating one. Those registrants must prove their address
   by mail, which is the property the API relies on. T8 deals with the ones nobody lets in.

**T0, the calls.** Run them from the checkout of the instance they are for: `~/ownpace-live` for
live, `~/ownpace-managed` for the OTA instance. Live's `.env` sets
`COMPOSE_PROJECT_NAME=ownpace-live` (0132 T1b), so the same lines read live's token there. Set
`ISSUER` and `PROJECT` to `JWT_ISSUER` and `JWT_AUDIENCE` as they stand in that checkout's
`deploy/compose/.env`. `setup-zitadel.sh` writes `JWT_AUDIENCE` as the project's id. The token
recipe is the one `docs/managed-bring-up.md` already gives.

```bash
PAT="$(docker compose -f deploy/compose/managed.yml run --rm -T zitadel-machinekey cat /machinekey/pat.txt | tr -d '\r\n')"

# 1. Public organisation registration off, and read back (expect: true, then 404).
curl -sS -X PUT "$ISSUER/admin/v1/restrictions" -H "Authorization: Bearer $PAT" \
  -H 'Content-Type: application/json' -d '{"disallowPublicOrgRegistration":true}'
curl -sS "$ISSUER/admin/v1/restrictions" -H "Authorization: Bearer $PAT" \
  | jq '.disallowPublicOrgRegistration // false'
curl -sS -o /dev/null -w '%{http_code}\n' "$ISSUER/ui/login/register/org"

# 2. The project admits its own organisation only, and read back (expect: true).
BODY="$(curl -sS "$ISSUER/management/v1/projects/$PROJECT" -H "Authorization: Bearer $PAT" \
  | jq -c '.project | {name,
      projectRoleAssertion: (.projectRoleAssertion // false),
      projectRoleCheck: (.projectRoleCheck // false),
      privateLabelingSetting: (.privateLabelingSetting // "PRIVATE_LABELING_SETTING_UNSPECIFIED"),
      hasProjectCheck: true}')"
curl -sS -X PUT "$ISSUER/management/v1/projects/$PROJECT" -H "Authorization: Bearer $PAT" \
  -H 'Content-Type: application/json' -d "$BODY"
curl -sS "$ISSUER/management/v1/projects/$PROJECT" -H "Authorization: Bearer $PAT" \
  | jq '.project.hasProjectCheck // false'

# 3. T3: how many organisations (expect: 1).
curl -sS -X POST "$ISSUER/admin/v1/orgs/_search" -H "Authorization: Bearer $PAT" \
  -H 'Content-Type: application/json' -d '{}' | jq -r '.details.totalResult'
```

A step that prints anything other than what its comment expects means that step did not take.
Stop there and write down what it printed.

**If a write is refused.** At the pinned tag, neither write is refused for changing nothing; that
refusal (*"has not been changed"*) belongs to the login policy's update. Any other refusal is
printed by `curl`: write it down and stop. The read-back is what decides.

**Where the result goes.** The date, the instance and the three outcomes go in this plan's Status
block, one line per instance, never the token. After T0 on live, 0131 T5's row for this plan
reads "done by hand; the bring-up follows", or "in place from the first start" if live's first tag
carried T1 and T2.

## 5. Order

1. **T0** on the OTA instance, now.
2. **T1, T2 and T3 in one PR**, before live's first bring-up if that can be arranged, and in any
   case before live's first invitation and before 0133 T3.
3. **T0 on live**, before its first invitation: the read-backs and the count, and the two
   settings by hand if live came up without them.
4. **T4a, the owner's enrolment**, in the same week, live first. T4b and T4c come in the next PR,
   after open questions 2 and 3.
5. **T6's languages and mails** before the first invitation, because they are cheap and the
   testers are Dutch. The brand can follow. Whatever of T4b, T5 and T6 is merged before live's
   first bring-up reaches live's fresh instance at its first start, the organisation's name
   included.
6. **T5** with 0139's publication.
7. **T7:** read the notes now, and set up the watch before the first invitation.
8. **T8** before the alpha has run for 30 days.

## Not in this plan

- The identity provider's mail, its SMTP login and its sender: 0133.
- Standing live's identity provider up at `id.ownpace.eu`, with its own masterkey and database:
  0132 T1d.
- How the public names are reached, and the identity provider's published port: 0132 (T1e, T3).
- What a role may do inside an organisation, and who may invite whom: 0137.
- The legal texts themselves, and each tester's recorded acceptance: 0139.
- The consent screens at Google, Microsoft, Dropbox, Box and Apple: 0140.

## Open questions

1. **The advice (§4).** Apply T1 and T2 by hand on the OTA instance now, merge them before live's
   first bring-up if that can be arranged, and in any case have them in place and read back on
   live before its first invitation?
2. **Forcing a second factor (T4c).** Choose between:
   - (a) every password account, while social sign-ins rely on their own provider. This is
     recommended.
   - (b) everyone.
   - (c) not forced.
3. **The lockout (T4b).** Are 10 wrong passwords and 5 wrong codes right? And should the page stop
   saying whether a login name exists?
4. **The console on the public origin.** Can the mesh provider's ingress refuse `/ui/console` to
   anyone off the mesh, at `id.ownpace.eu` and at `id.ota.ownpace.eu`? If it can, that is worth
   doing for the alpha. If it cannot, T4 carries the risk alone.
5. **The release watch (T7).** Which of (a), (b) and (c)? And is seven days the right window for a
   security release?
6. **Accounts nobody let in (T8).** Is 30 days the retention period? 0139 then writes it into the
   privacy policy.
7. **Self-registration during the alpha.** Keep it on, which is recommended and follows 0095 T0?
   Or turn it off and create each tester's account by hand in the console? The second avoids
   stray accounts entirely. The cost is more work for the owner, and a creation mail whose
   upstream wording names Zitadel.
8. **The organisation's name (T6).** On live, name it `Ownpace` from its first start, which needs
   no rename? On the OTA instance, rename it now, after a trial on a throwaway stack, or after the
   alpha?
9. **A check in the API as well (T2).** Should the API also refuse a token from an unexpected
   organisation? That needs a Zitadel-only claim and an amendment to ADR-0042. Not recommended
   while T1 and T2 hold.
10. **GitHub sign-in.** Zitadel `v4.17.3`'s GitHub provider reports every GitHub address as
    verified: `IsEmailVerified` returns true, *"because GitHub validates emails themselves"*. The
    API trusts that claim like any other. Is GitHub sign-in offered on live, whose buttons 0140
    decides, or on the OTA stack? If it is, is that trust acceptable for binding a grant? This
    plan did not look further.
