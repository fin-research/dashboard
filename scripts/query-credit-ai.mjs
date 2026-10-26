import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { register } from 'tsx/esm/api';
register();
const { creditAiQuerySchema, creditAiReportSchema } = await import('../src/lib/credit/ai.ts');

export async function queryCreditAi(query, { login, origin }) {
  const input = creditAiQuerySchema.parse({ view: 'ai', ...query });
  const session = await login();
  const url = new URL('/api/credit', origin);
  url.search = new URLSearchParams(input).toString();
  const response = await session.request(url, { headers: { Accept: 'application/json' }, followRedirects: false });
  if (response.status !== 200) throw new Error(`脱敏授信 API 返回 HTTP ${response.status}`);
  let payload;
  try { payload = JSON.parse(response.text); } catch { throw new Error('脱敏授信 API 未返回 JSON'); }
  const parsed = creditAiReportSchema.safeParse(payload);
  if (!parsed.success) throw new Error('返回数据未通过脱敏字段校验');
  return parsed.data;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('node --use-env-proxy scripts/query-credit-ai.mjs [--date YYYY-MM-DD] [--institution-id ID]\nGATEWAY_CHECKOUT 指定 Gateway；AUTH_TEST_ENV_FILE 指定项目组凭据文件。');
    return;
  }
  const args = process.argv.slice(2), query = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--date': 'date', '--institution-id': 'institutionId' }[args[i]];
    if (!key || !args[i + 1] || query[key] !== undefined) throw new Error('查询参数无效；使用 --help 查看参数');
    query[key] = args[i + 1];
  }
  // The Gateway owns Universal Login, PKCE and signed token validation.
  const gateway = process.env.GATEWAY_CHECKOUT ?? fileURLToPath(new URL('../../gateway/', import.meta.url));
  const { loginTestAccount, readAuthTestConfig, SITE_ORIGIN } = await import(pathToFileURL(resolve(gateway, 'scripts/lib/programmatic-login.mjs')).href);
  const result = await queryCreditAi(query, { origin: SITE_ORIGIN, login: async () => loginTestAccount(await readAuthTestConfig()) });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.name === 'ZodError' ? '查询参数无效' : `${error.code ? error.code + ': ' : ''}${error.message}`); process.exitCode = 1; });
}
