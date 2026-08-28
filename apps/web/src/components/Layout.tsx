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
  Flag, Plug, BookOpen, DoorOpen, LifeBuoy } from 'lucide-react';
import { useAuthStore } from '../stores/auth-store.ts';
import { isSelfHost } from '../services/edition.ts';
import { useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/index.tsx';
import { LOCALES } from '../i18n/strings.ts';
import BuildStamp from './BuildStamp.tsx';
import {
  activeNavHref,
  mappingRouteContext,
  truncateMiddle,
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

const Layout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const location = useLocation();
  const { user, logout, operator } = useAuthStore();
  const { locale, setLocale, t } = useLocale();

  // Tenants and Billing are managed-edition concepts: the appliance is
  // single-tenant and is not billed for (ADR-0026). Hidden rather than shown
  // broken, since neither has an endpoint to talk to there.
  const selfHost = isSelfHost();

  const navigation = [
    ...(selfHost
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
    { name: t('nav.setup'), href: '/setup', icon: ListChecks },
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
        ]
      : []),
    // The §11.1 drift decision queue (0028 T1): tenant-level in BOTH editions
    // — a new mailbox belongs to no mapping, so it cannot live under one.
    { name: t('nav.decisions'), href: '/decisions', icon: ListTodo },
    ...(selfHost ? [] : [{ name: t('nav.tenants'), href: '/tenants', icon: Building2 }]),
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
          className="fixed inset-0 bg-gray-600 bg-opacity-75 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
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
              onClick={() => setSidebarOpen(false)}
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
            {!selfHost && (
              <button
                onClick={logout}
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
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center h-16 px-4 bg-white border-b border-gray-200 lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
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
              const ctx = mappingRouteContext(location.pathname);
              if (ctx) {
                return (
                  <h1 className="text-xl font-semibold text-gray-900">
                    {ctx.screen && <>{t(SCREEN_TITLE_KEY[ctx.screen])} — </>}
                    <Link
                      to={`/mappings/${encodeURIComponent(ctx.mappingId)}`}
                      className="font-mono text-lg text-blue-700 hover:underline"
                      title={ctx.mappingId}
                    >
                      {truncateMiddle(ctx.mappingId)}
                    </Link>
                  </h1>
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
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
