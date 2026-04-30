import type { NavigationRoute } from '../types/navigation';

export const SIGN_IN_ROUTE = '/signin';
export const ACCOUNT_ROUTE = '/account';

export const appRoutes: NavigationRoute[] = [
  {
    path: '/',
    label: 'Home',
  },
  {
    path: '/scripts',
    label: 'Scripts',
  },
  {
    path: '/editor',
    label: 'Editor',
  },
  {
    path: '/performance',
    label: 'Performance',
  },
];
