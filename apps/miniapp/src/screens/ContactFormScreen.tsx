import { useEffect, useState, type FormEvent } from 'react';
import { NativeSelect } from '@vkontakte/vkui';
import { Headset, Warning } from '@phosphor-icons/react';
import type { HouseContact, HouseContactInput, HouseContactKind, HouseRole } from '@maxtown/shared';
import { Button, Input, Spinner, Textarea, Typography } from '../components/platform-ui.tsx';
import { ScreenHeading } from '../components/ui.tsx';
import { contactsClient } from '../data/contacts.ts';
import { demoMode, loadFixtures } from '../data/loadable.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

const categories: Array<{ value: HouseContactKind; label: string; title: string }> = [
  { value: 'management', label: 'Управляющая организация', title: 'Управляющая организация' },
  { value: 'dispatch', label: 'Диспетчерская', title: 'Диспетчерская' },
  { value: 'house-emergency', label: 'Аварийная служба Дома', title: 'Аварийная служба' },
  { value: 'plumber', label: 'Сантехник', title: 'Сантехник' },
  { value: 'electrician', label: 'Электрик', title: 'Электрик' },
  { value: 'elevator', label: 'Лифтовая служба', title: 'Лифтовая служба' },
  { value: 'intercom', label: 'Домофон', title: 'Обслуживание домофона' },
  { value: 'security', label: 'Консьерж или охрана', title: 'Консьерж или охрана' },
  { value: 'district-police', label: 'Участковый', title: 'Участковый' },
  { value: 'other', label: 'Другое', title: '' },
];

function suggestedTitle(kind: HouseContactKind): string {
  return categories.find(({ value }) => value === kind)?.title ?? '';
}

export function ContactFormScreen({
  houseId,
  role,
  contactId,
  navigate,
  notify,
}: {
  houseId: string | null;
  role: HouseRole | null;
  contactId?: string;
  navigate: Navigate;
  notify: Notify;
}) {
  const [kind, setKind] = useState<HouseContactKind>('dispatch');
  const [title, setTitle] = useState(suggestedTitle('dispatch'));
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [link, setLink] = useState('');
  const [contact, setContact] = useState<HouseContact | null>(null);
  const [status, setStatus] = useState<'ready' | 'loading' | 'error'>(contactId ? 'loading' : 'ready');
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDemo = demoMode() === 'filled';
  const resolvedHouseId = houseId ?? (isDemo ? 'demo-house' : null);
  const resolvedRole = role ?? (isDemo ? 'headman' : null);

  useEffect(() => {
    if (!contactId || !resolvedHouseId || resolvedRole !== 'headman') return;
    let cancelled = false;
    setStatus('loading');
    const request = isDemo
      ? loadFixtures()!.then(({ sampleContacts }) => ({ contacts: sampleContacts }))
      : contactsClient.load(resolvedHouseId);
    void request
      .then(({ contacts }) => {
        if (cancelled) return;
        const found = contacts.find(({ id }) => id === contactId);
        if (!found) throw new Error('contact_not_found');
        setContact(found);
        setKind(found.kind);
        setTitle(found.title);
        setDescription(found.description ?? '');
        setPhone(found.phone ?? '');
        setLink(found.link ?? '');
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [contactId, isDemo, resolvedHouseId, resolvedRole]);

  if (!resolvedHouseId) {
    return <MessageState title="Сначала вступите в Дом" description="Контакты доступны Жильцам Дома." />;
  }
  if (resolvedRole !== 'headman') {
    return <MessageState title="Изменение недоступно" description="Добавлять и изменять контакты может только Староста." />;
  }
  if (status === 'loading') {
    return <main className="screen screen--inner inner-content join-checking" id="main-content"><Spinner size={20} />Загружаем контакт…</main>;
  }
  if (status === 'error') {
    return <MessageState title="Не удалось открыть контакт" description="Вернитесь к списку и попробуйте ещё раз." />;
  }

  const changeKind = (next: HouseContactKind) => {
    const previousSuggestion = suggestedTitle(kind);
    setKind(next);
    if (!title.trim() || title === previousSuggestion) setTitle(suggestedTitle(next));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanPhone = phone.trim();
    const cleanLink = link.trim();
    if (!cleanTitle) {
      setError('Укажите название контакта');
      return;
    }
    if (!cleanPhone && !cleanLink) {
      setError('Укажите телефон или HTTPS-ссылку');
      return;
    }
    if (cleanPhone && !/\d/u.test(cleanPhone)) {
      setError('Проверьте номер телефона');
      return;
    }
    if (cleanLink && !cleanLink.startsWith('https://')) {
      setError('Ссылка должна начинаться с https://');
      return;
    }
    const input: HouseContactInput = {
      kind,
      title: cleanTitle,
      description: description.trim() || null,
      phone: cleanPhone || null,
      link: cleanLink || null,
    };
    setError(null);
    setSaving(true);
    try {
      if (!isDemo) await contactsClient.save(resolvedHouseId, input, contactId);
      notify(contactId ? 'Контакт изменён' : 'Контакт добавлен');
      navigate(ROUTES.contacts);
    } catch {
      setError('Не удалось сохранить контакт. Проверьте подключение и попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!contactId) return;
    setSaving(true);
    setError(null);
    try {
      if (!isDemo) await contactsClient.remove(resolvedHouseId, contactId);
      notify('Контакт удалён');
      navigate(ROUTES.contacts);
    } catch {
      setError('Не удалось удалить контакт. Попробуйте ещё раз.');
      setSaving(false);
    }
  };

  return (
    <main className="screen screen--inner screen--with-panel" id="main-content">
      <form className="contact-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="inner-content stagger">
          <ScreenHeading description="Название и хотя бы один способ связи обязательны">
            {contactId ? 'Изменить полезный контакт' : 'Новый полезный контакт'}
          </ScreenHeading>

          {contact?.source === 'data-mos' && !contact.overridden ? (
            <aside className="contact-warning">
              <Warning className="icon icon--small" weight="fill" aria-hidden />
              <Typography.Text asChild variant="description" color="secondary">
                <p>После сохранения источник больше не будет перезаписывать этот контакт.</p>
              </Typography.Text>
            </aside>
          ) : null}

          <label className="contact-form__field">
            <span>Категория</span>
            <NativeSelect value={kind} onChange={(event) => changeKind(event.target.value as HouseContactKind)} aria-label="Категория контакта">
              {categories.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
            </NativeSelect>
          </label>
          <label className="contact-form__field">
            <span>Название</span>
            <Input value={title} maxLength={160} placeholder="Например, дежурный сантехник" onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="contact-form__field">
            <span>Пояснение</span>
            <Textarea value={description} maxLength={1000} rows={3} placeholder="Имя, часы работы или зона ответственности" onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="contact-form__field">
            <span>Телефон</span>
            <Input type="tel" inputMode="tel" value={phone} maxLength={80} placeholder="+7 495 000-00-00" onChange={(event) => setPhone(event.target.value)} />
          </label>
          <label className="contact-form__field">
            <span>HTTPS-ссылка</span>
            <Input type="url" inputMode="url" value={link} maxLength={500} placeholder="https://example.ru" onChange={(event) => setLink(event.target.value)} />
          </label>
          {error ? <p className="field-error" role="alert">{error}</p> : null}

          {contactId ? (
            confirmingDelete ? (
              <section className="contact-delete-confirm" aria-labelledby="delete-contact-title">
                <Typography.Text asChild variant="body-strong"><h2 id="delete-contact-title">Удалить контакт?</h2></Typography.Text>
                <Typography.Text asChild variant="description" color="secondary"><p>Жильцы больше не увидят его в списке.</p></Typography.Text>
                <div className="contact-form__actions">
                  <Button type="button" variant="secondary" onClick={() => setConfirmingDelete(false)}>Отмена</Button>
                  <Button type="button" variant="destructive" loading={saving} onClick={() => void remove()}>Удалить</Button>
                </div>
              </section>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(true)}>Удалить контакт</Button>
            )
          ) : null}
        </div>
        <footer className="bottom-panel">
          <Button type="submit" size="large" variant="primary" stretched loading={saving}>Сохранить</Button>
        </footer>
      </form>
    </main>
  );
}

function MessageState({ title, description }: { title: string; description: string }) {
  return (
    <main className="screen screen--inner inner-content" id="main-content">
      <section className="decision-card">
        <Headset className="icon" aria-hidden />
        <Typography.Text asChild variant="title"><h1>{title}</h1></Typography.Text>
        <Typography.Text asChild variant="description" color="secondary"><p>{description}</p></Typography.Text>
      </section>
    </main>
  );
}
