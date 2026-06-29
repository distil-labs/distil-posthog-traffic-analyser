import { describe, expect, test } from "bun:test";
import { cosine, findNearest, jaccard } from "../src/orchestrator/dedupe.ts";

describe("cosine", () => {
  test("identical vectors -> 1", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  test("orthogonal -> 0", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  test("opposite -> -1", () => {
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1, 6);
  });
  test("zero vector -> 0", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe("findNearest", () => {
  const cands = [
    { id: "a", embedding: [1, 0, 0] },
    { id: "b", embedding: [0.9, 0.1, 0] },
    { id: "c", embedding: [0, 1, 0] },
  ];

  test("returns highest above threshold", () => {
    const m = findNearest([1, 0, 0], cands, 0.85);
    expect(m).not.toBeNull();
    expect(m!.id).toBe("a");
  });
  test("returns null when nothing above threshold", () => {
    const m = findNearest([0, 0, 1], cands, 0.85);
    expect(m).toBeNull();
  });
});

describe("jaccard fallback", () => {
  test("identical text -> 1", () => {
    expect(jaccard("hello world", "hello world")).toBe(1);
  });
  test("disjoint -> 0", () => {
    expect(jaccard("hello", "world")).toBe(0);
  });
  test("normalization handles case + punctuation", () => {
    expect(jaccard("Hello, World!", "hello world")).toBe(1);
  });
});
