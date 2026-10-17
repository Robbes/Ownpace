// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MIGRATION'S LINK SAYS ITS NAME (the UX sweep, `queues-uuid-heading`).
 *
 * Every queue card, Check, Confirmed, Finish and Review headed its migration
 * with `MappingHubLink`, which printed the id. On the appliance the id is a
 * slug somebody chose (`acme-mail`) and reads as a name; on managed it is a
 * UUID, so a person saw `a0000000-0000-4000-8000-0000000000d4` in bold above
 * every card, wrapped over two lines on a phone. The bar above already said
 * the name (`mappingDisplayName`). The link now reads the same answer, under
 * the same query key, and shows what the bar shows while it waits.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { editionFlag, mappingGet } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  mappingGet: vi.fn((): Promise<unknown> => new Promise<never>(() => {})),
}));

vi.mock('../services/edition', () => ({ isSelfHost: () => editionFlag.selfhost }));
vi.mock('../services/mapping-service', () => ({ mappingApi: { get: mappingGet } }));

import MappingHubLink from './MappingHubLink.tsx';
import { truncateMiddle } from './layout-context.ts';

const UUID = 'a0000000-0000-4000-8000-0000000000d4';

const renderLink = (mappingId: string, withCache = true) => {
  const link = (
    <MemoryRouter>
      <MappingHubLink mappingId={mappingId} />
    </MemoryRouter>
  );
  return render(
    withCache ? (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {link}
      </QueryClientProvider>
    ) : (
      link
    ),
  );
};

beforeEach(() => {
  editionFlag.selfhost = false;
  mappingGet.mockReset();
  mappingGet.mockImplementation(() => new Promise<never>(() => {}));
});

describe('MappingHubLink', () => {
  it('managed: says the name the migration was given, keeps the id as a tooltip, and leads to its page', async () => {
    mappingGet.mockResolvedValue({ name: 'Pieter — Microsoft 365 naar Nextcloud' });
    renderLink(UUID);

    const link = await screen.findByRole('link', { name: 'Pieter — Microsoft 365 naar Nextcloud' });
    expect(link).toHaveAttribute('href', `/mappings/${UUID}`);
    expect(link).toHaveAttribute('title', UUID);
    // A name somebody typed is prose, not code.
    expect(link.className).not.toContain('font-mono');
    expect(mappingGet).toHaveBeenCalledWith(UUID);
  });

  it('managed: while the name is on its way, says what the bar says, never the whole UUID', () => {
    renderLink(UUID);
    const link = screen.getByRole('link');
    expect(link.textContent).toBe(truncateMiddle(UUID));
    expect(link.textContent).not.toBe(UUID);
    expect(link.className).toContain('font-mono');
  });

  it('on the appliance the slug is the name, and nothing is asked', () => {
    editionFlag.selfhost = true;
    renderLink('acme-mail');
    expect(screen.getByRole('link', { name: 'acme-mail' })).toHaveAttribute('href', '/mappings/acme-mail');
    expect(mappingGet).not.toHaveBeenCalled();
  });

  it('drawn without the app’s query cache, still links the migration by its id', () => {
    renderLink('mapping-1', false);
    expect(screen.getByRole('link', { name: 'mapping-1' })).toHaveAttribute('href', '/mappings/mapping-1');
    expect(mappingGet).not.toHaveBeenCalled();
  });
});
