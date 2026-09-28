import { describe, expect, it } from 'vitest';
import { toProfileUser } from './vkUser.ts';

describe('toProfileUser', () => {
  it('uses the display name and photo returned by VK Bridge', () => {
    expect(toProfileUser({ first_name: 'Анна', last_name: 'Соколова', photo_200: 'https://vk.test/avatar.jpg' })).toEqual({
      name: 'Анна Соколова',
      initials: 'АС',
      photoUrl: 'https://vk.test/avatar.jpg',
    });
  });

  it('falls back to a safe display name when VK user information is unavailable', () => {
    expect(toProfileUser(undefined)).toBeNull();
    expect(toProfileUser({ first_name: ' ', last_name: '' })).toBeNull();
  });
});
