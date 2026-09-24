// Copyright 2026 The Ownpace authors (Apache-2.0)
import React from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import {
  LayoutDashboard,
  FolderGit2,
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
  Flag, Plug, BookOpen, DoorOpen, LifeBuoy, Link2, ArrowLeft, MessageSquareWarning, ScrollText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { mappingApi } from '../services/mapping-service.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { isSelfHost } from '../services/edition.ts';
import { signOutUrl } from '../services/oidc.ts';
import { useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/index.tsx';
import { LOCALES } from '../i18n/strings.ts';
import BuildStamp from './BuildStamp.tsx';
import { fetchReportingAvailable } from '../services/problem-report-service.ts';
import PlatformPauseBanner from './PlatformPauseBanner.tsx';
import {
  activeNavHref,
  mappingDisplayName,
  mappingRouteContext,
  upHref,
  type MappingScreen,
} from './layout-context.ts';

/** Header titles for the per-mapping screens — the same words as the nav. */
const SCREEN_TITLE_KEY: Record<MappingScreen, StringKey> = {
  deletions: 'nav.deletions',
  moves: 'nav.moves',
  failures: 'nav.failures',
  verify: 'nav.check',
  finish: 'nav.finish',
};

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
   *   goes on a new page is 0145 T3 (b).
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
  const { user, logout, operator, tenantCount } = useAuthStore();
  const token = useAuthStore((s) => s.token);
  // Whether the service takes problem reports (workplan 0130): the link is
  // offered only when a report could reach somebody.
  const reportingAvailable =
    useQuery({
      queryKey: ['problem-reports', 'available'],
      queryFn: fetchReportingAvailable,
      enabled: !selfHostEdition && token != null,
      staleTime: 5 * 60_000,
    }).data === true;

  /**
   * SIGN OUT OF THE ISSUER TOO, not just of this tab (2026-09-01).
   *
   * `logout()` clears the store and `localStorage`, which ends the APP's
   * session and nothing else. The issuer's own cookie survived it, so pressing
   * "Sign in" afterwards completed the whole authorization-code round trip
   * with no prompt at all and put the same person straight back in — found by
   * the owner one press after signing out.
   *
   * On a shared or borrowed machine that is not cosmetic: "sign out" that
   * leaves the issuer signed in means the next person to press "Sign in" is in
   * your account having proved nothing.
   *
   * THE LOCAL HALF HAPPENS FIRST AND UNCONDITIONALLY. The remote leg can be
   * absent (no issuer configured — the paste-a-token door has no remote
   * session), unsupported (no `end_session_endpoint` published) or unreachable,
   * and none of those may leave somebody still signed in HERE. So the URL is
   * asked for before the state is cleared — it needs the ID token — and
   * followed after, if there is one.
   */
  const signOut = React.useCallback(() => {
    void (async () => {
      const url = await signOutUrl(token);
      logout();
      if (url) globalThis.location.assign(url);
    })();
  }, [token, logout]);
  const { locale, setLocale, t } = useLocale();

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

  const navigation = [
    ...(selfHost || !inOrganisation
      ? []
      : [
          { name: t('nav.dashboard'), href: '/dashboard', icon: LayoutDashboard },
          { name: t('nav.mappings'), href: '/mappings', icon: FolderGit2 },
          // Connections are managed per tenant, so they sit beside Mappings
          // rather than inside one (workplan 0062). MANAGED ONLY, deliberately:
          // an appliance's connections come from mapping files, which are the
          // operator's source of truth — a UI editing them would either lie
          // (the file wins on restart) or rewrite a file somebody owns.
          { name: t('nav.connections'), href: '/connections', icon: Plug },
        ]),
    // The setup checklist is EDITION-NEUTRAL (workplan 0066): creating a Box
    // app and getting an admin to authorise it is the same work either way,
    // and the appliance answers the same routes over the same table.
    // Setup reads a checklist that belongs to an organisation, so in managed it
    // travels with the group above; the appliance answers it without one.
    ...(inOrganisation ? [{ name: t('nav.setup'), href: '/setup', icon: ListChecks }] : []),
    // Docs calls no API at all, so it is the one entry that works for anybody
    // signed in — and it stays, because a person with nowhere to go still
    // deserves somewhere to read.
    { name: t('nav.docs'), href: '/docs', icon: BookOpen },
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
    // — a new mailbox belongs to no mapping, so it cannot live under one.
    ...(inOrganisation ? [{ name: t('nav.decisions'), href: '/decisions', icon: ListTodo }] : []),
    ...(selfHost || !inOrganisation
      ? []
      : [{ name: t('nav.tenants'), href: '/tenants', icon: Building2 }]),
    // The access queue (workplan 0093 T7). Managed only — the appliance has one
    // owner and nobody to let in — and shown only to a platform operator, who
    // is usually the single person running the deployment. Hiding it is
    // cosmetic: the routes behind it answer an empty list and a "not found" to
    // anybody else, because to the database that is what the rows are.
    ...(selfHost || !operator
      ? []
      : [{ name: t('nav.accessRequests'), href: '/access-requests', icon: DoorOpen }]),
    // The support surface (workplan 0110 T4), on the same terms as the access
    // queue above: operator-only in the NAV, and cosmetically so — the screens
    // behind it answer an empty list and a "nothing here" to anybody else,
    // because that is what the views return them.
    ...(selfHost || !operator
      ? []
      : [{ name: t('nav.support'), href: '/support', icon: LifeBuoy }]),
    // Every address this deployment needs registered elsewhere (2026-09-01).
    // Operator-only in the NAV on the same terms as the two above, and
    // cosmetically so: the route behind it names no customer and no secret —
    // every value is an address published to a provider and typed into a
    // browser's location bar. Hidden because it is nobody else's job, not
    // because it is a secret.
    ...(selfHost || !operator
      ? []
      : [{ name: t('nav.redirectUris'), href: '/redirect-uris', icon: Link2 }]),
    // Billing reads are owner/admin (owner decision 2026-08-10), so for a
    // lesser role the entry would only lead to a "not for your role"
    // sentence — hidden like the appliance hides what it cannot serve. The
    // Billing screen itself still says the sentence for a typed URL.
    ...(selfHost || !(user?.role === 'owner' || user?.role === 'admin')
      ? []
      : [{ name: t('nav.billing'), href: '/billing', icon: CreditCard }]),
  ];

  return (
    <div className="min-h-screen bg-gray-50">
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
              <FolderGit2 className="w-8 h-8 text-blue-600" />
              <span className="text-xl font-bold text-gray-900">Ownpace</span>
            </Link>
            <button
              ref={closeButtonRef}
              onClick={closeDrawer}
              aria-label={t('common.close')}
              className="lg:hidden text-gray-500 hover:text-gray-700"
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
              const isActive =
                activeNavHref(location.pathname, navigation.map((n) => n.href)) === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <item.icon className="w-5 h-5 mr-3" />
                  {item.name}
                </Link>
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
                editions, so it stays on both. */}
            <div className="flex items-center gap-2 mb-3" aria-label={t('language.label')}>
              <span className="text-xs text-gray-500">{t('language.label')}:</span>
              {LOCALES.map((l) => (
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  aria-pressed={locale === l}
                  className={`px-2 py-1 text-xs font-medium rounded ${
                    locale === l
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            {/* "Report a problem" (workplan 0130), beside Sign out because it is
                about the session, not a screen: it carries the page the person
                is on. Offered only when the service takes reports. */}
            {!selfHost && reportingAvailable && (
              <Link
                to={`/report?from=${encodeURIComponent(location.pathname)}`}
                onClick={() => setSidebarOpen(false)}
                className="w-full flex items-center px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <MessageSquareWarning className="w-5 h-5 mr-3" />
                {t('nav.reportProblem')}
              </Link>
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
        <header className="sticky top-0 z-10 flex items-center h-16 px-4 bg-white border-b border-gray-200 lg:px-8">
          <button
            ref={menuButtonRef}
            onClick={() => setSidebarOpen(true)}
            aria-label={t('nav.menu')}
            aria-expanded={drawerOpen}
            aria-controls={drawerId}
            className="lg:hidden text-gray-500 hover:text-gray-700"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1 ml-4">
            {/* "Where am I" (0034 T3): a per-mapping route names its screen
                AND its mapping — the id links back to the hub. Before this,
                the title fell back to the brand (selfhost) or said only
                "Mappings" (managed), and the id lived in body text alone. */}
            {(() => {
              const ctx = routeCtx;
              if (ctx) {
                const name = mappingDisplayName(ctx.mappingId, headerMapping.data?.name);
                // Monospace only when what is shown IS the id; a name the owner
                // typed is prose and reads as prose.
                const showingId = !headerMapping.data?.name?.trim();
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
                    <h1 className="text-xl font-semibold text-gray-900">
                      {ctx.screen && <>{t(SCREEN_TITLE_KEY[ctx.screen])} — </>}
                      {ctx.screen ? (
                        // On a screen UNDER the hub the name leads back to it.
                        <Link
                          to={`/mappings/${encodeURIComponent(ctx.mappingId)}`}
                          className={`${showingId ? 'font-mono text-lg ' : ''}text-blue-700 hover:underline`}
                          title={ctx.mappingId}
                        >
                          {name}
                        </Link>
                      ) : (
                        // On the hub itself it is the page you are on — a link
                        // here pointed at itself, and was the click the owner
                        // made expecting to go back.
                        <span className={showingId ? 'font-mono text-lg' : ''} title={ctx.mappingId}>
                          {name}
                        </span>
                      )}
                    </h1>
                  </div>
                );
              }
              return (
                <h1 className="text-xl font-semibold text-gray-900">
                  {navigation.find((n) => location.pathname.startsWith(n.href))?.name ||
                    'Ownpace'}
                </h1>
              );
            })()}
          </div>
        </header>

        {/* Page content */}
        {/* pb-24 on small screens: Android password managers and the on-screen
            keyboard float an overlay above the viewport bottom, which hid the
            wizard's Next button behind it with nothing left to scroll to. */}
        <main className="p-4 pb-24 lg:p-8 lg:pb-8">
          {/* An operator hold, above whatever screen this is (migration
              0023). Here rather than on one page because a hold is
              platform-wide: it stops copying for every migration this person
              has, so a notice on one of them would be the same silence one
              click away. Renders nothing when nothing is held, and nothing on
              the appliance, which has no such thing. */}
          <PlatformPauseBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
