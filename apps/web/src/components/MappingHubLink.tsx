// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A mapping id that goes somewhere (0034 T1).
 *
 * The runs panel and the live-progress strip live on the per-mapping hub
 * (`/mappings/:id`) — built BECAUSE a Windows operator spent a weekend in
 * log tails — but the appliance printed mapping ids as inert `<h3>` text
 * everywhere, so the hub was reachable only by typing its URL. Every screen
 * that names a mapping now links it here. Real in BOTH editions: the hub
 * route is shared, so this needs no edition fork (hard rule 5).
 *
 * IT SAYS THE MIGRATION'S NAME, AS THE BAR ABOVE DOES (the UX sweep). On the
 * appliance the id is a slug somebody chose and reads as a name. On managed it
 * is a UUID, and every queue card, Check, Confirmed, Finish and Review was
 * headed `a0000000-0000-4000-8000-0000000000d4` in bold, over two lines on a
 * phone. The name comes from the same read, under the same key, as the bar's
 * (`Layout`), so it is the cached answer and not a second request; until it
 * arrives, and where it cannot, the link shows exactly what the bar shows
 * (`mappingDisplayName`), and the full id is its tooltip.
 */
import React from 'react';
import { Link } from 'react-router';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { mappingApi } from '../services/mapping-service.ts';
import { isSelfHost } from '../services/edition.ts';
import { mappingDisplayName } from './layout-context.ts';

const HubLink: React.FC<{ mappingId: string; name: string | undefined }> = ({ mappingId, name }) => (
  <Link
    to={`/mappings/${encodeURIComponent(mappingId)}`}
    title={mappingId}
    // Monospace only when what is shown IS the id, as in the bar.
    className={`${name?.trim() ? '' : 'font-mono '}break-words text-gray-900 hover:text-blue-700 hover:underline`}
  >
    {mappingDisplayName(mappingId, name)}
  </Link>
);

const NamedHubLink: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  const { data } = useQuery({
    queryKey: ['mapping', mappingId],
    queryFn: () => mappingApi.get(mappingId),
    staleTime: 60_000,
    retry: false,
  });
  return <HubLink mappingId={mappingId} name={data?.name} />;
};

const MappingHubLink: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  // The app always has its query cache. A screen drawn without one, which only
  // a test does, has nowhere to read the name from, and links the id as this
  // link always did. The appliance has no name to read.
  const cache = React.useContext(QueryClientContext);
  if (cache === undefined || isSelfHost()) return <HubLink mappingId={mappingId} name={undefined} />;
  return <NamedHubLink mappingId={mappingId} />;
};

export default MappingHubLink;
