import { Rng } from "@/core/rng";
import { allocate } from "./thompson";
import { nextBid, DEFAULT_BID, type BidControllerConfig } from "./bidController";
import type {
  Optimizer,
  OptimizerInput,
  OptimizerArmOutput,
} from "./Optimizer";

export interface BanditConfig {
  bid: BidControllerConfig;
  minImprToJudge: number; // не убиваем руку, пока не накоплена статзначимость
  minClicksToJudge: number;
  killCpaRatio: number; // во сколько раз CPA должен превышать цель, чтобы поставить на паузу
}

export const DEFAULT_BANDIT: BanditConfig = {
  bid: DEFAULT_BID,
  minImprToJudge: 1500,
  minClicksToJudge: 40,
  killCpaRatio: 1.5,
};

/**
 * Двухуровневая стратегия маркетолога, формализованная как последовательное
 * распределение бюджета под целевой CPA/ROAS:
 *   1) КУДА лить деньги — Thompson Sampling (allocate)
 *   2) КАКУЮ ставку держать — демпфированный контроллер (nextBid)
 * Плюс guardrails: пауза только после статзначимости, гарантированная разведка, клампы.
 */
export class BanditOptimizer implements Optimizer {
  readonly name = "ThompsonBandit+BidController";
  private rng: Rng;
  constructor(private cfg: BanditConfig = DEFAULT_BANDIT, seed = 123) {
    this.rng = new Rng(seed);
  }

  decide(input: OptimizerInput): OptimizerArmOutput[] {
    const { arms, targetCpa, totalBudget } = input;
    const samples = allocate(arms, totalBudget, targetCpa, this.rng, 0.05);
    const sampleById = new Map(samples.map((s) => [s.armId, s]));

    // сколько активных рук останется — чтобы не выключить все сразу
    const activeCount = arms.filter((a) => a.arm.state === "active").length;
    let killedThisTick = 0;

    return arms.map(({ arm, metrics }): OptimizerArmOutput => {
      const sample = sampleById.get(arm.id);
      const sampledRoas = sample?.expectedRoas ?? 0;

      // --- Guardrail: стоит ли поставить на паузу? ---
      const enoughData =
        metrics.impressions >= this.cfg.minImprToJudge &&
        metrics.clicks >= this.cfg.minClicksToJudge;
      const tooExpensive =
        metrics.conversions === 0
          ? metrics.spend > targetCpa * this.cfg.killCpaRatio // потратили на 2 CPA и 0 заявок
          : metrics.cpa > targetCpa * this.cfg.killCpaRatio;

      if (
        arm.state === "active" &&
        enoughData &&
        tooExpensive &&
        activeCount - killedThisTick > 1 // всегда оставляем хотя бы одну активной
      ) {
        killedThisTick++;
        return {
          armId: arm.id,
          bid: arm.bid,
          budget: 0,
          state: "paused",
          sampledRoas,
          reason: `пауза: ${
            metrics.conversions === 0 ? "0 заявок" : `CPA ${fmt(metrics.cpa)}`
          } при достаточной статистике (${metrics.impressions} показов) — ≥${this.cfg.killCpaRatio}× цели`,
        };
      }

      if (arm.state === "paused") {
        return {
          armId: arm.id,
          bid: arm.bid,
          budget: 0,
          state: "paused",
          sampledRoas,
          reason: "на паузе",
        };
      }

      // --- Активная рука: ставка (контроллер) + бюджет (бандит) ---
      const { bid, note } = nextBid(arm.bid, metrics, targetCpa, this.cfg.bid);
      const budget = Math.round((sample?.share ?? 0) * totalBudget * 100) / 100;

      return {
        armId: arm.id,
        bid: Math.round(bid * 100) / 100,
        budget,
        state: "active",
        sampledRoas,
        reason: `${note}; доля бюджета ${Math.floor((sample?.share ?? 0) * 100)}%`,
      };
    });
  }
}

function fmt(x: number): string {
  return `$${x.toFixed(2)}`;
}
