import type { PermissionCode } from '../permissions.ts';
import { AccessError } from './access.ts';

type Policy = { permission?: PermissionCode; public?: boolean; login?: boolean };
type Methods = Partial<Record<string, PermissionCode | 'public' | 'login'>>;
/** Exact SvelteKit route IDs. Adding an endpoint requires registering it here. */
export const ROUTE_PERMISSIONS: Record<string, Methods> = {
  '/': { GET: 'public' },
  '/auth/login': { GET: 'login' }, '/auth/logout': { GET: 'public', POST: 'public' },
  '/auth/session': { GET: 'public' }, '/auth/verify-email': { GET: 'public' },
  '/market-briefing': { GET: 'public' },
  '/market-briefing/text': { GET: 'public' },
  // Compatibility for already-open reports; current clients read public /data resources directly.
  '/api/market-resources/[resource]': { GET: 'public' },
  '/api/market-report': { GET: 'public', PUT: 'research.market_report:update' },
  '/api/market-briefing': { POST: 'research.market_report:generate' },
  '/market-hotspots': { GET: 'research.hotspot:read' },
  '/api/rag/hotspots': { GET: 'research.hotspot:read', POST: 'research.hotspot:generate' },
  '/policy-tracking': { GET: 'research.policy:read' },
  '/api/policies': { GET: 'research.policy:read' },
  '/api/policies/articles': { GET: 'research.policy:read' },
  '/api/policies/[id]/articles': { PUT: 'research.policy:update' },
  '/api/policies/[id]/commentary': { POST: 'research.policy:generate', PUT: 'research.policy_commentary:update' },
  '/articles/[id]': { GET: 'research.article:read' }, '/api/articles/[id]': { GET: 'research.article:read' },
  '/news/[id]': { GET: 'research.article:read' }, '/api/news/[id]': { GET: 'research.article:read' },
  '/commentaries/[id]': { GET: 'research.article:read' }, '/api/commentaries/[id]': { GET: 'research.article:read' },
  '/trading-research': { GET: 'research.workspace:read' },
  '/trading-research/[view]': { GET: 'research.workspace:read' },
  '/api/economic-indicators': { GET: 'research.economic_indicator:read' },
  '/credit-workbench/[[view]]': { GET: 'credit.institution:read' },
  '/credit-assistant': { GET: 'credit.assistant:read' },
  '/api/credit': { GET: 'credit.institution:read', PATCH: 'credit.institution:update', POST: 'credit.institution:update' },
  '/bond': { GET: 'bond.ledger:read' }, '/bond-ledger': { GET: 'bond.ledger:read' },
  '/secondary-bond-pool': { GET: 'bond.ledger:read' },
  '/api/bond-ledger': { GET: 'bond.ledger:read', POST: 'bond.ledger:import', DELETE: 'bond.ledger:delete' },
  '/fund-report': { GET: 'fund.report:read' }, '/fund-report/[date].html': { GET: 'fund.report:read' },
  '/api/fund-report': { POST: 'fund.report:upload' },
  '/financing-model': { GET: 'model.financing:read' }, '/api/financing-model': { GET: 'model.financing:read' },
  '/api/financing-model/conclusion': { PATCH: 'model.conclusion:update' },
  '/api/financing-model/decisions': { GET: 'model.financing:read', POST: 'model.decision:create' },
  '/api/financing-model/sell-side': { POST: 'model.sell_side:generate', PATCH: 'model.sell_side:update' },
  '/profile': { GET: 'account.profile:read' },
  '/api/profile': { GET: 'account.profile:read', POST: 'account.profile:update' },
  '/management': { GET: 'auth.permission:read' },
  '/management/people': { GET: 'auth.permission:read', 'POST:saveRolePermissions': 'auth.permission:update' },
  '/management/financing-profile': { GET: 'account.profile:read' },
  '/financing': { GET: 'financing.overview:read' },
  '/financing/login': { GET: 'login' }, '/financing/logout': { GET: 'login', 'POST:default': 'login' },
  '/financing/people': { GET: 'auth.permission:read' }, '/financing/settings': { GET: 'account.profile:read' },
  '/financing/avatar': { GET: 'account.profile:read' },
  '/financing/projects': { GET: 'financing.project:read', 'POST:createProject': 'financing.project:create', 'POST:updateProject': 'financing.project:update', 'POST:deleteProject': 'financing.project:delete' },
  '/financing/projects/[id]': { GET: 'financing.project:read', 'POST:updateProject': 'financing.project:update', 'POST:updateTask': 'financing.task:update', 'POST:addTask': 'financing.task:create', 'POST:updateOwnTaskStatus': 'financing.task:update_own' },
  '/financing/projects/options': { GET: 'financing.project:read' },
  '/financing/sop': { GET: 'financing.sop:read', 'POST:createSop': 'financing.sop:create', 'POST:createReminder': 'financing.reminder:create' },
  '/financing/sop/[id]': { GET: 'financing.sop:read', 'POST:updateTemplate': 'financing.sop:update', 'POST:toggleTemplate': 'financing.sop:update', 'POST:addNode': 'financing.sop:update', 'POST:updateNode': 'financing.sop:update', 'POST:reorderNodes': 'financing.sop:update', 'POST:deleteNode': 'financing.sop:delete' },
  '/financing/sop/reminders': { GET: 'financing.reminder:read' }, '/financing/sop/reminders/more': { GET: 'financing.reminder:read' },
  '/financing/debts/[id]': { GET: 'financing.data:read' }, '/financing/data': { GET: 'financing.data:read' },
  '/financing/data/api/[...path]': { GET: 'financing.data:read', POST: 'financing.data:create', PATCH: 'financing.data:update', DELETE: 'financing.data:delete' },
  '/financing/data/token': { GET: 'financing.data:read' },
  '/financing/data/import': { POST: 'financing.data:import' }, '/financing/data/import/[id]': { GET: 'financing.data:import' },
  '/financing/liability-report': { GET: 'financing.report:read', 'POST:saveSnapshot': 'financing.report:generate' },
  '/api/credit-assistant/institutions': { GET: 'credit.assistant:read' },
  '/api/credit-assistant/materials': { GET: 'credit.assistant:read' },
  '/api/credit-assistant/files/[id]': { GET: 'credit.assistant:read' },
  '/api/credit-assistant/session': { GET: 'credit.assistant:read', POST: 'credit.assistant:ask', DELETE: 'credit.assistant:delete' },
  '/api/credit-assistant/session/new': { POST: 'credit.assistant:ask' },
  '/api/credit-assistant/session/institution': { POST: 'credit.assistant:ask' },
};

export function actionNameFromUrl(url: URL): string {
  const names = [...url.searchParams.keys()].filter((name) => name.startsWith('/'));
  if (names.length > 1 || (names[0] && !/^\/[A-Za-z][A-Za-z0-9]*$/.test(names[0]))) throw new AccessError(403, '操作名称无效');
  return names[0]?.slice(1) ?? 'default';
}

export function requestPolicy(request: Request, routeId: string | null): Policy {
  const url = new URL(request.url);
  let path: string;
  try { path = decodeURIComponent(url.pathname).replace(/\/__data\.json$/, '').replace(/\/$/, '') || '/'; }
  catch { throw new AccessError(403, '请求路径无效'); }
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  // Static files are not a substitute for an unregistered application endpoint.
  if (!routeId && method === 'GET' && (/^\/_app\//.test(path) || /^\/(favicon\.(ico|svg)|robots\.txt)$/.test(path) || /^\/institution-logos\/[a-z0-9-]+\.(ico|png|jpg)$/.test(path))) return { public: true };
  let value: Methods[string];
  if (routeId === '/data/[...path]') {
    if (!['GET', 'POST'].includes(method)) throw new AccessError(403, '数据操作未登记');
    value = /^\/data\/choice(?:\/|$)/.test(path) ? 'login'
      : /^\/data\/camel(?:\/|$)/.test(path) ? 'login'
      : path === '/data/graphql' ? 'data.graphql:read' : method === 'GET' ? 'data.resource:read' : undefined;
  } else {
    const methods = ROUTE_PERMISSIONS[routeId ?? ''];
    const named = method === 'POST' ? actionNameFromUrl(url) : 'default';
    value = methods?.[`${method}:${named}`] ?? (named === 'default' ? methods?.[method] : undefined);
    if (method === 'GET' && routeId === '/credit-workbench/[[view]]' && path.endsWith('/assistant')) value = 'credit.assistant:read';
    if (method === 'GET' && routeId === '/trading-research/[view]') {
      const view = path.split('/').pop();
      const views: Record<string, PermissionCode> = { 'market-hotspots': 'research.hotspot:read', 'policy-tracking': 'research.policy:read', 'secondary-bond-pool': 'bond.ledger:read', 'bond': 'bond.ledger:read', 'financing-model': 'model.financing:read', 'credit': 'credit.institution:read', 'credit-assistant': 'credit.assistant:read' };
      value = views[view ?? ''] ?? value;
    }
    if (routeId === '/financing/data/api/[...path]' && path.endsWith('/rpc/liability_weekly_report_data') && method === 'POST') value = 'financing.report:read';
  }
  if (!value) throw new AccessError(403, '该入口或操作尚未登记权限');
  if (value === 'public') return { public: true };
  if (value === 'login') return { login: true };
  return { permission: value };
}
