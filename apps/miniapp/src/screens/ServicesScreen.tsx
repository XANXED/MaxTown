import { useEffect, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Button, Input, Typography } from '../components/platform-ui.tsx';
import { serviceVisuals } from '../components/serviceVisuals.ts';
import { BottomNavigation, EmptyState, IconTile, ListCard, RowShell } from '../components/ui.tsx';
import { filterServiceGroups, serviceGroups, type Service } from '../data/services.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';
import type { HouseRole, HouseService } from '@maxtown/shared';
import { loadHouseServices, saveHouseService, tariffFreshness, type HouseServiceInput } from '../data/houseServices.ts';

type ServicesScreenProps = {
  navigate: Navigate;
  notify: Notify;
  houseId: string | null;
  role: HouseRole | null;
};

export function ServicesScreen({ navigate, notify, houseId, role }: ServicesScreenProps) {
  const [query, setQuery] = useState('');
  const [houseServices, setHouseServices] = useState<HouseService[]>([]);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [serviceError, setServiceError] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [serviceTitle, setServiceTitle] = useState('');
  const [serviceCategory, setServiceCategory] = useState<HouseService['category']>('internet');
  const [phone, setPhone] = useState('');
  const [price, setPrice] = useState('');
  const [source, setSource] = useState('');
  const [checkedOn, setCheckedOn] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [editingService, setEditingService] = useState<HouseService | null>(null);
  const groups = filterServiceGroups(serviceGroups, query);
  const canEdit = role === 'headman' || role === 'responsible';

  useEffect(() => {
    if (!houseId) { setHouseServices([]); return; }
    let cancelled = false;
    setServiceLoading(true);
    setServiceError(false);
    void loadHouseServices(houseId).then((services) => {
      if (!cancelled) setHouseServices(services);
    }).catch(() => {
      if (!cancelled) setServiceError(true);
    }).finally(() => { if (!cancelled) setServiceLoading(false); });
    return () => { cancelled = true; };
  }, [houseId]);

  const beginEdit = (service?: HouseService) => {
    setEditingService(service ?? null);
    setEditingId(service?.id ?? null);
    setProvider(service?.provider ?? '');
    setServiceTitle(service?.title ?? '');
    setServiceCategory(service?.category ?? 'internet');
    setPhone(service?.contacts.phone ?? '');
    setPrice(service?.tariffs[0]?.amount ?? '');
    setSource(service?.tariffs[0]?.source ?? '');
    setCheckedOn(service?.tariffs[0]?.checkedOn ?? new Date().toISOString().slice(0, 10));
  };

  const saveService = async () => {
    if (!houseId || !provider.trim() || !serviceTitle.trim()) return;
    setSaving(true);
    const tariffs = editingService ? editingService.tariffs.map(({ id: _id, ...tariff }, index) => index === 0 && price.trim() && source.trim() ? ({
      ...tariff, amount: price.trim(), source: source.trim(), checkedOn, startsOn: checkedOn,
    }) : tariff) : price.trim() && source.trim() ? [{
      amount: price.trim(), currency: 'RUB', billingPeriod: 'месяц', conditions: '',
      startsOn: checkedOn, endsOn: null, source: source.trim(), checkedOn,
    }] : [];
    const input: HouseServiceInput = {
      category: serviceCategory, provider: provider.trim(), title: serviceTitle.trim(), state: 'available',
      contacts: phone.trim() ? { phone: phone.trim() } : {}, note: null, tariffs,
    };
    try {
      const saved = await saveHouseService(houseId, input, editingId ?? undefined);
      setHouseServices((current) => editingId ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      beginEdit();
      notify('Сведения об Услуге дома сохранены');
    } catch {
      notify('Не удалось сохранить сведения. Проверьте источник и дату тарифа');
    } finally { setSaving(false); }
  };

  const open = (service: Service) => {
    if (service.route) navigate(service.route);
    else notify(`«${service.title}» появится позже`);
  };

  return (
    <div className="screen screen--home">
      <main className="home-content stagger" id="main-content">
        <header className="home-header">
          <span className="home-header__copy">
            <Typography.Text asChild variant="header">
              <h1>Сервисы</h1>
            </Typography.Text>
            <Typography.Text asChild variant="detail" color="secondary">
              <span>Всё, что можно сделать для дома</span>
            </Typography.Text>
          </span>
        </header>

        <section className="list-group house-service-directory" aria-labelledby="house-services-heading">
          <h2 className="caps-label list-group__title" id="house-services-heading">Услуги дома и Поставщики</h2>
          {!houseId ? <p className="services-note">Вступите в Дом, чтобы увидеть его Услуги дома.</p> : serviceLoading ? <p className="services-note" aria-busy="true">Загружаем сведения…</p> : serviceError ? <p className="services-note" role="alert">Не удалось загрузить каталог Услуг дома.</p> : houseServices.length === 0 ? <p className="services-note">Сведений пока нет. Их может добавить Староста или Ответственный.</p> : (
            <div className="list-card" role="list">
              {houseServices.map((service) => <article className="house-service-card" role="listitem" key={service.id}>
                <Typography.Text asChild variant="body-strong"><h3>{service.title}</h3></Typography.Text>
                <p>{service.provider} · {service.state === 'available' ? 'Доступна' : service.state === 'limited' ? 'Есть ограничения' : service.state === 'unavailable' ? 'Временно недоступна' : 'Больше не оказывается'}</p>
                {service.contacts.phone ? <a href={`tel:${service.contacts.phone.replace(/[^+\\d]/g, '')}`}>{service.contacts.phone}</a> : null}
                {service.note ? <p>{service.note}</p> : null}
                {service.tariffs.length === 0 ? <p>Тарифы пока не указаны.</p> : null}
                {service.tariffs.map((tariff) => <div className="house-service-tariff" key={tariff.id}>
                  <strong>{tariff.amount} {tariff.currency} / {tariff.billingPeriod}</strong>
                  <span>{tariff.conditions || 'Условия не указаны'} · {tariff.endsOn ? `до ${tariff.endsOn}` : `с ${tariff.startsOn}`}</span>
                  <span>{tariffFreshness(tariff) === 'expired' ? 'Срок тарифа истёк' : tariffFreshness(tariff) === 'stale' ? `Давно не проверяли · ${tariff.checkedOn}` : `Проверено ${tariff.checkedOn}`}</span>
                  {/^(https?:\/\/)/i.test(tariff.source) ? <a href={tariff.source} target="_blank" rel="noreferrer">Источник тарифа</a> : <span>Источник: {tariff.source}</span>}
                </div>)}
                {canEdit ? <Button variant="secondary" size="small" onClick={() => beginEdit(service)}>Изменить сведения</Button> : null}
              </article>)}
            </div>
          )}
          {houseId && canEdit ? <div className="house-service-editor">
            <h3>{editingId ? 'Изменить Услугу дома' : 'Добавить Поставщика или Услугу'}</h3>
            <Input aria-label="Поставщик" placeholder="Название Поставщика" value={provider} onChange={(event) => setProvider(event.target.value)} maxLength={160} />
            <Input aria-label="Услуга дома" placeholder="Например, домашний интернет" value={serviceTitle} onChange={(event) => setServiceTitle(event.target.value)} maxLength={160} />
            <label className="house-service-field"><span>Категория</span><select className="house-service-select" aria-label="Категория Услуги дома" value={serviceCategory} onChange={(event) => setServiceCategory(event.target.value as HouseService['category'])}>
              <option value="internet">Интернет</option><option value="telecom">Связь</option><option value="utilities">Коммунальные услуги</option><option value="maintenance">Обслуживание</option><option value="other">Другое</option>
            </select></label>
            <Input aria-label="Телефон Поставщика" placeholder="Телефон для связи" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={80} />
            <Input aria-label="Цена тарифа" placeholder="Цена тарифа за месяц, ₽" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
            <Input aria-label="Источник тарифа" placeholder="Ссылка или название источника" value={source} onChange={(event) => setSource(event.target.value)} maxLength={1000} />
            <label className="house-service-field"><span>Когда проверили тариф</span><Input aria-label="Дата проверки тарифа" type="date" value={checkedOn} onChange={(event) => setCheckedOn(event.target.value)} /></label>
            {price.trim() ? <p className="services-note">Для сохранения цены укажите источник и дату проверки.</p> : null}
            <div className="house-service-actions">
              <Button disabled={saving || !provider.trim() || !serviceTitle.trim()} onClick={() => void saveService()}>{saving ? 'Сохраняем…' : 'Сохранить'}</Button>
              {editingId ? <Button variant="secondary" onClick={() => beginEdit()}>Отмена</Button> : null}
            </div>
          </div> : null}
        </section>

        <Input
          type="search"
          mode="contrast"
          size="medium"
          placeholder="Найти сервис"
          aria-label="Найти сервис"
          value={query}
          withClearButton
          iconBefore={<MagnifyingGlass className="icon icon--small" aria-hidden />}
          onChange={(event) => setQuery(event.target.value)}
        />

        {groups.map((group) => (
          <section className="list-group" aria-labelledby={`services-${group.id}`} key={group.id}>
            <h2 className="caps-label list-group__title" id={`services-${group.id}`}>
              {group.title}
            </h2>
            <ListCard label={group.title}>
              {group.services.map((service) => {
                const { icon, color } = serviceVisuals[service.icon];
                return (
                  <RowShell
                    key={service.id}
                    className="list-row--compact"
                    onOpen={() => open(service)}
                    trailing={service.route ? undefined : <span className="status-badge">Скоро</span>}
                  >
                    <IconTile icon={icon} tone={color} size="small" />
                    <span className="list-row__copy">
                      <Typography.Text asChild variant="body-strong">
                        <span>{service.title}</span>
                      </Typography.Text>
                      <Typography.Text asChild variant="description" color="secondary">
                        <span>{service.description}</span>
                      </Typography.Text>
                    </span>
                  </RowShell>
                );
              })}
            </ListCard>
          </section>
        ))}

        {groups.length === 0 ? (
          <div className="list-card">
            <EmptyState
              icon={MagnifyingGlass}
              title="Ничего не нашлось"
              description="Попробуйте другое слово — например, «заявка» или «показания»"
            />
          </div>
        ) : (
          <Typography.Text asChild variant="description" color="tertiary">
            <p className="services-note">Разделы для Старосты, Ответственных и Консьержей появятся здесь по Роли в Доме.</p>
          </Typography.Text>
        )}
      </main>
      <BottomNavigation active={ROUTES.services} navigate={navigate} />
    </div>
  );
}
