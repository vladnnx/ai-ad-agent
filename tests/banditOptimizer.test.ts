import { test } from "node:test";
import assert from "node:assert/strict";
import { BanditOptimizer, DEFAULT_BANDIT } from "../src/core/optimizer/BanditOptimizer";
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
function inp(id: string, p: Partial<Metrics>): OptimizerArmInput {
  return { arm: arm(id), metrics: metrics(p) };
}

test("guardrail: дорогую руку с достаточной статистикой ставим на паузу", () => {
  const opt = new BanditOptimizer();
  const out = opt.decide({
    arms: [
      inp("good", { impressions: 5000, clicks: 200, conversions: 60, spend: 300, cpa: 5, revenue: 3000 }),
      inp("dog", { impressions: 5000, clicks: 200, conversions: 5, spend: 300, cpa: 60, revenue: 100 }),
    ],
    targetCpa: 15,
    totalBudget: 300,
  });
  const dog = out.find((o) => o.armId === "dog")!;
  assert.equal(dog.state, "paused", "дорогая рука должна уйти в паузу");
  assert.equal(out.find((o) => o.armId === "good")!.state, "active");
});

test("guardrail: не убиваем руку без статзначимости (мало показов)", () => {
  const opt = new BanditOptimizer();
  const out = opt.decide({
    arms: [
      inp("a", { impressions: 100, clicks: 5, conversions: 0, spend: 60, cpa: 0 }), // дорого, но данных мало
      inp("b", { impressions: 5000, clicks: 200, conversions: 50, spend: 250, cpa: 5 }),
    ],
    targetCpa: 15,
    totalBudget: 300,
  });
  assert.equal(out.find((o) => o.armId === "a")!.state, "active", "без статзначимости не душим");
});

test("guardrail: всегда оставляем хотя бы одну руку активной", () => {
  const opt = new BanditOptimizer();
  const bad = (id: string) =>
    inp(id, { impressions: 5000, clicks: 200, conversions: 2, spend: 300, cpa: 150, revenue: 30 });
  const out = opt.decide({ arms: [bad("x"), bad("y")], targetCpa: 15, totalBudget: 300 });
  const active = out.filter((o) => o.state === "active").length;
  assert.equal(active, 1, "обе плохие, но одну обязаны оставить активной");
});

test("конфиг killCpaRatio дефолтен и осмыслен", () => {
  assert.ok(DEFAULT_BANDIT.killCpaRatio >= 1, "порог паузы — кратно цели");
});
