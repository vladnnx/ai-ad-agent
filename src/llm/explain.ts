import Anthropic from "@anthropic-ai/sdk";
import type { ArmDecision, Metrics } from "@/core/types";

/**
 * Роль LLM (Claude) — НАМЕРЕННО не оптимизатор.
 * Деньгами рулит детерминированная математика (бандит + контроллер): предсказуемо и аудируемо.
 * Claude делает то, в чем силен: пишет человекочитаемый разбор решений как толковый маркетолог.
 *
 * Без ANTHROPIC_API_KEY все работает, объяснение собирается по шаблону,
 * а математика и оптимизация не зависят от LLM вообще.
 *
 * useLLM=false — звать модель не нужно (троттлинг на стороне агента), отдаем шаблон.
 * Так LLM не дергается на каждый тик: в проде это лишние расходы и латентность.
 */

export interface ExplainInput {
  tick: number;
  targetCpa: number;
  global: Metrics;
  decisions: { decision: ArmDecision; metrics: Metrics }[];
}

const MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";

export async function explain(input: ExplainInput, useLLM = true): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !useLLM) return templateExplain(input);
  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 320,
      system:
        "Ты performance-маркетолог. По цифрам кратко (3-5 предложений, по-русски) объясни, " +
        "что происходит с кампаниями и почему агент так распорядился бюджетом и ставками. " +
        "Без воды и без выдуманных цифр, только то, что в данных. Решения уже приняты математикой, " +
        "ты их объясняешь человеку. В ответе используй только букву «е», никогда не пиши букву «ё».",
      messages: [{ role: "user", content: serialize(input) }],
    });
    const text = msg.content.find((b) => b.type === "text");
    return text && text.type === "text" ? text.text.trim() : templateExplain(input);
  } catch {
    // сеть/ключ/лимит — деградируем до шаблона, агент продолжает работать
    return templateExplain(input);
  }
}

function serialize(i: ExplainInput): string {
  const lines = i.decisions.map((d) => {
    const m = d.metrics;
    return `${d.decision.name}: показы ${m.impressions}, клики ${m.clicks}, заявки ${m.conversions}, CPA $${m.cpa.toFixed(
      2,
    )}, ROAS ${m.roas.toFixed(2)} → ставка $${d.decision.bid.toFixed(2)}, бюджет $${d.decision.budget.toFixed(
      0,
    )}, ${d.decision.state}`;
  });
  return [
    `Тик ${i.tick}. Цель CPA $${i.targetCpa.toFixed(2)}.`,
    `Итог по всем: расход $${i.global.spend.toFixed(0)}, заявки ${i.global.conversions}, CPA $${i.global.cpa.toFixed(
      2,
    )}, ROAS ${i.global.roas.toFixed(2)}.`,
    `Креативы:`,
    ...lines,
  ].join("\n");
}

function templateExplain(i: ExplainInput): string {
  const g = i.global;
  const paused = i.decisions.filter((d) => d.decision.state === "paused").length;
  const best = [...i.decisions]
    .filter((d) => d.decision.state === "active")
    .sort((a, b) => b.metrics.roas - a.metrics.roas)[0];
  const cpaVerdict =
    g.cpa === 0
      ? "заявок пока нет, идет разведка"
      : g.cpa <= i.targetCpa
        ? `CPA $${g.cpa.toFixed(2)} в пределах цели $${i.targetCpa.toFixed(2)}`
        : `CPA $${g.cpa.toFixed(2)} выше цели $${i.targetCpa.toFixed(2)}, режем дорогое`;
  const bestLine = best
    ? ` Лучший креатив сейчас «${best.decision.name}» (ROAS ${best.metrics.roas.toFixed(2)}), на него льем больше бюджета.`
    : "";
  return `Тик ${i.tick}: расход $${g.spend.toFixed(0)}, ${g.conversions} заявок, ${cpaVerdict}.${bestLine}${
    paused ? ` Поставлено на паузу: ${paused}.` : ""
  }`;
}
