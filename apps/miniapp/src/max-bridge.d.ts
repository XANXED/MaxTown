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
  /** Исходная строка запуска; передаётся API для проверки подписи MAX. */
  initData: string;
  initDataUnsafe?: {
    user?: MaxUser;
    /**
     * payload из ссылки `https://max.ru/<бот>?startapp=<payload>`. Документация
     * называет его «объектом WebAppStartParam» — проверяем тип при чтении.
     */
    start_param?: unknown;
  };
  platform: string;
  version: string;
  /** Открыть ссылку во внешнем браузере; MAX проверяет, что её открыли по нажатию. */
  openLink?(url: string): void;
  /** Сканер QR-кода; fileSelect — можно выбрать картинку из галереи. Отдаёт содержимое кода. */
  openCodeReader?(fileSelect?: boolean): Promise<string>;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft', disableVibrationFallback?: boolean): void;
    notificationOccurred(type: 'error' | 'success' | 'warning', disableVibrationFallback?: boolean): void;
    selectionChanged(disableVibrationFallback?: boolean): void;
  };
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
