import { runMarketBriefingNewsBatch } from '../../worker/market-briefing-news-runner.ts';

// Each child has an independent DATA budget; retries retain that child's counter.
export function newsWorkflow(env) {
  const instances = new Map();
  return {
    instances,
    async create({ id, params }) {
      if (instances.has(id)) throw new Error('duplicate instance');
      const record = { params, calls: 0, attempts: 0 };
      instances.set(id, record);
      const childEnv = { ...env, DATA: { fetch: request => { record.calls++; return env.DATA.fetch(request); } } };
      const step = { do: async (_name, options, fn) => {
        for (let retry = 0; ; retry++) {
          record.attempts++;
          try { return await fn(); }
          catch (error) { if (retry === options.retries.limit) throw error; }
        }
      } };
      try { record.output = await runMarketBriefingNewsBatch(childEnv, step, params); record.status = 'complete'; }
      catch (error) { record.status = 'errored'; record.error = { message: error.message }; }
      return { status: async () => record };
    },
    async get(id) {
      if (!instances.has(id)) throw new Error('missing instance');
      return { status: async () => instances.get(id) };
    },
  };
}
