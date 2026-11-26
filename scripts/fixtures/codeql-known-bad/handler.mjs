// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A KNOWN-BAD FIXTURE FOR CODEQL'S PROOF RUN (workplan 0178 §8 step 2).
 *
 * Not shipped code. Nothing imports this file, nothing runs it, and no image
 * copies it: it exists so that `codeql.yml`, dispatched with `proof`, can show
 * it reads what it should. A request's query string goes into a string-built
 * SQL query and into an HTML answer, the two flows CodeQL's `js/sql-injection`
 * and `js/reflected-xss` follow. If the proof run reports either one missing
 * here, the workflow is not reading the tree as it should, and the run is red.
 *
 * CodeQL's ordinary run leaves this folder out (`.github/codeql/codeql.yml`),
 * so the two alerts never sit in the repository's list.
 * `scripts/a-flow-across-files-nothing-followed.unit.test.ts` holds that no
 * other file names this folder but the ones that must.
 */

import express from 'express';
import pg from 'pg';

const app = express();
const pool = new pg.Pool();

app.get('/known-bad', async (req, res) => {
  const name = req.query.name;
  const found = await pool.query("SELECT id FROM known_bad WHERE name = '" + name + "'");
  res.send('<p>' + name + ': ' + found.rowCount + '</p>');
});

export default app;
