import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Spinner } from './components/platform-ui.tsx';
import { CaretLeft, HouseLine, LockKey, WifiSlash } from '@phosphor-icons/react';
import type { HouseMembershipSummary, HouseRole, PendingHouseSetup } from '@maxtown/shared';
import { EmptyState, ScreenHeading } from './components/ui.tsx';
import { ContactsScreen } from './screens/ContactsScreen.tsx';
import { ContactFormScreen } from './screens/ContactFormScreen.tsx';
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
import { InternetProvidersScreen } from './screens/InternetProvidersScreen.tsx';
import { InternetProviderFormScreen } from './screens/InternetProviderFormScreen.tsx';
import { WelcomeScreen } from './screens/WelcomeScreen.tsx';
import { HouseSetupScreen } from './screens/HouseSetupScreen.tsx';
import { AssignedPlaceFormScreen } from './screens/AssignedPlaceFormScreen.tsx';
import { NearestPlacesScreen } from './screens/NearestPlacesScreen.tsx';
import {
  hashForRoute,
  isRootRoute,
  matchCard,
  matchContactEditor,
  matchInternetProviderEditor,
  matchNearestPlaces,
  matchPlaceEditor,
  parentRoute,
  routeFromHash,
  ROUTES,
  startRoute,
  type AppRoute,
} from './routes.ts';
import { launchInviteCode } from './data/join.ts';
import { demoMode } from './data/loadable.ts';
import { demoPendingHouseSetup, launchSetupChatId } from './houseSetup.ts';
import { currentMaxInitData, launchPoll, maxNavigationHash, waitForMaxInitData } from './maxLaunch.ts';
import { useOnline } from './network.ts';
import { hasSeenWelcome, markWelcomeSeen } from './welcome.ts';
import { authenticateWithMax, AuthRequestError, getCurrentResident } from './auth/session.ts';
import { MembershipContext } from './auth/membership.tsx';
import './app.css';

const NOTICE_DURATION_MS = 3200;
/** Столько длится анимация исчезновения уведомления в app.css (--motion-base). */
const NOTICE_EXIT_MS = 240;
/** Внутри MAX (или по ссылке npm run dev:link) — вход через сервер; в dev без MAX — примеры. */
const INSIDE_MAX = Boolean(currentMaxInitData());
const REQUIRE_SERVER_AUTH = !import.meta.env.DEV || INSIDE_MAX;
const CommunityScreen = lazy(() => import('./screens/CommunityScreen.tsx').then(({ CommunityScreen: Screen }) => ({ default: Screen })));
const RepairModeScreen = lazy(() => import('./screens/RepairModeScreen.tsx').then(({ RepairModeScreen: Screen }) => ({ default: Screen })));

function initialRoute(): AppRoute {
  // Открыли по ссылке-приглашению — сразу к вступлению, приветствие не нужно.
  if (launchInviteCode()) return ROUTES.join;
  if (launchPoll()) return ROUTES.community;
  // В MAX человек пришёл из своего Домового чата — приветствие не нужно.
  if (INSIDE_MAX) return routeFromHash(window.location.hash);
  return startRoute(window.location.hash, hasSeenWelcome());
}

/**
 * Запись истории, сделанная приложением: порядковый номер шага внутри
 * MaxTown и прокрутка, с которой с него ушли. Номер 0 — первый экран: с него
 * «Назад» ведёт не в историю браузера, а к родительскому экрану.
 */
type HistoryEntry = { step: number; scrollY?: number };

type AuthState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

/** Вход ещё идёт или не удался: объясняем, что происходит, и даём повторить. */
function AuthScreen({ state, onRetry }: { state: Exclude<AuthState, { status: 'ready' }>; onRetry: () => void }) {
  const loading = state.status === 'loading';
  return (
    <div className="app-shell">
      <main className="screen screen--inner inner-content" id="main-content">
        <ScreenHeading description="MaxTown открывают из Домового чата в MAX">Доступ к дому</ScreenHeading>
        <div className="list-card">
          <EmptyState
            icon={loading ? HouseLine : LockKey}
            title={loading ? 'Проверяем участие в чате' : state.message}
            description={loading ? 'Это займёт несколько секунд' : 'Проверьте интернет и попробуйте ещё раз'}
            action={loading ? <Spinner size={20} /> : (
              <Button size="small" variant="secondary" onClick={onRetry}>
                Проверить снова
              </Button>
            )}
          />
        </div>
      </main>
    </div>
  );
}

function currentEntry(): HistoryEntry {
  const state = window.history.state as Partial<HistoryEntry> | null;
  return { step: typeof state?.step === 'number' ? state.step : 0, scrollY: state?.scrollY };
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [notice, setNotice] = useState<{ message: string; leaving: boolean } | null>(null);
  const noticeTimers = useRef<number[]>([]);
  const online = useOnline();
  const [authState, setAuthState] = useState<AuthState>({ status: REQUIRE_SERVER_AUTH ? 'loading' : 'ready' });
  const [authAttempt, setAuthAttempt] = useState(0);
  /** Домовые чаты, где человек может выбрать Адрес Дома; выбранные убираем. */
  const [pendingSetups, setPendingSetups] = useState<PendingHouseSetup[]>([]);
  const [demoSetupDone, setDemoSetupDone] = useState(false);
  const [activeHouseId, setActiveHouseId] = useState<string | null>(null);
  const [activeHouseRole, setActiveHouseRole] = useState<HouseRole | null>(null);
  const [activeMembership, setActiveMembership] = useState<HouseMembershipSummary | null>(null);

  /** Выбрать активный Дом: из ?house_id=, иначе первый. */
  const applyMemberships = useCallback((memberships: HouseMembershipSummary[], preferredHouseId?: string | null) => {
    const membership = memberships.find((item) => item.houseId === preferredHouseId) ?? memberships[0] ?? null;
    setActiveMembership(membership);
    setActiveHouseId(membership?.houseId ?? null);
    setActiveHouseRole(membership?.role ?? null);
  }, []);

  const refreshMembershipIn = useCallback(async (preferredHouseId: string | null) => {
    if (!REQUIRE_SERVER_AUTH) return;
    try {
      const { memberships } = await getCurrentResident();
      applyMemberships(memberships, preferredHouseId);
    } catch {
      // Не вышло — останется прежнее членство; следующий вход перечитает.
    }
  }, [applyMemberships]);
  const refreshMembership = useCallback(() => refreshMembershipIn(activeHouseId), [activeHouseId, refreshMembershipIn]);
  const [communityPollId, setCommunityPollId] = useState<string | null>(() => launchPoll()?.pollId ?? null);
  /** Куда прокрутить после смены экрана: наверх или туда, где Жилец был до перехода. */
  const pendingScroll = useRef(0);

  useEffect(() => {
    if (!REQUIRE_SERVER_AUTH) return;
    let active = true;
    setAuthState({ status: 'loading' });
    // Мост MAX может заполнить initData позже, чем запустился React.
    waitForMaxInitData()
      .then((initData) => authenticateWithMax(initData ?? '', launchSetupChatId()))
      .then(async ({ pendingHouseSetups }) => {
        const { memberships } = await getCurrentResident();
        if (!active) return;
        setPendingSetups(pendingHouseSetups);
        applyMemberships(memberships, launchPoll()?.houseId ?? null);
        setAuthState({ status: 'ready' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAuthState({ status: 'error', message: error instanceof AuthRequestError ? error.message : 'Не удалось подтвердить вход через MAX' });
      });
    return () => { active = false; };
  }, [authAttempt, applyMemberships]);

  const navigate = useCallback((nextRoute: AppRoute) => {
    // Параметры запуска MAX остаются во фрагменте: они нужны после перезагрузки WebView.
    const nextHash = maxNavigationHash(hashForRoute(nextRoute));
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
    window.history.replaceState({ step: 0 } satisfies HistoryEntry, '', maxNavigationHash(hashForRoute(parent)));
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

  const openCommunityPoll = useCallback(async (houseId: string, pollId: string) => {
    try {
      const me = await getCurrentResident();
      const membership = me.memberships.find((item) => item.houseId === houseId);
      if (!membership) return;
      applyMemberships(me.memberships, houseId);
      setCommunityPollId(pollId);
      navigate(ROUTES.community);
    } catch {
      notify('Не удалось открыть Опрос. Обновите экран и попробуйте снова.');
    }
  }, [navigate, notify]);

  useEffect(() => {
    // «Назад» и «Вперёд» браузера, ручная правка адреса. Оба события приходят
    // на один переход — обработчик повторяемый.
    const syncRoute = () => {
      pendingScroll.current = currentEntry().scrollY ?? 0;
      setRoute(routeFromHash(window.location.hash));
    };

    if (!window.location.hash) {
      window.history.replaceState({ step: 0 } satisfies HistoryEntry, '', maxNavigationHash(hashForRoute(initialRoute())));
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
    // В MAX «Назад» — системная кнопка; в браузере её нет, там своя.
    const backButton = INSIDE_MAX ? window.WebApp?.BackButton : undefined;
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

  if (authState.status !== 'ready') {
    return <AuthScreen state={authState} onRetry={() => setAuthAttempt((attempt) => attempt + 1)} />;
  }

  // Подключение Дома: чат из кнопки «Указать адрес», а без неё — первый
  // ожидающий, если своего Дома у человека ещё нет.
  const requestedSetupChatId = launchSetupChatId();
  const pendingHouseSetup = demoMode() === 'house-setup'
    ? (demoSetupDone ? null : demoPendingHouseSetup())
    : (requestedSetupChatId !== null
      ? pendingSetups.find((setup) => setup.chatId === requestedSetupChatId)
      : activeMembership === null ? pendingSetups[0] : undefined) ?? null;

  if (pendingHouseSetup) {
    return (
      <div className="app-shell">
        <HouseSetupScreen
          setup={pendingHouseSetup}
          onOpenHouse={(houseId) => {
            setDemoSetupDone(true);
            setPendingSetups((current) => current.filter((setup) => setup.chatId !== pendingHouseSetup.chatId));
            markWelcomeSeen();
            void refreshMembershipIn(houseId).then(() => navigate(ROUTES.home));
          }}
        />
      </div>
    );
  }

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
      screen = <ServicesScreen navigate={navigate} />;
      break;
    case ROUTES.internet:
      screen = <InternetProvidersScreen navigate={navigate} notify={notify} houseId={activeHouseId} role={activeHouseRole} />;
      break;
    case ROUTES.newInternetProvider:
      screen = <InternetProviderFormScreen navigate={navigate} notify={notify} houseId={activeHouseId} role={activeHouseRole} />;
      break;
    case ROUTES.profile:
      screen = <ProfileScreen navigate={navigate} notify={notify} />;
      break;
    case ROUTES.readings:
      screen = <ReadingsScreen navigate={navigate} />;
      break;
    case ROUTES.community:
      screen = <CommunityScreen houseId={activeHouseId} role={activeHouseRole} selectedPollId={communityPollId} />;
      break;
    case ROUTES.repairMode:
      screen = <RepairModeScreen houseId={activeHouseId} role={activeHouseRole} />;
      break;
    case ROUTES.contacts:
      screen = <ContactsScreen navigate={navigate} notify={notify} houseId={activeHouseId} role={activeHouseRole} />;
      break;
    case ROUTES.newContact:
      screen = <ContactFormScreen navigate={navigate} notify={notify} houseId={activeHouseId} role={activeHouseRole} />;
      break;
    case ROUTES.places:
      screen = <PlacesScreen navigate={navigate} houseId={activeHouseId} role={activeHouseRole} />;
      break;
    case ROUTES.newPlace:
      screen = <AssignedPlaceFormScreen navigate={navigate} notify={notify} houseId={activeHouseId} role={activeHouseRole} />;
      break;
    case ROUTES.notifications:
      screen = <NotificationsScreen navigate={navigate} openCommunityPoll={(houseId, pollId) => void openCommunityPoll(houseId, pollId)} />;
      break;
    case ROUTES.join:
      screen = <JoinScreen navigate={navigate} />;
      break;
    case ROUTES.house:
      screen = <HouseStateScreen navigate={navigate} />;
      break;
    case ROUTES.home:
      screen = <HomeScreen navigate={navigate} houseId={activeHouseId} />;
      break;
    default: {
      const card = matchCard(route);
      const contactEditor = matchContactEditor(route);
      const internetProviderEditor = matchInternetProviderEditor(route);
      const placeEditor = matchPlaceEditor(route);
      const nearest = matchNearestPlaces(route);
      screen =
        card?.kind === 'request' ? (
          <RequestScreen id={card.id} navigate={navigate} notify={notify} />
        ) : card?.kind === 'event' ? (
          <EventScreen id={card.id} navigate={navigate} />
        ) : contactEditor ? (
          <ContactFormScreen contactId={contactEditor.id} navigate={navigate} notify={notify} houseId={activeHouseId} role={activeHouseRole} />
        ) : internetProviderEditor ? (
          <InternetProviderFormScreen providerId={internetProviderEditor.id} navigate={navigate} notify={notify} houseId={activeHouseId} role={activeHouseRole} />
        ) : placeEditor ? (
          <AssignedPlaceFormScreen placeId={placeEditor.id} navigate={navigate} notify={notify} houseId={activeHouseId} role={activeHouseRole} />
        ) : nearest ? (
          <NearestPlacesScreen kind={nearest.kind} houseId={activeHouseId} />
        ) : (
          <HomeScreen navigate={navigate} houseId={activeHouseId} />
        );
    }
  }

  return (
    <MembershipContext.Provider value={{ membership: activeMembership, refresh: refreshMembership }}>
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
        {!isRootRoute(route) && !INSIDE_MAX ? (
          <div className="back-bar">
            <button className="text-action pressable back-bar__button" type="button" onClick={goBack}>
              <CaretLeft className="icon icon--small" weight="bold" aria-hidden />
              Назад
            </button>
          </div>
        ) : null}
        <Suspense fallback={<div className="join-checking" role="status"><Spinner size={20} />Открываем экран…</div>}>
          {screen}
        </Suspense>
      </div>
      <div className="live-region" aria-live="polite" aria-atomic="true">
        {notice ? (
          <div className={`notice${notice.leaving ? ' notice--leaving' : ''}`} role="status">
            {notice.message}
          </div>
        ) : null}
      </div>
    </div>
    </MembershipContext.Provider>
  );
}
