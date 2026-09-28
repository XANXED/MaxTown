type BridgeValue = string | number | boolean;
type BridgeParams = Record<string, unknown>;

export type VkBridgeClient = {
  send: (method: string) => Promise<unknown>;
  isWebView: () => boolean;
};

export async function readVkCode(bridge: { send: (method: 'VKWebAppOpenCodeReader') => Promise<unknown> }): Promise<string | null> {
  const result = await bridge.send('VKWebAppOpenCodeReader');
  if (!result || typeof result !== 'object' || !('code_data' in result) || typeof result.code_data !== 'string') return null;
  return result.code_data;
}

function launchParamsFrom(search: string, bridgeParams: unknown): string {
  const values = new URLSearchParams(search);
  if (bridgeParams && typeof bridgeParams === 'object' && !Array.isArray(bridgeParams)) {
    for (const [key, value] of Object.entries(bridgeParams as BridgeParams)) {
      if ((key.startsWith('vk_') || key === 'sign') && ['string', 'number', 'boolean'].includes(typeof value)) {
        values.set(key, String(value as BridgeValue));
      }
    }
  }
  return values.toString();
}

/**
 * Страница открыта сама по себе, а не внутри VK: не во фрейме и не в WebView.
 * Там VK Bridge некому ответить — его запросы не отклоняются, а висят вечно.
 */
export function isStandaloneBrowser(bridge: Pick<VkBridgeClient, 'isWebView'>, win: { self: unknown; top: unknown }): boolean {
  return win.self === win.top && !bridge.isWebView();
}

export async function initializeVkPlatform(
  bridge: VkBridgeClient,
  search: string,
  isDevelopment: boolean,
  standalone = false,
): Promise<{ launchParams: string; isEmbedded: boolean }> {
  // Локальный запуск: launch-параметры берём из адреса (их подписывает
  // `npm run dev:link`), к Bridge не обращаемся — он не ответит.
  if (isDevelopment && standalone) return { launchParams: launchParamsFrom(search, null), isEmbedded: false };
  try {
    await bridge.send('VKWebAppInit');
    const launchParams = await bridge.send('VKWebAppGetLaunchParams');
    return { launchParams: launchParamsFrom(search, launchParams), isEmbedded: bridge.isWebView() };
  } catch (error) {
    const hasSignedUrlLaunch = new URLSearchParams(search).has('sign');
    if (!isDevelopment && !hasSignedUrlLaunch) throw error;
    return { launchParams: launchParamsFrom(search, null), isEmbedded: false };
  }
}
