// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A REFUSAL LINKS ITS GUIDE, IN THE READER'S LANGUAGE (workplan 0148 T7).
 *
 * The create route puts a guide handle on each issue whose words used to name
 * a `docs/….md` file (`params.guide`), and a probe's refusal carries one too
 * (`guide`). This draws the link: the frame is ours, *Guide:* / *Handleiding:*,
 * and the title is the guide's own first heading in the reader's language,
 * read from the same files `/docs` serves. A handle nobody can resolve draws
 * nothing, never a link to nowhere.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { LocaleProvider } from '../i18n/index.tsx';
import { GuideLink, GuideLinks } from './GuideLink.tsx';
import { serverGuides, serverMessage } from '../services/api.ts';

const GUIDES = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'guides');

/** A guide's title as its file writes it: the first line, `# …`. */
function titleOf(locale: 'en' | 'nl', slug: string): string {
  return readFileSync(join(GUIDES, locale, `${slug}.md`), 'utf8').split('\n')[0]!.replace(/^#\s+/, '');
}

function inLocale(locale: 'en' | 'nl', ui: React.ReactNode) {
  window.localStorage.setItem('ownpace.locale', locale);
  return render(
    <MemoryRouter>
      <LocaleProvider>{ui}</LocaleProvider>
    </MemoryRouter>,
  );
}

/** The answer the create route gives a Box migration with no user id. */
function createRefusal(): AxiosError {
  const data = {
    error: 'Validation error',
    message:
      'Reusing a Box connection still needs the NUMERIC Box user id of the account this migration ' +
      'moves (userId): the connection says which Box app signs in, not whose files to read.',
    details: [
      {
        code: 'custom',
        path: ['sourceConfig', 'userId'],
        message: 'Reusing a Box connection still needs the NUMERIC Box user id …',
        params: { guide: 'box#user-id' },
      },
    ],
  };
  return new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem('ownpace.locale');
});

describe('a refusal with a guide handle links the guide, in both languages', () => {
  it('reads the handles off the create route’s issues, and keeps the words as they came', () => {
    const err = createRefusal();
    expect(serverGuides(err)).toEqual(['box#user-id']);
    expect(serverMessage(err)).not.toMatch(/docs\/[\w./-]+\.md/);
  });

  it('says Guide: and the English title, linking the section', () => {
    inLocale('en', <GuideLinks handles={serverGuides(createRefusal())} />);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent(`Guide: ${titleOf('en', 'box')}`);
    expect(link).toHaveAttribute('href', '/docs/box#user-id');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('says Handleiding: and the Dutch title, linking the same section', () => {
    inLocale('nl', <GuideLinks handles={serverGuides(createRefusal())} />);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent(`Handleiding: ${titleOf('nl', 'box')}`);
    expect(link).toHaveAttribute('href', '/docs/box#user-id');
    // The two titles differ: the Dutch is the Dutch guide's, not a copy.
    expect(titleOf('nl', 'box')).not.toBe(titleOf('en', 'box'));
  });

  it('links a probe refusal’s guide the same way', () => {
    const probe = { ok: false, reason: 'box source: userId is not set. …', guide: 'box#connect' };
    inLocale('nl', <GuideLink handle={probe.guide} />);
    expect(screen.getByRole('link')).toHaveTextContent(`Handleiding: ${titleOf('nl', 'box')}`);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/docs/box#connect');
  });

  it.each(['en', 'nl'] as const)('%s: says the guide opens in a new tab, to a screen reader (UX sweep)', (locale) => {
    inLocale(locale, <GuideLink handle="box#connect" />);
    const link = screen.getByRole('link');
    const frame = locale === 'en' ? 'Guide' : 'Handleiding';
    const said = locale === 'en' ? '(opens in a new tab)' : '(opent in een nieuw tabblad)';
    const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The space before the words is the sr-only span's own; jsdom's name drops it.
    const name = `^${escaped(`${frame}: ${titleOf(locale, 'box')}`)}\\s*${escaped(said)}$`;
    expect(link).toHaveAccessibleName(new RegExp(name));
    expect(link.querySelector('.sr-only')?.textContent).toBe(` ${said}`);
  });

  it('draws nothing for a handle that names no served guide, or none at all', () => {
    inLocale('en', <GuideLinks handles={['nowhere#connect', 'box', undefined]} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
