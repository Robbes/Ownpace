// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The credential refusals, in both languages, in one place (workplan 0083).
 *
 * Twelve `throw new Error(...)` sites across seven source factories told a
 * Dutch operator, in English, which credential was missing and where to put it.
 * They are the most-read prose the server produces — they are what a person
 * meets on the first attempt at every provider — and they were the only
 * operator prose with no Dutch at all.
 *
 * ## Why here and not in the web dictionary
 *
 * Owner decision, and hard rule 5 is the reason: `apps/selfhost` surfaces these
 * same errors and **has no dictionary**. A translation kept in
 * `apps/web/src/i18n/strings.ts` would make the appliance permanently
 * English-only for the sentences its owner most needs — the editions would
 * differ on the thing they are least allowed to differ on.
 *
 * So this is the class-4 pattern from `docs/i18n-prose-boundary.md`, the one
 * `APPLY_FLAG_WARNING_NL` set: **the Dutch lives BESIDE its English source, in
 * the same file, updated together or neither.**
 *
 * ## What is translated and what is not
 *
 * "Translate the frame, never the finding." The frame is the explanation — why
 * this credential is needed, which flow it belongs to, which document walks
 * through obtaining it. The **finding is the field name**, and it renders
 * verbatim in both languages, because it is the literal thing the operator
 * must go and set: an env var like `OAUTH2_CLIENT_ID` on the appliance, or a
 * stored-credential key like `clientId` in managed. Translating `clientId` to
 * *client-ID* would produce a sentence naming a field that does not exist —
 * which is exactly the defect 0071 T2 fixed in the other direction.
 *
 * ## Why an error subclass rather than a translated string
 *
 * A thrown `Error` carries one message, and the factory that throws it has no
 * idea who will read it — a log on the Spark, a probe result on a phone in
 * Dutch, an API response. Picking a language at throw time would mean plumbing
 * a locale into every factory and still getting it wrong for the second reader.
 *
 * Instead `message` stays exactly the English it always was — so every log
 * line, every existing test and every caller that only knows about `Error` is
 * unchanged — and the structured pair rides along on the error for the readers
 * that can use it.
 */

/** The two languages this product is authored in (ADR-0013). */
export type RefusalLocale = 'en' | 'nl';

/**
 * One refusal, in both languages, plus the fields it names.
 *
 * `fields` is separate from the sentences on purpose: 0071 T2 established that
 * a client should be able to resolve a storage key to the label its own input
 * carries, rather than showing the operator a database column. The sentence is
 * the frame; this is the finding.
 */
export interface BilingualRefusal {
  /** Stable handle, safe to switch on and safe to grep for in a log. */
  readonly code: string;
  /** The credential names, exactly as the operator must set them. Never translated. */
  readonly fields: readonly string[];
  readonly en: string;
  readonly nl: string;
}

/** Pick a language out of a refusal. */
export function refusalText(refusal: BilingualRefusal, locale: RefusalLocale): string {
  return locale === 'nl' ? refusal.nl : refusal.en;
}

/**
 * A build-time credential refusal that knows both languages.
 *
 * `message` is the English, so nothing that treats this as a plain `Error`
 * behaves differently than before.
 */
export class CredentialRefusalError extends Error {
  readonly refusal: BilingualRefusal;

  constructor(refusal: BilingualRefusal) {
    super(refusal.en);
    this.name = 'CredentialRefusalError';
    this.refusal = refusal;
    // Without this, `instanceof` fails when the class is extended across a
    // transpiled boundary — and the whole point is that a reader can ask.
    Object.setPrototypeOf(this, CredentialRefusalError.prototype);
  }
}

/** True for an error carrying a bilingual refusal, whoever threw it. */
export function isCredentialRefusal(error: unknown): error is CredentialRefusalError {
  return error instanceof CredentialRefusalError;
}

/**
 * Where a credential belongs, in Dutch — one per edition, not one per provider.
 *
 * Seven factories name the same two places. Written once here so that changing
 * how the appliance describes its own environment is one edit, not seven, and
 * so the five naming tables cannot drift into five slightly different Dutch
 * sentences for the same thing.
 */
export const CREDENTIAL_STORE_NL = {
  /** Self-host: environment variables on the appliance. */
  appliance: 'de omgeving van het apparaat',
  /** Managed: credentials stored against the connection. */
  managed: 'de opgeslagen gegevens van de bronverbinding',
} as const;

/** `a, b and c` / `a, b en c` — the only grammar the lists below need. */
function list(items: readonly string[], and: string): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Shape A — a provider's credentials are not set
// ---------------------------------------------------------------------------

export interface MissingCredentialsInput {
  /** The provider as the log and the operator both name it, e.g. `dropbox source`. */
  readonly subject: string;
  /** The missing field names, already in the asking edition's vocabulary. */
  readonly missing: readonly string[];
  /**
   * Everything after the lead sentence — why these credentials, which flow,
   * which document, and any read-only reassurance.
   *
   * Free-form rather than assembled from parts, after a first attempt that
   * composed `because` + `where` + `doc` + `readOnly`: the seven providers do
   * not share a tail. Drive ends on a read-only note with no document; Box
   * carries a one-time admin step nobody else has. Forcing them into one
   * template either reworded five English sentences that are already correct,
   * or grew an option per provider until the template was the union of them.
   *
   * What IS shared is the lead — the subject, the field list and the
   * is/are agreement — and that is what this function still owns.
   */
  readonly detailEn: string;
  readonly detailNl: string;
}

export function missingCredentials(input: MissingCredentialsInput): CredentialRefusalError {
  const names = [...input.missing];
  const isOne = names.length === 1;
  return new CredentialRefusalError({
    code: 'credentials_missing',
    fields: names,
    // English kept byte-identical to what these factories always threw, so
    // every log line and every test that pins it is untouched.
    en: `${input.subject}: ${names.join(', ')} ${isOne ? 'is' : 'are'} not set. ${input.detailEn}`,
    nl: `${input.subject}: ${list(names, 'en')} ${isOne ? 'is' : 'zijn'} niet ingesteld. ${input.detailNl}`,
  });
}

// ---------------------------------------------------------------------------
// Shape B — the account address is missing
// ---------------------------------------------------------------------------

export function missingAccountAddress(
  subject: string,
  whyEn: string,
  whyNl: string,
): CredentialRefusalError {
  return new CredentialRefusalError({
    code: 'account_address_missing',
    // `user` is the config key, so it is the finding — verbatim in both.
    fields: ['user'],
    en: `${subject} is missing the account address (\`user\`): ${whyEn}`,
    nl: `${subject}: het accountadres (\`user\`) ontbreekt — ${whyNl}`,
  });
}

// ---------------------------------------------------------------------------
// Shape C — a delegated token cannot read somebody else's mailbox
// ---------------------------------------------------------------------------

export interface DelegatedFlowConflictInput {
  readonly subject: string;
  readonly mailbox: string;
  /** The refresh-token field name in the asking edition's vocabulary. */
  readonly refreshTokenField: string;
  readonly clientSecretField: string;
  readonly store: string;
}

export function delegatedFlowCannotReadMailbox(
  input: DelegatedFlowConflictInput,
): CredentialRefusalError {
  return new CredentialRefusalError({
    code: 'delegated_flow_conflict',
    fields: [input.refreshTokenField, input.clientSecretField],
    en:
      `${input.subject}: mailbox "${input.mailbox}" names another user's ${input.store}, which ` +
      'requires application permissions (the client-credentials flow), but ' +
      `${input.refreshTokenField} is set — that is the DELEGATED flow and can only read the ` +
      `signed-in user (/me). Unset ${input.refreshTokenField} and set ${input.clientSecretField}, ` +
      'having granted admin consent — see docs/o365-application-access.md — or remove the ' +
      'mailbox to read /me.',
    nl:
      `${input.subject}: postbus "${input.mailbox}" verwijst naar de ${input.store} van een ` +
      'andere gebruiker. Daarvoor zijn toepassingsmachtigingen nodig (de client-credentials-' +
      `stroom), maar ${input.refreshTokenField} is ingesteld — dat is de GEDELEGEERDE stroom, ` +
      'die alleen de aangemelde gebruiker kan lezen (/me). Verwijder ' +
      `${input.refreshTokenField} en stel ${input.clientSecretField} in, nadat een beheerder ` +
      'toestemming heeft gegeven — zie docs/o365-application-access.md — of haal de postbus ' +
      'weg om /me te lezen.',
  });
}

// ---------------------------------------------------------------------------
// Shape D — the Entra app itself is not configured
// ---------------------------------------------------------------------------

export function entraClientIdMissing(subject: string, field: string): CredentialRefusalError {
  return new CredentialRefusalError({
    code: 'entra_client_id_missing',
    fields: [field],
    en: `${subject}: ${field} is not set (the Entra app registration id).`,
    nl: `${subject}: ${field} is niet ingesteld (het registratie-id van de Entra-app).`,
  });
}

export function entraFlowNotChosen(
  subject: string,
  clientSecretField: string,
  refreshTokenField: string,
): CredentialRefusalError {
  return new CredentialRefusalError({
    code: 'entra_flow_not_chosen',
    fields: [clientSecretField, refreshTokenField],
    en:
      `${subject}: set ${clientSecretField} (client-credentials flow) or ` +
      `${refreshTokenField} (delegated flow).`,
    nl:
      `${subject}: stel ${clientSecretField} in (client-credentials-stroom) of ` +
      `${refreshTokenField} (gedelegeerde stroom).`,
  });
}

// ---------------------------------------------------------------------------
// Shape D — a credential the PROVIDER rejected, where we know what they mean
// ---------------------------------------------------------------------------

/**
 * The refusal Apple gives, said in words that name the fix (workplan 0115 T5).
 *
 * Every Apple Account has two-factor authentication, and a two-factor
 * account's OWN password is refused by IMAP, CalDAV and CardDAV **by design**.
 * So the single most likely first attempt — typing the password you sign in to
 * Apple with — fails, and what came back was Apple's own opaque wording:
 * `AUTHENTICATIONFAILED`, or a bare `401`. Rendered verbatim, per 0080's
 * render-the-provider's-words rule, it tells a person their password is wrong.
 * It is not wrong. It is the wrong KIND of password, and no amount of retyping
 * it will help.
 *
 * This is the exception 0083's rule already anticipated: the sentence a person
 * needs here is OURS, not Apple's, because we know something Apple's error
 * does not say. It returns a `BilingualRefusal` so the existing
 * `credentialsRefused` path renders it in Dutch on a Dutch screen — no new
 * plumbing, and the appliance gets it too.
 *
 * NARROW ON PURPOSE. Only for `apple`, and only for messages that actually
 * look like an authentication rejection — a timeout, a DNS failure or a 500
 * must keep Apple's own words, because for those the provider's text is the
 * more useful sentence and guessing would be worse than silence.
 */
export function appleAuthRefusal(kind: string, message: string): BilingualRefusal | undefined {
  if (kind !== 'apple') return undefined;
  const looksLikeAuth =
    /authenticationfailed|invalid credentials|login failed|authentication failed|\b401\b|unauthori[sz]ed/i.test(
      message,
    );
  if (!looksLikeAuth) return undefined;
  return {
    code: 'appleAppPasswordRequired',
    fields: ['password'],
    en:
      'Apple refused these credentials. If you typed the password you use to sign in to Apple, ' +
      'that is why: every Apple Account has two-factor authentication, and Apple refuses the ' +
      'account password over IMAP, CalDAV and CardDAV by design. Make an app-specific password ' +
      'at account.apple.com \u2192 Sign-In and Security \u2192 App-Specific Passwords, and paste that ' +
      'instead. Keep the dashes Apple shows. If you already used an app-specific password, check ' +
      'it has not been revoked, and that the Apple ID above is the address the account signs in ' +
      'with.',
    nl:
      'Apple heeft deze gegevens geweigerd. Als u het wachtwoord hebt getypt waarmee u bij Apple ' +
      'inlogt, is dat de reden: elk Apple Account heeft tweefactorauthenticatie, en Apple weigert ' +
      'het accountwachtwoord bij IMAP, CalDAV en CardDAV met opzet. Maak een app-specifiek ' +
      'wachtwoord aan op account.apple.com \u2192 Inloggen en beveiliging \u2192 App-specifieke ' +
      'wachtwoorden, en plak dat in plaats daarvan. Laat de streepjes staan die Apple toont. Als ' +
      'u al een app-specifiek wachtwoord gebruikte: controleer of het niet is ingetrokken, en of ' +
      'de Apple ID hierboven het adres is waarmee het account inlogt.',
  };
}
