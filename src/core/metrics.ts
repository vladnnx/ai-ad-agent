import type { AdEvent, Metrics } from "./types";

/**
 * Шов №3 — MetricStore.
 * Хранит сырой неизменяемый журнал событий и считает из него метрики в скользящем окне.
 * Сегодня это массив в памяти; за тем же интерфейсом завтра Postgres → Kafka/Timescale.
 *
 * Принцип event-sourcing: метрики никогда не «накапливаются вручную», а всегда
 * пересчитываются из событий. Любую цифру можно объяснить «откуда она» — это и есть
 * разница между толковым маркетологом и черным ящиком.
 */
export class MetricStore {
  private log: AdEvent[] = [];

  append(events: AdEvent[]): void {
    for (const e of events) this.log.push(e);
  }

  get size(): number {
    return this.log.length;
  }

  /** события за окно [from, ∞) — опционально по конкретной руке */
  private window(from: number, armId?: string): AdEvent[] {
    return this.log.filter((e) => e.ts >= from && (!armId || e.armId === armId));
  }

  private aggregate(events: AdEvent[]): Metrics {
    let impressions = 0,
      clicks = 0,
      spend = 0,
      conversions = 0,
      revenue = 0;
    for (const e of events) {
      switch (e.type) {
        case "impression":
          impressions += e.count ?? 0;
          break;
        case "click":
          clicks += e.count ?? 0;
          break;
        case "spend":
          spend += e.amount ?? 0;
          break;
        case "lead":
          conversions += e.count ?? 0;
          revenue += e.value ?? 0;
          break;
      }
    }
    return {
      impressions,
      clicks,
      spend,
      conversions,
      revenue,
      ctr: impressions ? clicks / impressions : 0,
      cpc: clicks ? spend / clicks : 0,
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      cvr: clicks ? conversions / clicks : 0,
      cpa: conversions ? spend / conversions : 0,
      roas: spend ? revenue / spend : 0,
    };
  }

  /** метрики по руке за окно от from */
  forArm(armId: string, from = 0): Metrics {
    return this.aggregate(this.window(from, armId));
  }

  /** агрегат по всем рукам за окно от from */
  global(from = 0): Metrics {
    return this.aggregate(this.window(from));
  }
}
