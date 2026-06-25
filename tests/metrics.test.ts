import { test } from "node:test";
import assert from "node:assert/strict";
import { MetricStore } from "../src/core/metrics";
import type { AdEvent } from "../src/core/types";

function ev(ts: number, type: AdEvent["type"], n: number, extra: Partial<AdEvent> = {}): AdEvent {
  return { ts, armId: "a", type, count: n, ...extra };
}

test("метрики выводятся из потока событий (event-sourcing)", () => {
  const s = new MetricStore();
  s.append([
    ev(10, "impression", 1000),
    ev(10, "click", 50),
    { ts: 10, armId: "a", type: "spend", amount: 25 },
    { ts: 10, armId: "a", type: "lead", count: 5, value: 200 },
  ]);
  const m = s.forArm("a");
  assert.equal(m.impressions, 1000);
  assert.equal(m.clicks, 50);
  assert.equal(m.conversions, 5);
  assert.equal(m.ctr, 0.05); // 50 / 1000
  assert.equal(m.cpc, 0.5); // 25 / 50
  assert.equal(m.cvr, 0.1); // 5 / 50
  assert.equal(m.cpa, 5); // 25 / 5
  assert.equal(m.roas, 8); // 200 / 25
});

test("скользящее окно отрезает старые события (забывание)", () => {
  const s = new MetricStore();
  s.append([ev(10, "click", 100), ev(100, "click", 7)]);
  assert.equal(s.forArm("a", 0).clicks, 107, "без окна — всё");
  assert.equal(s.forArm("a", 50).clicks, 7, "с окном from=50 — только свежее");
});

test("деление на ноль не ломает метрики", () => {
  const m = new MetricStore().forArm("a");
  assert.equal(m.cpa, 0);
  assert.equal(m.roas, 0);
  assert.equal(m.ctr, 0);
});
