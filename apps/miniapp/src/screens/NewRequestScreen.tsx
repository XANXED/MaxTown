import { Camera, CheckCircle, House, Info, UsersThree, Warning, X } from '@phosphor-icons/react';
import { Button, Input, Textarea, Typography } from '../components/platform-ui.tsx';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { categoryVisual } from '../components/categoryVisuals.ts';
import { MiniTile, ScreenHeading, Segmented } from '../components/ui.tsx';
import { RequestIllustration } from '../components/requestIllustrations.tsx';
import { categoriesFor, requestPlaces, subcategoriesFor, type RequestPlace } from '../data/categories.ts';
import { useMembership } from '../auth/membership.tsx';
import { useHomeData } from '../data/home.ts';
import { knownProblem, reportedProblem, useHouseState } from '../data/houseState.ts';
import { visitDayToDate } from '../data/requestDetails.ts';
import { compressPhoto, pendingPhotoId } from '../data/requestPhotos.ts';
import { requestsClient } from '../data/requests.ts';
import { ApiError } from '../data/api.ts';
import { eventRoute, requestRoute, ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

const DESCRIPTION_LIMIT = 500;
const MINIMUM_DESCRIPTION_LENGTH = 10;
const PHOTO_LIMIT = 4;

type VisitDay = 'today' | 'tomorrow' | 'date';

const visitDays: Array<{ value: VisitDay; label: string }> = [
  { value: 'today', label: 'Сегодня' },
  { value: 'tomorrow', label: 'Завтра' },
  { value: 'date', label: 'Другой день' },
];

type Photo = { id: string; url: string; name: string; file: File };

type Errors = { category?: string; subcategory?: string; description?: string; apartment?: string };

function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function NewRequestScreen({ navigate, notify }: { navigate: Navigate; notify: Notify }) {
  const [place, setPlace] = useState<RequestPlace>('apartment');
  const [category, setCategory] = useState<string | null>(null);
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [visitDay, setVisitDay] = useState<VisitDay>('today');
  const [visitDate, setVisitDate] = useState('');
  const [apartment, setApartment] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const membership = useMembership();
  const { status: homeStatus, isResident } = useHomeData();
  const guest = homeStatus === 'ready' && !isResident;
  const { data: house } = useHouseState();
  const categories = categoriesFor(place);
  const subcategories = category ? subcategoriesFor(category, place) : [];
  const chosen = subcategories.find(({ id }) => id === subcategory) ?? null;
  const problem = knownProblem(house, category);
  // Соседи уже сообщили о том же: вместо дубля — «У меня тоже».
  const reported = problem ? null : reportedProblem(house, category, subcategory);
  // Квартира нужна для Визита; если она не привязана к членству — спросим номер.
  const needsApartment = place === 'apartment' && !membership?.apartmentNumber;

  // Превью живут как object URL — освобождаем их, когда экран закрывается.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url)), []);

  const addPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, PHOTO_LIMIT - photos.length);
    event.target.value = '';
    setPhotos((current) => [
      ...current,
      ...files.map((file) => ({ id: pendingPhotoId(), url: URL.createObjectURL(file), name: file.name, file })),
    ]);
  };

  const removePhoto = (photo: Photo) => {
    URL.revokeObjectURL(photo.url);
    setPhotos((current) => current.filter(({ id }) => id !== photo.id));
  };

  // Лифт или домофон в Квартире не бывает: при смене места неподходящий выбор сбрасываем.
  const choosePlace = (next: RequestPlace) => {
    setPlace(next);
    if (category && !categoriesFor(next).includes(category as (typeof categories)[number])) {
      setCategory(null);
      setSubcategory(null);
    } else if (category && subcategory && !subcategoriesFor(category, next).some(({ id }) => id === subcategory)) {
      setSubcategory(null);
    }
  };

  const chooseCategory = (next: string) => {
    if (next !== category) setSubcategory(null);
    setCategory(next);
    setErrors((current) => ({ ...current, category: undefined, subcategory: undefined }));
  };

  const chooseSubcategory = (next: string) => {
    setSubcategory(next);
    setErrors((current) => ({ ...current, subcategory: undefined }));
  };

  // Плитки — группа радиокнопок: стрелки переходят к соседней плитке.
  const onSubcategoryKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = Math.max(subcategories.findIndex(({ id }) => id === subcategory), 0);
    const last = subcategories.length - 1;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    const option = next === null ? undefined : subcategories[next];
    if (!option) return;
    event.preventDefault();
    chooseSubcategory(option.id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next ?? 0]?.focus();
  };

  const supportReported = async (requestId: string) => {
    if (!membership) return;
    try {
      await requestsClient.support(membership.houseId, requestId, true);
      notify('Отметили: у вас тоже. Вы получите уведомление, когда проблему решат');
      navigate(requestRoute(requestId));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось сохранить отметку');
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const nextErrors: Errors = {};
    if (!category) nextErrors.category = 'Выберите Категорию — от неё зависит, кто получит Заявку';
    if (category && subcategories.length > 0 && !chosen) nextErrors.subcategory = 'Выберите, что именно сломалось: так Ответственный поймёт, что взять с собой';
    if (description.trim().length < MINIMUM_DESCRIPTION_LENGTH) {
      nextErrors.description = 'Опишите неисправность подробнее: нужно хотя бы 10 символов';
    }
    if (needsApartment && !/^[0-9]{1,4}[а-яА-Яa-zA-Z]?$/.test(apartment.trim())) {
      nextErrors.apartment = 'Укажите номер Квартиры: например, 34 или 12А';
    }
    setErrors(nextErrors);
    if (nextErrors.category || nextErrors.subcategory || nextErrors.description || nextErrors.apartment || !category) return;

    if (guest) {
      notify('Сначала станьте Жильцом: Заявки уходят Ответственным от Жильцов');
      return;
    }
    if (!membership) {
      notify('В примере Заявка не отправляется: войдите через MAX');
      return;
    }

    setSending(true);
    try {
      const preferredVisitDate = place === 'apartment' ? visitDayToDate(visitDay, visitDate) : undefined;
      const created = await requestsClient.create(membership.houseId, {
        category,
        ...(chosen ? { subcategory: chosen.id } : {}),
        place,
        description: description.trim(),
        ...(needsApartment ? { apartmentNumber: apartment.trim() } : {}),
        ...(preferredVisitDate ? { preferredVisitDate } : {}),
      });
      // Фото — после Заявки, по одному: одно неудачное не отменяет остальные.
      let failed = 0;
      for (const photo of photos) {
        try {
          await requestsClient.uploadPhoto(membership.houseId, created.id, await compressPhoto(photo.file));
        } catch {
          failed += 1;
        }
      }
      notify(failed === 0
        ? `Заявка № ${created.number} отправлена${place === 'common-property' ? '. Её увидят все соседи' : ''}`
        : `Заявка № ${created.number} отправлена, но ${failed === photos.length ? 'фото не загрузились' : `не загрузилось фото: ${failed}`}`);
      navigate(requestRoute(created.id));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'apartment_required') {
        setErrors((current) => ({ ...current, apartment: error.message }));
      } else if (error instanceof ApiError && (error.code === 'subcategory_required' || error.code === 'subcategory_invalid')) {
        setErrors((current) => ({ ...current, subcategory: error.message }));
      } else {
        notify(error instanceof Error ? error.message : 'Не удалось отправить Заявку');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="screen screen--inner screen--with-panel" id="main-content">
      <form className="request-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="inner-content stagger">
          <ScreenHeading description="Опишите, что сломалось. Заявка уйдёт УК и Администратору Дома">
            Новая заявка
          </ScreenHeading>

          {guest ? (
            <aside className="outcome">
              <House className="icon" weight="fill" aria-hidden />
              <span className="request-note__copy">
                <Typography.Text asChild variant="description" color="secondary">
                  <p>Заявки уходят Ответственным от Жильцов. Станьте Жильцом своей Квартиры, это пара минут.</p>
                </Typography.Text>
                <button className="text-action pressable request-note__join" type="button" onClick={() => navigate(ROUTES.join)}>
                  Стать Жильцом
                </button>
              </span>
            </aside>
          ) : null}

          {/* Опасное — первым: при прорыве или газе заполнять форму не нужно. */}
          <aside className="request-note">
            <Warning className="icon" weight="fill" aria-hidden />
            <span className="request-note__copy">
              <Typography.Text asChild variant="description" color="secondary">
                <p>Прорвало трубу, пахнет газом или искрит проводка? Звоните в аварийную службу, не ждите.</p>
              </Typography.Text>
              <button className="text-action pressable request-note__action" type="button" onClick={() => navigate(ROUTES.contacts)}>
                Номера служб
              </button>
            </span>
          </aside>

          <fieldset className="form-section">
            <Typography.Text asChild variant="title">
              <legend>Где неисправность?</legend>
            </Typography.Text>
            <Segmented label="Где неисправность" options={requestPlaces} value={place} onChange={choosePlace} />
            <Typography.Text asChild variant="description" color="tertiary">
              <p>{requestPlaces.find(({ value }) => value === place)?.hint}</p>
            </Typography.Text>
            {needsApartment ? (
              <div className="reveal">
                <label htmlFor="apartment-number">
                  <Typography.Text asChild variant="body-strong">
                    <span>Номер Квартиры</span>
                  </Typography.Text>
                </label>
                <Input
                  id="apartment-number"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Например, 34"
                  maxLength={5}
                  value={apartment}
                  aria-invalid={Boolean(errors.apartment)}
                  aria-describedby={errors.apartment ? 'apartment-error' : undefined}
                  onChange={(event) => {
                    setApartment(event.target.value);
                    if (errors.apartment) setErrors((current) => ({ ...current, apartment: undefined }));
                  }}
                />
                {errors.apartment ? (
                  <Typography.Text asChild variant="description">
                    <span className="field-error" id="apartment-error">
                      {errors.apartment}
                    </span>
                  </Typography.Text>
                ) : null}
              </div>
            ) : null}
          </fieldset>

          <fieldset className="form-section" aria-describedby={errors.category ? 'category-error' : undefined}>
            <Typography.Text asChild variant="title">
              <legend>Категория</legend>
            </Typography.Text>
            <div className="chips">
              {categories.map((item) => (
                <button
                  className={`chip chip--with-icon pressable${category === item ? ' chip--selected' : ''}`}
                  type="button"
                  aria-pressed={category === item}
                  key={item}
                  onClick={() => chooseCategory(item)}
                >
                  <MiniTile icon={categoryVisual(item).icon} tone={categoryVisual(item).tone} />
                  {item}
                </button>
              ))}
            </div>
            {errors.category ? (
              <Typography.Text asChild variant="description">
                <span className="field-error" id="category-error">
                  {errors.category}
                </span>
              </Typography.Text>
            ) : null}
            {/* Об этой Системе уже известно — говорим до того, как Жилец опишет то же самое. */}
            {problem ? (
              <aside className="outcome reveal" aria-live="polite">
                <Info className="icon" weight="fill" aria-hidden />
                <span className="request-note__copy">
                  <Typography.Text asChild variant="body-strong">
                    <p>
                      {problem.status === 'accident'
                        ? `Сейчас открыта Авария: ${problem.name}`
                        : `Сейчас Плановое отключение: ${problem.name}`}
                    </p>
                  </Typography.Text>
                  <Typography.Text asChild variant="description" color="secondary">
                    <p>
                      {problem.status === 'accident'
                        ? 'Ответственные уже знают. Заявку можно не подавать, а если подадите, она привяжется к Аварии и закроется вместе с ней.'
                        : 'Это не поломка: Система не работает по плану. Если после окончания не заработает, подайте Заявку.'}
                    </p>
                  </Typography.Text>
                  {problem.eventId ? (
                    <button
                      className="text-action pressable request-note__join"
                      type="button"
                      onClick={() => problem.eventId && navigate(eventRoute(problem.eventId))}
                    >
                      Подробнее
                    </button>
                  ) : null}
                </span>
              </aside>
            ) : null}
          </fieldset>

          {category && subcategories.length > 0 ? (
            <fieldset className="form-section reveal" aria-describedby={errors.subcategory ? 'subcategory-error' : undefined}>
              <Typography.Text asChild variant="title">
                <legend>Что именно?</legend>
              </Typography.Text>
              <div className="subcategory-grid" role="radiogroup" aria-label="Что именно сломалось" onKeyDown={onSubcategoryKey}>
                {subcategories.map((option, index) => {
                  const selected = option.id === subcategory;
                  return (
                    <button
                      className={`subcategory-tile pressable${selected ? ' subcategory-tile--selected' : ''}`}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected || (!chosen && index === 0) ? 0 : -1}
                      key={option.id}
                      onClick={() => chooseSubcategory(option.id)}
                    >
                      <RequestIllustration category={category} subcategory={option.id} />
                      <span className="subcategory-tile__copy">
                        <Typography.Text asChild variant="body-strong">
                          <span>{option.label}</span>
                        </Typography.Text>
                        {option.hint ? (
                          <Typography.Text asChild variant="description" color="secondary">
                            <span>{option.hint}</span>
                          </Typography.Text>
                        ) : null}
                      </span>
                      {selected ? <CheckCircle className="subcategory-tile__check" weight="fill" aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
              {errors.subcategory ? (
                <Typography.Text asChild variant="description">
                  <span className="field-error" id="subcategory-error">
                    {errors.subcategory}
                  </span>
                </Typography.Text>
              ) : null}
              {chosen?.urgent ? (
                <aside className="request-note reveal" aria-live="polite">
                  <Warning className="icon" weight="fill" aria-hidden />
                  <span className="request-note__copy">
                    <Typography.Text asChild variant="description" color="secondary">
                      <p>Это может быть опасно. Сначала позвоните в аварийную службу, потом подайте Заявку.</p>
                    </Typography.Text>
                    <button className="text-action pressable request-note__action" type="button" onClick={() => navigate(ROUTES.contacts)}>
                      Номера служб
                    </button>
                  </span>
                </aside>
              ) : null}
            {reported ? (
              <aside className="outcome reveal" aria-live="polite">
                <UsersThree className="icon" weight="fill" aria-hidden />
                <span className="request-note__copy">
                  <Typography.Text asChild variant="body-strong">
                    <p>Соседи уже сообщили: {reported.title}</p>
                  </Typography.Text>
                  <Typography.Text asChild variant="description" color="secondary">
                    <p>
                      Заявка № {reported.number} {reported.status === 'in-progress' ? 'в работе' : 'ждёт Ответственного'}.
                      Отметьте «У меня тоже» — подавать такую же не нужно.
                    </p>
                  </Typography.Text>
                  <span className="request-note__actions">
                    <button className="text-action pressable" type="button" onClick={() => void supportReported(reported.id)}>
                      У меня тоже
                    </button>
                    <button className="text-action pressable" type="button" onClick={() => navigate(requestRoute(reported.id))}>
                      Открыть
                    </button>
                  </span>
                </span>
              </aside>
            ) : null}
            </fieldset>
          ) : null}

          <section className="form-section" aria-labelledby="description-label">
            <Typography.Text asChild variant="title">
              <label id="description-label" htmlFor="description">
                Что случилось?
              </label>
            </Typography.Text>
            <Textarea
              id="description"
              className={`request-textarea${errors.description ? ' request-textarea--invalid' : ''}`}
              value={description}
              placeholder="Например: течёт труба под раковиной на кухне"
              maxLength={DESCRIPTION_LIMIT}
              rows={4}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'description-error description-count' : 'description-count'}
              onChange={(event) => {
                setDescription(event.target.value);
                if (errors.description) setErrors((current) => ({ ...current, description: undefined }));
              }}
            />
            <div className="field-footer">
              {errors.description ? (
                <Typography.Text asChild variant="description">
                  <span className="field-error" id="description-error">
                    {errors.description}
                  </span>
                </Typography.Text>
              ) : (
                <span />
              )}
              <Typography.Text asChild variant="description" color="tertiary">
                <span className="character-count" id="description-count">
                  {description.length}/{DESCRIPTION_LIMIT}
                </span>
              </Typography.Text>
            </div>
          </section>

          <section className="form-section" aria-labelledby="photo-label">
            <Typography.Text asChild variant="title">
              <h2 id="photo-label">Фото</h2>
            </Typography.Text>
            <div className="photo-grid">
              {photos.map((photo) => (
                <figure className="photo-tile" key={photo.id}>
                  <img src={photo.url} alt={`Фото: ${photo.name}`} />
                  <button
                    className="photo-tile__remove pressable"
                    type="button"
                    aria-label={`Убрать фото ${photo.name}`}
                    onClick={() => removePhoto(photo)}
                  >
                    <X className="icon icon--small" weight="bold" aria-hidden />
                  </button>
                </figure>
              ))}
              {photos.length < PHOTO_LIMIT ? (
                <button className="photo-add pressable" type="button" onClick={() => photoInput.current?.click()}>
                  <Camera className="icon" aria-hidden />
                  <span>Добавить</span>
                </button>
              ) : null}
            </div>
            <input
              ref={photoInput}
              className="visually-hidden"
              type="file"
              accept="image/*"
              multiple
              tabIndex={-1}
              aria-hidden
              onChange={addPhotos}
            />
            <Typography.Text asChild variant="description" color="tertiary">
              <p>До {PHOTO_LIMIT} фото. Так Ответственный поймёт, что взять с собой.</p>
            </Typography.Text>
          </section>

          {place === 'apartment' ? (
            <section className="form-section" aria-labelledby="visit-label">
              <Typography.Text asChild variant="title">
                <h2 id="visit-label">Когда удобен Визит?</h2>
              </Typography.Text>
              <div className="chips">
                {visitDays.map(({ value, label }) => (
                  <button
                    className={`chip pressable${visitDay === value ? ' chip--selected' : ''}`}
                    type="button"
                    aria-pressed={visitDay === value}
                    key={value}
                    onClick={() => setVisitDay(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {visitDay === 'date' ? (
                <input
                  className="date-field reveal"
                  type="date"
                  min={todayIso()}
                  value={visitDate}
                  aria-label="День Визита"
                  onChange={(event) => setVisitDate(event.target.value)}
                />
              ) : null}
              <Typography.Text asChild variant="description" color="tertiary">
                <p>Время Визита назначит Ответственный.</p>
              </Typography.Text>
            </section>
          ) : null}

        </div>

        <footer className="bottom-panel">
          <Button type="submit" size="medium" variant="primary" stretched loading={sending}>
            Отправить заявку
          </Button>
        </footer>
      </form>
    </main>
  );
}
