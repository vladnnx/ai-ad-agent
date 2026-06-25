import { test } from "node:test";
import assert from "node:assert/strict";
import { nextBid, DEFAULT_BID } from "../src/core/optimizer/bidController";
import type { Metrics } from "../src/core/types";

function metrics(p: Partial<Metrics>): Metrics {
  return {
    impressions: 0,
    clicks: 0,
    spend: 0,
    conversions: 0,
    revenue: 0,
    ctr: 0,
    cpc: 0,
    cpm: 0,
    cvr: 0,
    cpa: 0,
    roas: 0,
    ...p,
  };
}

test("CPA ниже цели → ставку поднимаем (есть запас)", () => {
  const m = metrics({ clicks: 100, conversions: 20, cpa: 5 });
  const { bid } = nextBid(1.0, m, 15);
  assert.ok(bid > 1.0, `ждали рост, получили ${bid}`);
});

test("CPA выше цели → ставку снижаем (перегрев)", () => {
  const m = metrics({ clicks: 100, conversions: 5, cpa: 30 });
  const { bid } = nextBid(1.0, m, 15);
  assert.ok(bid < 1.0, `ждали снижение, получили ${bid}`);
});

test("мало данных → ставку держим (cold start)", () => {
  const m = metrics({ clicks: 3, conversions: 0, cpa: 0 });
  const { bid } = nextBid(1.0, m, 15);
  assert.equal(bid, 1.0);
});

test("шаг ограничен maxStep, ставка зажата в [minBid, maxBid]", () => {
  const m = metrics({ clicks: 100, conversions: 50, cpa: 1 }); // огромный запас
  const { bid } = nextBid(1.0, m, 15);
  assert.ok(bid <= 1.0 * (1 + DEFAULT_BID.maxStep) + 1e-9, "шаг вверх ограничен");
  const high = nextBid(DEFAULT_BID.maxBid * 2, m, 15).bid;
  assert.equal(high, DEFAULT_BID.maxBid, "кламп по максимуму");
});
