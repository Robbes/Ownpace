// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The confirm/green-light screen at a real URL (workplan 0037 T2).
 *
 * ConfirmMigration used to live only in CreateMapping's in-memory post-create
 * state: no route reached it, so one refresh stranded the paused mapping
 * permanently — the only visible affordance left was the Mappings Play
 * button, whose sync request earned a 409 telling the operator to POST
 * /start, which no screen could do. The wizard now navigates HERE on create
 * success, and a paused row's "Review and start" leads here too, so the
 * green light survives a refresh. The green light itself — discovery counts,
 * explicit start — is untouched (0013 T5/T6 stays exactly as heavy as it is).
 */
import React from 'react';
import { useParams, useNavigate, Navigate } from 'react-router';
import { ConfirmMigration } from '../components/ConfirmMigration.tsx';

const ConfirmMapping: React.FC = () => {
  const { mappingId } = useParams();
  const navigate = useNavigate();

  if (!mappingId) {
    return <Navigate to="/mappings" replace />;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <ConfirmMigration mappingId={mappingId} onStarted={() => navigate('/mappings')} />
    </div>
  );
};

export default ConfirmMapping;
