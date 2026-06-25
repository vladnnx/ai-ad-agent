import type { Metrics } from "@/core/types";

/** Параметры контроллера ставки. */
export interface BidControllerConfig {
  damping: number; // насколько резко реагируем (0..1)
  maxStep: number; // максимальное изменение ставки за тик (доля)
  minBid: number;
  maxBid: number;
  minClicksToAct: number; // не двигаем ставку, пока мало данных
}

export const DEFAULT_BID: BidControllerConfig = {
  damping: 0.4,
  maxStep: 0.25,
  minBid: 0.05,
  maxBid: 5,
  minClicksToAct: 15,
};

/**
 * Демпфированный контроллер ставки к целевому CPA.
 *  CPA ниже цели  → есть запас, поднимаем ставку (берем больше объема).
 *  CPA выше цели  → перегрев, снижаем ставку.
 * С ограничением скорости изменения и клампом min/max — это и есть «толковость», а не азарт.
 */
export function nextBid(
  currentBid: number,
  m: Metrics,
  targetCpa: number,
  cfg: BidControllerConfig = DEFAULT_BID,
): { bid: number; note: string } {
  // мало данных — держим ставку, продолжаем собирать статистику (cold start)
  if (m.clicks < cfg.minClicksToAct || m.conversions === 0) {
    return { bid: clamp(currentBid, cfg), note: "сбор статистики, ставку держим" };
  }
  // ошибка регулирования: >1 если есть запас (CPA дешевле цели), <1 если перегрев
  const ratio = targetCpa / m.cpa;
  // демпфирование + ограничение шага
  const raw = 1 + cfg.damping * (ratio - 1);
  const factor = Math.min(1 + cfg.maxStep, Math.max(1 - cfg.maxStep, raw));
  const bid = clamp(currentBid * factor, cfg);
  const dir = bid > currentBid ? "поднял" : bid < currentBid ? "снизил" : "оставил";
  const note = `CPA ${fmt(m.cpa)} vs цель ${fmt(targetCpa)} → ${dir} ставку до ${fmt(bid)}`;
  return { bid, note };
}

function clamp(bid: number, cfg: BidControllerConfig): number {
  return Math.min(cfg.maxBid, Math.max(cfg.minBid, bid));
}
function fmt(x: number): string {
  return `$${x.toFixed(2)}`;
}
