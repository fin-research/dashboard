import assert from "node:assert/strict";
import test from "node:test";

import {
  fitTreemapLabel,
  formatTreemapLabel,
} from "../src/treemap-labels.ts";

test("较大行业矩形显示行业名和涨跌幅", () => {
  assert.equal(formatTreemapLabel("电子", "−7.02%"), "电子\n−7.02%");
});

test("所有热力图标签都同时包含行业名和涨跌幅", () => {
  assert.equal(
    formatTreemapLabel("美容护理", "+0.18%"),
    "美容护理\n+0.18%",
  );
});

test("标签字号自适应且不低于 10px", () => {
  const layout = fitTreemapLabel("美容护理\n+0.18%", { width: 90, height: 40 }, 16);

  assert.equal(layout.visible, true);
  assert.ok(layout.fontSize >= 10);
  assert.ok(layout.fontSize < 16);
  assert.equal(layout.width, 82);
  assert.equal(layout.height, 32);
});

test("不足以同时容纳两行 10px 标签时整体隐藏", () => {
  assert.deepEqual(
    fitTreemapLabel("美容护理\n+0.18%", { width: 24, height: 18 }, 16),
    {
      visible: false,
      fontSize: 0,
      lineHeight: 0,
      width: 0,
      height: 0,
    },
  );
});
