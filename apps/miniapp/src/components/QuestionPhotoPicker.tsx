import { useEffect, useRef, type ChangeEvent } from 'react';
import { Camera, X } from '@phosphor-icons/react';
import { Typography } from './platform-ui.tsx';
import { pendingPhotoId } from '../data/requestPhotos.ts';

export type PendingQuestionPhoto = { id: string; name: string; url: string; file: File };
export const QUESTION_PHOTO_LIMIT = 4;

export function useQuestionPhotoCleanup(photos: PendingQuestionPhoto[]): void {
  const latest = useRef(photos);
  latest.current = photos;
  useEffect(() => () => latest.current.forEach((photo) => URL.revokeObjectURL(photo.url)), []);
}

export function QuestionPhotoPicker({ photos, onChange }: {
  photos: PendingQuestionPhoto[];
  onChange: (photos: PendingQuestionPhoto[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const add = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, QUESTION_PHOTO_LIMIT - photos.length);
    onChange([...photos, ...files.map((file) => ({ id: pendingPhotoId(), name: file.name, url: URL.createObjectURL(file), file }))]);
    event.target.value = '';
  };
  const remove = (photo: PendingQuestionPhoto) => {
    URL.revokeObjectURL(photo.url);
    onChange(photos.filter((item) => item.id !== photo.id));
  };
  return (
    <section className="form-section" aria-labelledby="management-photo-label">
      <Typography.Text asChild variant="title"><h2 id="management-photo-label">Фото</h2></Typography.Text>
      <div className="photo-grid">
        {photos.map((photo) => (
          <figure className="photo-tile" key={photo.id}>
            <img src={photo.url} alt={`Фото: ${photo.name}`} />
            <button className="photo-tile__remove pressable" type="button" aria-label={`Убрать фото ${photo.name}`} onClick={() => remove(photo)}>
              <X className="icon icon--small" weight="bold" aria-hidden />
            </button>
          </figure>
        ))}
        {photos.length < QUESTION_PHOTO_LIMIT ? (
          <button className="photo-add pressable" type="button" onClick={() => input.current?.click()}>
            <Camera className="icon" aria-hidden /><span>Добавить</span>
          </button>
        ) : null}
      </div>
      <input ref={input} className="visually-hidden" type="file" accept="image/*" multiple tabIndex={-1} aria-hidden onChange={add} />
      <Typography.Text asChild variant="description" color="tertiary"><p>До четырёх фото. Текст сообщения всё равно обязателен.</p></Typography.Text>
    </section>
  );
}
