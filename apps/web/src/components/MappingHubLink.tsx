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
 */
import React from 'react';
import { Link } from 'react-router';

const MappingHubLink: React.FC<{ mappingId: string }> = ({ mappingId }) => (
  <Link
    to={`/mappings/${encodeURIComponent(mappingId)}`}
    className="text-gray-900 hover:text-blue-700 hover:underline"
  >
    {mappingId}
  </Link>
);

export default MappingHubLink;
