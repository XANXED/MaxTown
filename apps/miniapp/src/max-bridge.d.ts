// Минимальные типы моста MAX (https://st.max.ru/js/max-web-app.js).
// Полный список членов: https://dev.max.ru/docs/webapps/bridge — дописывайте по мере использования.
// initDataUnsafe не годится для проверки подлинности: initData проверяет apps/api.

interface MaxWebApp {
  initData: string;
  platform: string;
  version: string;
}

interface Window {
  WebApp?: MaxWebApp;
}
