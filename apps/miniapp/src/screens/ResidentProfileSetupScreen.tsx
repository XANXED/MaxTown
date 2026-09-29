import { useState, type FormEvent } from 'react';
import { Switch } from '@vkontakte/vkui';
import type { HouseMembershipSummary, MeResponse, NeighborApartments } from '@maxtown/shared';
import { Button, Input, Typography } from '../components/platform-ui.tsx';
import { ScreenHeading } from '../components/ui.tsx';
import { saveResidentHouseProfile } from '../data/residentProfile.ts';
import { MaxContactRequestError, requestMaxPhoneContact } from '../maxContact.ts';

type Props = {
  membership: HouseMembershipSummary;
  phoneVerified: boolean;
  onComplete: (profile: MeResponse) => void;
};

type NeighborField = keyof NeighborApartments;

const APARTMENT_PATTERN = /^[1-9][0-9]{0,3}[а-яa-z]?$/iu;
const neighborFields: Array<{ key: NeighborField; label: string }> = [
  { key: 'left', label: 'Слева' },
  { key: 'right', label: 'Справа' },
  { key: 'below', label: 'Этажом ниже' },
  { key: 'above', label: 'Этажом выше' },
];

function normalized(value: string): string {
  return value.trim().toLocaleUpperCase('ru-RU');
}

function contactError(error: unknown): string {
  if (!(error instanceof MaxContactRequestError)) return 'Не удалось получить номер из MAX';
  if (error.reason === 'refused') return 'Вы не разрешили передать номер. Выключите показ телефона или попробуйте снова';
  if (error.reason === 'unsupported') return 'Запрос номера доступен только внутри приложения MAX';
  return 'MAX не передал номер. Попробуйте ещё раз';
}

export function ResidentProfileSetupScreen({ membership, phoneVerified, onComplete }: Props) {
  const [apartmentNumber, setApartmentNumber] = useState(membership.apartmentNumber ?? '');
  const [neighbors, setNeighbors] = useState<Record<NeighborField, string>>({
    left: membership.neighborApartments.left ?? '',
    right: membership.neighborApartments.right ?? '',
    below: membership.neighborApartments.below ?? '',
    above: membership.neighborApartments.above ?? '',
  });
  const [phoneVisible, setPhoneVisible] = useState(membership.phoneVisibleToNeighbors);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateNeighbor = (key: NeighborField, value: string) => {
    setNeighbors((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const apartment = normalized(apartmentNumber);
    if (!APARTMENT_PATTERN.test(apartment)) {
      setError('Укажите номер своей квартиры, например 42 или 42А');
      return;
    }
    const neighborApartments = Object.fromEntries(
      neighborFields.map(({ key }) => [key, neighbors[key].trim() ? normalized(neighbors[key]) : null]),
    ) as NeighborApartments;
    const invalidNeighbor = Object.values(neighborApartments).find((value) => value !== null && !APARTMENT_PATTERN.test(value));
    if (invalidNeighbor) {
      setError(`Проверьте номер соседней квартиры: ${invalidNeighbor}`);
      return;
    }
    if (Object.values(neighborApartments).includes(apartment)) {
      setError('Номер своей квартиры нельзя указывать как соседний');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const phoneContact = phoneVisible && !phoneVerified ? await requestMaxPhoneContact() : undefined;
      const profile = await saveResidentHouseProfile(membership.houseId, {
        apartmentNumber: apartment,
        phoneVisibleToNeighbors: phoneVisible,
        neighborApartments,
        ...(phoneContact ? { phoneContact } : {}),
      });
      onComplete(profile);
    } catch (caught) {
      setError(caught instanceof MaxContactRequestError ? contactError(caught) : caught instanceof Error ? caught.message : 'Не удалось сохранить профиль');
      setSaving(false);
    }
  };

  return (
    <main className="screen screen--inner screen--with-panel" id="main-content">
      <form className="resident-profile-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="inner-content stagger">
          <ScreenHeading description="Заполните один раз, чтобы соседи понимали, кто живёт рядом">Расскажите о себе</ScreenHeading>

          <section className="resident-profile-house" aria-label="Ваш Дом">
            <Typography.Text asChild variant="body-strong"><p>{membership.address}</p></Typography.Text>
            <Typography.Text asChild variant="description" color="secondary"><p>{membership.locality}</p></Typography.Text>
          </section>

          <label className="contact-form__field">
            <span>Номер вашей квартиры</span>
            <Input
              value={apartmentNumber}
              maxLength={5}
              autoComplete="off"
              placeholder="Например, 42"
              aria-describedby="apartment-hint"
              onChange={(event) => setApartmentNumber(event.target.value)}
            />
            <Typography.Text asChild variant="description" color="tertiary">
              <small id="apartment-hint">Обязательное поле</small>
            </Typography.Text>
          </label>

          <fieldset className="resident-neighbors">
            <legend>Номера соседних квартир</legend>
            <Typography.Text asChild variant="description" color="secondary">
              <p>Заполните только те, которые знаете</p>
            </Typography.Text>
            <div className="resident-neighbors__grid">
              {neighborFields.map(({ key, label }) => (
                <label className="contact-form__field" key={key}>
                  <span>{label}</span>
                  <Input
                    value={neighbors[key]}
                    maxLength={5}
                    autoComplete="off"
                    placeholder="Необязательно"
                    onChange={(event) => updateNeighbor(key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <section className="resident-phone-consent" aria-labelledby="phone-consent-title">
            <span className="resident-phone-consent__copy">
              <Typography.Text asChild variant="body-strong"><h2 id="phone-consent-title">Показывать мой номер соседям</h2></Typography.Text>
              <Typography.Text asChild variant="description" color="secondary">
                <p>{phoneVerified
                  ? 'Соседи из этого Дома увидят подтверждённый номер MAX'
                  : 'При сохранении MAX попросит поделиться номером аккаунта'}</p>
              </Typography.Text>
            </span>
            <Switch
              checked={phoneVisible}
              aria-label="Показывать номер телефона соседям"
              onChange={(event) => setPhoneVisible(event.target.checked)}
            />
          </section>

          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </div>
        <footer className="bottom-panel">
          <Button type="submit" size="large" stretched loading={saving}>Сохранить и продолжить</Button>
        </footer>
      </form>
    </main>
  );
}
