import { useEffect, useState, type FormEvent } from 'react';
import { Checkbox, NativeSelect } from '@vkontakte/vkui';
import type { HouseInternetProvider, HouseInternetProviderInput, HouseRole, InternetTariffInput } from '@maxtown/shared';
import { Button, Input, Spinner, Textarea, Typography } from '../components/platform-ui.tsx';
import { ScreenHeading } from '../components/ui.tsx';
import { internetProvidersClient, internetTechnologyLabels } from '../data/internetProviders.ts';
import { demoMode, loadFixtures } from '../data/loadable.ts';
import { ROUTES } from '../routes.ts';
import type { Navigate, Notify } from './types.ts';

const today = () => new Date().toISOString().slice(0, 10);
const technologies = Object.keys(internetTechnologyLabels) as Array<NonNullable<InternetTariffInput['technology']>>;

function emptyTariff(): InternetTariffInput {
  return {
    name: '', speedMbps: null, monthlyPrice: '', promoPrice: null, promoMonths: null,
    technology: null, hasTv: false, conditions: '', source: '', checkedOn: today(),
  };
}

type Props = {
  houseId: string | null;
  role: HouseRole | null;
  providerId?: string;
  navigate: Navigate;
  notify: Notify;
};

export function InternetProviderFormScreen({ houseId, role, providerId, navigate, notify }: Props) {
  const [name, setName] = useState('');
  const [availability, setAvailability] = useState<HouseInternetProvider['availability']>('available');
  const [phone, setPhone] = useState('');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [tariffs, setTariffs] = useState<InternetTariffInput[]>([emptyTariff()]);
  const [status, setStatus] = useState<'ready' | 'loading' | 'error'>(providerId ? 'loading' : 'ready');
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDemo = demoMode() === 'filled';
  const resolvedHouseId = houseId ?? (isDemo ? 'demo-house' : null);
  const canEdit = role === 'headman' || isDemo;

  useEffect(() => {
    if (!providerId || !resolvedHouseId || !canEdit) return;
    let cancelled = false;
    const request: Promise<HouseInternetProvider[]> = isDemo
      ? loadFixtures()!.then(({ sampleInternetProviders }) => sampleInternetProviders)
      : internetProvidersClient.load(resolvedHouseId);
    void request.then((items) => {
      if (cancelled) return;
      const provider = items.find(({ id }) => id === providerId);
      if (!provider) throw new Error('internet_provider_not_found');
      setName(provider.name);
      setAvailability(provider.availability);
      setPhone(provider.phone ?? '');
      setLink(provider.link ?? '');
      setNote(provider.note ?? '');
      setTariffs(provider.tariffs.map(({ id: _id, ...tariff }) => tariff));
      setStatus('ready');
    }).catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [canEdit, isDemo, providerId, resolvedHouseId]);

  if (!resolvedHouseId) return <Message title="Сначала вступите в Дом" description="Тарифы относятся к конкретному Дому." />;
  if (!canEdit) return <Message title="Изменение недоступно" description="Поставщиков и Тарифы может добавлять и изменять только Староста." />;
  if (status === 'loading') return <main className="screen screen--inner inner-content join-checking" id="main-content"><Spinner size={20} />Загружаем Поставщика…</main>;
  if (status === 'error') return <Message title="Не удалось открыть Поставщика" description="Вернитесь к списку и попробуйте ещё раз." />;

  const updateTariff = <K extends keyof InternetTariffInput>(index: number, key: K, value: InternetTariffInput[K]) => {
    setTariffs((current) => current.map((tariff, itemIndex) => itemIndex === index ? { ...tariff, [key]: value } : tariff));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError('Укажите название Поставщика'); return; }
    if (link.trim() && !/^https:\/\//i.test(link.trim())) { setError('Ссылка Поставщика должна начинаться с https://'); return; }
    for (const tariff of tariffs) {
      if (!tariff.name.trim() || !tariff.monthlyPrice.trim()) { setError('У каждого Тарифа нужны название и цена'); return; }
      if (!tariff.source.trim()) { setError('Укажите источник каждого Тарифа'); return; }
      if (tariff.promoPrice !== null && tariff.promoMonths === null) { setError('Для цены по акции укажите срок акции в месяцах'); return; }
    }
    const input: HouseInternetProviderInput = {
      name: name.trim(), availability, phone: phone.trim() || null, link: link.trim() || null, note: note.trim() || null,
      tariffs: tariffs.map((tariff) => ({ ...tariff, name: tariff.name.trim(), conditions: tariff.conditions.trim(), source: tariff.source.trim() })),
    };
    setError(null);
    setSaving(true);
    try {
      if (!isDemo) await internetProvidersClient.save(resolvedHouseId, input, providerId);
      notify(providerId ? 'Сведения о Поставщике изменены' : 'Поставщик добавлен — его видят Жильцы');
      navigate(ROUTES.internet);
    } catch {
      setError('Не удалось сохранить. Проверьте Тарифы, источник и подключение.');
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!providerId) return;
    setSaving(true);
    setError(null);
    try {
      if (!isDemo) await internetProvidersClient.remove(resolvedHouseId, providerId);
      notify('Поставщик убран из каталога Дома');
      navigate(ROUTES.internet);
    } catch {
      setError('Не удалось убрать Поставщика. Попробуйте ещё раз.');
      setSaving(false);
    }
  };

  return (
    <main className="screen screen--inner screen--with-panel" id="main-content">
      <form className="contact-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="inner-content stagger">
          <ScreenHeading description="Публикуйте только сведения, проверенные для этого Дома">{providerId ? 'Изменить Поставщика' : 'Новый Поставщик'}</ScreenHeading>
          <div className="internet-disclaimer">
            <Typography.Text asChild variant="description" color="secondary">
              <p>Ручные данные сохраняются с источником и датой проверки. Позже эти записи можно будет сопоставить с автоматической выгрузкой Поставщика.</p>
            </Typography.Text>
          </div>
          <label className="contact-form__field"><span>Поставщик</span><Input value={name} maxLength={160} placeholder="Например, Ростелеком" onChange={(event) => setName(event.target.value)} /></label>
          <label className="contact-form__field"><span>Доступность</span><NativeSelect value={availability} onChange={(event) => setAvailability(event.target.value as HouseInternetProvider['availability'])} aria-label="Доступность Поставщика">
            <option value="available">Подтверждён в Доме</option><option value="limited">Нужно уточнить</option>
          </NativeSelect></label>
          <label className="contact-form__field"><span>Телефон подключения</span><Input type="tel" value={phone} maxLength={80} placeholder="+7 800 000-00-00" onChange={(event) => setPhone(event.target.value)} /></label>
          <label className="contact-form__field"><span>Ссылка для проверки Квартиры</span><Input type="url" value={link} maxLength={500} placeholder="https://…" onChange={(event) => setLink(event.target.value)} /></label>
          <label className="contact-form__field"><span>Пояснение</span><Textarea value={note} maxLength={2000} rows={3} placeholder="Подъезды, ограничения, оборудование" onChange={(event) => setNote(event.target.value)} /></label>

          <section className="internet-tariff-editor" aria-labelledby="internet-tariffs-title">
            <div className="section-heading">
              <Typography.Text asChild variant="subheader"><h2 id="internet-tariffs-title">Тарифы</h2></Typography.Text>
              <button className="text-action" type="button" onClick={() => setTariffs((current) => [...current, emptyTariff()])}>Добавить</button>
            </div>
            {tariffs.map((tariff, index) => (
              <fieldset className="internet-tariff-form" key={index}>
                <legend>Тариф {index + 1}</legend>
                <label className="contact-form__field"><span>Название</span><Input value={tariff.name} maxLength={160} placeholder="Например, Технологии доступа 500" onChange={(event) => updateTariff(index, 'name', event.target.value)} /></label>
                <label className="contact-form__field"><span>Скорость, Мбит/с</span><Input type="number" min={1} inputMode="numeric" value={tariff.speedMbps ?? ''} placeholder="500" onChange={(event) => updateTariff(index, 'speedMbps', event.target.value ? Number(event.target.value) : null)} /></label>
                <label className="contact-form__field"><span>Цена в месяц, ₽</span><Input inputMode="decimal" value={tariff.monthlyPrice} placeholder="750" onChange={(event) => updateTariff(index, 'monthlyPrice', event.target.value)} /></label>
                <div className="internet-tariff-form__pair">
                  <label className="contact-form__field"><span>Цена по акции, ₽</span><Input inputMode="decimal" value={tariff.promoPrice ?? ''} placeholder="Необязательно" onChange={(event) => updateTariff(index, 'promoPrice', event.target.value || null)} /></label>
                  <label className="contact-form__field"><span>Месяцев акции</span><Input type="number" min={1} inputMode="numeric" value={tariff.promoMonths ?? ''} placeholder="3" onChange={(event) => updateTariff(index, 'promoMonths', event.target.value ? Number(event.target.value) : null)} /></label>
                </div>
                <label className="contact-form__field"><span>Технология</span><NativeSelect value={tariff.technology ?? ''} onChange={(event) => updateTariff(index, 'technology', (event.target.value || null) as InternetTariffInput['technology'])} aria-label={`Технология Тарифа ${index + 1}`}>
                  <option value="">Не указана</option>{technologies.map((technology) => <option value={technology} key={technology}>{internetTechnologyLabels[technology]}</option>)}
                </NativeSelect></label>
                <Checkbox checked={tariff.hasTv} onChange={(event) => updateTariff(index, 'hasTv', event.target.checked)}>Включает телевидение</Checkbox>
                <label className="contact-form__field"><span>Условия</span><Textarea value={tariff.conditions} maxLength={2000} rows={2} placeholder="Роутер, подключение, ограничения" onChange={(event) => updateTariff(index, 'conditions', event.target.value)} /></label>
                <label className="contact-form__field"><span>Источник</span><Input value={tariff.source} maxLength={1000} placeholder="https://…" onChange={(event) => updateTariff(index, 'source', event.target.value)} /></label>
                <label className="contact-form__field"><span>Когда проверили</span><Input type="date" value={tariff.checkedOn} onChange={(event) => updateTariff(index, 'checkedOn', event.target.value)} /></label>
                {tariffs.length > 1 ? <Button type="button" size="small" variant="ghost" onClick={() => setTariffs((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Удалить Тариф</Button> : null}
              </fieldset>
            ))}
          </section>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          {providerId ? (
            confirmingDelete ? (
              <section className="contact-delete-confirm" aria-labelledby="delete-provider-title">
                <Typography.Text asChild variant="body-strong"><h2 id="delete-provider-title">Убрать Поставщика?</h2></Typography.Text>
                <Typography.Text asChild variant="description" color="secondary"><p>Жильцы больше не увидят его Тарифы. Сохранённые Оценки останутся в истории.</p></Typography.Text>
                <div className="contact-form__actions">
                  <Button type="button" variant="secondary" onClick={() => setConfirmingDelete(false)}>Отмена</Button>
                  <Button type="button" variant="destructive" loading={saving} onClick={() => void remove()}>Убрать</Button>
                </div>
              </section>
            ) : <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(true)}>Убрать Поставщика</Button>
          ) : null}
        </div>
        <footer className="bottom-panel"><Button type="submit" size="large" stretched loading={saving}>Сохранить</Button></footer>
      </form>
    </main>
  );
}

function Message({ title, description }: { title: string; description: string }) {
  return <main className="screen screen--inner" id="main-content"><div className="inner-content"><ScreenHeading description={description}>{title}</ScreenHeading></div></main>;
}
