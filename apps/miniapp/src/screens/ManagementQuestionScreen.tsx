import { useState, type FormEvent } from 'react';
import { ChatCircleText, PaperPlaneRight } from '@phosphor-icons/react';
import type { ManagementQuestionMessage, ManagementQuestionState } from '@maxtown/shared';
import { Button, Typography } from '../components/platform-ui.tsx';
import { QuestionPhotoPicker, useQuestionPhotoCleanup, type PendingQuestionPhoto } from '../components/QuestionPhotoPicker.tsx';
import { EmptyState, ErrorState, ListCard, ScreenHeading, SkeletonRows } from '../components/ui.tsx';
import { useMembership } from '../auth/membership.tsx';
import { managementQuestionsClient, useManagementPhotoUrls, useManagementQuestion } from '../data/managementQuestions.ts';
import { compressPhoto } from '../data/requestPhotos.ts';
import { formatUpdatedAt } from '../data/labels.ts';
import type { Notify } from './types.ts';

const stateLabels: Record<ManagementQuestionState, string> = {
  'waiting-for-answer': 'Ждёт ответа УК',
  answered: 'УК ответила',
  closed: 'Вопрос закрыт',
};

function QuestionMessage({ message }: { message: ManagementQuestionMessage }) {
  const photos = useManagementPhotoUrls(message.photos);
  const author = message.authorRole === 'management-company' ? `УК · ${message.authorName}` : message.authorName;
  return (
    <li className={`comment ${message.mine ? 'comment--mine' : 'comment--theirs'} management-message`}>
      <span className="comment__author">{author}</span>
      <span className="comment__text">{message.text}</span>
      {photos.length > 0 ? <span className="management-message__photos">{photos.map((photo, index) => <img key={photo.id} src={photo.url} alt={`Фото ${index + 1} к сообщению`} loading="lazy" />)}</span> : null}
      <time className="comment__time" dateTime={message.at}>{formatUpdatedAt(message.at)}</time>
    </li>
  );
}

export function ManagementQuestionScreen({ id, notify }: { id: string; notify: Notify }) {
  const membership = useMembership();
  const loadable = useManagementQuestion(id);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PendingQuestionPhoto[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useQuestionPhotoCleanup(photos);

  if (loadable.status === 'loading') return <main className="screen screen--inner" id="main-content"><div className="inner-content"><SkeletonRows count={5} /></div></main>;
  if (loadable.status === 'error') return <main className="screen screen--inner" id="main-content"><div className="inner-content"><ErrorState onRetry={loadable.retry} /></div></main>;
  if (!loadable.data || !membership) return <main className="screen screen--inner" id="main-content"><div className="inner-content"><div className="list-card"><EmptyState icon={ChatCircleText} title="Вопрос не найден" description="Возможно, он относится к другому Дому" /></div></div></main>;
  const { question, managementAssigned } = loadable.data;

  const refreshAfterPhotos = async (messageId: string) => {
    let failed = 0;
    for (const photo of photos) {
      try { await managementQuestionsClient.uploadPhoto(membership.houseId, question.id, messageId, await compressPhoto(photo.file)); }
      catch { failed += 1; }
    }
    const fresh = await managementQuestionsClient.get(membership.houseId, question.id);
    if (fresh) loadable.replace(fresh);
    photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    setPhotos([]);
    if (failed) notify(`Сообщение отправлено, но не загрузилось фото: ${failed}`);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) { setError('Напишите сообщение'); return; }
    setSending(true); setError('');
    try {
      const result = question.canReopen
        ? await managementQuestionsClient.reopen(membership.houseId, question.id, { text: text.trim() })
        : await managementQuestionsClient.message(membership.houseId, question.id, { text: text.trim() });
      loadable.replace({ question: result.question, managementAssigned });
      setText('');
      await refreshAfterPhotos(result.messageId);
      notify(question.canReopen ? 'Вопрос возобновлён' : membership.role === 'management-company' ? 'Ответ опубликован' : 'Сообщение отправлено');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось отправить сообщение');
    } finally { setSending(false); }
  };

  const close = async () => {
    setSending(true); setError('');
    try {
      const changed = await managementQuestionsClient.close(membership.houseId, question.id);
      loadable.replace({ question: changed, managementAssigned });
      notify('Вопрос закрыт');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось закрыть вопрос'); }
    finally { setSending(false); }
  };

  const canCompose = question.canWrite || question.canReopen;
  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <ScreenHeading description={`${question.authorName} · ${stateLabels[question.state]}`}>{question.title}</ScreenHeading>
        {!managementAssigned && question.state !== 'closed' ? <div className="management-info" role="status"><ChatCircleText className="icon icon--small" aria-hidden /><p>УК ещё не подключена. Вопрос сохранён и будет доставлен после назначения.</p></div> : null}
        <ListCard label="Переписка по вопросу"><ol className="comments management-messages">{question.messages.map((message) => <QuestionMessage key={message.id} message={message} />)}</ol></ListCard>
        <section className="management-history" aria-labelledby="management-history-title">
          <Typography.Text asChild variant="subheader"><h2 id="management-history-title">История</h2></Typography.Text>
          <ol>{question.history.map((change, index) => <li key={`${change.at}-${index}`}><span>{stateLabels[change.state]}</span><time dateTime={change.at}>{formatUpdatedAt(change.at)}</time></li>)}</ol>
        </section>
        {canCompose ? (
          <form className="management-composer" onSubmit={(event) => void submit(event)}>
            <label htmlFor="management-message">{question.canReopen ? 'Почему вопрос снова актуален' : membership.role === 'management-company' ? 'Ответ УК' : 'Уточнение'}</label>
            <textarea id="management-message" className="comment-form__input management-composer__input" value={text} maxLength={4000} rows={4} placeholder="Напишите сообщение" onChange={(event) => setText(event.target.value)} required />
            <QuestionPhotoPicker photos={photos} onChange={setPhotos} />
            <Button type="submit" size="large" stretched loading={sending} iconBefore={<PaperPlaneRight className="icon icon--small" aria-hidden />}>{question.canReopen ? 'Возобновить вопрос' : membership.role === 'management-company' ? 'Опубликовать ответ' : 'Отправить уточнение'}</Button>
          </form>
        ) : question.state === 'closed' ? <Typography.Text asChild variant="description" color="secondary"><p>Переписка закрыта автором и доступна только для чтения.</p></Typography.Text> : <Typography.Text asChild variant="description" color="secondary"><p>Писать в этой теме могут только автор вопроса и УК.</p></Typography.Text>}
        {question.canClose ? <Button type="button" variant="secondary" disabled={sending} onClick={() => void close()}>Закрыть вопрос</Button> : null}
        {error ? <p className="field-error" role="alert">{error}</p> : null}
      </div>
    </main>
  );
}
