import { useEffect, useState, type FormEvent } from 'react';
import { Buildings, CheckCircle, MapPin, WarningCircle } from '@phosphor-icons/react';
import { Button, Input, Spinner, Typography } from '@maxhub/max-ui';
import type { HouseAddressSuggestion, PendingHouseSetup } from '@maxtown/shared';
import { IconTile, RowShell, ScreenHeading } from '../components/ui.tsx';
import {
  confirmSetupAddress,
  HouseSetupRequestError,
  suggestSetupAddresses,
} from '../houseSetup.ts';
import { hapticSuccess, hapticWarning } from '../haptics.ts';

type HouseSetupScreenProps = {
  setup: PendingHouseSetup;
  onOpenHouse: () => void;
};

export function HouseSetupScreen({ setup, onOpenHouse }: HouseSetupScreenProps) {
  const [query, setQuery] = useState(setup.chatTitle);
  const [suggestions, setSuggestions] = useState<HouseAddressSuggestion[]>([]);
  const [selected, setSelected] = useState<HouseAddressSuggestion | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdAddress, setCreatedAddress] = useState<string | null>(null);

  useEffect(() => {
    const normalized = query.trim();
    setSelected(null);
    setError(null);
    if (normalized.length < 3) {
      setSuggestions([]);
      setSearching(false);
      setSearched(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    setSearched(false);
    const timer = window.setTimeout(() => {
      void suggestSetupAddresses(setup, normalized)
        .then((addresses) => {
          if (cancelled) return;
          setSuggestions(addresses);
          setSearched(true);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setSuggestions([]);
          setError(reason instanceof HouseSetupRequestError ? reason.message : 'Не удалось найти адрес');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, setup.chatId, setup.chatTitle]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    void confirmSetupAddress(setup, selected)
      .then(() => {
        hapticSuccess();
        setCreatedAddress(selected.value);
      })
      .catch((reason: unknown) => {
        hapticWarning();
        setError(reason instanceof HouseSetupRequestError ? reason.message : 'Не удалось создать Дом');
      })
      .finally(() => setSaving(false));
  };

  if (createdAddress) {
    return (
      <main className="screen screen--inner" id="main-content">
        <div className="inner-content">
          <ScreenHeading description={createdAddress}>Дом создан</ScreenHeading>
          <section className="outcome outcome--positive" aria-live="polite">
            <CheckCircle className="icon" weight="fill" aria-hidden />
            <span className="outcome__copy">
              <Typography.Text asChild variant="body-strong">
                <p>Чат подключён к MaxTown</p>
              </Typography.Text>
              <Typography.Text asChild variant="description" color="secondary">
                <p>Все участники этого чата теперь могут открыть Дом в мини-приложении.</p>
              </Typography.Text>
            </span>
          </section>
          <Button size="medium" variant="primary" stretched onClick={onOpenHouse}>
            Открыть Дом
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen screen--inner" id="main-content">
      <form className="inner-content house-setup" onSubmit={submit} noValidate>
        <ScreenHeading description={`Домовой чат: ${setup.chatTitle}`}>Укажите адрес Дома</ScreenHeading>

        <section className="form-section" aria-labelledby="house-address-label">
          <Typography.Text asChild variant="title">
            <label id="house-address-label" htmlFor="house-address">Адрес</label>
          </Typography.Text>
          <Input
            id="house-address"
            mode="contrast"
            size="large"
            autoComplete="street-address"
            placeholder="Город, улица, дом"
            value={query}
            withClearButton
            aria-describedby={error ? 'house-address-error' : 'house-address-hint'}
            aria-invalid={Boolean(error)}
            iconBefore={<MapPin className="icon icon--small" aria-hidden />}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Typography.Text asChild variant="description" color="secondary">
            <p id="house-address-hint">Выберите конкретный дом из подсказок. Этот адрес увидят участники чата.</p>
          </Typography.Text>
          {error ? (
            <span className="outcome outcome--negative" id="house-address-error" role="alert">
              <WarningCircle className="icon" aria-hidden />
              <Typography.Text asChild variant="description">
                <span>{error}</span>
              </Typography.Text>
            </span>
          ) : null}
        </section>

        <section aria-labelledby="house-suggestions-title">
          <Typography.Text asChild variant="subheader">
            <h2 id="house-suggestions-title">Подходящие дома</h2>
          </Typography.Text>
          {searching ? (
            <div className="house-setup__loading" role="status">
              <Spinner size={20} />
              <Typography.Text asChild variant="description" color="secondary">
                <span>Ищем адрес</span>
              </Typography.Text>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="list-card" role="list" aria-label="Подсказки адреса">
              {suggestions.map((address) => {
                const isSelected = selected?.garHouseGuid === address.garHouseGuid;
                return (
                  <RowShell
                    key={address.garHouseGuid}
                    className={isSelected ? 'house-setup__selected' : ''}
                    onOpen={() => setSelected(address)}
                    trailing={
                      isSelected ? <CheckCircle className="icon icon--small" weight="fill" aria-hidden /> : undefined
                    }
                  >
                    <IconTile icon={Buildings} tone={isSelected ? 'green' : 'neutral'} size="small" />
                    <span className="list-row__copy">
                      <Typography.Text asChild variant="body-strong">
                        <span>{address.value}</span>
                      </Typography.Text>
                      <Typography.Text asChild variant="description" color="secondary">
                        <span>{address.locality}</span>
                      </Typography.Text>
                    </span>
                  </RowShell>
                );
              })}
            </div>
          ) : searched ? (
            <Typography.Text asChild variant="description" color="secondary">
              <p className="house-setup__empty">Точный дом не найден. Уточните город, улицу и номер.</p>
            </Typography.Text>
          ) : null}
        </section>

        <Button type="submit" size="medium" variant="primary" stretched disabled={!selected} loading={saving}>
          Создать Дом
        </Button>
      </form>
    </main>
  );
}
