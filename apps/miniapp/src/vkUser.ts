export type VkUserInfo = {
  first_name?: string;
  last_name?: string;
  photo_100?: string;
  photo_200?: string;
};

export type ProfileUser = { name: string; initials: string; photoUrl?: string };

export function toProfileUser(user: VkUserInfo | undefined): ProfileUser | null {
  if (!user) return null;
  const parts = [user.first_name, user.last_name].map((part) => part?.trim()).filter(Boolean) as string[];
  const name = parts.join(' ');
  if (!name) return null;
  return {
    name,
    initials: parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('ru-RU')).join('') || name[0]!.toLocaleUpperCase('ru-RU'),
    photoUrl: user.photo_200 || user.photo_100 || undefined,
  };
}

export function currentProfileUser(): ProfileUser | null {
  return toProfileUser(window.__VK_USER_INFO__);
}
