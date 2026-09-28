import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import bridge from '@vkontakte/vk-bridge';
import { useAdaptivity, useAppearance, useInsets } from '@vkontakte/vk-bridge-react';
import {
  AdaptivityProvider,
  AppRoot,
  ConfigProvider,
  getViewHeightByViewportHeight,
  getViewWidthByViewportWidth,
  ViewWidth,
} from '@vkontakte/vkui';
import '@vkontakte/vkui/dist/vkui.css';
import '@design/tokens.css';
import './components/platform-ui.css';
import { App } from './App.tsx';
import { initializeVkPlatform, type VkBridgeClient } from './platform/vk.ts';

function PlatformRoot() {
  const appearance = useAppearance();
  const insets = useInsets();
  const { type, viewportWidth, viewportHeight } = useAdaptivity();

  useEffect(() => {
    if (appearance) document.documentElement.dataset.colorScheme = appearance;
    else delete document.documentElement.dataset.colorScheme;
  }, [appearance]);

  const adaptivity = type === 'adaptive'
    ? {
      viewWidth: getViewWidthByViewportWidth(viewportWidth),
      viewHeight: getViewHeightByViewportHeight(viewportHeight),
    }
    : type === 'force_mobile' || type === 'force_mobile_compact'
      ? { viewWidth: ViewWidth.MOBILE, sizeX: type === 'force_mobile_compact' ? 'compact' as const : 'regular' as const }
      : {};

  return (
    <ConfigProvider colorScheme={appearance ?? undefined} isWebView={bridge.isWebView()}>
      <AdaptivityProvider {...adaptivity}>
        <AppRoot mode="full" safeAreaInsets={insets ?? undefined}>
          <App />
        </AppRoot>
      </AdaptivityProvider>
    </ConfigProvider>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root не найден в index.html');
const root = createRoot(rootElement);

async function startMiniApp(): Promise<void> {
  const initialized = await initializeVkPlatform(
    bridge as unknown as VkBridgeClient,
    window.location.search,
    import.meta.env.DEV,
  );
  window.__VK_LAUNCH_PARAMS__ = initialized.launchParams;
  try {
    const user = await bridge.send('VKWebAppGetUserInfo');
    if (user && typeof user === 'object') window.__VK_USER_INFO__ = user as Window['__VK_USER_INFO__'];
  } catch {
    window.__VK_USER_INFO__ = undefined;
  }

  root.render(<StrictMode><PlatformRoot /></StrictMode>);
}

void startMiniApp().catch(() => {
  window.__VK_LAUNCH_PARAMS__ = '';
  root.render(<StrictMode><PlatformRoot /></StrictMode>);
});
