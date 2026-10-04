// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE GUIDES, FOR A VISITOR WITHOUT AN ACCOUNT (workplan 0152; the owner,
 * 2026-10-04: *"Guide links on the Leaving pages: yes, make public"*).
 *
 * The site's *Leaving …* pages link a guide section for each limit they name,
 * such as `/docs/google#gmail` (0152 T5 (a)). The guides were signed-in pages,
 * so a visitor without an account was sent to the sign-in page instead, and
 * the link had to say *sign in first*. Now `/docs` and `/docs/<guide>` answer
 * everybody on managed: inside `Layout` for a session, as before, and here
 * for anybody else (`GuidesForEverybody` in `AppRoutes.tsx` chooses, on
 * `useSignedIn`). The guide is the same page, `Docs`, through the route's
 * `<Outlet />`, and it asks the API nothing without a session (`Docs.tsx`
 * says why).
 *
 * THE FRONT DOOR'S LOOK (0152 T9), as `/login` and `/request-access` draw it:
 * the way back to the site, the site's mark, and its teal for the links this
 * page adds. The guide inside keeps the app's colours, as every page beyond
 * those two does until 0153 reviews the palette (T9 (b)).
 *
 * WHAT THE SIDEBAR WOULD HAVE CARRIED, since this is outside `Layout`:
 *
 * - the language switch, because a guide is read in a language, and a
 *   visitor from the Dutch site may have a browser set to English
 *   (`LanguageSwitch`, the pages outside `Layout` since 0145 T6). The site's
 *   links carry the page's language as `?locale=`, so that visitor does not
 *   need it: taken once, on arrival, as `RequestAccess` takes it;
 * - the way in, for a visitor who has an account after all, in the request
 *   page's words;
 * - a person to write to (0144 T6 (a)) and the build stamp
 *   (`scripts/a-version-you-can-see-before-you-sign-in.unit.test.ts`);
 * - a new page starts at the top, as it does in `Layout` (0145 T3 (a)).
 *
 * NOT the alpha note: which line a visitor who was not invited reads during
 * the Alpha is the owner's open question 5 (0152).
 *
 * The appliance never comes here: it has nobody to sign in, so `useSignedIn`
 * is always true there and its guides stay in its layout.
 */
import React from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';
import { useLocale, useT } from '../i18n/index.tsx';
import { LOCALES, type Locale } from '../i18n/strings.ts';
import BackToSite from '../components/BackToSite.tsx';
import SiteMark from '../components/SiteMark.tsx';
import LanguageSwitch from '../components/LanguageSwitch.tsx';
import SupportLine from '../components/SupportLine.tsx';
import BuildStamp from '../components/BuildStamp.tsx';
import { useNewPageAtTheTop } from '../components/NewPageAtTheTop.tsx';

const PublicDocs: React.FC = () => {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [search] = useSearchParams();
  useNewPageAtTheTop();
  /**
   * `?locale=` rides on the guide links of the site's Leaving pages
   * (`site/build.mjs`), so a reader of the Dutch page reads the Dutch guide.
   * Matched against the list, as `RequestAccess` matches it: an unknown value
   * is ignored. Once, on arrival, and before the first paint, so the guide is
   * not drawn in the other language first; the article scrolls to its section
   * again when its text changes (`GuideArticle`).
   */
  React.useLayoutEffect(() => {
    const asked = search.get('locale');
    const known = LOCALES.find((l): l is Locale => l === asked);
    if (known && known !== locale) setLocale(known);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* The guide below is padded `p-6`; the frame lines up with its text. */}
        <header className="px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <BackToSite />
            <LanguageSwitch />
          </div>
          <div className="mt-6 flex items-center gap-3">
            <SiteMark className="w-10 h-10 shrink-0" />
            {/* The screen's name, as `Layout`'s header gives it to somebody
                whose menu names the guides; a guide's own `#` is an `<h2>`. */}
            <h1 className="text-2xl font-extrabold text-gray-900">{t('nav.docs')}</h1>
          </div>
        </header>

        <main>
          <Outlet />
        </main>

        <div className="px-6 mt-8 text-center space-y-2">
          <p>
            <Link to="/login" className="text-sm text-site-teal hover:underline">
              {t('access.backToSignIn')}
            </Link>
          </p>
          <SupportLine />
          <BuildStamp />
        </div>
      </div>
    </div>
  );
};

export default PublicDocs;
