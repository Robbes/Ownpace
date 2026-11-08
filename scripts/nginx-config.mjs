// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN NGINX CONFIG, READ AS NGINX READS IT, for the guards that need to know
 * what a request is answered with.
 *
 * The parser and the location choice were written for
 * `a-screenshot-the-front-door-lets-through.unit.test.ts` (workplan 0130) and
 * moved here unchanged when a second guard needed them (workplan 0158):
 * importing a `*.unit.test.ts` would register its tests a second time. What
 * was added for 0158 is the rest of the answer a browser sees:
 *
 * - `envsubst`, the nginx image's template step, so a test reads the file the
 *   container reads and not the one in git;
 * - `headersFor`, the `add_header` lines nginx applies to the response for a
 *   URI, by nginx's rule of inheritance, with their variables resolved.
 *
 * Nothing here runs nginx. `what-a-browser-may-do-with-the-app.unit.test.ts`
 * does, where the machine has one, and holds this reading to what it answers.
 *
 * `.mjs`, with its types in `nginx-config.d.mts`, since 2026-11-08 (workplan
 * 0158 T4): the outside probe and `deploy-live.sh` read the app's headers
 * through `app-headers.mjs`, which imports this, and both run on a bare
 * checkout, where a script needs no type stripping (the reason
 * `audit-advisories.d.mts` gives). The code is the `.ts` it was, its types
 * moved to the declaration file.
 */

/**
 * An nginx config as its directives and blocks. Comments are `#` to the end of
 * the line at the start of a word; a quoted word keeps its braces; and
 * `${name}`, which the image's template step substitutes and nginx reads as a
 * variable, is part of the word around it rather than a block. Anything this
 * cannot parse throws: a config that does not parse is one nothing checked.
 */
export function parseNginx(conf, file) {
  const top = [];
  const stack = [top];
  let words = [];
  const fail = (why) => {
    throw new Error(`${file}: ${why}. It does not parse, so nothing in it was checked: fix the config, not this test.`);
  };
  let i = 0;
  while (i < conf.length) {
    const c = conf[i];
    if (c === '#') {
      while (i < conf.length && conf[i] !== '\n') i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === ';') {
      if (words.length === 0) fail('an empty directive');
      stack.at(-1).push({ name: words[0], args: words.slice(1) });
      words = [];
      i++;
    } else if (c === '{') {
      if (words.length === 0) fail('a block with no name');
      const node = { name: words[0], args: words.slice(1), children: [] };
      stack.at(-1).push(node);
      stack.push(node.children);
      words = [];
      i++;
    } else if (c === '}') {
      if (words.length > 0) fail(`\`${words.join(' ')}\` has no semicolon`);
      if (stack.length === 1) fail('a closing brace with no block open');
      stack.pop();
      i++;
    } else if (c === '"' || c === "'") {
      let word = '';
      let j = i + 1;
      while (j < conf.length && conf[j] !== c) {
        if (conf[j] === '\\' && j + 1 < conf.length) {
          word += conf[j + 1];
          j += 2;
        } else {
          word += conf[j++];
        }
      }
      if (j >= conf.length) fail('a quote that never closes');
      words.push(word);
      i = j + 1;
    } else {
      let word = '';
      while (i < conf.length && !/[\s;{}]/.test(conf[i])) {
        if (conf[i] === '$' && conf[i + 1] === '{') {
          const end = conf.indexOf('}', i);
          if (end < 0) fail('a `${` that never closes');
          word += conf.slice(i, end + 1);
          i = end + 1;
        } else {
          word += conf[i++];
        }
      }
      words.push(word);
    }
  }
  if (stack.length !== 1) fail('a block that never closes');
  if (words.length > 0) fail(`\`${words.join(' ')}\` has no semicolon`);
  return top;
}

/** A location block's modifier and pattern, written apart or together (`= /x`, `=/x`). A named one is none. */
export function locationOf(node) {
  if (node.name !== 'location' || node.children === undefined) return undefined;
  const [first, second] = node.args;
  if (first === undefined || first.startsWith('@')) return undefined;
  for (const modifier of ['=', '^~', '~*', '~']) {
    if (first === modifier) return second === undefined ? undefined : { node, modifier, pattern: second };
    if (first.startsWith(modifier)) return { node, modifier, pattern: first.slice(modifier.length) };
  }
  return { node, modifier: '', pattern: first };
}

/**
 * The location nginx chooses for a URI among one level's blocks, as the path
 * of locations from that level down to the one chosen
 * (`ngx_http_core_find_location`): an exact `=` match ends the search; else
 * the longest prefix is remembered and its nested locations searched the same
 * way; unless that prefix is `^~`, the level's regexes are then tried in
 * order, and the first that matches wins over it. `final` is whether an exact
 * or a regex match ended the search, which a level above must not override.
 */
export function chooseLocation(level, uri) {
  const locations = level.map(locationOf).filter((l) => l !== undefined);
  const exact = locations.find((l) => l.modifier === '=' && l.pattern === uri);
  if (exact) return { path: [exact.node], final: true };
  let prefix;
  for (const l of locations) {
    if ((l.modifier === '' || l.modifier === '^~') && uri.startsWith(l.pattern)) {
      if (prefix === undefined || l.pattern.length > prefix.pattern.length) prefix = l;
    }
  }
  let found;
  if (prefix) {
    const inner = chooseLocation(prefix.node.children, uri);
    if (inner?.final) return { path: [prefix.node, ...inner.path], final: true };
    found = { path: [prefix.node, ...(inner?.path ?? [])], final: false };
    if (prefix.modifier === '^~') return found;
  }
  for (const l of locations) {
    if (l.modifier !== '~' && l.modifier !== '~*') continue;
    if (new RegExp(l.pattern, l.modifier === '~*' ? 'i' : '').test(uri)) {
      return { path: [l.node, ...(chooseLocation(l.node.children, uri)?.path ?? [])], final: true };
    }
  }
  return found;
}

/**
 * The template as the nginx image renders it. The image's entrypoint runs
 * `envsubst` with the list of variables DEFINED in the container, so `$NAME`
 * and `${NAME}` are replaced for those names alone (an empty value included),
 * and every other `$` reaches nginx as written: `$host`, `$uri`, and the
 * `$ownpace_…` names this repository gives its own variables for that reason.
 */
export function envsubst(template, defined) {
  return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, braced, bare) => {
    const name = braced ?? bare;
    return Object.hasOwn(defined, name) ? defined[name] : whole;
  });
}

/**
 * The headers nginx adds to its answer for a URI, in the server it reaches.
 *
 * nginx's rule for `add_header`: a level that sets none inherits the enclosing
 * level's, and a level that sets even one inherits nothing. So the lines that
 * apply are those of the innermost level, from the chosen location outwards
 * to the file's top, that has any (`ngx_http_headers_merge_conf`).
 *
 * A value's `$name` is resolved from the `set` lines of the server and of the
 * locations chosen, the innermost last; a variable this does not know throws
 * rather than being guessed. Read from the FIRST server in the file, which is
 * the only one the app's template has. Undefined when no location is chosen.
 */
export function headersFor(top, uri) {
  const levels = [top];
  let server;
  const find = (nodes) => {
    for (const node of nodes) {
      if (server || node.children === undefined) continue;
      if (node.name === 'server') {
        server = node;
        levels.push(node.children);
      } else if (node.name === 'http') {
        levels.push(node.children);
        find(node.children);
        if (!server) levels.pop();
      }
    }
  };
  find(top);
  if (!server) throw new Error('no server block: nothing answers a request');
  const chosen = chooseLocation(server.children, uri)?.path;
  if (!chosen) return undefined;
  const scopes = [...levels, ...chosen.map((l) => l.children)];
  const variables = new Map();
  for (const scope of scopes.slice(levels.length - 1)) {
    for (const node of scope) {
      if (node.name === 'set' && node.args[0]?.startsWith('$')) variables.set(node.args[0].slice(1), node.args[1] ?? '');
    }
  }
  const resolve = (value) =>
    value.replace(/\$(?:\{(\w+)\}|(\w+))/g, (_whole, braced, bare) => {
      const name = braced ?? bare;
      const known = variables.get(name);
      if (known === undefined) throw new Error(`add_header uses $${name}, which no \`set\` above it gives a value`);
      return resolve(known);
    });
  const own = [...scopes].reverse().find((scope) => scope.some((n) => n.name === 'add_header'));
  return (own ?? [])
    .filter((n) => n.name === 'add_header')
    .map((n) => ({ name: n.args[0], value: resolve(n.args[1] ?? ''), always: n.args[2] === 'always' }));
}
