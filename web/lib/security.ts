// Security Audit Module — based on nemesis-auditor & pashov skills
// Validates inputs, detects anomalies, prevents common attack vectors

interface SecurityCheck {
  passed: boolean;
  severity: "info" | "warn" | "critical";
  message: string;
}

export class SecurityAuditor {
  private maxOrderSize: number;
  private maxDailyVolume: number;
  private suspiciousPatterns: RegExp[];
  private blockedAddresses: Set<string>;

  constructor(config: { maxOrderSize?: number; maxDailyVolume?: number } = {}) {
    this.maxOrderSize = config.maxOrderSize || 10000;
    this.maxDailyVolume = config.maxDailyVolume || 100000;
    this.suspiciousPatterns = [
      /0x0{40}/i, // Burn address
    ];
    this.blockedAddresses = new Set([
      // Known malicious addresses placeholder
    ]);
  }

  // ─── Input Validation ────────────────────────────────────

  validateSymbol(symbol: string): SecurityCheck {
    if (!symbol || typeof symbol !== "string") {
      return { passed: false, severity: "critical", message: "Symbol is required" };
    }
    if (!/^[A-Z0-9]+(-USD|-USDT)?$/.test(symbol)) {
      return { passed: false, severity: "critical", message: `Invalid symbol format: ${symbol}` };
    }
    return { passed: true, severity: "info", message: "Symbol valid" };
  }

  validateSide(side: string): SecurityCheck {
    if (side !== "buy" && side !== "sell" && side !== "long" && side !== "short") {
      return { passed: false, severity: "critical", message: `Invalid side: ${side}` };
    }
    return { passed: true, severity: "info", message: "Side valid" };
  }

  validateSize(size: number): SecurityCheck {
    if (typeof size !== "number" || isNaN(size)) {
      return { passed: false, severity: "critical", message: "Size must be a number" };
    }
    if (size <= 0) {
      return { passed: false, severity: "critical", message: "Size must be positive" };
    }
    if (size > this.maxOrderSize) {
      return { passed: false, severity: "critical", message: `Size exceeds max ${this.maxOrderSize}` };
    }
    return { passed: true, severity: "info", message: "Size valid" };
  }

  validatePrice(price: number): SecurityCheck {
    if (typeof price !== "number" || isNaN(price)) {
      return { passed: false, severity: "critical", message: "Price must be a number" };
    }
    if (price <= 0) {
      return { passed: false, severity: "critical", message: "Price must be positive" };
    }
    // Check for unrealistic prices (flash crash protection)
    if (price < 0.000001 || price > 1000000) {
      return { passed: false, severity: "warn", message: `Suspicious price: ${price}` };
    }
    return { passed: true, severity: "info", message: "Price valid" };
  }

  validateLeverage(leverage: number): SecurityCheck {
    if (typeof leverage !== "number" || isNaN(leverage)) {
      return { passed: false, severity: "critical", message: "Leverage must be a number" };
    }
    if (leverage < 1 || leverage > 50) {
      return { passed: false, severity: "critical", message: `Leverage out of range: ${leverage}` };
    }
    return { passed: true, severity: "info", message: "Leverage valid" };
  }

  validateAddress(address: string): SecurityCheck {
    if (!address || typeof address !== "string") {
      return { passed: false, severity: "critical", message: "Address is required" };
    }
    // EVM address validation (0x + 40 hex chars)
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return { passed: false, severity: "critical", message: "Invalid EVM address format" };
    }
    if (this.blockedAddresses.has(address.toLowerCase())) {
      return { passed: false, severity: "critical", message: "Blocked address detected" };
    }
    // Check for suspicious patterns (burn address, etc)
    if (/^0x0{40}$/i.test(address)) {
      return { passed: false, severity: "critical", message: "Burn address detected" };
    }
    return { passed: true, severity: "info", message: "Address valid" };
  }

  // ─── Order Security Audit ────────────────────────────────

  auditOrder(order: {
    symbol: string;
    side: string;
    size: number;
    price: number;
    leverage?: number;
    wallet?: string;
  }): SecurityCheck[] {
    const checks: SecurityCheck[] = [];

    checks.push(this.validateSymbol(order.symbol));
    checks.push(this.validateSide(order.side));
    checks.push(this.validateSize(order.size));
    checks.push(this.validatePrice(order.price));
    if (order.leverage) checks.push(this.validateLeverage(order.leverage));
    if (order.wallet) checks.push(this.validateAddress(order.wallet));

    // Check for potential sandwich attack vectors
    if (order.size > this.maxOrderSize * 0.5) {
      checks.push({
        passed: true,
        severity: "warn",
        message: "Large order size — potential MEV target",
      });
    }

    // Slippage check: if no SL/TP, warn
    // (Handled in UI, but good to log)

    return checks;
  }

  // ─── Rate Limiting ───────────────────────────────────────

  private requestLog: Map<string, number[]> = new Map();

  checkRateLimit(identifier: string, windowMs: number = 60000, maxRequests: number = 30): SecurityCheck {
    const now = Date.now();
    const logs = this.requestLog.get(identifier) || [];
    const recent = logs.filter((t) => now - t < windowMs);
    recent.push(now);
    this.requestLog.set(identifier, recent);

    if (recent.length > maxRequests) {
      return {
        passed: false,
        severity: "critical",
        message: `Rate limit exceeded: ${recent.length} requests in ${windowMs / 1000}s`,
      };
    }
    return { passed: true, severity: "info", message: "Rate limit OK" };
  }

  // ─── Reentrancy / Double-Spend Guard ─────────────────────

  private pendingOrders: Set<string> = new Set();

  checkDuplicate(orderId: string): SecurityCheck {
    if (this.pendingOrders.has(orderId)) {
      return { passed: false, severity: "critical", message: "Duplicate order detected" };
    }
    this.pendingOrders.add(orderId);
    // Auto-clear after 30s
    setTimeout(() => this.pendingOrders.delete(orderId), 30000);
    return { passed: true, severity: "info", message: "No duplicate" };
  }

  // ─── Circuit Breaker ─────────────────────────────────────

  private dailyVolume: number = 0;
  private lastVolumeReset: number = Date.now();

  checkCircuitBreaker(orderSize: number): SecurityCheck {
    const now = Date.now();
    if (now - this.lastVolumeReset > 86400000) {
      this.dailyVolume = 0;
      this.lastVolumeReset = now;
    }
    this.dailyVolume += orderSize;

    if (this.dailyVolume > this.maxDailyVolume) {
      return {
        passed: false,
        severity: "critical",
        message: `Daily volume limit exceeded: ${this.dailyVolume.toFixed(2)}`,
      };
    }
    return { passed: true, severity: "info", message: "Circuit breaker OK" };
  }
}

export const defaultAuditor = new SecurityAuditor();
