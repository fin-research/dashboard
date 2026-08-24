import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("首页提供融资工作台生产路由入口", async () => {
  const page = await readFile(
    new URL("../src/routes/+page.svelte", import.meta.url),
    "utf8",
  );

  assert.match(
    page,
    /<a class="tool-card tool-card--workspace" href="\/financing\/">[\s\S]*?<h2>融资工作台<\/h2>/,
  );
  assert.equal((page.match(/class="tool-card /g) ?? []).length, 5);
  assert.match(
    page,
    /grid-template-columns:\s*repeat\(auto-fill, minmax\(280px, 1fr\)\)/,
  );
  assert.doesNotMatch(page, /@media\s*\(max-width:\s*1080px\)/);
});
