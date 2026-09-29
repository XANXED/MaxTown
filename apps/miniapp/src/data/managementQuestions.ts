import { useEffect, useState } from 'react';
import type {
  ManagementQuestion,
  ManagementQuestionInput,
  ManagementQuestionMessageInput,
  ManagementQuestionPhoto,
  ManagementQuestionsResponse,
} from '@maxtown/shared';
import { useMembership } from '../auth/membership.tsx';
import { apiFetch } from '../auth/session.ts';
import { ApiError, jsonRequest, readApiJson, type Fetcher } from './api.ts';
import { useApiLoadable, type ApiLoadable } from './loadable.ts';

const errors: Record<string, string> = {
  management_question_not_found: 'Вопрос не найден',
  management_question_create_forbidden: 'УК отвечает на вопросы, но не создаёт их от своего имени',
  management_question_write_forbidden: 'Писать в этой теме могут только автор и УК',
  management_question_close_forbidden: 'Закрыть вопрос может только его автор',
  management_question_reopen_forbidden: 'Возобновить вопрос может только его автор',
  management_question_closed: 'Вопрос уже закрыт',
  management_question_not_closed: 'Вопрос уже открыт',
  management_question_title_invalid: 'Укажите тему вопроса',
  management_question_text_invalid: 'Напишите текст сообщения',
  photo_limit_reached: 'К сообщению уже приложено 4 фото',
  management_question_photo_forbidden: 'Добавлять фото может только автор сообщения',
  unsupported_photo: 'Нужен JPEG, PNG или WebP',
  photo_too_large: 'Фото слишком большое',
  payload_too_large: 'Фото слишком большое',
  forbidden: 'Вы больше не участник этого Дома',
};

export type ManagementQuestionDetailsResponse = {
  question: ManagementQuestion;
  managementAssigned: boolean;
};

const read = <T,>(response: Response, fallback: string) => readApiJson<T>(response, fallback, errors);

export function createManagementQuestionsClient(fetcher: Fetcher = apiFetch) {
  const base = (houseId: string) => `/api/houses/${encodeURIComponent(houseId)}/management-questions`;
  const one = (houseId: string, questionId: string) => `${base(houseId)}/${encodeURIComponent(questionId)}`;
  return {
    list: async (houseId: string): Promise<ManagementQuestionsResponse> =>
      read(await fetcher(base(houseId)), 'Не удалось загрузить Вопросы в УК'),
    get: async (houseId: string, questionId: string): Promise<ManagementQuestionDetailsResponse | null> => {
      const response = await fetcher(one(houseId, questionId));
      if (response.status === 404) return null;
      return read(response, 'Не удалось загрузить Вопрос в УК');
    },
    create: async (houseId: string, input: ManagementQuestionInput): Promise<ManagementQuestion> =>
      (await read<{ question: ManagementQuestion }>(await fetcher(base(houseId), jsonRequest('POST', input)), 'Не удалось опубликовать Вопрос')).question,
    message: async (houseId: string, questionId: string, input: ManagementQuestionMessageInput): Promise<{ messageId: string; question: ManagementQuestion }> =>
      read(await fetcher(`${one(houseId, questionId)}/messages`, jsonRequest('POST', input)), 'Не удалось отправить сообщение'),
    close: async (houseId: string, questionId: string): Promise<ManagementQuestion> =>
      (await read<{ question: ManagementQuestion }>(await fetcher(`${one(houseId, questionId)}/close`, { method: 'POST' }), 'Не удалось закрыть Вопрос')).question,
    reopen: async (houseId: string, questionId: string, input: ManagementQuestionMessageInput): Promise<{ messageId: string; question: ManagementQuestion }> =>
      read(await fetcher(`${one(houseId, questionId)}/reopen`, jsonRequest('POST', input)), 'Не удалось возобновить Вопрос'),
    uploadPhoto: async (houseId: string, questionId: string, messageId: string, photo: Blob): Promise<void> => {
      await read(await fetcher(`${one(houseId, questionId)}/messages/${encodeURIComponent(messageId)}/photos`, {
        method: 'POST', headers: { 'Content-Type': photo.type || 'image/jpeg' }, body: photo,
      }), 'Не удалось загрузить фото');
    },
    photo: async (url: string): Promise<Blob> => {
      const response = await fetcher(url);
      if (!response.ok) throw new ApiError('Не удалось загрузить фото', null, response.status);
      return response.blob();
    },
  };
}

export const managementQuestionsClient = createManagementQuestionsClient();

const emptyList: ManagementQuestionsResponse = { questions: [], managementAssigned: false };

export function useManagementQuestions(): ApiLoadable<ManagementQuestionsResponse> {
  const houseId = useMembership()?.houseId ?? null;
  return useApiLoadable(houseId ? () => managementQuestionsClient.list(houseId) : null, emptyList, () => emptyList, houseId ?? '');
}

export function useManagementQuestion(id: string): ApiLoadable<ManagementQuestionDetailsResponse | null> {
  const houseId = useMembership()?.houseId ?? null;
  return useApiLoadable(houseId ? () => managementQuestionsClient.get(houseId, id) : null, null, () => null, `${houseId ?? ''}:${id}`);
}

export function useManagementPhotoUrls(photos: ManagementQuestionPhoto[]): Array<{ id: string; url: string }> {
  const key = photos.map(({ id, url }) => `${id}:${url}`).join('|');
  const [urls, setUrls] = useState<Array<{ id: string; url: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    void Promise.all(photos.map(async (photo) => {
      try {
        const url = URL.createObjectURL(await managementQuestionsClient.photo(photo.url));
        if (cancelled) { URL.revokeObjectURL(url); return null; }
        created.push(url);
        return { id: photo.id, url };
      } catch { return null; }
    })).then((loaded) => { if (!cancelled) setUrls(loaded.filter((item): item is { id: string; url: string } => item !== null)); });
    return () => { cancelled = true; created.forEach((url) => URL.revokeObjectURL(url)); };
  }, [key]);
  return urls;
}
