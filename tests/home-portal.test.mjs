import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("首页提供政策跟踪等七个业务入口并自适应换行", async () => {
  const [page, globalStyles] = await Promise.all([
    readFile(new URL("../src/routes/+page.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    page,
    /<article class="tool-card tool-card--fund-report">[\s\S]*?<h2>资金日报<\/h2>/,
  );
  assert.match(
    page,
    /href=\{todayFundReportUrl\}>[\s\S]*?今日资金日报[\s\S]*?href="\/fund-report">[\s\S]*?历史资金日报/,
  );
  assert.match(
    page,
    /const todayFundReportUrl = `\/fund-report\/\$\{currentReportDate\(\)\}\.html`/,
  );
  assert.match(
    page,
    /<a class="tool-card tool-card--workspace" href="\/financing\/">[\s\S]*?<h2>融资工作台<\/h2>/,
  );
  assert.match(
    page,
    /<a class="tool-card tool-card--trading-research" href="\/trading-research">[\s\S]*?<h2>交易研究工作台<\/h2>/,
  );
  assert.match(
    page,
    /<a class="tool-card tool-card--policies" href="\/policy-tracking">[\s\S]*?<h2>政策跟踪<\/h2>/,
  );
  assert.match(
    page,
    /<a class="tool-card tool-card--management" href="\/management">[\s\S]*?<h2>管理<\/h2>/,
  );
  assert.equal((page.match(/class="tool-card /g) ?? []).length, 7);
  assert.ok(
    page.indexOf('href="/fund-report"') < page.indexOf('href="/market-briefing"'),
  );
  assert.ok(
    page.indexOf('href="/management"') > page.indexOf('href="/financing/"'),
  );
  assert.doesNotMatch(page, /href="\/(bond|financing-model)"/);
  assert.match(
    page,
    /grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 280px\), 380px\)\)/,
  );
  assert.match(page, /\.tool-card\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*380px/);
  assert.match(page, /\.tool-copy h2\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(page, /@media\s*\(max-width:\s*1080px\)/);
  assert.match(globalStyles, /html\s*\{[\s\S]*?min-width:\s*0/);
});
