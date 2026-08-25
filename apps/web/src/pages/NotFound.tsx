// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE SCREEN FOR AN ADDRESS THAT IS NOT A SCREEN.
 *
 * Until 2026-08-25 there was none, and the result was worse than an ugly error:
 * `https://app.ota.ownpace.eu/blabla` served a **blank white page with HTTP
 * 200**. Reported from the live test host.
 *
 * Two ordinary decisions produced it. nginx does the SPA fallback —
 * `try_files $uri $uri/ /index.html` — so any path returns `index.html` and a
 * 200, which is correct and unavoidable for a single-page app. React Router
 * then matched nothing, because `AppRoutes.tsx` had no `path="*"`, and rendered
 * nothing at all. Neither half was wrong on its own; together they answered
 * "everything is fine" and drew an empty page.
 *
 * THE STATUS CODE STAYS 200, AND THAT IS NOT A BUG HERE. The server cannot know
 * which client-side paths exist without duplicating the route table into nginx
 * — two files that must agree, which this repo has spent a week learning to
 * distrust. The honest fix is at the layer that knows: the router.
 *
 * WHAT IT SAYS MATTERS MORE THAN USUAL. This is a product that moves somebody's
 * mail, and the first thought on hitting an unexpected screen is "has something
 * of mine gone missing?" So the reassurance comes before anything else, and it
 * is a statement of fact rather than a comfort: nothing here touches a
 * migration. The joke is allowed to be dry; the reassurance is not optional.
 */

import React from 'react';
import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { useT } from '../i18n/index.tsx';

const NotFound: React.FC = () => {
  const t = useT();

  return (
    <div className="max-w-xl mx-auto text-center py-16 px-4">
      <Compass className="w-12 h-12 mx-auto mb-6 text-gray-400" aria-hidden="true" />
      <h1 className="text-2xl font-semibold mb-3">{t('notFound.heading')}</h1>
      <p className="text-gray-600 mb-8">{t('notFound.lede')}</p>
      <Link
        to="/"
        className="inline-block px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
      >
        {t('notFound.back')}
      </Link>
    </div>
  );
};

export default NotFound;
