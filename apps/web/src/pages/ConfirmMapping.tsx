// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The confirm/green-light screen at a real URL (workplan 0037 T2).
 *
 * ConfirmMigration used to live only in the wizard's in-memory post-create
 * state: no route reached it, so one refresh stranded the paused mapping
 * permanently. The wizard navigated HERE on create success, and a paused
 * migration's "Review and start" leads here, so the green light survives a
 * refresh. The green light itself — discovery counts, explicit start — is
 * untouched (0013 T5/T6 stays exactly as heavy as it is).
 *
 * The wizard also brought a refused add to a person in the navigation's state,
 * for this page to say. It retired (0153 D5), and *Start a migration* says a
 * refused add on its own last screen, so nothing brings one here any more.
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
