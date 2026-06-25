import { NextResponse } from "next/server";
import { sim } from "@/server/simulation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    value?: number;
  };

  switch (body.action) {
    case "start":
      sim.start();
      break;
    case "stop":
      sim.stop();
      break;
    case "step":
      await sim.step();
      break;
    case "reset":
      sim.reset();
      break;
    case "speed":
      if (typeof body.value === "number") sim.setSpeed(body.value);
      break;
    case "targetCpa":
      if (typeof body.value === "number") sim.setTargetCpa(body.value);
      break;
    default:
      return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, state: sim.state() });
}
