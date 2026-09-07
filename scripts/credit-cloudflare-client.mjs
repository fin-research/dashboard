import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Local operational scripts only. Production accesses R2 and AI Search through bindings.
export async function cloudflareClient() {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const authPath = process.env.WRANGLER_AUTH_FILE ?? path.join(homedir(), process.platform === "darwin"
    ? "Library/Preferences/.wrangler/config/default.toml" : ".config/.wrangler/config/default.toml");
  const token = process.env.CLOUDFLARE_API_TOKEN ?? (await readFile(authPath, "utf8")).match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw new Error("请先运行 wrangler login，或提供 CLOUDFLARE_API_TOKEN");
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.vars.CLOUDFLARE_ACCOUNT_ID}`;
  return async (resource, init = {}) => {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(base + resource, { ...init, headers: { authorization: `Bearer ${token}`,
          "user-agent": "wrangler/4.125.0", ...init.headers }, signal: AbortSignal.timeout(90000) });
        if (response.ok) return response;
        lastStatus = response.status;
        await response.body?.cancel();
        if (response.status < 500 && response.status !== 429) break;
      } catch (error) { if (attempt === 2) throw error; }
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    throw new Error(`Cloudflare ${resource.split("/").slice(0, 4).join("/")} HTTP ${lastStatus}`);
  };
}
