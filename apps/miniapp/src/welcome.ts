// Отметка «приветствие уже видели». Живёт в localStorage этого устройства:
// это удобство, а не состояние, которое нужно где-то ещё. Хранилище может
// быть недоступно (приватный режим, запрет сайта), поэтому всё в try/catch.

const WELCOME_SEEN_KEY = 'maxtown.welcome-seen';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function hasSeenWelcome(storage: KeyValueStorage | undefined = defaultStorage()): boolean {
  try {
    return storage?.getItem(WELCOME_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markWelcomeSeen(storage: KeyValueStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(WELCOME_SEEN_KEY, '1');
  } catch {
    // Не запомнили — приветствие покажется ещё раз, это не страшно.
  }
}
