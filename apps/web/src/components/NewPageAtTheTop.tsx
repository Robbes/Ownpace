// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A NEW PAGE STARTS AT THE TOP (workplan 0145 T3 (a)).
 *
 * `BrowserRouter` neither resets nor restores the scroll, so a page opened
 * from further down a list opened part of the way down. Now a new path is
 * sent to the top, at once, before it is painted. Two cases keep their
 * scroll:
 *
 * - Back and Forward (`POP`, which is also the first load): the scroll is
 *   left to the browser's own restoration, which is what a person expects;
 * - a new query or a new `#section` on the same path: not a new page, as
 *   `Layout`'s `followLink` treats it. Keyed on the path alone for that reason.
 *
 * An address that names a section on a new path goes to the top as well.
 * The page with the section scrolls to it afterwards (`GuideArticle`, for
 * `/docs/<guide>#<section>`), in a passive effect, and React runs this
 * layout effect before any passive one of the same commit. So the reader
 * lands on the section, and on the top where the section is missing, not
 * at the old page's offset. That order is why this is a layout effect.
 *
 * Focus is left where it is: on a new page it is 0145 T3 (b)'s, and the
 * drawer's is T1's (`Layout`).
 *
 * Called by every frame a page is drawn in: `Layout`, and `PublicDocs`, where
 * a visitor without a session reads the guides (workplan 0152, 2026-10-04),
 * and a link from one guide to another is followed as often as inside the app.
 */
import React from 'react';
import { useLocation, useNavigationType } from 'react-router';

export function useNewPageAtTheTop(): void {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  React.useLayoutEffect(() => {
    if (navigationType === 'POP') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]); // the path alone: a new query or hash on the same path is not a new page
}
