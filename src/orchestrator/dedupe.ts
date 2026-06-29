export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export interface Candidate {
  id: string;
  embedding: number[];
  text?: string;
}

export interface Match {
  id: string;
  score: number;
}

export function findNearest(
  query: number[],
  candidates: Candidate[],
  threshold = 0.85,
): Match | null {
  let best: Match | null = null;
  for (const c of candidates) {
    const score = cosine(query, c.embedding);
    if (score >= threshold && (best === null || score > best.score)) {
      best = { id: c.id, score };
    }
  }
  return best;
}

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function jaccard(a: string, b: string): number {
  const aw = new Set(normalizeText(a).split(" ").filter(Boolean));
  const bw = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (aw.size === 0 && bw.size === 0) return 0;
  let inter = 0;
  for (const w of aw) if (bw.has(w)) inter++;
  const union = aw.size + bw.size - inter;
  return union === 0 ? 0 : inter / union;
}
