import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
if (config.name !== 'eastmoney-dashboard') throw new Error('Unexpected target Worker');
const mode = process.argv.includes('--stop-old-cron') ? 'stop-old-cron' : process.argv.includes('--switch-route') ? 'switch-route' : 'plan';
const auth = spawnSync('pnpm', ['exec', 'wrangler', 'auth', 'token', '--json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (auth.status !== 0) throw new Error('Wrangler authentication unavailable');
const { token } = JSON.parse(auth.stdout);
if (!token) throw new Error('Wrangler token unavailable');
const account = config.vars.CLOUDFLARE_ACCOUNT_ID;
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`Cloudflare ${method} ${path} failed (${response.status})`);
  return data.result;
}
const zones = await api('zones?name=hasbai.xyz');
if (zones.length !== 1) throw new Error('Unexpected Cloudflare zone');
const zone = zones[0].id;
const [routes, schedule, workflow] = await Promise.all([
  api(`zones/${zone}/workers/routes`),
  api(`accounts/${account}/workers/scripts/eastmoney-financing/schedules`),
  api(`accounts/${account}/workflows/financing-debt-import`),
]);
const oldRoute = routes.find(route => route.pattern === 'eastmoney.hasbai.xyz/financing/*');
const primary = routes.find(route => route.pattern === 'eastmoney.hasbai.xyz/*');
if (primary?.script !== 'eastmoney-dashboard' || (oldRoute && oldRoute.script !== 'eastmoney-financing')) throw new Error('Unexpected route owner; no route changed');
const activeStates = ['queued', 'running', 'paused', 'waiting', 'waitingForPause', 'rollingBack'];
if (activeStates.some(state => workflow.instances?.[state] > 0)) throw new Error('An import Workflow is still active; no cutover changes made');
console.log(JSON.stringify({ mode, oldCron: schedule.schedules.map(item => item.cron), oldRoutePresent: Boolean(oldRoute), workflowOwner: workflow.script_name }));
if (mode === 'stop-old-cron') {
  if (schedule.schedules.some(item => item.cron !== '0 * * * *')) throw new Error('Unexpected legacy schedule');
  await api(`accounts/${account}/workers/scripts/eastmoney-financing/schedules`, 'PUT', []);
  const confirmed = await api(`accounts/${account}/workers/scripts/eastmoney-financing/schedules`);
  if (confirmed.schedules.length) throw new Error('Old schedule still active');
  console.log(JSON.stringify({ oldCronStopped: true }));
}
if (mode === 'switch-route') {
  if (schedule.schedules.length || workflow.script_name !== 'eastmoney-dashboard') throw new Error('Dashboard Workflow or Cron transfer is incomplete');
  const settings = await api(`accounts/${account}/workers/scripts/eastmoney-dashboard/settings`);
  for (const name of ['DEBT_IMPORT_WORKFLOW', 'AUTH0_MANAGEMENT_CLIENT_SECRET', 'LIABILITY_REPORT_SNAPSHOTS']) {
    if (!settings.bindings.some(binding => binding.name === name)) throw new Error(`Dashboard binding ${name} missing`);
  }
  const schedules = await api(`accounts/${account}/workers/scripts/eastmoney-dashboard/schedules`);
  if (!['0 * * * *', '0 16 * * *'].every(cron => schedules.schedules.some(item => item.cron === cron))) throw new Error('Dashboard schedules incomplete');
  if (oldRoute) await api(`zones/${zone}/workers/routes/${oldRoute.id}`, 'DELETE');
  const confirmed = await api(`zones/${zone}/workers/routes`);
  if (confirmed.some(route => route.pattern === 'eastmoney.hasbai.xyz/financing/*')) throw new Error('Legacy route still exists');
  console.log(JSON.stringify({ financingServedByDashboard: true, workflowOwner: workflow.script_name, oldCronStopped: true }));
}
