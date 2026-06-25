import { test } from "node:test";
import assert from "node:assert/strict";
import { secondPrice } from "../src/platforms/MockPlatform";

const MKT = 1.3;

test("вторая цена монотонно растет со ставкой", () => {
  let prev = 0;
  for (let bid = 0.1; bid <= 8; bid += 0.1) {
    const p = secondPrice(bid, MKT);
    assert.ok(p >= prev - 1e-9, `немонотонно при bid=${bid}`);
    prev = p;
  }
});

test("CPC всегда ниже ставки (платим вторую цену, не первую)", () => {
  for (const bid of [0.2, 0.5, 1, 2, 5]) {
    assert.ok(secondPrice(bid, MKT) < bid, `CPC ≥ ставки при bid=${bid}`);
  }
});

test("CPC насыщается у рыночной цены при высокой ставке", () => {
  assert.ok(secondPrice(50, MKT) < MKT, "не превышает рынок");
  assert.ok(secondPrice(50, MKT) > MKT * 0.9, "но близко к нему — тут и появляется тупик по CPA");
});

test("на низкой ставке вторая цена ≈ половина ставки", () => {
  const bid = 0.05;
  assert.ok(Math.abs(secondPrice(bid, MKT) - bid / 2) < bid * 0.1, "предел bid/2 при bid→0");
});
