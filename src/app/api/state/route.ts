import { NextResponse } from "next/server";
import { sim } from "@/server/simulation";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(sim.state());
}
