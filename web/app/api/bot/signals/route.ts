import { NextResponse } from "next/server";
import { getSignals, removeSignal } from "@/lib/signal-store";

export async function GET() {
  const { signals, lastCycleTime } = getSignals();
  return NextResponse.json({
    count: signals.length,
    signals,
    lastCycleTime,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  removeSignal(id);
  return NextResponse.json({ success: true });
}
