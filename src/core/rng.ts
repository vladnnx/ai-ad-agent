// Маленький набор случайностей с фиксируемым seed — чтобы прогоны были воспроизводимы
// (важно и для демо, и для «честных» объяснений: тот же seed → тот же сценарий).

export class Rng {
  private s: number;
  constructor(seed = 42) {
    this.s = seed >>> 0 || 1;
  }
  // mulberry32 — быстрый детерминированный PRNG
  next(): number {
    this.s |= 0;
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // нормальное распределение (Box-Muller)
  normal(mean = 0, sd = 1): number {
    const u1 = Math.max(this.next(), 1e-9);
    const u2 = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  // Binomial(n, p): точный цикл для малых n, нормальная аппроксимация для больших
  binomial(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n > 200) {
      const v = Math.round(this.normal(n * p, Math.sqrt(n * p * (1 - p))));
      return Math.min(n, Math.max(0, v));
    }
    let k = 0;
    for (let i = 0; i < n; i++) if (this.next() < p) k++;
    return k;
  }
  // Gamma(shape, 1) — Marsaglia-Tsang
  private gamma(shape: number): number {
    if (shape < 1) {
      const u = this.next();
      return this.gamma(1 + shape) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x = this.normal();
      let v = 1 + c * x;
      if (v <= 0) continue;
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  // Beta(a, b) через две Gamma — основа Thompson Sampling
  beta(a: number, b: number): number {
    const x = this.gamma(a);
    const y = this.gamma(b);
    return x / (x + y);
  }
}
