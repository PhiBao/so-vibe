import { NextResponse } from "next/server";
import { readBotState, writeBotState } from "@/lib/data-store";

export async function POST(request: Request) {
  const body = await request.json();
  const state = readBotState();
  state.running = !!body.running;
  if (!state.running) {
    // Reset cycle when stopping
    state.cycle = 0;
  }
  writeBotState(state);
  return NextResponse.json({ success: true, running: state.running, cycle: state.cycle });
}
