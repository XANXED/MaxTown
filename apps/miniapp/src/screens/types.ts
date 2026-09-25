import type { AppRoute } from '../routes.ts';

export type Notify = (message: string) => void;

export type Navigate = (route: AppRoute) => void;
