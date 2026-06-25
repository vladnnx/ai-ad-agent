import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate } from "../src/core/optimizer/thompson";
import { Rng } from "../src/core/rng";
import type { Arm, Metrics } from "../src/core/types";
import type { OptimizerArmInput } from "../src/core/optimizer/Optimizer";

function arm(id: string): Arm {
  return { id, campaignId: "c", name: id, state: "active", bid: 1, budget: 50 };
}
function metrics(p: Partial<Metrics>): Metrics {
  return {
    impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0,
    ctr: 0, cpc: 0, cpm: 0, cvr: 0, cpa: 0, roas: 0, ...p,
  };
}
function input(id: string, p: Partial<Metrics>): OptimizerArmInput {
  return { arm: arm(id), metrics: metrics(p) };
}

test("доли суммируются в ~1 и каждая ≥ minShare (гарантия разведки)", () => {
  const rng = new Rng(1);
  const arms = [
    input("good", { clicks: 200, conversions: 60, cpc: 1, revenue: 3000 }),
    input("bad", { clicks: 200, conversions: 4, cpc: 1, revenue: 80 }),
  ];
  const s = allocate(arms, 300, 15, rng, 0.05);
  const sum = s.reduce((a, x) => a + x.share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `сумма долей = ${sum}`);
  for (const x of s) assert.ok(x.share >= 0.05 - 1e-9, `${x.armId} ниже minShare`);
});

test("в среднем больше бюджета уходит на руку с лучшим ROAS", () => {
  // усредняем по многим сэмплам — Thompson стохастичен, но мат.ожидание в пользу лучшей
  const rng = new Rng(42);
  let good = 0, bad = 0;
  for (let i = 0; i < 200; i++) {
    const s = allocate(
      [
        input("good", { clicks: 300, conversions: 90, cpc: 1, revenue: 5000 }),
        input("bad", { clicks: 300, conversions: 6, cpc: 1, revenue: 120 }),
      ],
      300, 15, rng, 0.05,
    );
    good += s.find((x) => x.armId === "good")!.share;
    bad += s.find((x) => x.armId === "bad")!.share;
  }
  assert.ok(good > bad, `good=${(good / 200).toFixed(2)} должно быть > bad=${(bad / 200).toFixed(2)}`);
});

test("паузные руки не участвуют в распределении", () => {
  const a = input("paused", { clicks: 100, conversions: 30 });
  a.arm.state = "paused";
  const s = allocate([a, input("active", { clicks: 100, conversions: 30 })], 300, 15, new Rng(3), 0.05);
  assert.equal(s.length, 1);
  assert.equal(s[0].armId, "active");
});
