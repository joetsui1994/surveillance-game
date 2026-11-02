import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { createRoundsApi } from './net/config.ts';
import { Root } from './Root.tsx';
import './styles.css';

const api = createRoundsApi();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root api={api} />
    </ErrorBoundary>
  </StrictMode>,
);
