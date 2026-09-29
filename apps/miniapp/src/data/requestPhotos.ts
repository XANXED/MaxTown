import { useEffect, useState } from 'react';
import type { RequestPhoto } from '@maxtown/shared';
import { requestsClient } from './requests.ts';

// Фото к Заявке: телефон сжимает их перед отправкой, а показывает через
// сессию — адрес API в <img> не подставить, у него нет заголовка входа.

/** Длинная сторона фото после сжатия: деталей хватает, а весит в разы меньше. */
export const PHOTO_MAX_SIDE = 1600;
const PHOTO_QUALITY = 0.82;

/** Размер после сжатия: длинная сторона не больше maxSide, маленькие фото не растягиваем. */
export function scaledSize(width: number, height: number, maxSide = PHOTO_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Сжать фото в JPEG. Не вышло прочитать (редкий формат) — ошибка, фото пропускаем. */
export async function compressPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить фото');
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не удалось подготовить фото'))), 'image/jpeg', PHOTO_QUALITY);
    });
  } finally {
    bitmap.close();
  }
}

/** Фото с сервера — это адрес API, остальные (примеры, превью) показываются как есть. */
function isApiPhoto(url: string): boolean {
  return url.startsWith('/api/');
}

/**
 * Адреса для <img>: фото из API скачиваются с сессией и живут как object URL,
 * пока открыта карточка. Не скачалось — фото нет в списке.
 */
export function useRequestPhotoUrls(photos: RequestPhoto[]): Array<{ id: string; url: string }> {
  const key = photos.map(({ id, url }) => `${id}:${url}`).join('|');
  const [urls, setUrls] = useState<Array<{ id: string; url: string }>>(() => photos.filter(({ url }) => !isApiPhoto(url)));

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    void Promise.all(photos.map(async (photo) => {
      if (!isApiPhoto(photo.url)) return photo;
      try {
        const objectUrl = URL.createObjectURL(await requestsClient.photo(photo.url));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return null;
        }
        created.push(objectUrl);
        return { id: photo.id, url: objectUrl };
      } catch {
        return null;
      }
    })).then((loaded) => {
      if (!cancelled) setUrls(loaded.filter((photo): photo is { id: string; url: string } => photo !== null));
    });
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
    // photos меняется при каждом ответе сервера; перезагружаем, только когда изменился состав.
  }, [key]);

  return urls;
}
