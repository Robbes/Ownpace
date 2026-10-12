// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A REFUSAL LINKS ITS GUIDE (workplan 0148 T7).
 *
 * A refusal's words are the server's, in English as written (the i18n prose
 * boundary), and they name no file. Beside them it may carry a guide handle,
 * such as `dropbox#own-app`: on the create route's issues, on a credential
 * refusal's pair, on a probe's refusal, on a scope-manifest row. This draws it
 * as *Guide: {title}* / *Handleiding: {title}*: the frame in the reader's
 * language (class 2), the guide's own title in the language the guide page
 * would open in, and a link to that section of `/docs`.
 *
 * In a new tab, as the account form's guide link is: a guide is read with the
 * refused form still open beside it. A handle this build cannot resolve draws
 * nothing rather than a link to nowhere; the sources' handles are held to the
 * served guides by `scripts/a-refusal-that-links-its-guide.unit.test.ts`.
 */
import React from 'react';
import { Link } from 'react-router';
import { guideHandleParts } from '@openmig/shared';
import { useLocale } from '../i18n/index.tsx';
import { servedGuideTitle } from '../pages/Docs.tsx';

export const GuideLink: React.FC<{ handle: unknown; className?: string }> = ({ handle, className }) => {
  const { t, locale } = useLocale();
  const parts = guideHandleParts(handle);
  const title = parts === undefined ? undefined : servedGuideTitle(parts.guide, locale);
  if (parts === undefined || title === undefined) return null;
  return (
    <Link
      to={`/docs/${parts.guide}#${parts.section}`}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'block mt-1 text-sm text-blue-700 hover:underline'}
    >
      {t('setup.refusalGuide', { title })}
    </Link>
  );
};

/** Each distinct handle once, in the order the refusal carried them. */
export const GuideLinks: React.FC<{ handles: ReadonlyArray<unknown> | undefined; className?: string }> = ({
  handles,
  className,
}) => (
  <>
    {[...new Set(handles ?? [])].map((handle) => (
      <GuideLink key={String(handle)} handle={handle} {...(className === undefined ? {} : { className })} />
    ))}
  </>
);
