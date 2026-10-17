// Copyright 2026 The Ownpace authors (Apache-2.0)
import React from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import {
  ArrowRightLeft,
  Building2,
  ListTodo,
  LogOut,
  Menu,
  X,
  CreditCard,
  Trash2,
  MoveRight,
  AlertTriangle,
  ClipboardCheck,
  ListChecks,
  Flag, Plug, BookOpen, DoorOpen, LifeBuoy, Link2, ArrowLeft, MessageSquareWarning, ScrollText, Mail } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { IMPLICIT_PERSON_ID } from '@openmig/shared';
import { mappingApi } from '../services/mapping-service.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { isSelfHost } from '../services/edition.ts';
import { useSignOut } from './SignOut.tsx';
import { useLocale, useOperatorT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/index.tsx';
import BuildStamp from './BuildStamp.tsx';
import LanguageSwitch from './LanguageSwitch.tsx';
import NextStepLink from './NextStepLink.tsx';
import SiteMark from './SiteMark.tsx';
import { fetchReportingAvailable } from '../services/problem-report-service.ts';
import { fetchAttention } from '../services/operating-service.ts';
import { needsYouTotal } from '../services/needs-you.ts';
import PlatformPauseBanner from './PlatformPauseBanner.tsx';
import NewVersionPrompt from './NewVersionPrompt.tsx';
import AlphaNote from './AlphaNote.tsx';
import { supportAddress } from './SupportLine.tsx';
import { useNewPageAtTheTop } from './NewPageAtTheTop.tsx';
import {
  activeNavHref,
  mappingDisplayName,
  mappingRouteContext,
  upHref,
  type MappingScreen,
} from './layout-context.ts';

/** Header titles for the per-mapping screens — the same words as the nav, or the hub's. */
const SCREEN_TITLE_KEY: Record<MappingScreen, StringKey> = {
  deletions: 'nav.deletions',
  moves: 'nav.moves',
  failures: 'nav.failures',
  verify: 'nav.check',
  finish: 'nav.finish',
  sharing: 'hub.sharing.name',
  confirmed: 'hub.confirmed.name',
  report: 'migrationReport.title',
  confirm: 'nav.review',
};

/**
 * ONE H1 A PAGE (the UX sweep, `a11y-two-h1-per-page`). Each of these managed
 * pages draws its own `<h1>` (Billing, Migrations, a person's name…), so the
 * bar's name there is a paragraph and not a second, louder copy of it. Every
 * other route keeps the bar's `<h1>`: Help's checklist and guides, whose own
 * titles are `<h2>` by design, the appliance's flat queues, which have none,
 * and a migration's screens, whose bar names the screen and the migration.
 * Before adding a route here, check that its page draws an `<h1>`.
 */
const OWN_H1_PREFIXES = [
  '/mappings',
  '/people',
  '/start',
  '/connections',
  '/decisions',
  '/tenants',
  '/billing',
  '/report',
  '/support',
  '/access-requests',
  '/redirect-uris',
] as const;

/**
 * THE CONDITION TAILWIND PUTS `lg:` BEHIND, word for word, so the script and
 * the stylesheet agree on which screen has a drawer. Not `(min-width: 1024px)`:
 * a rem in a media query follows the browser's font size, so for somebody who
 * set it larger than 16 px the two would disagree on a band of widths, and that
 * reader is who the drawer's focus handling is for. The guard asks the
 * installed Tailwind for this text (a-menu-that-gives-focus-back).
 */
const WIDE_SCREEN = '(width >= 64rem)';

/**
 * Whether the navigation is the sidebar (wide) or a drawer (narrow).
 *
 * Every browser the app supports has `matchMedia`; jsdom does not. Without it
 * the answer is "wide", which is how the layout behaved before it asked: the
 * drawer is never inert. So a test that does not care about the drawer sees
 * the layout it always saw, and nothing real can land in that branch.
 */
function subscribeWideScreen(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(WIDE_SCREEN);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const wideScreenNow = (): boolean =>
  typeof window.matchMedia !== 'function' || window.matchMedia(WIDE_SCREEN).matches;

const Layout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  /**
   * THE PHONE MENU TAKES FOCUS AND GIVES IT BACK (workplan 0145 T1).
   *
   * A closed drawer used to be only moved off screen. It comes before the page
   * in the document, so a keyboard tabbed through every link of a menu nobody
   * could see, and a screen reader swiped through it. Now, below `lg`:
   *
   * - closed, the drawer is `inert`: out of the tab order and the swipe order;
   * - open, focus moves to its close button and the page behind is `inert`;
   * - Escape, the close button and the backdrop close it, and focus goes back
   *   to the menu button. Following a link closes it as before; where focus
   *   goes on a new page is 0145 T3 (b), and a link to the page already shown
   *   gives focus back to the menu button (`followLink`).
   *
   * From `lg` up the drawer is the sidebar and none of this applies, even if
   * the window was widened with the drawer open.
   */
  const wideScreen = React.useSyncExternalStore(subscribeWideScreen, wideScreenNow);
  // Widened with the drawer open: it is the sidebar now, so it is closed, and
  // narrowing the window again does not bring it back over the page.
  if (wideScreen && sidebarOpen) setSidebarOpen(false);
  const drawerOpen = sidebarOpen && !wideScreen;
  const drawerId = React.useId();
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const giveFocusBack = React.useRef(false);
  const closeDrawer = React.useCallback(() => {
    giveFocusBack.current = true;
    setSidebarOpen(false);
  }, []);
  // After the commit, not in the handler: until React has taken `inert` off
  // the element that is to receive focus, a browser refuses to focus it.
  React.useEffect(() => {
    if (drawerOpen) {
      closeButtonRef.current?.focus();
    } else if (giveFocusBack.current) {
      giveFocusBack.current = false;
      menuButtonRef.current?.focus();
    }
  }, [drawerOpen]);
  // On the document, not the drawer: a click on the drawer's own text leaves
  // focus on the body, and Escape has to work from there too.
  React.useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, closeDrawer]);
  const location = useLocation();
  // A new page starts at the top (workplan 0145 T3 (a)): the hook says when,
  // and why it is a layout effect. `PublicDocs` calls it too (0152).
  useNewPageAtTheTop();
  // Following a link closes the drawer. To another page, focus goes to that
  // page (0145 T3 (b)). To the page already shown there is no route change and
  // nothing takes focus: the followed link goes `inert` with its drawer, and a
  // browser drops focus to the body. So it goes back to the menu button, as it
  // does on Escape. The query is ignored: it is not a route change either.
  const followLink = (to: string) => {
    if (drawerOpen && to.split('?')[0] === location.pathname) closeDrawer();
    else setSidebarOpen(false);
  };
  const routeCtx = mappingRouteContext(location.pathname);
  const selfHostEdition = isSelfHost();
  // THE MIGRATION'S NAME, for the header. The same query key the hub already
  // uses, so on the hub this is the cached answer and not a second request;
  // on a screen under it, one read that the hub then reuses. The appliance
  // is skipped — its id is a slug somebody chose, and it is the name.
  const headerMapping = useQuery({
    queryKey: ['mapping', routeCtx?.mappingId],
    queryFn: () => mappingApi.get(routeCtx!.mappingId),
    enabled: routeCtx !== null && !selfHostEdition,
    staleTime: 60_000,
  });
  const { user, operator, tenantCount } = useAuthStore();
  const token = useAuthStore((s) => s.token);
  // Whether the service takes problem reports (workplan 0130): the link is
  // offered only when a report could reach somebody.
  const reporting = useQuery({
    queryKey: ['problem-reports', 'available'],
    queryFn: fetchReportingAvailable,
    enabled: !selfHostEdition && token != null,
    staleTime: 5 * 60_000,
  });
  const reportingAvailable = reporting.data === true;
  // WHERE THE FORM IS OFF, AN ADDRESS (workplan 0144 T6 (a)). The deployment's
  // own, from the build (`SupportLine.tsx`), and null without one or on an
  // appliance. Only once the question above is answered, so the one never
  // swaps for the other; then a signed-in tester always has one of the two.
  const helpAddress = supportAddress();
  const offerHelp = helpAddress !== null && !reportingAvailable && !reporting.isLoading;

  // Out of the issuer too, not just this tab (2026-09-01): `SignOut.tsx`
  // says why, and the acceptance screen's *Not now* shares it (0139 T3).
  const signOut = useSignOut();
  const { t } = useLocale();
  const ot = useOperatorT();

  // Tenants and Billing are managed-edition concepts: the appliance is
  // single-tenant and is not billed for (ADR-0026). Hidden rather than shown
  // broken, since neither has an endpoint to talk to there.
  const selfHost = isSelfHost();

  /**
   * WHETHER THIS PERSON IS IN AN ORGANISATION AT ALL — the axis the nav did not
   * have, and the reason a platform operator could not use the product.
   *
   * An operator belongs to no organisation BY DESIGN (0093 T6/T7): `/api/me`
   * runs on `authenticateSubject` precisely so the one person who lets the
   * others in can hold a session without a tenant. The nav did not know that.
   * It offered them Dashboard, Mappings, Connections, Setup, Decisions and
   * Tenants — every one tenant-scoped — and each one's first request answered
   *
   *     403 { message: 'No active membership for this tenant' }
   *
   * which `api.ts` reads as a dead session and signs them out. Reported from
   * the OTA instance on 2026-08-31: "I see the full menu, and if I click on any
   * menu items, I switch back to login." Six dead ends and two working screens,
   * with nothing to tell them apart.
   *
   * MANAGED ONLY. The appliance has no tenancy to belong to and its screens
   * answer for the mappings it is configured with, so `selfHost` keeps its nav
   * exactly as it was — hiding it there would break the edition that never had
   * this problem.
   */
  const inOrganisation = selfHost || tenantCount > 0;
  const member = !selfHost && inOrganisation;

  /**
   * THE COUNT BESIDE *NEEDS YOU* (0153 T3 (c)): what the Migrations cards count,
   * added up, and the organisation's own decisions (`needsYouTotal`). The same
   * read, under the same key, as Migrations and the page itself, so the three
   * agree. A read that failed, or a queue it could not look in, shows `?` and
   * says it could not count: a menu with no number would read as nothing
   * waiting (hard rule 9). Nothing is shown while it loads, or at nought.
   */
  const attention = useQuery({ queryKey: ['attention'], queryFn: fetchAttention, enabled: member });
  const needsYouBadge = ((): { text: string; description: string } | undefined => {
    if (!member || attention.isPending) return undefined;
    const total = attention.isSuccess ? needsYouTotal(attention.data) : undefined;
    if (total === undefined) return { text: '?', description: t('people.needsUnknown') };
    if (total === 0) return undefined;
    return {
      text: String(total),
      description: total === 1 ? t('nav.needsYou.count.one') : t('nav.needsYou.count.many', { n: total }),
    };
  })();

  /**
   * THE MENU A MEMBER READS (0153 T3 (c), T6 (b); the owner's D7, 2026-09-28):
   * Migrations, Needs you, Accounts, Help, Team, Billing. The Dashboard went,
   * and Migrations is the landing page. *Help* is the setup checklist and the
   * setup guides, as two tabs of one entry (`HelpTabs`), so `also` lights it
   * on the guides too. The appliance and an operator in no organisation keep
   * the menus they had.
   */
  // `lang` on the operator's three entries: their names are English only
  // (operator-strings.ts), so a screen reader in a Dutch menu reads them so.
  const navigation: { name: string; href: string; icon: LucideIcon; also?: readonly string[]; lang?: 'en' }[] = [
    // The appliance's one person's page (0153 T8), first, as a member's
    // Migrations is: every migration it is configured with, and the steps
    // before switching. Its landing once every migration has started.
    ...(selfHost
      ? [{ name: t('nav.mappings'), href: `/people/${IMPLICIT_PERSON_ID}`, icon: ArrowRightLeft, also: ['/people'] }]
      : []),
    ...(member
      ? [
          // A person's page (0153 T5) is part of Migrations, so it lights it,
          // and so does Start a migration, which the Migrations page opens: it
          // said *Ownpace* in the bar and lit nothing (the UX sweep).
          { name: t('nav.mappings'), href: '/mappings', icon: ArrowRightLeft, also: ['/people', '/start'] },
          // What waits on the person, across every queue: each migration's
          // line, and the decisions that belong to no migration (T6 (b)'s
          // *Needs you*, one word where there were three).
          { name: t('nav.decisions'), href: '/decisions', icon: ListTodo },
          // Accounts are managed per tenant, so they sit beside Migrations
          // rather than inside one (workplan 0062). MANAGED ONLY, deliberately:
          // an appliance's connections come from mapping files, which are the
          // operator's source of truth — a UI editing them would either lie
          // (the file wins on restart) or rewrite a file somebody owns.
          { name: t('nav.connections'), href: '/connections', icon: Plug },
          { name: t('nav.help'), href: '/setup', icon: BookOpen, also: ['/docs'] },
          { name: t('nav.tenants'), href: '/tenants', icon: Building2 },
        ]
      : []),
    // The setup checklist is EDITION-NEUTRAL (workplan 0066): creating a Box
    // app and getting an admin to authorise it is the same work either way,
    // and the appliance answers the same routes over the same table. A
    // member reaches it through Help; the appliance keeps its own entry.
    ...(selfHost ? [{ name: t('nav.setup'), href: '/setup', icon: ListChecks }] : []),
    // Docs calls no API at all, so it is the one entry that works for anybody
    // signed in — and it stays, because a person with nowhere to go still
    // deserves somewhere to read. A member reaches it through Help.
    ...(member ? [] : [{ name: t('nav.docs'), href: '/docs', icon: BookOpen }]),
    // The §11.2 decision queues, and then the §20 gate and the end of the
    // migration — in the order the runbook's cutover sequence uses.
    //
    // Self-host only in the NAV, not in the app: the appliance answers these for
    // every configured mapping, so a top-level entry makes sense there. A
    // managed tenant reaches the same screens per-mapping — Mappings → a
    // mapping's hub (MappingDetail, 0019 T4) → its queues/check/finish —
    // because "every deletion across every migration you have" is not a page
    // anyone asked for. All five screens are per-mapping-routable in both
    // editions (Finish joined with 0019 T5).
    ...(selfHost
      ? [
          { name: t('nav.review'), href: '/confirm', icon: ClipboardCheck },
          { name: t('nav.deletions'), href: '/deletions', icon: Trash2 },
          { name: t('nav.moves'), href: '/moves', icon: MoveRight },
          { name: t('nav.failures'), href: '/failures', icon: AlertTriangle },
          { name: t('nav.check'), href: '/verify', icon: ListChecks },
          { name: t('nav.finish'), href: '/finish', icon: Flag },
          // The owner's log (0129 D5): what went wrong and what was done.
          { name: t('nav.log'), href: '/log', icon: ScrollText },
        ]
      : []),
    // The §11.1 drift decision queue (0028 T1): tenant-level in BOTH editions
    // — a new mailbox belongs to no mapping, so it cannot live under one. A
    // member has it second, above; the appliance keeps it here.
    ...(selfHost ? [{ name: t('nav.decisions'), href: '/decisions', icon: ListTodo }] : []),
    // The access queue (workplan 0093 T7). Managed only — the appliance has one
    // owner and nobody to let in — and shown only to a platform operator, who
    // is usually the single person running the deployment. Hiding it is
    // cosmetic: the routes behind it answer an empty list and a "not found" to
    // anybody else, because to the database that is what the rows are.
    ...(selfHost || !operator
      ? []
      : [{ name: ot('nav.accessRequests'), href: '/access-requests', icon: DoorOpen, lang: 'en' as const }]),
    // The support surface (workplan 0110 T4), on the same terms as the access
    // queue above: operator-only in the NAV, and cosmetically so — the screens
    // behind it answer an empty list and a "nothing here" to anybody else,
    // because that is what the views return them.
    ...(selfHost || !operator
      ? []
      : [{ name: ot('nav.support'), href: '/support', icon: LifeBuoy, lang: 'en' as const }]),
    // Every address this deployment needs registered elsewhere (2026-09-01).
    // Operator-only in the NAV on the same terms as the two above, and
    // cosmetically so: the route behind it names no customer and no secret —
    // every value is an address published to a provider and typed into a
    // browser's location bar. Hidden because it is nobody else's job, not
    // because it is a secret.
    ...(selfHost || !operator
      ? []
      : [{ name: ot('nav.redirectUris'), href: '/redirect-uris', icon: Link2, lang: 'en' as const }]),
    // Billing reads are owner/admin (owner decision 2026-08-10), so for a
    // lesser role the entry would only lead to a "not for your role"
    // sentence — hidden like the appliance hides what it cannot serve. The
    // Billing screen itself still says the sentence for a typed URL.
    ...(selfHost || !(user?.role === 'owner' || user?.role === 'admin')
      ? []
      : [{ name: t('nav.billing'), href: '/billing', icon: CreditCard }]),
  ];

  /**
   * WHAT THE BAR SAYS, once, for the bar and for the browser's tab (0145 T3
   * (b)). A screen under a migration says the screen and the migration; the
   * hub, the migration; anywhere else, the menu entry it belongs to.
   *
   * On managed the migration is called by the name it was given, and by
   * *Migration* until that is read or where it cannot be: never its UUID,
   * which is what a failed read used to put in the bar, in monospace, over two
   * lines on a phone (the UX sweep). The id stays the name's tooltip, and in
   * the hub's Details. The appliance's id is a slug somebody chose; it is the
   * name there.
   */
  const screenTitle = routeCtx?.screen ? t(SCREEN_TITLE_KEY[routeCtx.screen]) : undefined;
  const migrationName = !routeCtx
    ? undefined
    : selfHostEdition
      ? mappingDisplayName(routeCtx.mappingId, undefined)
      : headerMapping.data?.name?.trim() || t('hub.fallbackTitle');
  // Monospace only when what is shown IS the id: on the appliance.
  const showingId = selfHostEdition;
  const headerText =
    migrationName !== undefined
      ? screenTitle
        ? `${screenTitle} — ${migrationName}`
        : migrationName
      : navigation.find((n) =>
          [n.href, ...(n.also ?? [])].some((href) => location.pathname.startsWith(href)),
        )?.name || 'Ownpace';
  // The tab used to say *Ownpace - Sovereign Data Migration*, in English, on
  // every screen. `index.html` keeps that title for the moment before the app
  // has loaded.
  React.useEffect(() => {
    document.title = headerText === 'Ownpace' ? 'Ownpace' : `${headerText} — Ownpace`;
  }, [headerText]);
  const pageHasOwnH1 =
    !selfHostEdition &&
    OWN_H1_PREFIXES.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* A way past the menu (0145 T1): the sidebar comes before the page, so
          a keyboard went through every entry of it, the language switch and
          Sign out on every page. The first thing Tab reaches, seen only with
          focus. The click moves focus itself, so the address gets no `#main`
          and history no entry for it. */}
      <a
        href="#main"
        onClick={(event) => {
          const main = document.getElementById('main');
          if (!main) return;
          event.preventDefault();
          main.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-blue-700 focus:ring-2 focus:ring-blue-600"
      >
        {t('nav.skipToContent')}
      </a>
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-gray-600/75 z-20 lg:hidden"
          onClick={closeDrawer}
        />
      )}

      {/* Sidebar */}
      <aside
        id={drawerId}
        inert={!wideScreen && !drawerOpen}
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
            <Link to="/" className="flex items-center space-x-2">
              {/* The site's mark, as on the sign-in page (0152 T9). */}
              <SiteMark className="w-8 h-8" />
              <span className="text-xl font-bold text-gray-900">Ownpace</span>
            </Link>
            <button
              ref={closeButtonRef}
              onClick={closeDrawer}
              aria-label={t('common.close')}
              className="lg:hidden p-2 -mr-2 rounded-md text-gray-500 hover:text-gray-700"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Navigation. The active entry comes from activeNavHref: plain
              prefix matching went dark on per-mapping routes (0034 T3) —
              on /mappings/acme/deletions the appliance's Deletions entry
              lights up, and managed's Mappings entry stays lit. */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              const lit = activeNavHref(
                location.pathname,
                navigation.flatMap((n) => [n.href, ...(n.also ?? [])]),
              );
              const isActive = lit === item.href || (lit !== null && (item.also ?? []).includes(lit));
              // Beside the link, not in it: the link's name stays the page's
              // name, and the count is its description.
              const badge = member && item.href === '/decisions' ? needsYouBadge : undefined;
              return (
                <div key={item.href} className="relative">
                  <Link
                    to={item.href}
                    lang={item.lang}
                    onClick={() => followLink(item.href)}
                    aria-describedby={badge ? 'nav-needs-you-count' : undefined}
                    className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                      badge ? 'pr-14 ' : ''
                    }${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
                  >
                    <item.icon className="w-5 h-5 mr-3" />
                    {item.name}
                  </Link>
                  {badge && (
                    <span
                      id="nav-needs-you-count"
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex min-w-6 h-6 px-2 items-center justify-center rounded-full bg-amber-100 text-amber-900 text-xs font-semibold"
                    >
                      <span aria-hidden="true">{badge.text}</span>
                      <span className="sr-only">{badge.description}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </nav>

          {/* User section (0034 T2). The appliance has no accounts: rendering
              an avatar "U", "user@example.com" and a Sign out that clears a
              store nothing reads was fake identity chrome on a sovereignty
              product. Selfhost keeps only the language switcher. On managed
              the block renders the signed-in claims — no fallbacks: the store
              always holds real claims after login, and if it ever does not,
              an absent block is a bug made visible, not papered over. */}
          <div className="p-4 border-t border-gray-200">
            {!selfHost && user != null && (
              <div className="flex items-center mb-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-blue-700 font-semibold">
                    {user.name?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="ml-3 flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                </div>
              </div>
            )}
            {/* Language switcher (ADR-0013 / workplan 0024): text-labelled
                buttons, not an icon — WCAG 2.2 AA per SAD §23. Real on both
                editions, so it stays on both. The one the pages outside the
                layout draw, so it is a named group here too; the visible
                label is for the eye, the group's name for a screen reader. */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-gray-500" aria-hidden="true">
                {t('language.label')}:
              </span>
              <LanguageSwitch />
            </div>
            {/* "Report a problem" (workplan 0130), beside Sign out because it is
                about the session, not a screen: it carries the page the person
                is on. Offered only when the service takes reports. */}
            {!selfHost && reportingAvailable && (
              <Link
                to={`/report?from=${encodeURIComponent(location.pathname)}`}
                onClick={() => followLink('/report')}
                className="w-full flex items-center px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <MessageSquareWarning className="w-5 h-5 mr-3" />
                {t('nav.reportProblem')}
              </Link>
            )}
            {offerHelp && (
              <a
                href={`mailto:${helpAddress}`}
                className="w-full flex items-center px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Mail className="w-5 h-5 mr-3 shrink-0" />
                <span className="min-w-0 break-all">{t('help.sidebar', { address: helpAddress })}</span>
              </a>
            )}
            {!selfHost && (
              <button
                onClick={signOut}
                className="w-full flex items-center px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <LogOut className="w-5 h-5 mr-3" />
                {t('nav.signOut')}
              </button>
            )}
            {/* Last, and smallest: what build this is. See BuildStamp.tsx. */}
            <BuildStamp />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64" inert={drawerOpen}>
        {/* Top bar */}
        {/* At least h-16, and taller when a migration's long name needs a
            second line: a fixed h-16 cut the title off at the top on a 360-px
            phone (the UX sweep). */}
        <header className="sticky top-0 z-10 flex items-center min-h-16 py-2 px-4 bg-white border-b border-gray-200 lg:px-8">
          <button
            ref={menuButtonRef}
            onClick={() => setSidebarOpen(true)}
            aria-label={t('nav.menu')}
            aria-expanded={drawerOpen}
            aria-controls={drawerId}
            className="lg:hidden p-2 -ml-2 rounded-md text-gray-500 hover:text-gray-700"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1 ml-4">
            {/* "Where am I" (0034 T3): a per-mapping route names its screen
                AND its mapping — the id links back to the hub. Before this,
                the title fell back to the brand (selfhost) or said only
                "Mappings" (managed), and the id lived in body text alone. */}
            {/* text-base on a phone, so a migration's two-line title fits the
                bar; text-xl from sm up, as it was. */}
            {(() => {
              const ctx = routeCtx;
              if (ctx) {
                return (
                  <div className="flex items-center gap-3">
                    {/* UP a level, not back in history — see `upHref`. */}
                    <Link
                      to={upHref(ctx)}
                      aria-label={t('nav.back')}
                      title={t('nav.back')}
                      className="p-1 -ml-1 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                    >
                      <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                    </Link>
                    <h1 className="text-base leading-snug sm:text-xl font-semibold text-gray-900">
                      {screenTitle && <>{screenTitle} — </>}
                      {ctx.screen ? (
                        // On a screen UNDER the hub the name leads back to it.
                        <Link
                          to={`/mappings/${encodeURIComponent(ctx.mappingId)}`}
                          className={`${showingId ? 'font-mono text-base sm:text-lg ' : ''}text-blue-700 hover:underline`}
                          title={ctx.mappingId}
                        >
                          {migrationName}
                        </Link>
                      ) : (
                        // On the hub itself it is the page you are on — a link
                        // here pointed at itself, and was the click the owner
                        // made expecting to go back.
                        <span className={showingId ? 'font-mono text-base sm:text-lg' : undefined} title={ctx.mappingId}>
                          {migrationName}
                        </span>
                      )}
                    </h1>
                  </div>
                );
              }
              const className = 'text-base leading-snug sm:text-xl font-semibold text-gray-900';
              return pageHasOwnH1 ? <p className={className}>{headerText}</p> : <h1 className={className}>{headerText}</h1>;
            })()}
          </div>
        </header>

        {/* Page content */}
        {/* pb-24 on small screens: Android password managers and the on-screen
            keyboard float an overlay above the viewport bottom, which hid the
            wizard's Next button behind it with nothing left to scroll to. */}
        <main id="main" tabIndex={-1} className="p-4 pb-24 lg:p-8 lg:pb-8 focus:outline-none">
          {/* The alpha note (workplan 0131 T1), first: a standing welcome,
              not a failure, on every signed-in page, in the same amber shape as
              the hold below. Nothing unless the deployment runs the alpha, and
              never on the appliance. */}
          <AlphaNote className="mb-4" />
          {/* An operator hold, above whatever screen this is (migration
              0023). Here rather than on one page because a hold is
              platform-wide: it stops copying for every migration this person
              has, so a notice on one of them would be the same silence one
              click away. Renders nothing when nothing is held, and nothing on
              the appliance, which has no such thing. */}
          <PlatformPauseBanner />
          {/* A newer page than this one (workplan 0145): the site serves
              another build, most likely after a deploy while the tab stayed
              open. Both editions; nothing while the page is current. */}
          <NewVersionPrompt />
          <Outlet />
          {/* Under a step page of a migration, the way on to the next step. */}
          {routeCtx?.screen && <NextStepLink mappingId={routeCtx.mappingId} screen={routeCtx.screen} />}
        </main>
      </div>
    </div>
  );
};

export default Layout;
