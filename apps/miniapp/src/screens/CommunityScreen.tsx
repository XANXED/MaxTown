import { useCallback, useEffect, useState, type FormEvent } from 'react';
import bridge from '@vkontakte/vk-bridge';
import { ArrowClockwise, ChatCircle, PaperPlaneRight, Plus } from '@phosphor-icons/react';
import { Button, Input, Spinner, Textarea, Typography } from '../components/platform-ui.tsx';
import type { CommunityMessage, CommunityPoll, HouseRole } from '@maxtown/shared';
import { getCurrentResident } from '../auth/session.ts';
import { loadVkMessagePermission, requestVkMessagesPermission, setVkMessagePermission } from '../data/notifications.ts';
import {
  createCommunityPoll,
  loadCommunityMessages,
  loadCommunityPolls,
  parsePollOptions,
  sendCommunityMessage,
  voteInCommunityPoll,
  type CommunityPage,
} from '../data/community.ts';

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

export function CommunityScreen({ houseId, role, selectedPollId }: { houseId: string | null; role: HouseRole | null; selectedPollId?: string | null }) {
  const [resolvedHouseId, setResolvedHouseId] = useState(houseId);
  const [resolvedRole, setResolvedRole] = useState(role);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [polls, setPolls] = useState<CommunityPoll[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [question, setQuestion] = useState('');
  const [optionsDraft, setOptionsDraft] = useState('За\nПротив');
  const [showPollForm, setShowPollForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [messagePermission, setMessagePermission] = useState<{ status: 'unknown' | 'allowed' | 'denied' | 'opted_out'; groupId: number | null } | null>(null);
  const [permissionSaving, setPermissionSaving] = useState(false);

  const refresh = useCallback(async (initial = false) => {
    if (!resolvedHouseId) return;
    if (initial) setStatus('loading');
    try {
      const [page, loadedPolls] = await Promise.all([loadCommunityMessages(resolvedHouseId), loadCommunityPolls(resolvedHouseId)]);
      setMessages(page.messages);
      setNextCursor(page.nextCursor);
      setPolls(loadedPolls);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [resolvedHouseId]);

  useEffect(() => {
    setResolvedHouseId(houseId);
    setResolvedRole(role);
    if (houseId && role) return;
    void getCurrentResident().then((me) => {
      const membership = me.memberships.find((item) => item.houseId === houseId) ?? me.memberships[0];
      setResolvedHouseId(houseId ?? membership?.houseId ?? null);
      setResolvedRole(membership?.role ?? null);
    }).catch(() => { if (!houseId) setResolvedHouseId(null); });
  }, [houseId, role]);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!resolvedHouseId) return;
    let active = true;
    void loadVkMessagePermission().then((permission) => { if (active) setMessagePermission(permission); })
      .catch(() => { if (active) setMessagePermission(null); });
    return () => { active = false; };
  }, [resolvedHouseId]);

  useEffect(() => {
    if (status !== 'ready' || !selectedPollId) return;
    document.getElementById(`community-poll-${selectedPollId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [polls, selectedPollId, status]);

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolvedHouseId || !draft.trim()) return;
    setSending(true);
    setNotice('');
    void sendCommunityMessage(resolvedHouseId, draft.trim()).then((message) => {
      setMessages((current) => [message, ...current]);
      setDraft('');
    }).catch(() => setNotice('Не удалось отправить сообщение. Попробуйте ещё раз.'))
      .finally(() => setSending(false));
  };

  const loadOlder = async () => {
    if (!resolvedHouseId || !nextCursor) return;
    try {
      const page: CommunityPage = await loadCommunityMessages(resolvedHouseId, nextCursor);
      setMessages((current) => [...current, ...page.messages]);
      setNextCursor(page.nextCursor);
    } catch { setNotice('Не удалось загрузить старые сообщения.'); }
  };

  const submitPoll = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolvedHouseId) return;
    const options = parsePollOptions(optionsDraft);
    if (question.trim().length < 3 || options.length < 2 || options.length > 8) {
      setNotice('Укажите вопрос и от 2 до 8 вариантов — по одному в строке.');
      return;
    }
    setSending(true);
    void createCommunityPoll(resolvedHouseId, question.trim(), options).then((poll) => {
      setPolls((current) => [poll, ...current]);
      setQuestion('');
      setOptionsDraft('За\nПротив');
      setShowPollForm(false);
      setNotice('Опрос опубликован');
    }).catch(() => setNotice('Не удалось создать Опрос. Проверьте варианты и попробуйте снова.'))
      .finally(() => setSending(false));
  };

  const castVote = async (pollId: string, optionId: string) => {
    if (!resolvedHouseId) return;
    setSending(true);
    try {
      await voteInCommunityPoll(resolvedHouseId, pollId, optionId);
      await refresh();
      setNotice('Голос учтён. Изменить его нельзя.');
    } catch { setNotice('Не удалось записать голос. Обновите экран и проверьте, открыт ли Опрос.'); }
    finally { setSending(false); }
  };

  const allowVkMessages = async () => {
    const groupId = messagePermission?.groupId;
    if (!groupId) return;
    setPermissionSaving(true);
    setNotice('');
    try {
      const allowed = await requestVkMessagesPermission(bridge, groupId);
      if (!allowed) throw new Error('VK не подтвердил разрешение');
      setMessagePermission({ status: 'allowed', groupId });
      setNotice('Уведомления VK включены. Уведомления в приложении доступны всегда.');
    } catch {
      setNotice('Не удалось включить сообщения VK. Уведомления в приложении останутся доступны.');
    } finally { setPermissionSaving(false); }
  };

  const optOutOfVkMessages = async () => {
    const groupId = messagePermission?.groupId;
    if (!groupId) return;
    setPermissionSaving(true);
    try {
      await setVkMessagePermission(false);
      setMessagePermission({ status: 'opted_out', groupId });
      setNotice('Сообщения VK отключены. Уведомления в приложении останутся доступны.');
    } catch {
      setNotice('Не удалось сохранить настройку уведомлений. Попробуйте ещё раз.');
    } finally { setPermissionSaving(false); }
  };

  if (!resolvedHouseId) {
    return (
      <main className="screen screen--inner inner-content" id="main-content">
        <section className="decision-card">
          <ChatCircle className="icon" aria-hidden />
          <Typography.Text asChild variant="title"><h1>Сначала вступите в Дом</h1></Typography.Text>
          <Typography.Text asChild variant="description" color="secondary"><p>Чат и Опросы видны Жильцам Дома.</p></Typography.Text>
        </section>
      </main>
    );
  }

  const canCreatePoll = Boolean(resolvedRole);

  return (
    <main className="screen screen--inner community-screen" id="main-content">
      <div className="inner-content stagger">
        <header className="community-heading">
          <span>
            <Typography.Text asChild variant="header"><h1>Чат Дома</h1></Typography.Text>
            <Typography.Text asChild variant="description" color="secondary"><p>Сообщения соседей и неформальные Опросы</p></Typography.Text>
          </span>
          <Button size="small" variant="secondary" iconBefore={<ArrowClockwise className="icon icon--small" aria-hidden />} onClick={() => void refresh(true)}>Обновить</Button>
        </header>

        <section className="community-panel" aria-labelledby="polls-heading">
          <div className="community-panel__heading">
            <Typography.Text asChild variant="title"><h2 id="polls-heading">Опросы соседей</h2></Typography.Text>
            {canCreatePoll ? <Button size="small" variant="secondary" iconBefore={<Plus className="icon icon--small" aria-hidden />} onClick={() => setShowPollForm((value) => !value)}>Создать</Button> : null}
          </div>
          <Typography.Text asChild variant="description" color="secondary"><p>Голоса анонимны: видны только суммарные результаты и ваш выбор. Опрос не заменяет собрание собственников.</p></Typography.Text>
          <div className="community-permission">
            <Typography.Text asChild variant="description" color="secondary"><p>Уведомления в приложении приходят всем Жильцам. Ссылки на новые Опросы можно дополнительно получать в сообщениях VK.</p></Typography.Text>
            {messagePermission?.groupId ? (
              messagePermission.status === 'allowed' ? (
                <Button size="small" variant="secondary" loading={permissionSaving} onClick={() => void optOutOfVkMessages()}>Отключить сообщения VK</Button>
              ) : (
                <div className="community-permission__actions">
                  <Button size="small" variant="secondary" loading={permissionSaving} onClick={() => void allowVkMessages()}>
                    {messagePermission.status === 'opted_out' || messagePermission.status === 'denied' ? 'Разрешить сообщения VK' : 'Включить уведомления VK'}
                  </Button>
                  {messagePermission.status !== 'opted_out' ? <Button size="small" variant="ghost" disabled={permissionSaving} onClick={() => void optOutOfVkMessages()}>Оставить только уведомления в приложении</Button> : null}
                </div>
              )
            ) : null}
          </div>
          {showPollForm ? (
            <form className="community-form" onSubmit={submitPoll}>
              <Input mode="contrast" size="large" aria-label="Вопрос Опроса" placeholder="О чём спросить соседей?" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} />
              <Textarea aria-label="Варианты ответа, по одному в строке" placeholder="Каждый вариант — с новой строки" value={optionsDraft} rows={3} maxLength={1600} onChange={(event) => setOptionsDraft(event.target.value)} />
              <Button type="submit" size="medium" variant="primary" stretched loading={sending}>Опубликовать Опрос</Button>
            </form>
          ) : null}
          {polls.length === 0 && status === 'ready' ? <p className="community-empty">Пока нет Опросов.</p> : null}
          <div className="community-polls">
            {polls.map((poll) => {
              const closed = poll.closesAt !== null && Date.parse(poll.closesAt) <= Date.now();
              const total = poll.options.reduce((sum, option) => sum + option.votes, 0);
              return (
                <article className="community-poll" key={poll.id} id={`community-poll-${poll.id}`}>
                  <span className="caps-label">Неформальный Опрос</span>
                  <Typography.Text asChild variant="body-strong"><h3>{poll.question}</h3></Typography.Text>
                  {poll.closesAt ? <Typography.Text asChild variant="description" color="secondary"><p>{closed ? 'Опрос закрыт' : `До ${timeFormat.format(new Date(poll.closesAt))}`}</p></Typography.Text> : null}
                  <div className="community-poll__options">
                    {poll.options.map((option) => (
                      <Button key={option.id} size="small" variant={poll.myVoteOptionId === option.id ? 'primary' : 'secondary'} stretched
                        disabled={sending || Boolean(poll.myVoteOptionId) || closed} onClick={() => void castVote(poll.id, option.id)}>
                        {option.label} · {option.votes}
                      </Button>
                    ))}
                  </div>
                  <Typography.Text asChild variant="description" color="secondary"><p>Ответов: {total}{poll.myVoteOptionId ? '. Голос учтён, изменить его нельзя.' : ''}</p></Typography.Text>
                </article>
              );
            })}
          </div>
        </section>

        <section className="community-panel" aria-labelledby="messages-heading">
          <Typography.Text asChild variant="title"><h2 id="messages-heading">Сообщения</h2></Typography.Text>
          {status === 'loading' ? <div className="join-checking"><Spinner size={20} />Загружаем сообщения…</div> : null}
          {status === 'error' ? <div className="community-error" role="alert">Не удалось загрузить чат. Проверьте подключение и обновите экран.</div> : null}
          {status === 'ready' && messages.length === 0 ? <p className="community-empty">Начните разговор с соседями.</p> : null}
          {nextCursor ? <Button size="small" variant="ghost" stretched onClick={() => void loadOlder()}>Показать старые сообщения</Button> : null}
          <ol className="community-messages" aria-live="polite">
            {messages.map((message) => (
              <li className="community-message" key={message.id}>
                <div className="community-message__meta"><span>{message.authorName} · {message.authorRole === 'headman' ? 'Староста' : message.authorRole === 'responsible' ? 'Ответственный' : message.authorRole === 'concierge' ? 'Консьерж' : 'Жилец'}</span><time dateTime={message.createdAt}>{timeFormat.format(new Date(message.createdAt))}</time></div>
                <p>{message.body}</p>
              </li>
            ))}
          </ol>
          <form className="community-form community-form--message" onSubmit={submitMessage}>
            <Textarea aria-label="Сообщение соседям" placeholder="Напишите соседям" value={draft} rows={3} maxLength={4000} onChange={(event) => setDraft(event.target.value)} />
            <Button type="submit" size="medium" variant="primary" stretched loading={sending} disabled={!draft.trim()} iconBefore={<PaperPlaneRight className="icon icon--small" aria-hidden />}>Отправить</Button>
          </form>
        </section>
        {notice ? <p className="community-notice" role="status">{notice}</p> : null}
      </div>
    </main>
  );
}
