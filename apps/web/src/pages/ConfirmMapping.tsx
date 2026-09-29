// Copyright 2026 The Ownpace authors (Apache-2.0)
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
 *
 * A migration started from a person's card is added to that person before
 * the wizard comes here (0153 T3). When that add is refused, the wizard
 * brings the server's words in the navigation's state, and this page says
 * them above the green light: the migration was made, and is nobody's yet.
 */
import React from 'react';
import { useParams, useNavigate, useLocation, Navigate } from 'react-router';
import { AlertCircle } from 'lucide-react';
import { ConfirmMigration } from '../components/ConfirmMigration.tsx';
import { useT } from '../i18n/index.tsx';

/** The server's words for a refused add, when the wizard brought them. */
function notAddedToPerson(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const words = (state as { notAddedToPerson?: unknown }).notAddedToPerson;
  return typeof words === 'string' ? words : null;
}

const ConfirmMapping: React.FC = () => {
  const { mappingId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const notAdded = notAddedToPerson(useLocation().state);

  if (!mappingId) {
    return <Navigate to="/mappings" replace />;
  }

  return (
    <div className="max-w-4xl mx-auto">
      {notAdded !== null && (
        <div role="alert" className="mb-4 flex items-start gap-2 p-4 rounded-lg bg-amber-50 text-amber-900 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p>
              <span className="font-medium">{t('people.notAdded')}</span> {notAdded}
            </p>
            <p className="mt-1">{t('people.notAdded.where')}</p>
          </div>
        </div>
      )}
      <ConfirmMigration mappingId={mappingId} onStarted={() => navigate('/mappings')} />
    </div>
  );
};

export default ConfirmMapping;
