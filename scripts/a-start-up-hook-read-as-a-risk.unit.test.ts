// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A START-UP HOOK READ AS A RISK, AND KEPT, BECAUSE IT DOES ONE THING.
 *
 * On 2026-11-24 an outside, read-only check of this repository named
 * `.claude/settings.json` (AIR-2b): it registers a `SessionStart` hook, and a
 * settings file an assistant loads on opening a checkout is a place where a
 * repository could run a command, send the assistant's traffic to another
 * address or hand it a tool server, without anybody being asked. Read
 * (workplan 0006 §R), this one does none of that, and it stays:
 *
 * - the hook is the repository's own script, `.claude/hooks/session-start.sh`;
 * - its first action is to exit unless `CLAUDE_CODE_REMOTE` is `true`, so on
 *   anyone's own computer it does nothing at all;
 * - in a Claude Code on the web container it runs
 *   `pnpm install --frozen-lockfile`, which installs exactly the lockfile's
 *   versions and refuses to change it; without it a fresh web session started
 *   with an incomplete workspace whose gates failed like a broken repository
 *   (the script's own header);
 * - nothing redirects the model's address, and no MCP server is configured.
 *
 * WHAT THIS PINS, so a later change cannot quietly add one: the settings hold
 * that one hook and nothing else; no `env` sets a `*_BASE_URL`, an
 * `ANTHROPIC_*` variable or a proxy; no `apiKeyHelper`, `mcpServers`,
 * `enableAllProjectMcpServers` or `enabledMcpjsonServers`; no `.mcp.json` at
 * the root; and the script exits for a local checkout before anything else,
 * and installs only with `--frozen-lockfile`. A change that needs more than
 * this is a decision to make in the open, and this test is where it shows.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS_PATH = '.claude/settings.json';
const HOOK_PATH = '.claude/hooks/session-start.sh';
const HOOK_COMMAND = '$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh';

const settings = JSON.parse(readFileSync(join(REPO_ROOT, SETTINGS_PATH), 'utf8')) as Record<string, unknown>;
const hook = readFileSync(join(REPO_ROOT, HOOK_PATH), 'utf8');

/** Every key anywhere in a JSON value, at any depth. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]);
  }
  return [];
}

/** The script's commands: no comments, no blank lines, no heredoc text (the warning it prints). */
const commands = hook
  .replace(/<<'?(\w+)'?\n[\s\S]*?\n\1\n/g, '<<$1\n')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

describe('the assistant settings hold the start-up hook and nothing more', () => {
  it('holds only hooks.SessionStart, with the one command', () => {
    expect(Object.keys(settings)).toEqual(['hooks']);
    expect(settings.hooks).toEqual({
      SessionStart: [{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }],
    });
  });

  it('sets no address, key or proxy for the model, and no tool server', () => {
    const keys = allKeys(settings);
    for (const forbidden of ['env', 'apiKeyHelper', 'mcpServers', 'enableAllProjectMcpServers', 'enabledMcpjsonServers']) {
      expect(keys, `${SETTINGS_PATH} sets ${forbidden}`).not.toContain(forbidden);
    }
    const redirects = keys.filter((k) => /_BASE_URL$|^ANTHROPIC_|PROXY/i.test(k));
    expect(redirects, `${SETTINGS_PATH} sets a model address, key or proxy`).toEqual([]);
  });

  it('has no .mcp.json at the root', () => {
    expect(existsSync(join(REPO_ROOT, '.mcp.json'))).toBe(false);
  });
});

describe('the hook does nothing on a local checkout, and installs only what the lockfile says', () => {
  it('its first action, after the shell options, is the exit for anything but a web container', () => {
    const body = commands.filter((line) => !line.startsWith('set '));
    expect(body.slice(0, 3)).toEqual(['if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then', 'exit 0', 'fi']);
  });

  it('every install it runs is --frozen-lockfile', () => {
    // What a line RUNS, so a message it echoes about the install is not an install.
    const run = commands.map((line) => line.replace(/"[^"]*"/g, '""'));
    const installs = run.filter((line) => /\b(?:pnpm|npm|yarn)\s+(?:install|i|add|ci)\b/.test(line));
    expect(installs.length).toBeGreaterThan(0);
    for (const line of installs) expect(line).toMatch(/^(?:if )?pnpm install --frozen-lockfile(?:; then)?$/);
  });
});
