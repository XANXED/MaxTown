import { useEffect, useState, type FormEvent } from 'react';
import { Info } from '@phosphor-icons/react';
import { Button, Input, Textarea, Typography } from '../components/platform-ui.tsx';
import { QuestionPhotoPicker, useQuestionPhotoCleanup, type PendingQuestionPhoto } from '../components/QuestionPhotoPicker.tsx';
import { ScreenHeading } from '../components/ui.tsx';
import { useMembership } from '../auth/membership.tsx';
import { managementQuestionsClient } from '../data/managementQuestions.ts';
import { compressPhoto } from '../data/requestPhotos.ts';
import { managementQuestionRoute, ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

export function NewManagementQuestionScreen({ navigate, notify }: { navigate: Navigate; notify: Notify }) {
  const membership = useMembership();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PendingQuestionPhoto[]>([]);
  const [assigned, setAssigned] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useQuestionPhotoCleanup(photos);

  useEffect(() => {
    if (!membership) return;
    void managementQuestionsClient.list(membership.houseId).then((result) => setAssigned(result.managementAssigned)).catch(() => undefined);
  }, [membership?.houseId]);

  if (!membership) return <main className="screen screen--inner" id="main-content"><div className="inner-content"><ScreenHeading description="Сначала подключитесь к Дому">Задать вопрос УК</ScreenHeading></div></main>;
  if (membership.role === 'management-company') return <main className="screen screen--inner" id="main-content"><div className="inner-content"><ScreenHeading description="Аккаунт УК отвечает в уже созданных темах">Задать вопрос УК</ScreenHeading></div></main>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !text.trim()) { setError('Заполните тему и текст вопроса'); return; }
    setSaving(true); setError('');
    try {
      const question = await managementQuestionsClient.create(membership.houseId, { title: title.trim(), text: text.trim() });
      const messageId = question.messages[0]?.id;
      let failed = 0;
      if (messageId) {
        for (const photo of photos) {
          try { await managementQuestionsClient.uploadPhoto(membership.houseId, question.id, messageId, await compressPhoto(photo.file)); }
          catch { failed += 1; }
        }
      }
      notify(failed ? `Вопрос опубликован, но не загрузилось фото: ${failed}` : assigned === false ? 'Вопрос сохранён и ждёт подключения УК' : 'Вопрос опубликован');
      navigate(managementQuestionRoute(question.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось опубликовать вопрос');
    } finally { setSaving(false); }
  };

  return (
    <main className="screen screen--inner contact-form" id="main-content">
      <form onSubmit={(event) => void submit(event)}>
        <div className="inner-content stagger">
          <ScreenHeading description="Ответ будет доступен всем участникам Дома">Задать вопрос УК</ScreenHeading>
          {assigned === false ? <div className="management-info" role="status"><Info className="icon icon--small" aria-hidden /><p>УК ещё не подключена. Вопрос сохранится и будет доставлен после назначения.</p></div> : null}
          <div className="management-info"><Info className="icon icon--small" aria-hidden /><p>Ваше имя и переписку увидит весь Дом. Номер Квартиры не публикуется.</p></div>
          <label className="contact-form__field"><span>Тема</span><Input value={title} maxLength={120} placeholder="Например, когда включат отопление?" onChange={(event) => setTitle(event.target.value)} required /></label>
          <label className="contact-form__field"><span>Вопрос</span><Textarea value={text} maxLength={4000} rows={6} placeholder="Опишите, что хотите уточнить у УК" onChange={(event) => setText(event.target.value)} required /></label>
          <QuestionPhotoPicker photos={photos} onChange={setPhotos} />
          <Typography.Text asChild variant="description" color="secondary"><p>Если что-то сломалось в Квартире или Общем имуществе, оформите Заявку — так неисправность попадёт в работу.</p></Typography.Text>
          <Button type="button" variant="secondary" onClick={() => navigate(ROUTES.newRequest)}>Подать Заявку</Button>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </div>
        <footer className="bottom-panel"><Button type="submit" size="large" stretched loading={saving}>Опубликовать вопрос</Button></footer>
      </form>
    </main>
  );
}
