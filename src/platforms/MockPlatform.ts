import type { AdEvent, Arm, CampaignSpec } from "@/core/types";
import { Rng } from "@/core/rng";
import type { AdPlatform } from "./AdPlatform";

/** Скрытая «правда» о руке — агент ее НЕ видит и должен нащупать по метрикам. */
interface ArmTruth {
  ctr: number; // истинный CTR
  cvr: number; // истинная конверсия клика в заявку
  value: number; // средняя выручка с заявки
  baseTraffic: number; // сколько аукционов в тик приходит на руку
}

/**
 * Честный симулятор рекламного аукциона с конкурентами.
 * Площадка дала добро на мок; реальные API за модерацией/доступами — для прототипа мок
 * не слабость, а правильный выбор: позволяет смотреть на работу агента вживую и воспроизводимо.
 *
 * Аукцион (модель второй цены с конкурентом):
 *  - на каждый показ есть цена-конкурента C ~ Exp(mean = market), market шумит по дейпарту;
 *  - показ выигрываем, если ставка ≥ C  →  win-rate = P(bid ≥ C) = 1 − e^(−bid/market);
 *  - платим вторую цену: CPC = E[C | C ≤ bid] (≈ bid/2 на низкой ставке, → market на высокой).
 * Отсюда ключевое для контроллера: CPC (и значит CPA) РАСТЕТ со ставкой и насыщается у market.
 * Поэтому у слабых креативов есть внутренний оптимум ставки (CPA упирается в цель), а у
 * сильных — нет (CPA ниже цели даже на потолке, их и надо жать вверх). Контроллер это видит.
 *
 * Дальше по воронке:
 *  - доступный трафик зависит от суточного паттерна и шума;
 *  - клики ~ Binomial(impressions, истинный CTR);
 *  - заявки ~ Binomial(clicks, истинный CVR), каждая приносит value с шумом;
 *  - пейсинг: если расход за час превышает дневной бюджет/24, объем срезается пропорционально.
 */
export class MockPlatform implements AdPlatform {
  readonly name = "MockAds";
  private rng: Rng;
  private arms = new Map<string, Arm>();
  private truth = new Map<string, ArmTruth>();
  private events: AdEvent[] = [];
  private time: number; // симуляционные часы
  private tickMs = 60 * 60 * 1000; // 1 тик = 1 час симуляции
  private seq = 0;
  private market: number; // средняя цена-конкурента в аукционе ($/клик), масштаб конкуренции

  constructor(seed = 7, startTime = Date.UTC(2026, 0, 1, 0, 0, 0), market = 1.3) {
    this.rng = new Rng(seed);
    this.time = startTime;
    this.market = market;
  }

  createCampaign(spec: CampaignSpec): Arm[] {
    const created: Arm[] = [];
    for (const c of spec.creatives) {
      const id = `arm_${++this.seq}`;
      const arm: Arm = {
        id,
        campaignId: spec.name,
        name: c.name,
        state: "active",
        bid: 0.5, // стартовая ставка $/клик
        budget: 50, // стартовый дневной бюджет $
      };
      this.arms.set(id, arm);
      // скрытая правда: креативы заметно разные по качеству — есть что находить.
      // Можно задать явно (для воспроизводимого демо) либо сгенерировать случайно.
      const o = c.truth ?? {};
      this.truth.set(id, {
        ctr: o.ctr ?? 0.01 + this.rng.next() * 0.06, // 1%..7%
        cvr: o.cvr ?? 0.03 + this.rng.next() * 0.17, // 3%..20%
        value: o.value ?? 20 + this.rng.next() * 60, // $20..$80 за заявку
        baseTraffic: o.baseTraffic ?? 400 + Math.floor(this.rng.next() * 600),
      });
      created.push({ ...arm });
    }
    return created;
  }

  getArms(): Arm[] {
    return [...this.arms.values()].map((a) => ({ ...a }));
  }
  getTruth(armId: string): ArmTruth | undefined {
    return this.truth.get(armId);
  }

  setBid(armId: string, bid: number): void {
    const a = this.arms.get(armId);
    if (a) a.bid = Math.max(0.05, bid);
  }
  setBudget(armId: string, budget: number): void {
    const a = this.arms.get(armId);
    if (a) a.budget = Math.max(0, budget);
  }
  setArmState(armId: string, state: "active" | "paused"): void {
    const a = this.arms.get(armId);
    if (a) a.state = state;
  }

  now(): number {
    return this.time;
  }

  /** суточный коэффициент трафика: днем больше, ночью меньше */
  private daily(hourUtc: number): number {
    return 0.6 + 0.4 * Math.sin(((hourUtc - 6) / 24) * 2 * Math.PI);
  }

  pullEvents(since: number): AdEvent[] {
    // двигаем часы ровно на один тик и генерим события за этот тик
    this.time += this.tickMs;
    const hour = new Date(this.time).getUTCHours();
    const dayFactor = this.daily(hour);

    for (const arm of this.arms.values()) {
      if (arm.state !== "active") continue;
      const t = this.truth.get(arm.id)!;

      // цена-конкурента (масштаб) шумит по дейпарту: днем конкуренция выше
      const mkt = Math.max(0.05, this.market * dayFactor * (0.85 + 0.3 * this.rng.next()));
      // win-rate = P(bid ≥ C), C ~ Exp(mean=mkt)
      const winRate = 1 - Math.exp(-arm.bid / mkt);
      // вторая цена: E[C | C ≤ bid] — растет со ставкой, насыщается у mkt
      const cpc = secondPrice(arm.bid, mkt) * (0.92 + 0.16 * this.rng.next());

      const avail = t.baseTraffic * dayFactor;
      let impressions = this.rng.binomial(Math.round(avail), winRate);
      let clicks = this.rng.binomial(impressions, t.ctr);
      let spend = clicks * cpc;

      // пейсинг: расход за час не выше дневного бюджета/24 — срезаем объем пропорционально
      const hourlyCap = arm.budget / 24;
      if (spend > hourlyCap && hourlyCap > 0) {
        const k = hourlyCap / spend;
        impressions = Math.floor(impressions * k);
        clicks = Math.floor(clicks * k);
        spend = hourlyCap;
      }

      const conversions = this.rng.binomial(clicks, t.cvr);
      const revenue = conversions * t.value * (0.8 + 0.4 * this.rng.next());

      const ts = this.time;
      if (impressions > 0)
        this.events.push({ ts, armId: arm.id, type: "impression", count: impressions });
      if (clicks > 0) this.events.push({ ts, armId: arm.id, type: "click", count: clicks });
      if (spend > 0) this.events.push({ ts, armId: arm.id, type: "spend", amount: spend });
      if (conversions > 0)
        this.events.push({ ts, armId: arm.id, type: "lead", count: conversions, value: revenue });
    }

    return this.events.filter((e) => e.ts > since);
  }
}

/**
 * Ожидаемая вторая цена при выигрыше: E[C | C ≤ bid] для C ~ Exp(mean = mkt).
 * = mkt − bid·e^(−bid/mkt) / (1 − e^(−bid/mkt)). На низкой ставке ≈ bid/2, на высокой → mkt.
 */
export function secondPrice(bid: number, mkt: number): number {
  const x = bid / mkt;
  const winRate = 1 - Math.exp(-x);
  if (winRate < 1e-6) return bid / 2; // предел при bid → 0
  const e = (bid * Math.exp(-x)) / winRate;
  return Math.max(0.01, mkt - e);
}
