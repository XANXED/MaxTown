import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeScreen } from './screens/HomeScreen.tsx';
import { HouseEventsScreen } from './screens/HouseEventsScreen.tsx';
import { NewRequestScreen } from './screens/NewRequestScreen.tsx';
import { ProfileScreen } from './screens/ProfileScreen.tsx';
import { RequestsScreen } from './screens/RequestsScreen.tsx';
import { ServicesScreen } from './screens/ServicesScreen.tsx';
import { WelcomeScreen } from './screens/WelcomeScreen.tsx';
import { hashForRoute, routeFromHash, ROUTES, startRoute, type AppRoute } from './routes.ts';
import { hasSeenWelcome, markWelcomeSeen } from './welcome.ts';
import './app.css';

const NOTICE_DURATION_MS = 3200;
/** Столько длится анимация исчезновения уведомления в app.css (--motion-base). */
const NOTICE_EXIT_MS = 240;

/** Экраны без кнопки «Назад»: приветствие и вкладки нижней навигации. */
const rootRoutes = new Set<AppRoute>([ROUTES.welcome, ROUTES.home, ROUTES.requests, ROUTES.services, ROUTES.profile]);

function initialRoute(): AppRoute {
  return startRoute(window.location.hash, hasSeenWelcome());
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [notice, setNotice] = useState<{ message: string; leaving: boolean } | null>(null);
  const noticeTimers = useRef<number[]>([]);

  const navigate = useCallback((nextRoute: AppRoute) => {
    const nextHash = hashForRoute(nextRoute);
    if (window.location.hash === nextHash) {
      setRoute(nextRoute);
      return;
    }

    window.location.hash = nextHash;
  }, []);

  const notify = useCallback((message: string) => {
    noticeTimers.current.forEach((timer) => window.clearTimeout(timer));
    setNotice({ message, leaving: false });
    noticeTimers.current = [
      window.setTimeout(() => setNotice((current) => current && { ...current, leaving: true }), NOTICE_DURATION_MS),
      window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS + NOTICE_EXIT_MS),
    ];
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      setRoute(routeFromHash(window.location.hash));
      window.scrollTo({ top: 0, behavior: 'instant' });
    };

    if (!window.location.hash) {
      window.history.replaceState(null, '', hashForRoute(initialRoute()));
    }

    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  useEffect(() => {
    const webApp = window.WebApp;
    const backButton = webApp?.initData ? webApp.BackButton : undefined;
    if (!backButton) return;

    const goHome = () => navigate(ROUTES.home);

    // Вкладки нижней навигации — корневые экраны, «Назад» на них не нужен.
    if (rootRoutes.has(route)) {
      backButton.hide();
      return;
    }

    backButton.show();
    backButton.onClick(goHome);

    return () => backButton.offClick(goHome);
  }, [navigate, route]);

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
          notify={notify}
          onContinue={() => {
            markWelcomeSeen();
            navigate(ROUTES.home);
          }}
        />
      );
      break;
    case ROUTES.requests:
      screen = <RequestsScreen navigate={navigate} notify={notify} />;
      break;
    case ROUTES.newRequest:
      screen = <NewRequestScreen notify={notify} />;
      break;
    case ROUTES.events:
      screen = <HouseEventsScreen notify={notify} />;
      break;
    case ROUTES.services:
      screen = <ServicesScreen navigate={navigate} notify={notify} />;
      break;
    case ROUTES.profile:
      screen = <ProfileScreen navigate={navigate} notify={notify} />;
      break;
    case ROUTES.home:
    default:
      screen = <HomeScreen navigate={navigate} notify={notify} />;
      break;
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        К основному содержанию
      </a>
      {/* key перезапускает анимацию появления при смене экрана */}
      <div className="screen-transition" key={route}>
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
