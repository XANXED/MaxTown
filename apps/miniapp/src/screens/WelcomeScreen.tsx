import { House, Phone, Wrench } from '@phosphor-icons/react';
import { Button, Typography } from '@maxhub/max-ui';
import buildingImage from '../assets/home-building.webp';
import { IconTile, type IconComponent, type TileColor } from '../components/ui.tsx';
import { JOIN_HINT } from '../data/home.ts';
import type { Notify } from './types.ts';

const features: Array<{ icon: IconComponent; color: TileColor; title: string; description: string }> = [
  {
    icon: House,
    color: 'green',
    title: 'Состояние дома',
    description: 'Электричество, вода, отопление, лифты и интернет: работает ли всё прямо сейчас',
  },
  {
    icon: Wrench,
    color: 'coral',
    title: 'Заявки Ответственным',
    description: 'Сообщите о неисправности с фото и следите, как её устраняют',
  },
  {
    icon: Phone,
    color: 'blue',
    title: 'Контакты и Места рядом',
    description: 'Диспетчерская, аварийная служба, поликлиника и МФЦ',
  },
];

type WelcomeScreenProps = {
  notify: Notify;
  onContinue: () => void;
};

export function WelcomeScreen({ notify, onContinue }: WelcomeScreenProps) {
  return (
    <div className="screen screen--welcome">
      <main className="welcome" id="main-content">
        <img
          className="welcome__image"
          src={buildingImage}
          alt=""
          width="960"
          height="400"
          fetchPriority="high"
        />

        <div className="welcome__copy stagger">
          <Typography.Text asChild variant="hero">
            <h1>Ваш дом в MAX</h1>
          </Typography.Text>
          <Typography.Text asChild variant="body" color="secondary">
            <p>Состояние дома, Заявки и нужные Контакты — в одном месте, без звонков и личных походов.</p>
          </Typography.Text>
        </div>

        <ul className="welcome__features stagger">
          {features.map(({ icon, color, title, description }) => (
            <li className="welcome__feature" key={title}>
              <IconTile icon={icon} tone={color} size="medium" />
              <span className="welcome__feature-copy">
                <Typography.Text asChild variant="body-strong">
                  <span>{title}</span>
                </Typography.Text>
                <Typography.Text asChild variant="description" color="secondary">
                  <span>{description}</span>
                </Typography.Text>
              </span>
            </li>
          ))}
        </ul>
      </main>

      <footer className="bottom-panel">
        <Button size="medium" variant="primary" stretched onClick={() => notify(JOIN_HINT)}>
          Стать Жильцом
        </Button>
        <Button size="medium" variant="ghost" stretched onClick={onContinue}>
          Сначала посмотреть
        </Button>
      </footer>
    </div>
  );
}
