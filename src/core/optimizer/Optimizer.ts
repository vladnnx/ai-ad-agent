import type { Arm, Metrics } from "@/core/types";

/**
 * Шов №2 — стратегия принятия решений.
 * Бандит + контроллер сегодня → контекстный бандит / RL завтра, без переписывания агента.
 */
export interface OptimizerArmInput {
  arm: Arm;
  metrics: Metrics; // метрики руки за окно
}

export interface OptimizerInput {
  arms: OptimizerArmInput[];
  targetCpa: number; // цель, которую держим
  totalBudget: number; // суммарный дневной бюджет на распределение
}

export interface OptimizerArmOutput {
  armId: string;
  bid: number;
  budget: number;
  state: "active" | "paused";
  sampledRoas: number; // выборка из апостериора — для прозрачности
  reason: string;
}

export interface Optimizer {
  readonly name: string;
  decide(input: OptimizerInput): OptimizerArmOutput[];
}
