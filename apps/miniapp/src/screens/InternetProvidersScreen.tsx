import { useEffect, useState } from 'react';
import { ArrowSquareOut, Phone, Star, WifiHigh } from '@phosphor-icons/react';
import type { HouseInternetProvider, HouseRole } from '@maxtown/shared';
import { useMembership } from '../auth/membership.tsx';
import { Button, Typography } from '../components/platform-ui.tsx';
import { ErrorState, InlineEmpty, ScreenHeading, SkeletonRows } from '../components/ui.tsx';
import { phoneHref } from '../data/contacts.ts';
import {
  formatInternetRating,
  internetProviderSourceLabels,
  internetProvidersClient,
  internetTechnologyLabels,
  tariffFreshness,
} from '../data/internetProviders.ts';
import { demoMode, loadFixtures } from '../data/loadable.ts';
import { openExternal } from '../links.ts';
import { internetProviderEditRoute, ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const checkedDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

function price(value: string): string {
  return `${money.format(Number(value))} ₽/мес.`;
}

function checkedLabel(value: string): string {
  return checkedDate.format(new Date(`${value}T00:00:00`));
}

type Props = {
  houseId: string | null;
  role: HouseRole | null;
  navigate: Navigate;
  notify: Notify;
};

export function InternetProvidersScreen({ houseId, role, navigate, notify }: Props) {
  const membership = useMembership();
  const [providers, setProviders] = useState<HouseInternetProvider[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [ratingProviderId, setRatingProviderId] = useState<string | null>(null);
  const mode = demoMode();
  const demoData = mode === 'filled' || (mode === 'error' && attempt > 0);
  const resolvedHouseId = houseId ?? (mode ? 'demo-house' : null);
  const canEdit = role === 'headman' || demoData;
  const canRate = Boolean(membership?.apartmentId) || demoData;

  useEffect(() => {
    let cancelled = false;
    if (mode === 'loading' || (mode === 'error' && attempt === 0)) {
      setStatus(mode === 'error' ? 'error' : 'loading');
      return () => { cancelled = true; };
    }
    if (demoData) {
      setStatus('loading');
      void loadFixtures()!.then(({ sampleInternetProviders }) => {
        if (!cancelled) { setProviders(sampleInternetProviders); setStatus('ready'); }
      });
      return () => { cancelled = true; };
    }
    if (!resolvedHouseId) {
      setProviders([]);
      setStatus('ready');
      return () => { cancelled = true; };
    }
    setStatus('loading');
    void internetProvidersClient.load(resolvedHouseId)
      .then((items) => { if (!cancelled) { setProviders(items); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [attempt, demoData, mode, resolvedHouseId]);

  const rate = async (providerId: string, score: number) => {
    if (!resolvedHouseId || !canRate || ratingProviderId) return;
    setRatingProviderId(providerId);
    try {
      const rating = demoData
        ? { average: score, count: 1, myScore: score }
        : await internetProvidersClient.rate(resolvedHouseId, providerId, score);
      setProviders((current) => current.map((provider) => provider.id === providerId ? { ...provider, rating } : provider));
      notify('Оценка сохранена для этого Дома');
    } catch {
      notify('Не удалось сохранить оценку. Попробуйте ещё раз.');
    } finally { setRatingProviderId(null); }
  };

  return (
    <main className="screen screen--inner" id="main-content">
      <div className="inner-content stagger">
        <ScreenHeading description="Поставщики и Тарифы, проверенные для вашего Дома">Интернет в Доме</ScreenHeading>

        <div className="internet-disclaimer">
          <Typography.Text asChild variant="description" color="secondary">
            <p>Наличие в Доме не гарантирует свободный порт в конкретной Квартире. Финальную техническую возможность подтверждает Поставщик.</p>
          </Typography.Text>
        </div>

        <div className="internet-disclaimer">
          <Typography.Text asChild variant="description" color="secondary">
            <p>{canEdit ? 'Сейчас Поставщиков и Тарифы добавляет Староста. Структура данных уже готова к будущей автоматической выгрузке.' : 'Поставщиков и Тарифы для Дома добавляет Староста. Автоматическая выгрузка будет подключена позже.'}</p>
          </Typography.Text>
        </div>

        {canEdit ? (
          <div className="internet-toolbar">
            <Button size="medium" onClick={() => navigate(ROUTES.newInternetProvider)}>Добавить Поставщика</Button>
          </div>
        ) : null}

        {status === 'loading' ? <SkeletonRows count={3} /> : null}
        {status === 'error' ? <ErrorState onRetry={() => setAttempt((value) => value + 1)} /> : null}
        {status === 'ready' && !resolvedHouseId ? (
          <div className="list-card">
            <InlineEmpty icon={WifiHigh} tone="green" title="Сначала вступите в Дом" description="Доступность интернета зависит от адреса Дома" actionLabel="Вступить" onAction={() => navigate(ROUTES.join)} />
          </div>
        ) : null}
        {status === 'ready' && resolvedHouseId && providers.length === 0 ? (
          <div className="list-card">
            <InlineEmpty
              icon={WifiHigh}
              tone="neutral"
              title="Поставщики пока не подтверждены"
              description={canEdit ? 'Добавьте сведения из прайс-листа или личного кабинета Поставщика' : 'Староста или Ответственный добавит проверенные Тарифы'}
              actionLabel={canEdit ? 'Добавить' : undefined}
              onAction={canEdit ? () => navigate(ROUTES.newInternetProvider) : undefined}
            />
          </div>
        ) : null}

        {status === 'ready' && providers.length > 0 ? (
          <section className="internet-provider-list" aria-label="Поставщики интернета">
            {providers.map((provider) => (
              <article className="internet-provider" key={provider.id}>
                <header className="internet-provider__header">
                  <span className="internet-provider__title">
                    <Typography.Text asChild variant="title"><h2>{provider.name}</h2></Typography.Text>
                    <span className={`status-badge${provider.availability === 'available' ? ' status-badge--positive' : ''}`}>
                      {provider.availability === 'available' ? 'Есть в Доме' : 'Нужно уточнить'}
                    </span>
                  </span>
                  <span className="internet-rating-summary" aria-label={`Рейтинг: ${formatInternetRating(provider.rating)}`}>
                    <Star className="icon icon--small" weight={provider.rating.average === null ? 'regular' : 'fill'} aria-hidden />
                    {formatInternetRating(provider.rating)}
                  </span>
                </header>

                <Typography.Text asChild variant="description" color="secondary">
                  <span className="internet-provider__provenance">
                    {internetProviderSourceLabels[provider.source]}{provider.manualOverride && provider.source !== 'manual' ? ' · правка Старосты' : ''}
                  </span>
                </Typography.Text>

                <div className="internet-tariffs" role="list" aria-label={`Тарифы ${provider.name}`}>
                  {provider.tariffs.map((tariff) => (
                    <div className="internet-tariff" role="listitem" key={tariff.id}>
                      <span className="internet-tariff__main">
                        <Typography.Text asChild variant="body-strong"><strong>{tariff.name}</strong></Typography.Text>
                        <Typography.Text asChild variant="description" color="secondary">
                          <span>{[
                            tariff.speedMbps ? `до ${tariff.speedMbps} Мбит/с` : null,
                            tariff.technology ? internetTechnologyLabels[tariff.technology] : null,
                            tariff.hasTv ? 'с ТВ' : null,
                          ].filter(Boolean).join(' · ') || 'Скорость уточняется'}</span>
                        </Typography.Text>
                      </span>
                      <span className="internet-tariff__price">
                        <Typography.Text asChild variant="body-strong"><strong>{price(tariff.promoPrice ?? tariff.monthlyPrice)}</strong></Typography.Text>
                        {tariff.promoPrice ? (
                          <Typography.Text asChild variant="description" color="secondary"><span>{tariff.promoMonths} мес., затем {price(tariff.monthlyPrice)}</span></Typography.Text>
                        ) : null}
                      </span>
                      {tariff.conditions ? <Typography.Text asChild variant="description" color="secondary"><p>{tariff.conditions}</p></Typography.Text> : null}
                      {/^https:\/\//i.test(tariff.source) ? (
                        <button className="text-action internet-tariff__source" type="button" onClick={() => openExternal(tariff.source)}>
                          {tariffFreshness(tariff) === 'stale' ? 'Давно не проверяли' : 'Проверено'} {checkedLabel(tariff.checkedOn)}
                        </button>
                      ) : (
                        <Typography.Text asChild variant="description" color="secondary">
                          <span className="internet-tariff__source">{tariffFreshness(tariff) === 'stale' ? 'Давно не проверяли' : 'Проверено'} {checkedLabel(tariff.checkedOn)} · {tariff.source}</span>
                        </Typography.Text>
                      )}
                    </div>
                  ))}
                </div>

                {provider.note ? <Typography.Text asChild variant="description" color="secondary"><p className="internet-provider__note">{provider.note}</p></Typography.Text> : null}

                <div className="internet-provider__actions">
                  {provider.phone ? <a className="contact-action pressable" href={phoneHref(provider.phone)}><Phone className="icon icon--small" aria-hidden />Позвонить</a> : null}
                  {provider.link ? <button className="contact-action pressable" type="button" onClick={() => openExternal(provider.link!)}><ArrowSquareOut className="icon icon--small" aria-hidden />Проверить квартиру</button> : null}
                  {canEdit ? <Button size="small" variant="secondary" onClick={() => navigate(internetProviderEditRoute(provider.id))}>Изменить</Button> : null}
                </div>

                <fieldset className="internet-rating" disabled={!canRate || ratingProviderId === provider.id}>
                  <legend>{canRate ? 'Как работает в вашем Доме?' : 'Оценивать могут Жильцы Квартир'}</legend>
                  <div className="internet-rating__buttons">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <button
                        className={`internet-rating__button${provider.rating.myScore === score ? ' internet-rating__button--selected' : ''}`}
                        type="button"
                        aria-label={`${score} из 5`}
                        aria-pressed={provider.rating.myScore === score}
                        onClick={() => void rate(provider.id, score)}
                        key={score}
                      >
                        <Star className="icon icon--small" weight={provider.rating.myScore !== null && score <= provider.rating.myScore ? 'fill' : 'regular'} aria-hidden />
                        {score}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
