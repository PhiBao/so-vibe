import { NextResponse } from "next/server";
import { readBotState } from "@/lib/data-store";

export async function GET() {
  const state = readBotState();
  return NextResponse.json({
    running: state.running,
    cycle: state.cycle || 0,
  });
}
