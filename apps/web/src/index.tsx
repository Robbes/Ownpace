// Copyright 2026 The Ownpace authors (Apache-2.0)
// First, before any module that makes a schema: see the file.
import './zod-without-eval.ts';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
