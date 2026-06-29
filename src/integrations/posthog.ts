import { getSettings } from "../util/config.ts";
import { getLogger } from "../util/log.ts";
import { retry } from "../util/retry.ts";
import { PostHogEventSchema, type PostHogEvent } from "../types.ts";

const log = getLogger("posthog");

interface RawListResponse {
  next: string | null;
  results: unknown[];
}

export interface FetchEventsOpts {
  after: Date;
  before?: Date;
  limit?: number;
  maxPages?: number;
  eventFilter?: string;
}

export class PostHogClient {
  readonly host: string;
  readonly projectId: string;
  private apiKey: string;

  constructor(opts: { host?: string; projectId?: string; apiKey?: string } = {}) {
    const s = getSettings();
    this.host = (opts.host ?? s.POSTHOG_HOST).replace(/\/+$/, "");
    this.projectId = opts.projectId ?? s.POSTHOG_PROJECT_ID;
    this.apiKey = opts.apiKey ?? s.POSTHOG_API_KEY;
    if (!this.apiKey) throw new Error("POSTHOG_API_KEY is required");
    if (!this.projectId) throw new Error("POSTHOG_PROJECT_ID is required");
  }

  async *fetchEvents(opts: FetchEventsOpts): AsyncGenerator<PostHogEvent> {
    const limit = opts.limit ?? 100;
    const maxPages = opts.maxPages ?? 100;
    const params = new URLSearchParams({
      after: opts.after.toISOString(),
      limit: String(limit),
      orderBy: '["-timestamp"]',
    });
    if (opts.before) params.set("before", opts.before.toISOString());
    if (opts.eventFilter) params.set("event", opts.eventFilter);

    let url: string | null = `${this.host}/api/projects/${this.projectId}/events/?${params}`;
    let page = 0;
    let total = 0;

    while (url && page < maxPages) {
      const currentUrl: string = url;
      const data = await retry<RawListResponse>(async (): Promise<RawListResponse> => {
        const res: Response = await fetch(currentUrl, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`PostHog ${res.status}: ${body.slice(0, 200)}`);
        }
        return (await res.json()) as RawListResponse;
      });

      for (const raw of data.results) {
        const parsed = PostHogEventSchema.safeParse(raw);
        if (!parsed.success) {
          log.warn("event_skip_invalid", { errors: parsed.error.issues.slice(0, 3) });
          continue;
        }
        yield parsed.data;
        total++;
      }

      log.info("page_done", { page, fetched: data.results.length, total });
      url = data.next;
      page++;
    }

    log.info("fetch_done", { pages: page, total });
  }
}
