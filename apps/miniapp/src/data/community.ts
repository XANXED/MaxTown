import type { CommunityMessage, CommunityPoll } from '@maxtown/shared';
import { apiFetch } from '../auth/session.ts';

export type CommunityPage = { messages: CommunityMessage[]; nextCursor: string | null };

export function parsePollOptions(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function expectOk(response: Response, message: string): Promise<void> {
  if (!response.ok) throw new Error(message);
}

export async function loadCommunityMessages(houseId: string, before?: string): Promise<CommunityPage> {
  const query = new URLSearchParams({ limit: '50' });
  if (before) query.set('before', before);
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/community/messages?${query}`);
  await expectOk(response, 'Не удалось загрузить сообщения Дома');
  return response.json() as Promise<CommunityPage>;
}

export async function sendCommunityMessage(houseId: string, body: string): Promise<CommunityMessage> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/community/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
  });
  await expectOk(response, 'Не удалось отправить сообщение');
  return (await response.json() as { message: CommunityMessage }).message;
}

export async function loadCommunityPolls(houseId: string): Promise<CommunityPoll[]> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/polls`);
  await expectOk(response, 'Не удалось загрузить Опросы');
  return (await response.json() as { polls: CommunityPoll[] }).polls;
}

export async function createCommunityPoll(houseId: string, question: string, options: string[]): Promise<CommunityPoll> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/polls`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, options: options.map((label) => ({ label })) }),
  });
  await expectOk(response, 'Не удалось создать Опрос');
  return (await response.json() as { poll: CommunityPoll }).poll;
}

export async function voteInCommunityPoll(houseId: string, pollId: string, optionId: string): Promise<void> {
  const response = await apiFetch(`/api/houses/${encodeURIComponent(houseId)}/polls/${encodeURIComponent(pollId)}/votes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId }),
  });
  await expectOk(response, 'Не удалось записать голос. Возможно, Опрос уже закрыт или голос учтён.');
}
