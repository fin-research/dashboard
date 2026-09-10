import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendCreditActivity, creditActivityLabel } from "../src/lib/credit-assistant/progress.ts";
import { findCreditCustomers } from "../src/lib/server/credit-repository.ts";
import { creditDatabase, seedCredit } from "./helpers/credit-database.mjs";

test("activity history appends recurring work without declaring milestones complete", () => {
  let state = { activities: [] };
  for (const stage of ["scope", "retrieval", "analysis", "answer", "review", "analysis", "retrieval"]) {
    state.activities = appendCreditActivity(state, stage, stage, 1000);
  }
  assert.deepEqual(state.activities.map(item => item.id), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(creditActivityLabel(state.activities.at(-1), state.activities), "检索材料 · 第 2 轮");
  assert.equal(appendCreditActivity(state, "retrieval", "retrieval", 2000), state.activities, "duplicate snapshots do not add rounds");
  for (let i = 0; i < 100; i++) state.activities = appendCreditActivity(state, `activity ${i}`, "analysis", i);
  assert.equal(state.activities.length, 64);
  assert.equal(state.activities.at(-1).id, 107);
});

test("customer picker filters locally, selects immediately, and ignores stale history responses", async () => {
  await promisify(execFile)(process.execPath, ["--conditions=browser", "tests/helpers/credit-customer-picker.mjs"], {
    cwd: new URL("../", import.meta.url), timeout: 30_000, maxBuffer: 20_000,
  });
});

test("current-state institution SQL returns every cold-start option and preserves exact lookup", async t => {
  const db = await creditDatabase(t);
  for (let i = 0; i < 25; i++) await seedCredit(db, "2026-01-01", `银行${i}`, { confidentiality_status: i === 24 });
  assert.equal((await findCreditCustomers(db, "")).length, 25);
  assert.equal((await findCreditCustomers(db, "银行")).length, 20);
  assert.equal((await findCreditCustomers(db, "银行24", true))[0].confidentialityStatus, true);
  assert.deepEqual(await findCreditCustomers(db, "", true), []);
});
