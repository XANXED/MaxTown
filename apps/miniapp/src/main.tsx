import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MaxUI } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
import '@design/tokens.css';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('#root не найден в index.html');

createRoot(root).render(
  <StrictMode>
    {/* платформа и цветовая схема определяются автоматически */}
    <MaxUI>
      <App />
    </MaxUI>
  </StrictMode>,
);
