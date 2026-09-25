// Имя и фото человека для экрана Профиля. Берутся из initDataUnsafe: этого
// достаточно, чтобы показать, но не чтобы доверять — личность подтверждает
// только apps/api по подписанному initData.

export type ProfileUser = {
  name: string;
  initials: string;
  username?: string;
  photoUrl?: string;
};

export function toProfileUser(user: MaxUser | undefined): ProfileUser | null {
  if (!user) return null;

  const parts = [user.first_name, user.last_name].map((part) => part?.trim()).filter(Boolean) as string[];
  const name = parts.join(' ') || user.username || 'Без имени';
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('ru-RU'))
    .join('');

  return {
    name,
    initials: initials || name[0]?.toLocaleUpperCase('ru-RU') || '?',
    username: user.username || undefined,
    photoUrl: user.photo_url || undefined,
  };
}

export function currentProfileUser(): ProfileUser | null {
  return toProfileUser(window.WebApp?.initDataUnsafe?.user);
}
