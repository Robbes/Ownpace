// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The small line in the sidebar that says what is running.
 *
 * Deliberately quiet: muted, extra-small, at the bottom, no icon and no label
 * shouting "version". Somebody reading a screen to answer "which build is
 * this?" will find it; nobody else has to look at it. `title` carries the full
 * commit for the case where seven characters are not enough.
 *
 * See `services/build-identity.ts` for why there can be TWO answers here and
 * why showing both on a mismatch is the whole point rather than a nicety.
 */
import React from 'react';
import { operatingBaseUrl } from '../services/edition.ts';
import {
  uiBuild,
  fetchServerBuild,
  describeBuild,
  type BuildIdentity,
} from '../services/build-identity.ts';

const BuildStamp: React.FC = () => {
  const ui = uiBuild();
  const [server, setServer] = React.useState<BuildIdentity | null>(null);

  React.useEffect(() => {
    // Aborted on unmount: a version stamp must never be the reason a state
    // update lands on a component that has gone.
    const controller = new AbortController();
    void fetchServerBuild(operatingBaseUrl(), controller.signal).then(setServer);
    return () => controller.abort();
  }, []);

  const text = describeBuild(ui, server);
  // An unstamped build renders NOTHING rather than a placeholder. A stamp that
  // says `v0.0.0` when nobody stamped it is a wrong answer wearing the clothes
  // of a right one; an absent line at least prompts the question.
  if (!text) return null;

  const full = [ui.commit && `UI ${ui.commit}`, server?.commit && `API ${server.commit}`]
    .filter(Boolean)
    .join('\n');

  return (
    <p className="mt-3 text-[11px] leading-tight text-gray-400 select-text" title={full || undefined}>
      {text}
    </p>
  );
};

export default BuildStamp;
