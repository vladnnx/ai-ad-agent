"use client";

import { useEffect, useRef, useState } from "react";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";

interface Metrics {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cvr: number;
  cpa: number;
  roas: number;
}
interface State {
  running: boolean;
  msPerTick: number;
  targetCpa: number;
  totalBudget: number;
  platform: string;
  latest: {
    tick: number;
    global: Metrics;
    arms: {
      arm: { id: string; name: string; state: string; bid: number; budget: number };
      metrics: Metrics;
      sampledRoas: number;
      truth: { ctr: number; cvr: number; value: number };
    }[];
  } | null;
  series: { tick: number; spend: number; cpa: number; roas: number; conversions: number }[];
  log: {
    tick: number;
    explanation: string;
    decisions: { name: string; bid: number; budget: number; state: string; reason: string }[];
  }[];
}

async function control(action: string, value?: number) {
  await fetch("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, value }),
  });
}

export default function Dashboard() {
  const [s, setS] = useState<State | null>(null);
  const [targetInput, setTargetInput] = useState(15);
  const [speedInput, setSpeedInput] = useState(750);
  const editing = useRef(false);
  const editingSpeed = useRef(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/state", { cache: "no-store" });
        const data: State = await r.json();
        if (alive) {
          setS(data);
          if (!editing.current) setTargetInput(data.targetCpa);
          if (!editingSpeed.current) setSpeedInput(1550 - data.msPerTick);
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 700);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const g = s?.latest?.global;
  const maxBudget = Math.max(1, ...(s?.latest?.arms.map((a) => a.arm.budget) ?? [1]));
  const cpaFill = `${((targetInput - 5) / 35) * 100}%`;
  const spdFill = `${((speedInput - 50) / 1450) * 100}%`;
  const ticksPerSec = (1000 / (1550 - speedInput)).toFixed(1);
  const cpaGood = g && g.cpa > 0 ? g.cpa <= (s?.targetCpa ?? 0) : undefined;

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>AI Ad Agent: самообучаемый по метрикам</h1>
            <div className="sub">Площадка: {s?.platform ?? "нет"} (мок-аукцион)</div>
          </div>
        </div>
      </header>

      <div className="sub page-sub">
        Контур Sense → Decide → Act: бюджет лью бандитом (Thompson), ставку держу контроллером к
        target CPA.
      </div>

      <div className="toolbar">
        {s?.running ? (
          <button className="danger" onClick={() => control("stop")}>
            <Icon name="pause" /> Стоп
          </button>
        ) : (
          <button className="primary" onClick={() => control("start")}>
            <Icon name="play" /> Старт
          </button>
        )}
        <button onClick={() => control("step")} disabled={s?.running}>
          Шаг
        </button>
        <button onClick={() => control("reset")}>
          <Icon name="reset" /> Сброс
        </button>

        <span className="spacer" />

        <label className="ctl">
          <span className="ctl-label">
            Target CPA <b>${targetInput}</b>
          </span>
          <input
            type="range"
            min={5}
            max={40}
            step={1}
            value={targetInput}
            style={{ "--p": cpaFill } as React.CSSProperties}
            onMouseDown={() => (editing.current = true)}
            onMouseUp={() => (editing.current = false)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setTargetInput(v);
              control("targetCpa", v);
            }}
          />
        </label>

        <label className="ctl">
          <span className="ctl-label">
            Скорость <b>{ticksPerSec}/с</b>
          </span>
          <input
            type="range"
            min={50}
            max={1500}
            step={10}
            value={speedInput}
            style={{ "--p": spdFill } as React.CSSProperties}
            onMouseDown={() => (editingSpeed.current = true)}
            onMouseUp={() => (editingSpeed.current = false)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSpeedInput(v);
              control("speed", 1550 - v);
            }}
          />
        </label>
      </div>

      <div className="kpis">
        <Kpi icon="spend" chip="chip-purple" v={money(g?.spend)} l="Расход" />
        <Kpi icon="leads" chip="chip-blue" v={g?.conversions ?? 0} l="Заявки" />
        <Kpi
          icon="target"
          chip={cpaGood === false ? "chip-pink" : "chip-teal"}
          v={money(g?.cpa)}
          l={`CPA (цель ${money(s?.targetCpa)})`}
          color={cpaGood === undefined ? undefined : cpaGood ? "teal" : "red"}
        />
        <Kpi
          icon="roas"
          chip="chip-teal"
          v={(g?.roas ?? 0).toFixed(2)}
          l="ROAS"
          color={g && g.roas >= 1 ? "teal" : undefined}
        />
      </div>

      <div className="row">
        <div className="panel grow" style={{ flexBasis: 620 }}>
          <div className="section-title">CPA и ROAS по тикам</div>
          <div style={{ width: "100%", height: 264 }}>
            <ResponsiveContainer>
              <ComposedChart data={s?.series ?? []} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillCpa" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#cb86c2" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#cb86c2" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fillRoas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5dcac4" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="#5dcac4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="tick" stroke="#87888c" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis yAxisId="l" stroke="#87888c" fontSize={11} tickLine={false} axisLine={false} width={34} />
                <YAxis yAxisId="r" orientation="right" stroke="#87888c" fontSize={11} tickLine={false} axisLine={false} width={30} />
                <Tooltip
                  contentStyle={{
                    background: "#1b1c26",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 12,
                    boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
                  }}
                  labelStyle={{ color: "#87888c" }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                <ReferenceLine
                  yAxisId="l"
                  y={s?.targetCpa}
                  stroke="#30a0da"
                  strokeDasharray="5 4"
                  label={{ value: "target CPA", fill: "#5dcac4", fontSize: 10, position: "insideTopRight" }}
                />
                <Area
                  yAxisId="l"
                  type="monotone"
                  dataKey="cpa"
                  name="CPA $"
                  stroke="#cb86c2"
                  strokeWidth={2.6}
                  fill="url(#fillCpa)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
                <Area
                  yAxisId="r"
                  type="monotone"
                  dataKey="roas"
                  name="ROAS"
                  stroke="#5dcac4"
                  strokeWidth={2.6}
                  fill="url(#fillRoas)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel grow" style={{ flexBasis: 460 }}>
          <div className="section-title">Решения агента</div>
          <div className="scroll">
            {(s?.log ?? []).map((l) => (
              <div className="logitem" key={l.tick}>
                <div className="t">тик {l.tick}</div>
                <div className="e">{l.explanation}</div>
                <div className="d">
                  {l.decisions
                    .map((d) => `${d.name}: ${d.state === "paused" ? "пауза" : `ставка $${d.bid}, бюджет $${d.budget}`}`)
                    .join(" / ")}
                </div>
              </div>
            ))}
            {!s?.log?.length && <div className="sub">Нажми «Старт», агент начнет вести кампании.</div>}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="section-title">Креативы</div>
        <table>
          <colgroup>
            <col style={{ width: "17%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "7.5%" }} />
            <col style={{ width: "6.5%" }} />
            <col style={{ width: "6.5%" }} />
            <col style={{ width: "6.5%" }} />
            <col style={{ width: "6.5%" }} />
            <col style={{ width: "6.5%" }} />
            <col style={{ width: "6.5%" }} />
            <col style={{ width: "6.5%" }} />
            <col style={{ width: "6.5%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Креатив</th>
              <th>Статус</th>
              <th>Показы</th>
              <th>Клики</th>
              <th>CTR</th>
              <th>Заявки</th>
              <th>CVR</th>
              <th>CPC</th>
              <th>CPA</th>
              <th>ROAS</th>
              <th>Ставка</th>
              <th>Бюджет</th>
              <th>Доля</th>
            </tr>
          </thead>
          <tbody>
            {(s?.latest?.arms ?? []).map((a) => (
              <tr key={a.arm.id}>
                <td>{a.arm.name}</td>
                <td>
                  <span className={`tag ${a.arm.state}`}>{a.arm.state === "active" ? "активен" : "пауза"}</span>
                </td>
                <td>{a.metrics.impressions}</td>
                <td>{a.metrics.clicks}</td>
                <td>{pct(a.metrics.ctr)}</td>
                <td>{a.metrics.conversions}</td>
                <td>{pct(a.metrics.cvr)}</td>
                <td>{money(a.metrics.cpc)}</td>
                <td>{money(a.metrics.cpa)}</td>
                <td>{a.metrics.roas.toFixed(2)}</td>
                <td>${a.arm.bid.toFixed(2)}</td>
                <td>${a.arm.budget.toFixed(0)}</td>
                <td>
                  <div className="bar">
                    <i style={{ width: `${Math.round((a.arm.budget / maxBudget) * 100)}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
          Агент не видит «истинных» CTR/CVR креативов, он нащупывает их по метрикам через
          Thompson Sampling и сам переливает бюджет на победителей.
        </div>
      </div>
    </div>
  );
}

function Kpi({
  v,
  l,
  color,
  icon,
  chip,
}: {
  v: React.ReactNode;
  l: string;
  color?: "teal" | "red";
  icon: string;
  chip: string;
}) {
  const c = color === "teal" ? "var(--teal)" : color === "red" ? "#ff5b85" : "var(--text)";
  return (
    <div className="kpi">
      <div className={`chip ${chip}`}>
        <Icon name={icon} />
      </div>
      <div>
        <div className="v" style={{ color: c }}>
          {v}
        </div>
        <div className="l">{l}</div>
      </div>
    </div>
  );
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    play: <polygon points="7 5 19 12 7 19" fill="currentColor" stroke="none" />,
    pause: (
      <>
        <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
        <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      </>
    ),
    reset: (
      <>
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <polyline points="21 3 21 9 15 9" />
      </>
    ),
    spend: (
      <>
        <rect x="2" y="6" width="20" height="12" rx="2.5" />
        <circle cx="12" cy="12" r="2.6" />
      </>
    ),
    leads: (
      <>
        <circle cx="12" cy="12" r="9" />
        <polyline points="8 12 11 15 16 9" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
    roas: (
      <>
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="15 7 21 7 21 13" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function money(x?: number): string {
  return `$${(x ?? 0).toFixed(2)}`;
}

function pct(x?: number): string {
  return `${((x ?? 0) * 100).toFixed(1)}%`;
}
