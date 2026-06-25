import { MockPlatform } from "@/platforms/MockPlatform";
import { BanditOptimizer } from "@/core/optimizer/BanditOptimizer";
import { Agent } from "@/core/agent";
import type { TickSnapshot } from "@/core/types";

/**
 * Синглтон-«движок»: держит площадку, агента и историю тиков в памяти процесса.
 * Цикл крутится на setInterval — для прототипа durable-очередь (BullMQ/Temporal) избыточна;
 * она прячется за тем же контуром и подключается при масштабе, код агента не меняя.
 */

export interface SeriesPoint {
  tick: number;
  spend: number;
  cpa: number;
  roas: number;
  conversions: number;
}

export interface LogEntry {
  tick: number;
  explanation: string;
  decisions: { name: string; bid: number; budget: number; state: string; reason: string }[];
}

class Simulation {
  platform!: MockPlatform;
  agent!: Agent;
  running = false;
  msPerTick = 800;
  latest: TickSnapshot | null = null;
  series: SeriesPoint[] = [];
  log: LogEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;

  constructor() {
    this.build();
  }

  private build() {
    this.platform = new MockPlatform(7);
    // Засеянный сценарий: есть явный победитель, середняки и явный «дог».
    // Агент не видит этих чисел — он должен сам их нащупать по метрикам.
    this.platform.createCampaign({
      name: "Запуск продукта",
      creatives: [
        { name: "A — оффер «скидка»", truth: { ctr: 0.03, cvr: 0.05, value: 35 } },
        { name: "B — «бесплатно 7 дней»", truth: { ctr: 0.05, cvr: 0.16, value: 60 } }, // победитель
        { name: "C — видео-демо", truth: { ctr: 0.04, cvr: 0.09, value: 45 } },
        { name: "D — отзыв клиента", truth: { ctr: 0.035, cvr: 0.07, value: 40 } },
        { name: "E — баннер «новинка»", truth: { ctr: 0.012, cvr: 0.02, value: 22 } }, // дог
      ],
    });
    const optimizer = new BanditOptimizer();
    const platform = this.platform;
    this.agent = new Agent(
      platform,
      optimizer,
      { targetCpa: 15, totalBudget: 300, windowHours: 48, llmEveryTicks: 5 },
      // прокидываем скрытую правду только для прозрачности дашборда
      (id: string) => {
        const t = platform.getTruth(id);
        return t ? { ctr: t.ctr, cvr: t.cvr, value: t.value } : undefined;
      },
    );
  }

  reset() {
    this.stop();
    this.latest = null;
    this.series = [];
    this.log = [];
    this.build();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setSpeed(ms: number) {
    this.msPerTick = Math.min(3000, Math.max(50, ms));
  }

  setTargetCpa(v: number) {
    this.agent.setTargetCpa(v);
  }

  private schedule() {
    if (!this.running) return;
    this.timer = setTimeout(() => this.run(), this.msPerTick);
  }

  private async run() {
    if (this.ticking) return this.schedule();
    this.ticking = true;
    try {
      const snap = await this.agent.tick();
      this.latest = snap;
      this.series.push({
        tick: snap.tick,
        spend: round(snap.global.spend),
        cpa: round(snap.global.cpa),
        roas: round(snap.global.roas),
        conversions: snap.global.conversions,
      });
      if (this.series.length > 300) this.series.shift();
      this.log.unshift({
        tick: snap.tick,
        explanation: snap.explanation,
        decisions: snap.decisions.map((d) => ({
          name: d.name,
          bid: d.bid,
          budget: d.budget,
          state: d.state,
          reason: d.reason,
        })),
      });
      if (this.log.length > 40) this.log.pop();
    } catch (e) {
      console.error("tick error", e);
    } finally {
      this.ticking = false;
      this.schedule();
    }
  }

  /** один шаг вручную (когда симуляция на паузе) */
  async step() {
    if (this.running || this.ticking) return;
    this.ticking = true;
    try {
      const snap = await this.agent.tick();
      this.latest = snap;
      this.series.push({
        tick: snap.tick,
        spend: round(snap.global.spend),
        cpa: round(snap.global.cpa),
        roas: round(snap.global.roas),
        conversions: snap.global.conversions,
      });
      this.log.unshift({
        tick: snap.tick,
        explanation: snap.explanation,
        decisions: snap.decisions.map((d) => ({
          name: d.name,
          bid: d.bid,
          budget: d.budget,
          state: d.state,
          reason: d.reason,
        })),
      });
      if (this.log.length > 40) this.log.pop();
    } finally {
      this.ticking = false;
    }
  }

  state() {
    return {
      running: this.running,
      msPerTick: this.msPerTick,
      targetCpa: this.agent.config.targetCpa,
      totalBudget: this.agent.config.totalBudget,
      platform: this.platform.name,
      latest: this.latest,
      series: this.series,
      log: this.log,
    };
  }
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

// единый экземпляр на процесс (переживает запросы в dev/prod Node-сервере)
const g = globalThis as unknown as { __sim?: Simulation };
export const sim: Simulation = g.__sim ?? (g.__sim = new Simulation());
