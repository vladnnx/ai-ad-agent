import type { AdPlatform } from "@/platforms/AdPlatform";
import type { Optimizer } from "./optimizer/Optimizer";
import { MetricStore } from "./metrics";
import { explain } from "@/llm/explain";
import type { ArmDecision, Metrics, TickSnapshot } from "./types";

export interface AgentConfig {
  targetCpa: number; // цель, которую держим (можно менять на лету из UI)
  totalBudget: number; // суммарный дневной бюджет
  // скользящее окно метрик в часах. Это и есть «забывание»: контроллер и бандит видят
  // СВЕЖЕЕ поведение, а не размытый средний за все время — иначе агент не реагирует на
  // нестационарность (усталость креатива, смена аукциона). 0 = кумулятивно (без забывания).
  windowHours: number;
  // как часто звать LLM за объяснением (каждые N тиков). Между ними — дешевый шаблон.
  // В проде LLM на каждый тик дорого/лишне; математика и решения от LLM не зависят. 0/1 = каждый тик.
  llmEveryTicks?: number;
}

/** скрытая правда руки — только для прозрачности дашборда, агент ее не использует */
export type TruthProvider = (
  armId: string,
) => { ctr: number; cvr: number; value: number } | undefined;

/**
 * Агент = тикающий цикл Sense → Decide → Act → Explain.
 * Ничего не знает о конкретной площадке/оптимизаторе — только через интерфейсы (швы).
 */
export class Agent {
  private store = new MetricStore();
  private lastTs = 0;
  private tickCount = 0;
  // окно метрик, замороженное в момент паузы руки — чтобы в дашборде у выключенной руки
  // оставались СВЕЖИЕ цифры, по которым агент принял решение (а не нули из-за окна и не
  // размытый кумулятив, в котором плохой сигнал теряется).
  private frozen = new Map<string, Metrics>();

  constructor(
    private platform: AdPlatform,
    private optimizer: Optimizer,
    public config: AgentConfig,
    private truthProvider?: TruthProvider,
  ) {}

  setTargetCpa(v: number) {
    this.config.targetCpa = Math.max(1, v);
  }

  private windowFrom(): number {
    if (!this.config.windowHours) return 0;
    return this.platform.now() - this.config.windowHours * 3600_000;
  }

  /** один тик цикла; возвращает снимок для дашборда */
  async tick(): Promise<TickSnapshot> {
    this.tickCount++;

    // 1) SENSE — собрать сырые события и обновить event store
    const events = this.platform.pullEvents(this.lastTs);
    this.lastTs = this.platform.now();
    this.store.append(events);

    const from = this.windowFrom();
    const arms = this.platform.getArms();
    // На скользящем окне агент ПРИНИМАЕТ решения (свежесть, реакция на нестационарность).
    const windowMetrics = new Map<string, Metrics>(
      arms.map((a) => [a.id, this.store.forArm(a.id, from)]),
    );

    // 2) DECIDE — аллокация бюджета (бандит) + ставка (контроллер) + guardrails
    const decisions = this.optimizer.decide({
      arms: arms.map((arm) => ({ arm, metrics: windowMetrics.get(arm.id)! })),
      targetCpa: this.config.targetCpa,
      totalBudget: this.config.totalBudget,
    });
    const decisionById = new Map(decisions.map((d) => [d.armId, d]));

    // Метрики ДЛЯ ПОКАЗА: активная рука — живое окно; паузная — окно, замороженное в момент
    // паузы (те данные, что обосновали выключение), иначе из-за окна цифры утекли бы в нули.
    const dispMetrics = new Map<string, Metrics>();
    for (const arm of arms) {
      const w = windowMetrics.get(arm.id)!;
      if (decisionById.get(arm.id)?.state === "paused") {
        if (!this.frozen.has(arm.id)) this.frozen.set(arm.id, w);
        dispMetrics.set(arm.id, this.frozen.get(arm.id)!);
      } else {
        this.frozen.delete(arm.id); // рука снова активна — размораживаем
        dispMetrics.set(arm.id, w);
      }
    }

    // 3) ACT — вернуть решения в площадку
    const armDecisions: ArmDecision[] = [];
    for (const d of decisions) {
      this.platform.setArmState(d.armId, d.state);
      this.platform.setBid(d.armId, d.bid);
      this.platform.setBudget(d.armId, d.budget);
      const arm = arms.find((a) => a.id === d.armId)!;
      armDecisions.push({
        armId: d.armId,
        name: arm.name,
        bid: d.bid,
        budget: d.budget,
        state: d.state,
        reason: d.reason,
      });
    }

    const global = this.store.global(from); // итог за то же окно — «свежее» состояние кампаний

    // 4) EXPLAIN — человекочитаемый разбор. LLM зовем не каждый тик (троттлинг по llmEveryTicks),
    // в промежутках — дешевый детерминированный шаблон. Решения уже приняты математикой.
    const every = this.config.llmEveryTicks ?? 1;
    const useLLM = every <= 1 || this.tickCount % every === 0;
    const explanation = await explain(
      {
        tick: this.tickCount,
        targetCpa: this.config.targetCpa,
        global,
        decisions: armDecisions.map((decision) => ({
          decision,
          metrics: dispMetrics.get(decision.armId)!,
        })),
      },
      useLLM,
    );

    const sampleById = new Map(decisions.map((d) => [d.armId, d.sampledRoas]));
    return {
      tick: this.tickCount,
      simTime: this.platform.now(),
      targetCpa: this.config.targetCpa,
      global,
      arms: arms.map((arm) => ({
        arm,
        metrics: dispMetrics.get(arm.id)!,
        sampledRoas: sampleById.get(arm.id) ?? 0,
        truth: this.truthProvider?.(arm.id) ?? { ctr: 0, cvr: 0, value: 0 },
      })),
      decisions: armDecisions,
      explanation,
    };
  }
}
