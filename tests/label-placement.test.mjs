import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseBestLabelPlacement,
  overlapArea,
} from "../src/label-placement.ts";

const bounds = { x: 8, y: 8, width: 984, height: 584 };

test("靠近横轴的数据标签自动从下方切换到上方", () => {
  const axis = { x: 0, y: 540, width: 1000, height: 60 };
  const placement = chooseBestLabelPlacement({
    point: { x: 100, y: 520 },
    label: { width: 120, height: 58 },
    bounds,
    obstacles: [axis],
    preferred: "bottom",
  });

  assert.equal(placement.side, "top");
  assert.equal(overlapArea(placement, axis), 0);
});

test("右下角标签自动避开横轴上方图例并保持在画布内", () => {
  const legend = { x: 760, y: 500, width: 240, height: 40 };
  const placement = chooseBestLabelPlacement({
    point: { x: 940, y: 485 },
    label: { width: 130, height: 58 },
    bounds,
    obstacles: [legend],
    preferred: "bottom",
  });

  assert.equal(overlapArea(placement, legend), 0);
  assert.ok(placement.x >= bounds.x);
  assert.ok(placement.x + placement.width <= bounds.x + bounds.width);
  assert.ok(placement.y >= bounds.y);
});
