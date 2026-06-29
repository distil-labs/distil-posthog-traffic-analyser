import { z } from "zod";

export const PostHogEventSchema = z.object({
  id: z.string(),
  distinct_id: z.string(),
  event: z.string(),
  timestamp: z.string(),
  properties: z.record(z.string(), z.unknown()).default({}),
});
export type PostHogEvent = z.infer<typeof PostHogEventSchema>;

export const SessionSchema = z.object({
  sessionId: z.string(),
  distinctId: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  eventCount: z.number().int().positive(),
  events: z.array(PostHogEventSchema),
});
export type Session = z.infer<typeof SessionSchema>;

export const FindingKindSchema = z.enum(["bug", "gap"]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const RawFindingSchema = z.object({
  kind: FindingKindSchema,
  severity: z.number().int().min(1).max(5),
  title: z.string().min(1).max(160),
  evidence: z.string().min(1).max(800),
});
export type RawFinding = z.infer<typeof RawFindingSchema>;

export const ExtractorOutputSchema = z.object({
  findings: z.array(RawFindingSchema),
});
export type ExtractorOutput = z.infer<typeof ExtractorOutputSchema>;

export interface StoredFinding {
  id: string;
  kind: FindingKind;
  severity: number;
  title: string;
  evidence: string;
  sessionIds: string[];
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  priorityRank: number | null;
  priorityReason: string | null;
  prioritizedAt: string | null;
}

export const PriorityItemSchema = z.object({
  id: z.string(),
  rank: z.number().int().min(1),
  reason: z.string().min(1).max(600),
});
export type PriorityItem = z.infer<typeof PriorityItemSchema>;

export const PrioritizerOutputSchema = z.object({
  ranked: z.array(PriorityItemSchema),
});
export type PrioritizerOutput = z.infer<typeof PrioritizerOutputSchema>;
