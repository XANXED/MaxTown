import { useEffect, useState, type FormEvent } from 'react';
import { NativeSelect } from '@vkontakte/vkui';
import { MapPin } from '@phosphor-icons/react';
import type { AssignedPlace, AssignedPlaceInput, AssignedPlaceKind, GeoPoint, HouseRole } from '@maxtown/shared';
import { PlacesMap } from '../components/PlacesMap.tsx';
import { assignedVisuals } from '../components/placeVisuals.ts';
import { Button, Input, Spinner, Textarea, Typography } from '../components/platform-ui.tsx';
import { ScreenHeading } from '../components/ui.tsx';
import { demoMode, loadFixtures } from '../data/loadable.ts';
import { assignedKindLabels, assignedKinds, placesClient, useHouseLocation } from '../data/places.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

/** Название по умолчанию — пока Староста сам его не поменял. */
function suggestedTitle(kind: AssignedPlaceKind): string {
  return kind === 'other' ? '' : assignedKindLabels[kind];
}

type AssignedPlaceFormProps = {
  houseId: string | null;
  role: HouseRole | null;
  placeId?: string;
  navigate: Navigate;
  notify: Notify;
};

/** Закреплённое место: Староста вносит поликлинику по прикреплению, школу, участок. */
export function AssignedPlaceFormScreen({ houseId, role, placeId, navigate, notify }: AssignedPlaceFormProps) {
  const [kind, setKind] = useState<AssignedPlaceKind>('adult-clinic');
  const [title, setTitle] = useState(suggestedTitle('adult-clinic'));
  const [address, setAddress] = useState('');
  const [hours, setHours] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  /** Точка места, которую Староста отметил; null — места нет на карте. */
  const [point, setPoint] = useState<GeoPoint | null>(null);
  /** Где сейчас прицел карты — его и отмечаем кнопкой. */
  const [center, setCenter] = useState<GeoPoint | null>(null);
  const [status, setStatus] = useState<'ready' | 'loading' | 'error'>(placeId ? 'loading' : 'ready');
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDemo = demoMode() === 'filled';
  const resolvedHouseId = houseId ?? (isDemo ? 'demo-house' : null);
  const resolvedRole = role ?? (isDemo ? 'headman' : null);
  const houseLocation = useHouseLocation(resolvedHouseId);

  useEffect(() => {
    if (!placeId || !resolvedHouseId || resolvedRole !== 'headman') return;
    let cancelled = false;
    const request: Promise<AssignedPlace[]> = isDemo
      ? loadFixtures()!.then(({ sampleAssignedPlaces }) => sampleAssignedPlaces)
      : placesClient.assigned(resolvedHouseId);
    request
      .then((places) => {
        if (cancelled) return;
        const found = places.find(({ id }) => id === placeId);
        if (!found) throw new Error('place_not_found');
        setKind(found.kind);
        setTitle(found.title);
        setAddress(found.address);
        setHours(found.hours ?? '');
        setPhone(found.phone ?? '');
        setNote(found.note ?? '');
        setPoint(found.point ?? null);
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [placeId, isDemo, resolvedHouseId, resolvedRole]);

  if (!resolvedHouseId) return <MessageState title="Сначала вступите в Дом" description="Места рядом видны Жильцам Дома." />;
  if (resolvedRole !== 'headman') {
    return <MessageState title="Изменение недоступно" description="Закреплённые места добавляет и меняет только Староста." />;
  }
  if (status === 'loading') {
    return <main className="screen screen--inner inner-content join-checking" id="main-content"><Spinner size={20} />Загружаем место…</main>;
  }
  if (status === 'error') return <MessageState title="Не удалось открыть место" description="Вернитесь к списку и попробуйте ещё раз." />;

  const changeKind = (next: AssignedPlaceKind) => {
    const previousSuggestion = suggestedTitle(kind);
    setKind(next);
    if (!title.trim() || title === previousSuggestion) setTitle(suggestedTitle(next));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanPhone = phone.trim();
    if (!title.trim()) {
      setError('Укажите название, например «Поликлиника № 114»');
      return;
    }
    if (!address.trim()) {
      setError('Укажите адрес: по нему Жилец найдёт место на карте');
      return;
    }
    if (cleanPhone && !/\d/u.test(cleanPhone)) {
      setError('Проверьте номер телефона');
      return;
    }
    const input: AssignedPlaceInput = {
      kind,
      title: title.trim(),
      address: address.trim(),
      hours: hours.trim() || null,
      phone: cleanPhone || null,
      note: note.trim() || null,
      point,
    };
    setError(null);
    setSaving(true);
    try {
      if (!isDemo) await placesClient.save(resolvedHouseId, input, placeId);
      notify(placeId ? 'Место изменено' : 'Место добавлено — его видят все Жильцы');
      navigate(ROUTES.places);
    } catch {
      setError('Не удалось сохранить место. Проверьте подключение и попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!placeId) return;
    setSaving(true);
    setError(null);
    try {
      if (!isDemo) await placesClient.remove(resolvedHouseId, placeId);
      notify('Место удалено');
      navigate(ROUTES.places);
    } catch {
      setError('Не удалось удалить место. Попробуйте ещё раз.');
      setSaving(false);
    }
  };

  return (
    <main className="screen screen--inner screen--with-panel" id="main-content">
      <form className="contact-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="inner-content stagger">
          <ScreenHeading description="Место, за которым закреплён Дом: его не найти поиском «ближайшее»">
            {placeId ? 'Изменить место' : 'Новое закреплённое место'}
          </ScreenHeading>

          <label className="contact-form__field">
            <span>Что это</span>
            <NativeSelect value={kind} onChange={(event) => changeKind(event.target.value as AssignedPlaceKind)} aria-label="Вид места">
              {assignedKinds.map((item) => <option value={item} key={item}>{assignedKindLabels[item]}</option>)}
            </NativeSelect>
          </label>
          <label className="contact-form__field">
            <span>Название</span>
            <Input value={title} maxLength={160} placeholder="Например, Поликлиника № 114" onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="contact-form__field">
            <span>Адрес</span>
            <Input value={address} maxLength={300} placeholder="Камышовая улица, 38" onChange={(event) => setAddress(event.target.value)} />
          </label>
          <label className="contact-form__field">
            <span>Часы работы</span>
            <Input value={hours} maxLength={200} placeholder="Пн–пт 8:00–20:00" onChange={(event) => setHours(event.target.value)} />
          </label>
          <label className="contact-form__field">
            <span>Телефон</span>
            <Input type="tel" inputMode="tel" value={phone} maxLength={80} placeholder="+7 812 000-00-00" onChange={(event) => setPhone(event.target.value)} />
          </label>
          <label className="contact-form__field">
            <span>Пояснение</span>
            <Textarea value={note} maxLength={1000} rows={3} placeholder="Кабинет, как прикрепиться, кто участковый" onChange={(event) => setNote(event.target.value)} />
          </label>
          <section className="contact-form__field place-point" aria-labelledby="place-point-title">
            <span id="place-point-title">Точка на карте</span>
            <PlacesMap
              label="Выбор точки места: двигайте карту, прицел в центре"
              house={houseLocation}
              initialCenter={point}
              markers={point ? [{ id: 'point', point, label: title || assignedKindLabels[kind], ...assignedVisuals[kind] }] : []}
              onCenterChange={setCenter}
            />
            <Typography.Text asChild variant="description" color="secondary">
              <p>
                {point
                  ? 'Место отмечено. Чтобы поправить, наведите прицел и отметьте ещё раз.'
                  : 'Необязательно. Наведите прицел на вход и отметьте — место появится на карте у Жильцов.'}
              </p>
            </Typography.Text>
            <div className="contact-form__actions">
              <Button type="button" variant="secondary" disabled={!center} onClick={() => center && setPoint(center)}>
                Отметить здесь
              </Button>
              {point ? (
                <Button type="button" variant="ghost" onClick={() => setPoint(null)}>
                  Убрать точку
                </Button>
              ) : null}
            </div>
          </section>
          {error ? <p className="field-error" role="alert">{error}</p> : null}

          {placeId ? (
            confirmingDelete ? (
              <section className="contact-delete-confirm" aria-labelledby="delete-place-title">
                <Typography.Text asChild variant="body-strong"><h2 id="delete-place-title">Удалить место?</h2></Typography.Text>
                <Typography.Text asChild variant="description" color="secondary"><p>Жильцы больше не увидят его в Местах рядом.</p></Typography.Text>
                <div className="contact-form__actions">
                  <Button type="button" variant="secondary" onClick={() => setConfirmingDelete(false)}>Отмена</Button>
                  <Button type="button" variant="destructive" loading={saving} onClick={() => void remove()}>Удалить</Button>
                </div>
              </section>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(true)}>Удалить место</Button>
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
        <MapPin className="icon" aria-hidden />
        <Typography.Text asChild variant="title"><h1>{title}</h1></Typography.Text>
        <Typography.Text asChild variant="description" color="secondary"><p>{description}</p></Typography.Text>
      </section>
    </main>
  );
}
