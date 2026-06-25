// Доменные типы. Единые для симулятора, агента, API и UI — это и есть плюс монорепо-стиля:
// одна правда о форме данных по всему пайплайну.

/** Тип сырого события воронки. Все остальное (метрики) выводится из этих событий. */
export type AdEventType = "impression" | "click" | "spend" | "lead";

/**
 * Сырое событие. Неизменяемо и аудируемо (event-sourcing):
 * любую метрику можно пересчитать из потока событий и объяснить «откуда цифра».
 * Для прототипа события агрегированы по тику (count/amount), но остаются полным журналом.
 */
export interface AdEvent {
  ts: number; // unix ms (симуляционное время)
  armId: string; // кампания × креатив (см. Arm)
  type: AdEventType;
  count?: number; // для impression | click | lead
  amount?: number; // для spend (деньги) — потрачено
  value?: number; // для lead — выручка (revenue) по заявке
}

/** «Рука» бандита: конкретный креатив внутри кампании. Минимальная единица оптимизации. */
export interface Arm {
  id: string;
  campaignId: string;
  name: string;
  state: "active" | "paused";
  bid: number; // текущая ставка (CPC-таргет), которой управляет контроллер
  budget: number; // дневной бюджет, который распределяет аллокатор-бандит
}

/** Необязательное задание «скрытой правды» креатива — чтобы засеять воспроизводимое демо. */
export interface CreativeTruth {
  ctr?: number;
  cvr?: number;
  value?: number;
  baseTraffic?: number;
}

/** Спецификация кампании при заведении. */
export interface CampaignSpec {
  name: string;
  creatives: { name: string; truth?: CreativeTruth }[];
}

/** Метрики по одной «руке» или агрегат, посчитанные из событий в окне. */
export interface Metrics {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
  ctr: number; // clicks / impressions
  cpc: number; // spend / clicks
  cpm: number; // spend / impressions * 1000
  cvr: number; // conversions / clicks
  cpa: number; // spend / conversions  ← главная цель
  roas: number; // revenue / spend      ← вторая цель
}

/** Решение агента по одной руке за тик — то, что уходит обратно в площадку. */
export interface ArmDecision {
  armId: string;
  name: string;
  bid: number;
  budget: number;
  state: "active" | "paused";
  reason: string; // короткое детерминированное обоснование (не LLM)
}

/** Снимок состояния одного тика — для дашборда и журнала. */
export interface TickSnapshot {
  tick: number;
  simTime: number;
  targetCpa: number;
  global: Metrics;
  arms: {
    arm: Arm;
    metrics: Metrics;
    sampledRoas: number; // выборка из апостериора (для прозрачности бандита)
    truth: { ctr: number; cvr: number; value: number }; // скрытая правда — только для дашборда
  }[];
  decisions: ArmDecision[];
  explanation: string; // человекочитаемый разбор (LLM или шаблон)
}
