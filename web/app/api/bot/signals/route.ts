import { NextResponse } from "next/server";
import { getSignals } from "@/lib/signal-store";

export async function GET() {
  const { signals, lastCycleTime } = getSignals();
  return NextResponse.json({
    count: signals.length,
    signals,
    lastCycleTime,
  });
}
