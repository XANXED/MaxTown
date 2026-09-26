import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CaretLeft, WifiSlash } from '@phosphor-icons/react';
import { ContactsScreen } from './screens/ContactsScreen.tsx';
import { EventScreen } from './screens/EventScreen.tsx';
import { HomeScreen } from './screens/HomeScreen.tsx';
import { HouseEventsScreen } from './screens/HouseEventsScreen.tsx';
import { HouseStateScreen } from './screens/HouseStateScreen.tsx';
import { JoinScreen } from './screens/JoinScreen.tsx';
import { NotificationsScreen } from './screens/NotificationsScreen.tsx';
import { NewRequestScreen } from './screens/NewRequestScreen.tsx';
import { PlacesScreen } from './screens/PlacesScreen.tsx';
import { ProfileScreen } from './screens/ProfileScreen.tsx';
import { ReadingsScreen } from './screens/ReadingsScreen.tsx';
import { RequestScreen } from './screens/RequestScreen.tsx';
import { RequestsScreen } from './screens/RequestsScreen.tsx';
import { ServicesScreen } from './screens/ServicesScreen.tsx';
import { WelcomeScreen } from './screens/WelcomeScreen.tsx';
import {
  hashForRoute,
  isRootRoute,
  matchCard,
  parentRoute,
  routeFromHash,
  ROUTES,
  startRoute,
  type AppRoute,
} from './routes.ts';
import { launchInviteCode } from './data/join.ts';
import { useOnline } from './network.ts';
import { hasSeenWelcome, markWelcomeSeen } from './welcome.ts';
import './app.css';

const NOTICE_DURATION_MS = 3200;
/** Столько длится анимация исчезновения уведомления в app.css (--motion-base). */
const NOTICE_EXIT_MS = 240;

function initialRoute(): AppRoute {
  // Открыли по ссылке-приглашению — сразу к вступлению, приветствие не нужно.
  if (launchInviteCode()) return ROUTES.join;
  return startRoute(window.location.hash, hasSeenWelcome());
}

/**
 * Запись истории, сделанная приложением: порядковый номер шага внутри
 * MaxTown и прокрутка, с которой с него ушли. Номер 0 — первый экран: с него
 * «Назад» ведёт не в историю браузера, а к родительскому экрану.
 */
type HistoryEntry = { step: number; scrollY?: number };

function currentEntry(): HistoryEntry {
  const state = window.history.state as Partial<HistoryEntry> | null;
  return { step: typeof state?.step === 'number' ? state.step : 0, scrollY: state?.scrollY };
}

/** В MAX «Назад» — системная кнопка; в браузере её нет, и внутренним экранам нужна своя. */
const insideMax = Boolean(window.WebApp?.initData);

export function App() {
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [notice, setNotice] = useState<{ message: string; leaving: boolean } | null>(null);
  const noticeTimers = useRef<number[]>([]);
  const online = useOnline();
  /** Куда прокрутить после смены экрана: наверх или туда, где Жилец был до перехода. */
  const pendingScroll = useRef(0);

  const navigate = useCallback((nextRoute: AppRoute) => {
    const nextHash = hashForRoute(nextRoute);
    if (window.location.hash === nextHash) {
      setRoute(nextRoute);
      return;
    }

    const { step } = currentEntry();
    window.history.replaceState({ step, scrollY: window.scrollY } satisfies HistoryEntry, '');
    window.history.pushState({ step: step + 1 } satisfies HistoryEntry, '', nextHash);
    pendingScroll.current = 0;
    setRoute(nextRoute);
  }, []);

  const goBack = useCallback(() => {
    if (currentEntry().step > 0) {
      window.history.back();
      return;
    }

    // Истории нет (экран открыли по ссылке) — поднимаемся к родителю, не выходя из приложения.
    const parent = parentRoute(route);
    window.history.replaceState({ step: 0 } satisfies HistoryEntry, '', hashForRoute(parent));
    pendingScroll.current = 0;
    setRoute(parent);
  }, [route]);

  const notify = useCallback((message: string) => {
    noticeTimers.current.forEach((timer) => window.clearTimeout(timer));
    setNotice({ message, leaving: false });
    noticeTimers.current = [
      window.setTimeout(() => setNotice((current) => current && { ...current, leaving: true }), NOTICE_DURATION_MS),
      window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS + NOTICE_EXIT_MS),
    ];
  }, []);

  useEffect(() => {
    // «Назад» и «Вперёд» браузера, ручная правка адреса. Оба события приходят
    // на один переход — обработчик повторяемый.
    const syncRoute = () => {
      pendingScroll.current = currentEntry().scrollY ?? 0;
      setRoute(routeFromHash(window.location.hash));
    };

    if (!window.location.hash) {
      window.history.replaceState({ step: 0 } satisfies HistoryEntry, '', hashForRoute(initialRoute()));
    }

    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  useLayoutEffect(() => {
    window.scrollTo({ top: pendingScroll.current, behavior: 'instant' });
    pendingScroll.current = 0;
  }, [route]);

  useEffect(() => {
    const backButton = insideMax ? window.WebApp?.BackButton : undefined;
    if (!backButton) return;

    // Вкладки нижней навигации — корневые экраны, «Назад» на них не нужен.
    if (isRootRoute(route)) {
      backButton.hide();
      return;
    }

    backButton.show();
    backButton.onClick(goBack);

    return () => backButton.offClick(goBack);
  }, [goBack, route]);

  useEffect(
    () => () => {
      noticeTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  let screen;

  switch (route) {
    case ROUTES.welcome:
      screen = (
        <WelcomeScreen
          onJoin={() => {
            markWelcomeSeen();
            navigate(ROUTES.join);
          }}
          onContinue={() => {
            markWelcomeSeen();
            navigate(ROUTES.home);
          }}
        />
      );
      break;
    case ROUTES.requests:
      screen = <RequestsScreen navigate={navigate} />;
      break;
    case ROUTES.newRequest:
      screen = <NewRequestScreen navigate={navigate} notify={notify} />;
      break;
    case ROUTES.events:
      screen = <HouseEventsScreen navigate={navigate} />;
      break;
    case ROUTES.services:
      screen = <ServicesScreen navigate={navigate} notify={notify} />;
      break;
    case ROUTES.profile:
      screen = <ProfileScreen navigate={navigate} notify={notify} />;
      break;
    case ROUTES.readings:
      screen = <ReadingsScreen navigate={navigate} />;
      break;
    case ROUTES.contacts:
      screen = <ContactsScreen navigate={navigate} />;
      break;
    case ROUTES.places:
      screen = <PlacesScreen navigate={navigate} />;
      break;
    case ROUTES.notifications:
      screen = <NotificationsScreen navigate={navigate} />;
      break;
    case ROUTES.join:
      screen = <JoinScreen navigate={navigate} notify={notify} />;
      break;
    case ROUTES.house:
      screen = <HouseStateScreen navigate={navigate} />;
      break;
    case ROUTES.home:
      screen = <HomeScreen navigate={navigate} />;
      break;
    default: {
      const card = matchCard(route);
      screen =
        card?.kind === 'request' ? (
          <RequestScreen id={card.id} navigate={navigate} notify={notify} />
        ) : card?.kind === 'event' ? (
          <EventScreen id={card.id} navigate={navigate} />
        ) : (
          <HomeScreen navigate={navigate} />
        );
    }
  }

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          // Хеш занят маршрутами: #main-content увёл бы на главную. Переводим фокус сами.
          event.preventDefault();
          const main = document.getElementById('main-content');
          if (!main) return;
          main.setAttribute('tabindex', '-1');
          main.focus();
        }}
      >
        К основному содержанию
      </a>
      {online ? null : (
        <div className="offline-bar" role="status">
          <WifiSlash className="icon icon--small" aria-hidden />
          Нет интернета. Данные могут устареть
        </div>
      )}
      {/* key перезапускает анимацию появления при смене экрана */}
      <div className="screen-transition" key={route}>
        {!insideMax && !isRootRoute(route) ? (
          <div className="back-bar">
            <button className="text-action pressable back-bar__button" type="button" onClick={goBack}>
              <CaretLeft className="icon icon--small" weight="bold" aria-hidden />
              Назад
            </button>
          </div>
        ) : null}
        {screen}
      </div>
      <div className="live-region" aria-live="polite" aria-atomic="true">
        {notice ? (
          <div className={`notice${notice.leaving ? ' notice--leaving' : ''}`} role="status">
            {notice.message}
          </div>
        ) : null}
      </div>
    </div>
  );
}
