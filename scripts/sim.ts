// Прогон ядра без UI: показывает, как агент сам сбивает CPA вниз и растит ROAS.
// Запуск: npm run sim
import { MockPlatform } from "@/platforms/MockPlatform";
import { BanditOptimizer } from "@/core/optimizer/BanditOptimizer";
import { Agent } from "@/core/agent";

async function main() {
  const platform = new MockPlatform(7);
  platform.createCampaign({
    name: "Запуск продукта",
    creatives: [
      { name: "A", truth: { ctr: 0.03, cvr: 0.05, value: 35 } },
      { name: "B", truth: { ctr: 0.05, cvr: 0.16, value: 60 } }, // победитель
      { name: "C", truth: { ctr: 0.04, cvr: 0.09, value: 45 } },
      { name: "D", truth: { ctr: 0.035, cvr: 0.07, value: 40 } },
      { name: "E", truth: { ctr: 0.012, cvr: 0.02, value: 22 } }, // дог
    ],
  });
  const agent = new Agent(
    platform,
    new BanditOptimizer(),
    { targetCpa: 15, totalBudget: 300, windowHours: 48 },
    (id) => {
      const t = platform.getTruth(id);
      return t ? { ctr: t.ctr, cvr: t.cvr, value: t.value } : undefined;
    },
  );

  const N = Number(process.argv[2] ?? 120);
  console.log(`Прогон ${N} тиков, target CPA $15\n`);
  console.log("тик |  расход | заявки |   CPA | ROAS");
  for (let i = 1; i <= N; i++) {
    const snap = await agent.tick();
    if (i % 10 === 0 || i === 1) {
      const g = snap.global;
      console.log(
        `${String(i).padStart(3)} | ${money(g.spend, 7)} | ${String(g.conversions).padStart(6)} | ${money(
          g.cpa,
          5,
        )} | ${g.roas.toFixed(2)}`,
      );
    }
  }

  const last = await agent.tick();
  console.log("\nИтоговое распределение по креативам:");
  for (const a of last.arms) {
    console.log(
      `  ${a.arm.name}: ${a.arm.state.padEnd(6)} ставка $${a.arm.bid.toFixed(2)} бюджет $${a.arm.budget
        .toFixed(0)
        .padStart(3)}  | факт CPA ${money(a.metrics.cpa, 6)} ROAS ${a.metrics.roas.toFixed(
        2,
      )}  (истинный CVR ${(a.truth.cvr * 100).toFixed(1)}%)`,
    );
  }
}

function money(x: number, w = 6): string {
  return `$${x.toFixed(2)}`.padStart(w);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
