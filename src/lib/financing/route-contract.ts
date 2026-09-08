/** Map canonical SvelteKit routes onto the unchanged financing permission catalogue. */
export function financingRouteId(routeId: string | null): string | null {
  if (routeId === '/management/people') return '/people';
  if (routeId === '/management/financing-profile') return '/settings';
  if (routeId === '/financing') return '/';
  if (routeId?.startsWith('/financing/')) return routeId.slice('/financing'.length);
  return null;
}
