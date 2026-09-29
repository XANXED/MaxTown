import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdaptivityProvider, AppRoot, ConfigProvider } from '@vkontakte/vkui';
import '@vkontakte/vkui/dist/vkui.css';
import '@design/tokens.css';
import './components/platform-ui.css';
import { App } from './App.tsx';
import { currentMaxInitData } from './maxLaunch.ts';

// Мини-апп MAX. Интерфейс — на VKUI (MAX сделан VK и выглядит так же), мост —
// window.WebApp из скрипта MAX в index.html. Отступы вырезов экрана VKUI берёт
// из CSS env(safe-area-inset-*), тему — из системной.

type ColorScheme = 'light' | 'dark';

const darkQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function useSystemColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(darkQuery?.matches ? 'dark' : 'light');
  useEffect(() => {
    if (!darkQuery) return;
    const update = () => setScheme(darkQuery.matches ? 'dark' : 'light');
    darkQuery.addEventListener('change', update);
    return () => darkQuery.removeEventListener('change', update);
  }, []);
  return scheme;
}

function PlatformRoot() {
  const colorScheme = useSystemColorScheme();

  useEffect(() => {
    document.documentElement.dataset.colorScheme = colorScheme;
  }, [colorScheme]);

  return (
    <ConfigProvider colorScheme={colorScheme} isWebView={Boolean(currentMaxInitData())}>
      <AdaptivityProvider>
        <AppRoot mode="full">
          <App />
        </AppRoot>
      </AdaptivityProvider>
    </ConfigProvider>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root не найден в index.html');

createRoot(rootElement).render(
  <StrictMode>
    <PlatformRoot />
  </StrictMode>,
);
