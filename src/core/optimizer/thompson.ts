import { Rng } from "@/core/rng";
import type { OptimizerArmInput } from "./Optimizer";

/**
 * Аллокатор бюджета через Thompson Sampling (многорукий бандит).
 *
 * На каждую руку держим Beta-апостериор по конверсии (CVR):
 *   alpha = 1 + conversions, beta = 1 + (clicks - conversions).
 * На каждом тике сэмплим CVR из распределений, оцениваем ожидаемый ROAS и распределяем
 * бюджет в пользу лучших. Бандит сам исследует новые руки (широкий апостериор → иногда
 * выпадает высокая выборка) и эксплуатирует победителей — это и есть «самообучение по
 * метрикам», без ручной разметки.
 */
export interface ArmSample {
  armId: string;
  sampledCvr: number;
  expectedRoas: number;
  share: number; // доля бюджета [0..1]
}

export function allocate(
  arms: OptimizerArmInput[],
  totalBudget: number,
  targetCpa: number,
  rng: Rng,
  minShare = 0.05, // гарантированный минимум на исследование (cold start)
): ArmSample[] {
  const active = arms.filter((a) => a.arm.state === "active");
  if (active.length === 0) return [];

  const samples: ArmSample[] = active.map(({ arm, metrics }) => {
    const alpha = 1 + metrics.conversions;
    const beta = 1 + Math.max(0, metrics.clicks - metrics.conversions);
    const sampledCvr = rng.beta(alpha, beta);

    // ценность заявки: факт, если есть конверсии, иначе оптимистичный приор (поощряем разведку)
    const valuePerConv =
      metrics.conversions > 0 ? metrics.revenue / metrics.conversions : targetCpa * 2;
    // оценка стоимости клика: факт, иначе текущая ставка как прокси
    const cpc = metrics.clicks > 0 ? metrics.cpc : arm.bid;
    // ожидаемый доход с клика / стоимость клика = ожидаемый ROAS
    const expectedRoas = cpc > 0 ? (sampledCvr * valuePerConv) / cpc : 0;

    return { armId: arm.id, sampledCvr, expectedRoas, share: 0 };
  });

  // доля бюджета ∝ ожидаемому ROAS, но с гарантированным минимумом на разведку
  const totalRoas = samples.reduce((s, x) => s + Math.max(0, x.expectedRoas), 0);
  const n = samples.length;
  for (const s of samples) {
    const proportional = totalRoas > 0 ? Math.max(0, s.expectedRoas) / totalRoas : 1 / n;
    // смесь: (1 - n*minShare) на эксплуатацию + minShare на исследование каждой руке
    s.share = minShare + (1 - n * minShare) * proportional;
  }
  return samples;
}
