import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("根布局只挂载一个融资工作台式全局消息区域", async () => {
  const [layout, component, store] = await Promise.all([
    readFile(new URL("../src/routes/+layout.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/GlobalMessages.svelte", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/global-messages.ts", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /import GlobalMessages from "\$lib\/GlobalMessages\.svelte"/);
  assert.equal((layout.match(/<GlobalMessages\s*\/>/g) ?? []).length, 1);
  assert.match(component, /position:\s*fixed/);
  assert.match(component, /pointer-events:\s*none/);
  assert.match(component, /\.global-message[\s\S]*pointer-events:\s*auto/);
  assert.match(component, /aria-label=\{`关闭通知：\$\{item\.message\}`\}/);
  assert.match(store, /const DEFAULT_DURATION = 4500/);
  assert.match(store, /function pause\(id: string, reason:/);
  assert.match(store, /function resume\(id: string, reason:/);
});

test("二级池回退提示发布到全局消息而非上传状态栏", async () => {
  const page = await readFile(
    new URL("../src/routes/bond/+page.svelte", import.meta.url),
    "utf8",
  );

  assert.match(
    page,
    /globalMessages\.warning\([\s\S]*所选范围无线上台账，已回退至/,
  );
  assert.doesNotMatch(
    page,
    /uploadMessage\s*=\s*`所选范围无线上台账，已回退至/,
  );
});
