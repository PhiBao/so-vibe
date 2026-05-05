// Data Store — Vercel-compatible in-memory storage with fs fallback
// Vercel serverless functions are stateless, so we use module-level memory
// Local dev still benefits from fs persistence

import fs from "fs";
import path from "path";

// ─── In-Memory Stores ──────────────────────────────────────
const memory: Record<string, any> = {};
const memoryLines: Record<string, string[]> = {};

function memGet(key: string, fallback?: any) {
  return memory[key] !== undefined ? memory[key] : fallback;
}

function memSet(key: string, value: any) {
  memory[key] = value;
}

function memAppend(key: string, line: string) {
  if (!memoryLines[key]) memoryLines[key] = [];
  memoryLines[key].push(line);
  // Keep last 2000 lines to prevent unbounded growth
  if (memoryLines[key].length > 2000) memoryLines[key] = memoryLines[key].slice(-2000);
}

function memReadLines(key: string): string[] {
  return memoryLines[key] || [];
}

// ─── File Helpers (best-effort, local dev only) ────────────

const DATA_DIR = path.join(process.cwd(), "..", "data");

function ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function filePath(name: string) {
  return path.join(DATA_DIR, name);
}

// ─── JSON Store ────────────────────────────────────────────

export function readJson(name: string, fallback: any = null) {
  // Memory first (Vercel primary)
  const mem = memGet(name);
  if (mem !== undefined && mem !== null) return mem;

  // Fs fallback (local dev)
  try {
    ensureDir();
    const fp = filePath(name);
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, "utf8"));
      memSet(name, data);
      return data;
    }
  } catch {}

  return fallback;
}

export function writeJson(name: string, data: any) {
  memSet(name, data);
  try {
    ensureDir();
    fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
  } catch {}
}

// ─── JSONL Store (append-only lines) ───────────────────────

export function appendLine(name: string, obj: any) {
  const line = JSON.stringify(obj);
  memAppend(name, line);
  try {
    ensureDir();
    fs.appendFileSync(filePath(name), line + "\n");
  } catch {}
}

export function readLines(name: string, filterFn?: (obj: any) => boolean): any[] {
  const mem = memReadLines(name);
  let lines = mem;

  // If memory is empty, try fs
  if (lines.length === 0) {
    try {
      const fp = filePath(name);
      if (fs.existsSync(fp)) {
        const fileLines = fs.readFileSync(fp, "utf8").trim().split("\n").filter(Boolean);
        memoryLines[name] = fileLines;
        lines = fileLines;
      }
    } catch {}
  }

  const parsed = lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  return filterFn ? parsed.filter(filterFn) : parsed;
}

export function updateLines(name: string, mapFn: (obj: any) => any) {
  const lines = readLines(name);
  const updated = lines.map(mapFn);
  memoryLines[name] = updated.map(o => JSON.stringify(o));
  try {
    ensureDir();
    fs.writeFileSync(filePath(name), memoryLines[name].join("\n") + "\n");
  } catch {}
}

// ─── Specific Data Accessors ───────────────────────────────

// Bot state
export function readBotState() {
  return readJson("bot-state.json", { running: false, cycle: 0, config: null });
}

export function writeBotState(state: any) {
  writeJson("bot-state.json", state);
}

// Bot config
export function readBotConfig() {
  const saved = readJson("bot-config.json", null);
  if (saved) {
    // Migrate old field names
    if (saved.maxPositionPct !== undefined && saved.maxMarginPct === undefined) {
      saved.maxMarginPct = saved.maxPositionPct;
    }
    return saved;
  }
  return {
    enabled: false,
    minConfidence: 0.55,
    maxMarginPct: 20,
    symbols: ["SOL", "ETH", "BTC"],
    interval: 60,
    portfolioValue: 1000,
    walletAddress: "",
  };
}

export function writeBotConfig(config: any) {
  writeJson("bot-config.json", config);
}

// Risk state
export function readRiskState() {
  return readJson("risk-state.json", null);
}

export function writeRiskState(state: any) {
  writeJson("risk-state.json", state);
}
