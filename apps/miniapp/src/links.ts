// Внешние ссылки: внутри MAX — через мост (webview сам вкладки не откроет),
// в браузере — новой вкладкой.

export function openExternal(url: string): void {
  const openLink = window.WebApp?.initData ? window.WebApp.openLink : undefined;
  if (openLink) {
    openLink.call(window.WebApp, url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}
