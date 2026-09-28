import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HouseChatBinding } from './house-chat.ts';

export type RegisterHouseChat = {
  chatId: number;
  chatTitle: string;
};

export interface HouseChatRegistry {
  list(): Promise<HouseChatBinding[]>;
  register(chat: RegisterHouseChat): Promise<HouseChatBinding>;
}

function bindingFor(chat: RegisterHouseChat): HouseChatBinding {
  const chatTitle = chat.chatTitle.trim();
  if (!Number.isSafeInteger(chat.chatId) || chat.chatId === 0) throw new Error('Некорректный chatId');
  if (!chatTitle) throw new Error('Название Домового чата обязательно');

  return {
    houseId: `max-chat:${chat.chatId}`,
    houseLabel: chatTitle,
    chatId: chat.chatId,
  };
}

export class MemoryHouseChatRegistry implements HouseChatRegistry {
  private readonly chats = new Map<number, HouseChatBinding>();

  constructor(initial: HouseChatBinding[] = []) {
    initial.forEach((chat) => this.chats.set(chat.chatId, chat));
  }

  async list(): Promise<HouseChatBinding[]> {
    return [...this.chats.values()];
  }

  async register(chat: RegisterHouseChat): Promise<HouseChatBinding> {
    const binding = bindingFor(chat);
    this.chats.set(binding.chatId, binding);
    return binding;
  }
}

export class JsonHouseChatRegistry implements HouseChatRegistry {
  private writeQueue: Promise<unknown> = Promise.resolve();
  private readonly filePath: string;
  private readonly initial: HouseChatBinding[];

  constructor(filePath: string, initial: HouseChatBinding[] = []) {
    this.filePath = filePath;
    this.initial = initial;
  }

  private async readStored(): Promise<HouseChatBinding[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Реестр Домовых чатов повреждён');

    return parsed.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error('Реестр Домовых чатов повреждён');
      }
      const value = item as Record<string, unknown>;
      if (
        !Number.isSafeInteger(value.chatId) ||
        value.chatId === 0 ||
        typeof value.houseId !== 'string' ||
        !value.houseId ||
        typeof value.houseLabel !== 'string' ||
        !value.houseLabel
      ) {
        throw new Error('Реестр Домовых чатов повреждён');
      }
      return {
        chatId: value.chatId as number,
        houseId: value.houseId,
        houseLabel: value.houseLabel,
      };
    });
  }

  async list(): Promise<HouseChatBinding[]> {
    await this.writeQueue;
    const merged = new Map(this.initial.map((chat) => [chat.chatId, chat]));
    (await this.readStored()).forEach((chat) => merged.set(chat.chatId, chat));
    return [...merged.values()];
  }

  async register(chat: RegisterHouseChat): Promise<HouseChatBinding> {
    const binding = bindingFor(chat);
    const operation = this.writeQueue.then(async () => {
      const chats = new Map((await this.readStored()).map((item) => [item.chatId, item]));
      chats.set(binding.chatId, binding);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, `${JSON.stringify([...chats.values()], null, 2)}\n`, 'utf8');
      return binding;
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}
