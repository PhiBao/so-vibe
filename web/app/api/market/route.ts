import { NextResponse } from "next/server";
import { getAdapter, initDex } from "@/lib/dex";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") || "SOL";

  try {
    await initDex();
    const adapter = getAdapter();

    const [candles, book] = await Promise.all([
      adapter.getCandles(symbol, "1h", 100),
      adapter.getOrderbook(symbol),
    ]);

    const closes = candles.map((c) => c.close);
    const last = closes.length - 1;

    // Simple RSI
    let rsi = 50;
    if (closes.length > 15) {
      const changes = [];
      for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);
      let avgGain = 0,
        avgLoss = 0;
      for (let i = 0; i < 14; i++) {
        if (changes[i] > 0) avgGain += changes[i];
        else avgLoss += Math.abs(changes[i]);
      }
      avgGain /= 14;
      avgLoss /= 14;
      for (let i = 14; i < changes.length; i++) {
        avgGain = (avgGain * 13 + (changes[i] > 0 ? changes[i] : 0)) / 14;
        avgLoss = (avgLoss * 13 + (changes[i] < 0 ? Math.abs(changes[i]) : 0)) / 14;
      }
      rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    // Simple EMA
    const ema = (data: number[], period: number) => {
      const k = 2 / (period + 1);
      const result = [data[0]];
      for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k));
      return result;
    };

    const ema9 = closes.length > 9 ? ema(closes, 9)[last] : null;
    const ema21 = closes.length > 21 ? ema(closes, 21)[last] : null;
    const ema50 = closes.length > 50 ? ema(closes, 50)[last] : null;

    // Price change 24h
    const price24hAgo = closes.length > 24 ? closes[last - 24] : closes[0];
    const change24h = closes[last] && price24hAgo ? ((closes[last] - price24hAgo) / price24hAgo) * 100 : 0;

    // Trend
    const trend =
      ema9 && ema21 && ema50
        ? ema9 > ema21 && ema21 > ema50
          ? "bullish"
          : ema9 < ema21 && ema21 < ema50
            ? "bearish"
            : "neutral"
        : "unknown";

    return NextResponse.json({
      symbol,
      price: book.mid || closes[last],
      change24h: change24h.toFixed(2),
      rsi: rsi.toFixed(1),
      trend,
      ema: { ema9, ema21, ema50 },
      book: { bids: book.bids?.slice(0, 5) || [], asks: book.asks?.slice(0, 5) || [], mid: book.mid },
      candles: candles.slice(-100),
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch market data" }, { status: 500 });
  }
}
