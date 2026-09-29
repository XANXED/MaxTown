// Тактильный отклик MAX. Вне MAX (в браузере) моста нет — вызов молча ничего не делает.

function haptics() {
  return window.WebApp?.initData ? window.WebApp.HapticFeedback : undefined;
}

export function hapticSuccess(): void {
  haptics()?.notificationOccurred('success', true);
}

export function hapticWarning(): void {
  haptics()?.notificationOccurred('warning', true);
}
