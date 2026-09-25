// Минимальные типы моста MAX (https://st.max.ru/js/max-web-app.js).
// Полный список членов: https://dev.max.ru/docs/webapps/bridge — дописывайте по мере использования.
// initDataUnsafe не годится для проверки подлинности: initData проверяет apps/api.

/** Пользователь из initDataUnsafe.user — только для показа, не для проверки. */
interface MaxUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface MaxWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: MaxUser;
  };
  platform: string;
  version: string;
  BackButton: {
    show(): void;
    hide(): void;
    isVisible: boolean;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
}

interface Window {
  WebApp?: MaxWebApp;
}
