import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@design/tokens.css';
import './app.css';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root не найден в index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
