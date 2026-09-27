// Copyright 2026 The Ownpace authors (Apache-2.0)

// Vitest setup for web component tests: registers @testing-library/jest-dom
// matchers (toBeInTheDocument, etc.) and clears the DOM between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom has no layout, so its `window.scrollTo` only prints "Not implemented".
// The app sends the page to the top on every wizard step and every new page
// (workplan 0145 T3 (a)), so every test that walks the wizard or follows a
// link printed that line, 83 times for the wizard's files alone. A test that
// asks where the page went spies on this (`a-step-that-starts-at-the-top`).
// Through `globalThis`, which is the window here: this file is also in the
// root program, which has no DOM lib.
Object.defineProperty(globalThis, 'scrollTo', {
  configurable: true,
  writable: true,
  value: () => {},
});
