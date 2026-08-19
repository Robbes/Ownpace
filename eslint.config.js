import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/dist-selfhost/**', '**/build/**', '**/coverage/**', '**/*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node.js environment for .js, .cjs and .mjs files
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    /* TYPE-AWARE rules, and deliberately only two of them.
     *
     * `recommendedTypeChecked` in full reports 2275 problems here, almost all
     * of it stylistic debt (`require-await` 751, the `no-unsafe-*` family 924,
     * `no-unnecessary-type-assertion` 412) that would have to be suppressed
     * wholesale to get a green build — and a rule everybody suppresses is not
     * a rule. These two are different: they catch a promise that is never
     * awaited, in a codebase whose entire job is async I/O against remote
     * mailboxes and calendars. That defect does not throw. It returns early,
     * reports success, and loses the write.
     *
     * The cost is a real TS Program, so a COLD lint goes ~15s -> ~68s. Warm it
     * is ~1.5s, which is what nearly every run is: `--cache-strategy content`
     * survives CI's checkout, and only changed files are re-linted.
     */
    // Every .ts/.tsx in the repo is now inside a tsconfig — the root program
    // covers packages, apps, scripts, test and the root-level files, and
    // test/ui has its own (it needs DOM lib). Before that this list named three
    // globs and quietly skipped 35 files, which is how a gate ends up meaning
    // less than it looks like it means.
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        // `attributes` OFF, and this is a finding rather than a shortcut: all
        // 22 sites it reported are React event handlers, and every one of them
        // already opens a try/catch and sets its own failure state — checked
        // individually, not sampled. React ignores a handler's return value by
        // design, so `onClick={someAsyncFn}` is the idiomatic spelling and the
        // sub-check has no true positive to find here. The rest of the rule
        // stays on: an async function passed where a void callback is expected
        // in ordinary code IS a bug, and `arguments` is what catches it.
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Enforce architecture rule: core must not import drizzle-orm or @openmig/ledger directly
    // Only @openmig/shared is allowed from @openmig/* in packages/core/src (excluding tests)
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'drizzle-orm',
              message: 'Drizzle ORM imports are not allowed in core. Use the @openmig/shared ports instead.',
            },
            {
              name: '@openmig/ledger',
              message: 'Direct ledger imports are not allowed in core. Use the @openmig/shared ports instead.',
            },
          ],
          patterns: [
            {
              group: ['@openmig/ledger/*'],
              message: 'Direct ledger imports are not allowed in core. Use the @openmig/shared ports instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
