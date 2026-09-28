import bridge from '@vkontakte/vk-bridge';

export function hapticSuccess(): void {
  void bridge.send('VKWebAppTapticNotificationOccurred', { type: 'success' }).catch(() => undefined);
}

export function hapticWarning(): void {
  void bridge.send('VKWebAppTapticNotificationOccurred', { type: 'warning' }).catch(() => undefined);
}
