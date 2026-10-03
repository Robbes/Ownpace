#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// adr-operative.mjs — assemble docs/adr/OPERATIVE.md from every ADR's own
// `## Operative rules` section (ADR-0038).
//
// WHY GENERATED. The register's own header warns that a second hand-written
// list of ADRs is the mistake it exists to stop — SAD §24 drifted exactly that
// way. OPERATIVE.md is therefore BUILD OUTPUT of the sections inside the ADRs,
// never a second source: edit the section in the ADR, run --write, and the
// unit test (scripts/adr-operative.unit.test.ts) fails any state where the two
// disagree.
//
// Usage:
//   node scripts/adr-operative.mjs --check   # exit 1 + diff hint on drift (CI/test)
//   node scripts/adr-operative.mjs --write   # regenerate docs/adr/OPERATIVE.md
//
// Deliberately dumb: number order, verbatim section content (comments
// stripped), no summarising, no filtering. A retracted ADR's one-line
// "Nothing — retracted" entry is cheap and keeps the file's coverage total.
//
// WHY IT REFUSES A SECTION OVER BUDGET (ADR-0051). The template asked for
// "3–8 terse bullets" in a comment, and nothing read the comment: between
// 2026-08-20 and 2026-10-03 this file's output went from 6.5k words to 12.1k,
// one section reached 27 bullets and 2,000 words, and reasons, examples and
// "this bullet originally said…" notes moved into the rules. A request in a
// comment is a hope; a refusal at --write, where the author is standing, is a
// limit. The numbers are BUDGET below.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'adr');
const OUT = join(ADR_DIR, 'OPERATIVE.md');
const SECTION = '## Operative rules';

/**
 * The budget every operative section is held to (ADR-0051). Table rows are
 * data — ADR-0014's tier table is read by two price guards — so they are not
 * counted as words; everything else in the section is.
 */
export const BUDGET = Object.freeze({
  bullets: 8,
  wordsPerBullet: 60,
  wordsPerSection: 300,
});

const isTableRow = (line) => /^\s*\|/.test(line);
/** Words, not tokens: a list marker (`- `, `  * `) is punctuation, not a word. */
export const wordCount = (text) =>
  text
    .replace(/^\s*[-*+]\s+/gm, '')
    .split(/\s+/)
    .filter(Boolean).length;

/**
 * The section's top-level bullets, each with its continuation lines (nested
 * bullets included) and without table rows. A line at column 0 that starts
 * `- ` opens a bullet; anything else non-blank belongs to the open one.
 */
export function operativeBullets(body) {
  const bullets = [];
  for (const line of body.split('\n')) {
    if (/^- /.test(line)) bullets.push([line]);
    else if (bullets.length && line.trim() !== '') bullets[bullets.length - 1].push(line);
  }
  return bullets.map((lines) => lines.filter((l) => !isTableRow(l)).join('\n'));
}

/**
 * Every way one ADR's operative section breaks the budget, as sentences that
 * name the file, the limit and the fix. Empty when it is within budget.
 */
export function budgetProblems(file, body) {
  const problems = [];
  const fix = 'state the rule and point at what holds it; the reasons belong in the narrative below';
  const bullets = operativeBullets(body);
  if (bullets.length > BUDGET.bullets) {
    problems.push(`${file}: ${bullets.length} operative bullets, the budget is ${BUDGET.bullets} (ADR-0051) — ${fix}`);
  }
  bullets.forEach((bullet, i) => {
    const n = wordCount(bullet);
    if (n > BUDGET.wordsPerBullet) {
      const opening = bullet.split('\n')[0].slice(0, 60);
      problems.push(
        `${file}: operative bullet ${i + 1} ("${opening}…") is ${n} words, the budget is ${BUDGET.wordsPerBullet} (ADR-0051) — ${fix}`,
      );
    }
  });
  const words = wordCount(
    body
      .split('\n')
      .filter((l) => !isTableRow(l))
      .join('\n'),
  );
  if (words > BUDGET.wordsPerSection) {
    problems.push(`${file}: the operative section is ${words} words, the budget is ${BUDGET.wordsPerSection} (ADR-0051) — ${fix}`);
  }
  // A sub-heading inside the section is narrative structure that the
  // extractor would republish as rules: ADR-0042 carried "### Amended
  // 2026-08-25" here, and OPERATIVE.md printed it as one of its rules.
  for (const line of body.split('\n')) {
    if (/^#{3,} /.test(line)) {
      problems.push(`${file}: the operative section contains the heading "${line.trim()}" — an amendment goes below, in the narrative or the amendment log (ADR-0051)`);
    }
  }
  return problems;
}

/** ADR source files: NNNN-*.md, excluding the template (0000) and generated/registry files. */
export function adrFiles(dir = ADR_DIR) {
  return readdirSync(dir)
    .filter((f) => /^\d{4}-.+\.md$/.test(f) && !f.startsWith('0000-'))
    .sort();
}

/**
 * Extract the operative section of one ADR: the content between the
 * `## Operative rules` heading and the next `## ` heading (or EOF), with HTML
 * comments removed. Throws — never returns empty — because a missing or empty
 * section is exactly the drift this tool exists to make loud.
 */
export function extractOperative(file, text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === SECTION);
  if (start === -1) {
    throw new Error(`${file}: no "${SECTION}" section — every ADR must state what holds now (ADR-0038)`);
  }
  // The section ends at the next heading OR the first blockquote: several ADRs
  // carry `> **Update …**` history blocks directly after the metadata, and an
  // operative section that swallowed them would republish narrative as rules —
  // the exact confusion this file exists to end.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]) || /^> /.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  if (!body) {
    throw new Error(`${file}: "${SECTION}" is empty — state the live rules, or "Nothing — retracted/superseded" explicitly`);
  }
  const title = lines.find((l) => l.startsWith('# '))?.slice(2).trim() ?? file;
  return { title, body };
}

export function assemble(dir = ADR_DIR) {
  const parts = [
    '<!-- GENERATED by scripts/adr-operative.mjs — DO NOT EDIT THIS FILE. -->',
    '<!-- Edit the "## Operative rules" section inside the ADR itself, then run: -->',
    '<!--   node scripts/adr-operative.mjs --write -->',
    '',
    '# ADR operative rules — what holds NOW',
    '',
    'One entry per ADR, assembled verbatim from each file’s own `## Operative rules`',
    'section. This is the document to load when you need the constraints; open a full',
    'ADR only to challenge or amend its decision (see AGENTS.md). Statuses and dates',
    'live in [README.md](./README.md), the register.',
    '',
  ];
  const overBudget = [];
  for (const file of adrFiles(dir)) {
    const { title, body } = extractOperative(file, readFileSync(join(dir, file), 'utf8'));
    overBudget.push(...budgetProblems(file, body));
    parts.push(`## [${title}](./${file})`, '', body, '');
  }
  // Every problem at once, not the first: an author trimming one section
  // should not discover the next only after regenerating again.
  if (overBudget.length) throw new Error(overBudget.join('\n'));
  return parts.join('\n');
}

function assembleOrExit() {
  try {
    return assemble();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

const mode = process.argv[2];
if (mode === '--write') {
  writeFileSync(OUT, assembleOrExit());
  console.log(`wrote ${OUT}`);
} else if (mode === '--check') {
  const want = assembleOrExit();
  let have = '';
  try {
    have = readFileSync(OUT, 'utf8');
  } catch {
    /* missing counts as drift */
  }
  if (have !== want) {
    console.error('docs/adr/OPERATIVE.md is out of date with the ADRs’ own operative sections.');
    console.error('Regenerate it:  node scripts/adr-operative.mjs --write');
    process.exit(1);
  }
  console.log('OPERATIVE.md is current');
} else if (mode !== undefined) {
  console.error('usage: adr-operative.mjs [--check | --write]');
  process.exit(2);
}
