import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("全屏热点页不再通过全局 html/body 污染后续页面背景和滚动", async () => {
  const [hotspots, home, financing] = await Promise.all([
    readFile(new URL("../src/routes/market-hotspots/+page.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/+page.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/pages/FinancingModelPage.svelte", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(hotspots, /:global\((?:html|body)\)/);
  assert.match(hotspots, /\.hotspot-page\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0/);
  assert.doesNotMatch(home, /:global\((?:html|body)\)/);
  assert.doesNotMatch(financing, /:global\((?:html|body)\)/);
});

test("二级池日期重载不写入全局滚动锁且原入口复用同一页面组件", async () => {
  const [page, route, styles] = await Promise.all([
    readFile(new URL("../src/lib/pages/BondLedgerPage.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/bond/+page.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /void refreshReport\(true\)/);
  assert.doesNotMatch(page, /document\.(?:body|documentElement).*overflow|style\.overflow/);
  assert.match(route, /<BondLedgerPage \/>/);
  assert.match(styles, /html\s*\{[\s\S]*?min-width:\s*0/);
});
