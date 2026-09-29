import { MaxApiError, type MaxApi, type MaxChatMember, type MaxOpenAppButton } from './api.ts';

// Поддельный MAX для тестов: чаты, их участники и права бота — в памяти,
// отправленные ботом сообщения копятся в sent.

export type FakeChat = { title: string; botIsAdmin: boolean; members: MaxChatMember[] };

export type FakeMax = MaxApi & {
  chats: Map<number, FakeChat>;
  sent: Array<{ chatId: number; text: string; button?: MaxOpenAppButton }>;
  sentDirect: Array<{ userId: number; text: string; button?: MaxOpenAppButton }>;
  subscriptions: Array<{ url: string; secret: string }>;
  /** Следующие вызовы падают, как недоступный MAX. */
  failing: boolean;
};

export function member(userId: number, extra: Partial<MaxChatMember> = {}): MaxChatMember {
  return { userId, username: null, isAdmin: false, isOwner: false, isBot: false, ...extra };
}

export function createFakeMax(): FakeMax {
  const chats = new Map<number, FakeChat>();
  const fake: FakeMax = {
    chats,
    sent: [],
    sentDirect: [],
    subscriptions: [],
    failing: false,
    async chatTitle(chatId) {
      check();
      const chat = chats.get(chatId);
      if (!chat) throw new Error(`Нет чата ${chatId}`);
      return chat.title;
    },
    async member(chatId, userId) {
      check();
      return chats.get(chatId)?.members.find((item) => item.userId === userId && !item.isBot) ?? null;
    },
    async members(chatId) {
      check();
      return chats.get(chatId)?.members ?? [];
    },
    async botIsAdmin(chatId) {
      check();
      return chats.get(chatId)?.botIsAdmin ?? false;
    },
    async sendChatMessage(chatId, text, button) {
      check();
      fake.sent.push({ chatId, text, ...(button ? { button } : {}) });
    },
    async sendUserMessage(userId, text, button) {
      check();
      fake.sentDirect.push({ userId, text, ...(button ? { button } : {}) });
    },
    async subscribe(url, secret) {
      check();
      fake.subscriptions.push({ url, secret });
    },
  };
  function check() {
    if (fake.failing) throw new MaxApiError('MAX недоступен');
  }
  return fake;
}
