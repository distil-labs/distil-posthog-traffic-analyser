/**
 * Build the committed seed dataset under examples/seeds/.
 *
 * These are hand-authored (input, output) pairs for the three tools,
 * validated against the exact tool schemas in src/tools/registry.ts.
 * They are the seeds you hand to the Distil Labs platform: Distil expands
 * them into synthetic training data and trains a student per tool. No
 * frontier teacher key is needed to produce or use them.
 *
 * Regenerate with:  bun run build-seeds
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getTool, NarratorOutputSchema } from "../src/tools/registry.ts";
import {
  ExtractorOutputSchema,
  PrioritizerOutputSchema,
  type PostHogEvent,
  type RawFinding,
  type Session,
} from "../src/types.ts";

const OUT_DIR = join(import.meta.dirname ?? import.meta.dir, "..", "examples", "seeds");

function ev(
  id: string,
  distinctId: string,
  event: string,
  timestamp: string,
  properties: Record<string, unknown> = {},
): PostHogEvent {
  return { id, distinct_id: distinctId, event, timestamp, properties };
}

function session(
  sessionId: string,
  distinctId: string,
  startedAt: string,
  endedAt: string,
  events: PostHogEvent[],
): Session {
  return {
    sessionId,
    distinctId,
    startedAt,
    endedAt,
    durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
    eventCount: events.length,
    events,
  };
}

const bug = (severity: number, title: string, evidence: string): RawFinding => ({
  kind: "bug",
  severity,
  title,
  evidence,
});
const gap = (severity: number, title: string, evidence: string): RawFinding => ({
  kind: "gap",
  severity,
  title,
  evidence,
});

interface SeedRow {
  narration: string;
  findings: RawFinding[];
  session: Session;
}

// ---------------------------------------------------------------------------
// Authored sessions + their narrator/extractor labels.
// A "success" session has an empty findings array on purpose: the extractor
// must learn that not every session contains an actionable issue.
// ---------------------------------------------------------------------------
const seeds: SeedRow[] = [
  {
    session: session("seed-s01", "u-paid-acme-1", "2026-06-17T09:00:00Z", "2026-06-17T09:04:30Z", [
      ev("e1", "u-paid-acme-1", "$pageview", "2026-06-17T09:00:00Z", { $pathname: "/dashboard" }),
      ev("e2", "u-paid-acme-1", "$pageview", "2026-06-17T09:01:00Z", { $pathname: "/reports" }),
      ev("e3", "u-paid-acme-1", "button_click", "2026-06-17T09:02:00Z", { button: "Export CSV", $pathname: "/reports" }),
      ev("e4", "u-paid-acme-1", "export_failed", "2026-06-17T09:02:05Z", { error: "500 Internal Server Error", $pathname: "/reports" }),
      ev("e5", "u-paid-acme-1", "button_click", "2026-06-17T09:03:00Z", { button: "Export CSV", $pathname: "/reports" }),
      ev("e6", "u-paid-acme-1", "export_failed", "2026-06-17T09:03:05Z", { error: "500 Internal Server Error", $pathname: "/reports" }),
      ev("e7", "u-paid-acme-1", "$pageleave", "2026-06-17T09:04:30Z", { $pathname: "/reports" }),
    ]),
    narration:
      "The user opened the dashboard and navigated to the reports page. They clicked Export CSV twice, and both attempts failed with a 500 Internal Server Error. After the second failure they left the page without exporting.",
    findings: [
      bug(5, "CSV export fails with a 500 error", "User clicked Export CSV twice on the reports page and both attempts returned a 500 Internal Server Error before they abandoned."),
    ],
  },
  {
    session: session("seed-s02", "u-trial-beta-2", "2026-06-17T09:15:00Z", "2026-06-17T09:18:00Z", [
      ev("e1", "u-trial-beta-2", "$pageview", "2026-06-17T09:15:00Z", { $pathname: "/integrations" }),
      ev("e2", "u-trial-beta-2", "search", "2026-06-17T09:15:30Z", { query: "slack", $pathname: "/integrations" }),
      ev("e3", "u-trial-beta-2", "search", "2026-06-17T09:16:00Z", { query: "slack integration", $pathname: "/integrations" }),
      ev("e4", "u-trial-beta-2", "search", "2026-06-17T09:16:30Z", { query: "send to slack", $pathname: "/integrations" }),
      ev("e5", "u-trial-beta-2", "feature_request_click", "2026-06-17T09:17:00Z", { feature: "Request Slack integration", $pathname: "/integrations" }),
      ev("e6", "u-trial-beta-2", "$pageleave", "2026-06-17T09:18:00Z", { $pathname: "/integrations" }),
    ]),
    narration:
      "The user landed on the integrations page and searched three times for a Slack integration with increasingly specific queries. Finding no result, they clicked the Request Slack integration button. They then left the page, unable to connect Slack.",
    findings: [
      gap(3, "No Slack integration available", "User searched for Slack three different ways, found nothing, and clicked Request Slack integration before leaving."),
    ],
  },
  {
    session: session("seed-s03", "u-paid-zenith-3", "2026-06-17T09:30:00Z", "2026-06-17T09:35:00Z", [
      ev("e1", "u-paid-zenith-3", "$pageview", "2026-06-17T09:30:00Z", { $pathname: "/billing" }),
      ev("e2", "u-paid-zenith-3", "button_click", "2026-06-17T09:31:00Z", { button: "Update card", $pathname: "/billing" }),
      ev("e3", "u-paid-zenith-3", "form_submit", "2026-06-17T09:33:00Z", { form: "payment-method", $pathname: "/billing" }),
      ev("e4", "u-paid-zenith-3", "payment_method_updated", "2026-06-17T09:33:30Z", { $pathname: "/billing" }),
      ev("e5", "u-paid-zenith-3", "$pageleave", "2026-06-17T09:35:00Z", { $pathname: "/billing" }),
    ]),
    narration:
      "The user opened the billing page and clicked Update card. They submitted the payment-method form and the card was updated successfully. They left the page once the update completed.",
    findings: [],
  },
  {
    session: session("seed-s04", "u-trial-flux-4", "2026-06-17T10:00:00Z", "2026-06-17T10:06:00Z", [
      ev("e1", "u-trial-flux-4", "$pageview", "2026-06-17T10:00:00Z", { $pathname: "/onboarding/step-1" }),
      ev("e2", "u-trial-flux-4", "form_submit", "2026-06-17T10:01:00Z", { form: "company-info", $pathname: "/onboarding/step-1" }),
      ev("e3", "u-trial-flux-4", "$pageview", "2026-06-17T10:01:30Z", { $pathname: "/onboarding/step-2" }),
      ev("e4", "u-trial-flux-4", "button_click", "2026-06-17T10:02:00Z", { button: "Continue", $pathname: "/onboarding/step-2" }),
      ev("e5", "u-trial-flux-4", "validation_error", "2026-06-17T10:02:01Z", { field: "phone", error: "Phone number is required", $pathname: "/onboarding/step-2" }),
      ev("e6", "u-trial-flux-4", "button_click", "2026-06-17T10:03:00Z", { button: "Continue", $pathname: "/onboarding/step-2" }),
      ev("e7", "u-trial-flux-4", "validation_error", "2026-06-17T10:03:01Z", { field: "phone", error: "Phone number is required", $pathname: "/onboarding/step-2" }),
      ev("e8", "u-trial-flux-4", "rage_click", "2026-06-17T10:04:00Z", { $pathname: "/onboarding/step-2" }),
      ev("e9", "u-trial-flux-4", "$pageleave", "2026-06-17T10:06:00Z", { $pathname: "/onboarding/step-2" }),
    ]),
    narration:
      "The user moved from onboarding step one to step two and tried to continue. The continue action failed twice with a 'Phone number is required' validation error, and the user rage-clicked in frustration. They abandoned onboarding on step two without completing it.",
    findings: [
      bug(4, "Onboarding blocked by phone validation error", "User hit 'Phone number is required' twice on step 2, rage-clicked, and abandoned onboarding."),
      gap(2, "Required phone field is not clearly marked", "User repeatedly failed the phone validation, suggesting the required field was not obvious before submitting."),
    ],
  },
  {
    session: session("seed-s05", "u-paid-acme-1", "2026-06-17T10:30:00Z", "2026-06-17T10:33:30Z", [
      ev("e1", "u-paid-acme-1", "$pageview", "2026-06-17T10:30:00Z", { $pathname: "/reports" }),
      ev("e2", "u-paid-acme-1", "button_click", "2026-06-17T10:31:00Z", { button: "Export CSV", $pathname: "/reports" }),
      ev("e3", "u-paid-acme-1", "export_failed", "2026-06-17T10:31:05Z", { error: "500 Internal Server Error", $pathname: "/reports" }),
      ev("e4", "u-paid-acme-1", "support_chat_open", "2026-06-17T10:32:00Z", { $pathname: "/reports" }),
      ev("e5", "u-paid-acme-1", "support_message_sent", "2026-06-17T10:33:00Z", { message: "Export still broken!", $pathname: "/reports" }),
      ev("e6", "u-paid-acme-1", "$pageleave", "2026-06-17T10:33:30Z", { $pathname: "/reports" }),
    ]),
    narration:
      "The user returned to the reports page and clicked Export CSV, which failed again with a 500 Internal Server Error. They opened support chat and sent a message saying the export was still broken. They left the page without a working export.",
    findings: [
      bug(5, "CSV export still failing (500); user escalated to support", "Export failed with a 500 error again and the user opened support chat with the message 'Export still broken!'"),
    ],
  },
  {
    session: session("seed-s06", "u-paid-orbit-6", "2026-06-17T11:00:00Z", "2026-06-17T11:03:20Z", [
      ev("e1", "u-paid-orbit-6", "$pageview", "2026-06-17T11:00:00Z", { $pathname: "/reports" }),
      ev("e2", "u-paid-orbit-6", "filter_apply", "2026-06-17T11:00:40Z", { filter: "date=last_30_days", $pathname: "/reports" }),
      ev("e3", "u-paid-orbit-6", "report_generated", "2026-06-17T11:01:10Z", { $pathname: "/reports" }),
      ev("e4", "u-paid-orbit-6", "button_click", "2026-06-17T11:02:00Z", { button: "Export CSV", $pathname: "/reports" }),
      ev("e5", "u-paid-orbit-6", "export_succeeded", "2026-06-17T11:02:04Z", { $pathname: "/reports" }),
      ev("e6", "u-paid-orbit-6", "$pageleave", "2026-06-17T11:03:20Z", { $pathname: "/reports" }),
    ]),
    narration:
      "The user opened the reports page, applied a last-30-days date filter, and generated a report. They clicked Export CSV and the download completed successfully. They left the page after exporting.",
    findings: [],
  },
  {
    session: session("seed-s07", "u-trial-nova-7", "2026-06-17T11:20:00Z", "2026-06-17T11:23:10Z", [
      ev("e1", "u-trial-nova-7", "$pageview", "2026-06-17T11:20:00Z", { $pathname: "/settings/team" }),
      ev("e2", "u-trial-nova-7", "button_click", "2026-06-17T11:20:40Z", { button: "Invite member", $pathname: "/settings/team" }),
      ev("e3", "u-trial-nova-7", "form_submit", "2026-06-17T11:21:10Z", { form: "invite", $pathname: "/settings/team" }),
      ev("e4", "u-trial-nova-7", "invite_failed", "2026-06-17T11:21:12Z", { error: "Seat limit reached", $pathname: "/settings/team" }),
      ev("e5", "u-trial-nova-7", "$pageleave", "2026-06-17T11:23:10Z", { $pathname: "/settings/team" }),
    ]),
    narration:
      "The user opened team settings and submitted an invite for a new member. The invite failed with a 'Seat limit reached' error and no upgrade option was offered. They left the page unable to add a teammate.",
    findings: [
      gap(3, "No upgrade path shown when the seat limit is reached", "Invite failed with 'Seat limit reached' and the user was offered no way to add seats or upgrade before leaving."),
    ],
  },
  {
    session: session("seed-s08", "u-trial-echo-8", "2026-06-17T11:40:00Z", "2026-06-17T11:43:30Z", [
      ev("e1", "u-trial-echo-8", "$pageview", "2026-06-17T11:40:00Z", { $pathname: "/help" }),
      ev("e2", "u-trial-echo-8", "search", "2026-06-17T11:40:30Z", { query: "bulk delete", $pathname: "/help" }),
      ev("e3", "u-trial-echo-8", "search_no_results", "2026-06-17T11:40:32Z", { query: "bulk delete", $pathname: "/help" }),
      ev("e4", "u-trial-echo-8", "search", "2026-06-17T11:41:10Z", { query: "delete many records", $pathname: "/help" }),
      ev("e5", "u-trial-echo-8", "search_no_results", "2026-06-17T11:41:12Z", { query: "delete many records", $pathname: "/help" }),
      ev("e6", "u-trial-echo-8", "$pageleave", "2026-06-17T11:43:30Z", { $pathname: "/help" }),
    ]),
    narration:
      "The user opened the help center and searched for how to bulk delete records using two different phrasings. Both searches returned no results and they opened no articles. They left the help center without finding an answer.",
    findings: [
      gap(2, "Help center search returns no results for common queries", "User searched 'bulk delete' and 'delete many records' and both returned no results."),
    ],
  },
  {
    session: session("seed-s09", "u-paid-vertex-9", "2026-06-17T12:00:00Z", "2026-06-17T12:02:40Z", [
      ev("e1", "u-paid-vertex-9", "$pageview", "2026-06-17T12:00:00Z", { $pathname: "/dashboard" }),
      ev("e2", "u-paid-vertex-9", "page_refresh", "2026-06-17T12:00:40Z", { $pathname: "/dashboard" }),
      ev("e3", "u-paid-vertex-9", "page_refresh", "2026-06-17T12:01:20Z", { $pathname: "/dashboard" }),
      ev("e4", "u-paid-vertex-9", "page_refresh", "2026-06-17T12:02:00Z", { $pathname: "/dashboard" }),
      ev("e5", "u-paid-vertex-9", "$pageleave", "2026-06-17T12:02:40Z", { $pathname: "/dashboard" }),
    ]),
    narration:
      "The user opened the dashboard, which appeared to load slowly. They refreshed the page three times over two minutes while the widgets stayed blank. They left the dashboard without the data ever loading.",
    findings: [
      bug(4, "Dashboard widgets fail to load", "User refreshed the dashboard three times in two minutes with widgets staying blank, then left."),
    ],
  },
  {
    session: session("seed-s10", "u-trial-flux-4", "2026-06-17T12:20:00Z", "2026-06-17T12:24:00Z", [
      ev("e1", "u-trial-flux-4", "$pageview", "2026-06-17T12:20:00Z", { $pathname: "/onboarding/step-1" }),
      ev("e2", "u-trial-flux-4", "form_submit", "2026-06-17T12:20:40Z", { form: "company-info", $pathname: "/onboarding/step-1" }),
      ev("e3", "u-trial-flux-4", "$pageview", "2026-06-17T12:21:10Z", { $pathname: "/onboarding/step-2" }),
      ev("e4", "u-trial-flux-4", "form_submit", "2026-06-17T12:22:00Z", { form: "contact-info", $pathname: "/onboarding/step-2" }),
      ev("e5", "u-trial-flux-4", "$pageview", "2026-06-17T12:22:40Z", { $pathname: "/onboarding/step-3" }),
      ev("e6", "u-trial-flux-4", "form_submit", "2026-06-17T12:23:10Z", { form: "preferences", $pathname: "/onboarding/step-3" }),
      ev("e7", "u-trial-flux-4", "onboarding_complete", "2026-06-17T12:23:30Z", { $pathname: "/dashboard" }),
      ev("e8", "u-trial-flux-4", "report_viewed", "2026-06-17T12:23:50Z", { $pathname: "/dashboard" }),
    ]),
    narration:
      "The user moved through all three onboarding steps, submitting each form without errors. They reached the dashboard and viewed their first report. They continued into the app after completing onboarding.",
    findings: [],
  },
  {
    session: session("seed-s11", "u-paid-quasar-11", "2026-06-17T13:00:00Z", "2026-06-17T13:03:00Z", [
      ev("e1", "u-paid-quasar-11", "$pageview", "2026-06-17T13:00:00Z", { $pathname: "/settings/api-keys" }),
      ev("e2", "u-paid-quasar-11", "button_click", "2026-06-17T13:00:30Z", { button: "Generate key", $pathname: "/settings/api-keys" }),
      ev("e3", "u-paid-quasar-11", "button_click", "2026-06-17T13:01:10Z", { button: "Generate key", $pathname: "/settings/api-keys" }),
      ev("e4", "u-paid-quasar-11", "button_click", "2026-06-17T13:01:50Z", { button: "Generate key", $pathname: "/settings/api-keys" }),
      ev("e5", "u-paid-quasar-11", "$pageleave", "2026-06-17T13:03:00Z", { $pathname: "/settings/api-keys" }),
    ]),
    narration:
      "The user opened the API keys page and clicked Generate key. Nothing appeared after the click, and they pressed Generate key two more times with no result. They left the page without an API key.",
    findings: [
      bug(4, "Generate API key button is unresponsive", "User clicked Generate key three times with no key produced and then left the page."),
    ],
  },
  {
    session: session("seed-s12", "u-paid-lumen-12", "2026-06-17T13:20:00Z", "2026-06-17T13:22:30Z", [
      ev("e1", "u-paid-lumen-12", "$pageview", "2026-06-17T13:20:00Z", { $pathname: "/settings/notifications" }),
      ev("e2", "u-paid-lumen-12", "toggle", "2026-06-17T13:20:40Z", { setting: "email_alerts", value: "off", $pathname: "/settings/notifications" }),
      ev("e3", "u-paid-lumen-12", "button_click", "2026-06-17T13:21:00Z", { button: "Save", $pathname: "/settings/notifications" }),
      ev("e4", "u-paid-lumen-12", "save_failed", "2026-06-17T13:21:03Z", { error: "Could not save settings", $pathname: "/settings/notifications" }),
      ev("e5", "u-paid-lumen-12", "$pageleave", "2026-06-17T13:22:30Z", { $pathname: "/settings/notifications" }),
    ]),
    narration:
      "The user opened notification settings and toggled email alerts off. They clicked Save and the change failed with a 'Could not save settings' error. They left settings without the change being saved.",
    findings: [
      bug(3, "Notification settings fail to save", "Toggling email alerts off and clicking Save returned a 'Could not save settings' error."),
    ],
  },
  {
    session: session("seed-s13", "u-trial-sol-13", "2026-06-17T13:40:00Z", "2026-06-17T13:44:00Z", [
      ev("e1", "u-trial-sol-13", "$pageview", "2026-06-17T13:40:00Z", { $pathname: "/settings/account" }),
      ev("e2", "u-trial-sol-13", "$pageview", "2026-06-17T13:41:00Z", { $pathname: "/settings/security" }),
      ev("e3", "u-trial-sol-13", "$pageview", "2026-06-17T13:42:00Z", { $pathname: "/settings/billing" }),
      ev("e4", "u-trial-sol-13", "search", "2026-06-17T13:42:40Z", { query: "delete account", $pathname: "/settings/billing" }),
      ev("e5", "u-trial-sol-13", "$pageleave", "2026-06-17T13:44:00Z", { $pathname: "/settings/billing" }),
    ]),
    narration:
      "The user visited the account, security, and billing pages in turn, apparently looking for a way to delete their account. They searched for 'delete account' but found no delete option on any page. They left settings without locating the control.",
    findings: [
      gap(3, "Account deletion control is hard to find", "User checked account, security, and billing pages and searched 'delete account' without finding a delete option."),
    ],
  },
  {
    session: session("seed-s14", "u-trial-pixel-14", "2026-06-17T14:00:00Z", "2026-06-17T14:03:40Z", [
      ev("e1", "u-trial-pixel-14", "$pageview", "2026-06-17T14:00:00Z", { $pathname: "/upgrade" }),
      ev("e2", "u-trial-pixel-14", "plan_select", "2026-06-17T14:00:40Z", { plan: "pro", $pathname: "/upgrade" }),
      ev("e3", "u-trial-pixel-14", "form_submit", "2026-06-17T14:01:20Z", { form: "payment", $pathname: "/upgrade" }),
      ev("e4", "u-trial-pixel-14", "payment_failed", "2026-06-17T14:01:23Z", { error: "Card verification failed", $pathname: "/upgrade" }),
      ev("e5", "u-trial-pixel-14", "form_submit", "2026-06-17T14:02:10Z", { form: "payment", $pathname: "/upgrade" }),
      ev("e6", "u-trial-pixel-14", "payment_failed", "2026-06-17T14:02:13Z", { error: "Card verification failed", $pathname: "/upgrade" }),
      ev("e7", "u-trial-pixel-14", "$pageleave", "2026-06-17T14:03:40Z", { $pathname: "/upgrade" }),
    ]),
    narration:
      "The user opened the upgrade page and selected the Pro plan. On the payment form the card was declined with a 'Card verification failed' error, and they retried once with the same result. They left the upgrade flow without completing the purchase.",
    findings: [
      bug(4, "Upgrade payment fails with a card verification error", "User selected the Pro plan and the payment form returned 'Card verification failed' on two attempts before they abandoned the upgrade."),
    ],
  },
  {
    session: session("seed-s15", "u-paid-orbit-6", "2026-06-17T14:20:00Z", "2026-06-17T14:22:30Z", [
      ev("e1", "u-paid-orbit-6", "$pageview", "2026-06-17T14:20:00Z", { $pathname: "/reports" }),
      ev("e2", "u-paid-orbit-6", "filter_apply", "2026-06-17T14:20:40Z", { filter: "status=active", $pathname: "/reports" }),
      ev("e3", "u-paid-orbit-6", "button_click", "2026-06-17T14:21:20Z", { button: "Export CSV", $pathname: "/reports" }),
      ev("e4", "u-paid-orbit-6", "export_succeeded", "2026-06-17T14:21:24Z", { $pathname: "/reports" }),
      ev("e5", "u-paid-orbit-6", "$pageleave", "2026-06-17T14:22:30Z", { $pathname: "/reports" }),
    ]),
    narration:
      "The user opened the reports page and applied a status filter to narrow the results. They exported the filtered report to CSV and the download succeeded. They left the page after a successful export.",
    findings: [],
  },
  {
    session: session("seed-s16", "u-paid-atlas-16", "2026-06-17T14:40:00Z", "2026-06-17T14:42:20Z", [
      ev("e1", "u-paid-atlas-16", "$pageview", "2026-06-17T14:40:00Z", { $pathname: "/dashboard", $browser: "Mobile Safari" }),
      ev("e2", "u-paid-atlas-16", "button_click", "2026-06-17T14:40:30Z", { button: "Menu", $pathname: "/dashboard", $browser: "Mobile Safari" }),
      ev("e3", "u-paid-atlas-16", "button_click", "2026-06-17T14:40:50Z", { button: "Menu", $pathname: "/dashboard", $browser: "Mobile Safari" }),
      ev("e4", "u-paid-atlas-16", "button_click", "2026-06-17T14:41:10Z", { button: "Menu", $pathname: "/dashboard", $browser: "Mobile Safari" }),
      ev("e5", "u-paid-atlas-16", "rage_click", "2026-06-17T14:41:30Z", { $pathname: "/dashboard", $browser: "Mobile Safari" }),
      ev("e6", "u-paid-atlas-16", "$pageleave", "2026-06-17T14:42:20Z", { $pathname: "/dashboard" }),
    ]),
    narration:
      "The user opened the dashboard on Mobile Safari and tapped the Menu button, which never opened. They tapped Menu two more times and then rage-clicked with no response. They left the app without reaching any other page.",
    findings: [
      bug(3, "Navigation menu does not open on mobile", "A Mobile Safari user tapped the Menu button three times and rage-clicked without the menu ever opening."),
    ],
  },
  {
    session: session("seed-s17", "u-paid-helix-17", "2026-06-17T15:00:00Z", "2026-06-17T15:04:10Z", [
      ev("e1", "u-paid-helix-17", "$pageview", "2026-06-17T15:00:00Z", { $pathname: "/settings/webhooks" }),
      ev("e2", "u-paid-helix-17", "form_submit", "2026-06-17T15:01:00Z", { form: "webhook-config", $pathname: "/settings/webhooks" }),
      ev("e3", "u-paid-helix-17", "webhook_saved", "2026-06-17T15:01:02Z", { $pathname: "/settings/webhooks" }),
      ev("e4", "u-paid-helix-17", "button_click", "2026-06-17T15:01:30Z", { button: "Send test event", $pathname: "/settings/webhooks" }),
      ev("e5", "u-paid-helix-17", "webhook_test_failed", "2026-06-17T15:01:42Z", { error: "Timeout after 10s", $pathname: "/settings/webhooks" }),
      ev("e6", "u-paid-helix-17", "button_click", "2026-06-17T15:02:40Z", { button: "Send test event", $pathname: "/settings/webhooks" }),
      ev("e7", "u-paid-helix-17", "webhook_test_failed", "2026-06-17T15:02:52Z", { error: "Timeout after 10s", $pathname: "/settings/webhooks" }),
      ev("e8", "u-paid-helix-17", "$pageleave", "2026-06-17T15:04:10Z", { $pathname: "/settings/webhooks" }),
    ]),
    narration:
      "The user opened webhook settings and saved a new webhook endpoint. They clicked Send test event twice, and both deliveries failed with a timeout after ten seconds. They left the page without a working webhook.",
    findings: [
      bug(4, "Webhook test deliveries time out", "Both Send test event attempts on a newly saved endpoint failed with a ten-second timeout."),
    ],
  },
  {
    session: session("seed-s18", "u-trial-cove-18", "2026-06-17T15:20:00Z", "2026-06-17T15:23:00Z", [
      ev("e1", "u-trial-cove-18", "$pageview", "2026-06-17T15:20:00Z", { $pathname: "/integrations" }),
      ev("e2", "u-trial-cove-18", "integration_connect_start", "2026-06-17T15:20:40Z", { feature: "Google Sheets", $pathname: "/integrations" }),
      ev("e3", "u-trial-cove-18", "oauth_completed", "2026-06-17T15:21:30Z", { feature: "Google Sheets", $pathname: "/integrations" }),
      ev("e4", "u-trial-cove-18", "integration_connected", "2026-06-17T15:21:35Z", { feature: "Google Sheets", $pathname: "/integrations" }),
      ev("e5", "u-trial-cove-18", "$pageleave", "2026-06-17T15:23:00Z", { $pathname: "/integrations" }),
    ]),
    narration:
      "The user opened the integrations page and started connecting Google Sheets. They completed the OAuth authorization and the integration was marked connected. They left the page after the successful setup.",
    findings: [],
  },
  {
    session: session("seed-s19", "u-paid-forge-19", "2026-06-17T15:40:00Z", "2026-06-17T15:43:30Z", [
      ev("e1", "u-paid-forge-19", "$pageview", "2026-06-17T15:40:00Z", { $pathname: "/settings/security" }),
      ev("e2", "u-paid-forge-19", "search", "2026-06-17T15:40:30Z", { query: "saml", $pathname: "/settings/security" }),
      ev("e3", "u-paid-forge-19", "search_no_results", "2026-06-17T15:40:32Z", { query: "saml", $pathname: "/settings/security" }),
      ev("e4", "u-paid-forge-19", "search", "2026-06-17T15:41:10Z", { query: "single sign-on", $pathname: "/settings/security" }),
      ev("e5", "u-paid-forge-19", "search_no_results", "2026-06-17T15:41:12Z", { query: "single sign-on", $pathname: "/settings/security" }),
      ev("e6", "u-paid-forge-19", "feature_request_click", "2026-06-17T15:42:00Z", { feature: "Request SSO/SAML", $pathname: "/settings/security" }),
      ev("e7", "u-paid-forge-19", "$pageleave", "2026-06-17T15:43:30Z", { $pathname: "/settings/security" }),
    ]),
    narration:
      "The user opened security settings and searched for saml and then single sign-on, with both searches returning no results. They clicked Request SSO/SAML. They left the page unable to configure single sign-on for their team.",
    findings: [
      gap(4, "No SSO / SAML login available", "User searched security settings for saml and single sign-on, got no results, and filed a request for SSO/SAML support."),
    ],
  },
  {
    session: session("seed-s20", "u-paid-ridge-20", "2026-06-17T16:00:00Z", "2026-06-17T16:06:30Z", [
      ev("e1", "u-paid-ridge-20", "$pageview", "2026-06-17T16:00:00Z", { $pathname: "/reports" }),
      ev("e2", "u-paid-ridge-20", "filter_apply", "2026-06-17T16:00:30Z", { filter: "date=last_90_days", $pathname: "/reports" }),
      ev("e3", "u-paid-ridge-20", "page_refresh", "2026-06-17T16:03:00Z", { $pathname: "/reports" }),
      ev("e4", "u-paid-ridge-20", "filter_apply", "2026-06-17T16:03:40Z", { filter: "date=last_90_days", $pathname: "/reports" }),
      ev("e5", "u-paid-ridge-20", "report_generated", "2026-06-17T16:06:00Z", { $pathname: "/reports" }),
      ev("e6", "u-paid-ridge-20", "$pageleave", "2026-06-17T16:06:30Z", { $pathname: "/reports" }),
    ]),
    narration:
      "The user opened the reports page and applied a last-90-days date filter, but the report kept loading without completing. They refreshed the page, which cleared their filter, and had to reapply it before the report finally generated after a long wait. They left the page as soon as the report loaded.",
    findings: [
      bug(3, "Report generation is slow for large date ranges", "A last-90-days report kept the user waiting so long they refreshed, and it still took minutes end to end."),
      bug(2, "Filter selection resets on page refresh", "Refreshing the reports page cleared the user's applied date filter and forced them to reapply it."),
    ],
  },
  {
    session: session("seed-s21", "u-trial-mesa-21", "2026-06-17T16:20:00Z", "2026-06-17T16:22:40Z", [
      ev("e1", "u-trial-mesa-21", "$pageview", "2026-06-17T16:20:00Z", { $pathname: "/reports" }),
      ev("e2", "u-trial-mesa-21", "search", "2026-06-17T16:20:30Z", { query: "schedule report", $pathname: "/reports" }),
      ev("e3", "u-trial-mesa-21", "search_no_results", "2026-06-17T16:20:32Z", { query: "schedule report", $pathname: "/reports" }),
      ev("e4", "u-trial-mesa-21", "feature_request_click", "2026-06-17T16:21:20Z", { feature: "Request scheduled reports", $pathname: "/reports" }),
      ev("e5", "u-trial-mesa-21", "$pageleave", "2026-06-17T16:22:40Z", { $pathname: "/reports" }),
    ]),
    narration:
      "The user opened the reports page and searched for a way to schedule a report. The search returned no results and they clicked Request scheduled reports. They left the page without setting up a schedule.",
    findings: [
      gap(2, "No way to schedule recurring reports", "User searched for report scheduling, found nothing, and clicked Request scheduled reports before leaving."),
    ],
  },
  {
    session: session("seed-s22", "u-paid-delta-22", "2026-06-17T16:40:00Z", "2026-06-17T16:45:20Z", [
      ev("e1", "u-paid-delta-22", "$pageview", "2026-06-17T16:40:00Z", { $pathname: "/login" }),
      ev("e2", "u-paid-delta-22", "button_click", "2026-06-17T16:40:20Z", { button: "Forgot password", $pathname: "/login" }),
      ev("e3", "u-paid-delta-22", "form_submit", "2026-06-17T16:40:50Z", { form: "password-reset", $pathname: "/login" }),
      ev("e4", "u-paid-delta-22", "form_submit", "2026-06-17T16:43:00Z", { form: "password-reset", $pathname: "/login" }),
      ev("e5", "u-paid-delta-22", "support_chat_open", "2026-06-17T16:44:00Z", { $pathname: "/login" }),
      ev("e6", "u-paid-delta-22", "support_message_sent", "2026-06-17T16:44:40Z", { message: "No reset email received", $pathname: "/login" }),
      ev("e7", "u-paid-delta-22", "$pageleave", "2026-06-17T16:45:20Z", { $pathname: "/login" }),
    ]),
    narration:
      "The user clicked Forgot password on the login page and submitted the reset form. Receiving nothing, they submitted the form again and then opened support chat to say no reset email had arrived. They left without regaining access to their account.",
    findings: [
      bug(4, "Password reset email never arrives", "User submitted the reset form twice, received no email, and told support no reset email had arrived."),
    ],
  },
  {
    session: session("seed-s23", "u-paid-lumen-12", "2026-06-17T17:00:00Z", "2026-06-17T17:02:10Z", [
      ev("e1", "u-paid-lumen-12", "$pageview", "2026-06-17T17:00:00Z", { $pathname: "/settings/notifications" }),
      ev("e2", "u-paid-lumen-12", "toggle", "2026-06-17T17:00:40Z", { setting: "weekly_digest", value: "on", $pathname: "/settings/notifications" }),
      ev("e3", "u-paid-lumen-12", "button_click", "2026-06-17T17:01:00Z", { button: "Save", $pathname: "/settings/notifications" }),
      ev("e4", "u-paid-lumen-12", "save_succeeded", "2026-06-17T17:01:02Z", { $pathname: "/settings/notifications" }),
      ev("e5", "u-paid-lumen-12", "$pageleave", "2026-06-17T17:02:10Z", { $pathname: "/settings/notifications" }),
    ]),
    narration:
      "The user opened notification settings and toggled the weekly digest on. They clicked Save and the change was saved successfully. They left settings with the digest enabled.",
    findings: [],
  },
  {
    session: session("seed-s24", "u-trial-quill-24", "2026-06-17T17:20:00Z", "2026-06-17T17:25:00Z", [
      ev("e1", "u-trial-quill-24", "$pageview", "2026-06-17T17:20:00Z", { $pathname: "/records" }),
      ev("e2", "u-trial-quill-24", "search", "2026-06-17T17:20:30Z", { query: "import csv", $pathname: "/records" }),
      ev("e3", "u-trial-quill-24", "search_no_results", "2026-06-17T17:20:32Z", { query: "import csv", $pathname: "/records" }),
      ev("e4", "u-trial-quill-24", "button_click", "2026-06-17T17:21:10Z", { button: "Add record", $pathname: "/records" }),
      ev("e5", "u-trial-quill-24", "record_created", "2026-06-17T17:21:50Z", { $pathname: "/records" }),
      ev("e6", "u-trial-quill-24", "button_click", "2026-06-17T17:22:20Z", { button: "Add record", $pathname: "/records" }),
      ev("e7", "u-trial-quill-24", "record_created", "2026-06-17T17:23:00Z", { $pathname: "/records" }),
      ev("e8", "u-trial-quill-24", "button_click", "2026-06-17T17:23:30Z", { button: "Add record", $pathname: "/records" }),
      ev("e9", "u-trial-quill-24", "record_created", "2026-06-17T17:24:10Z", { $pathname: "/records" }),
      ev("e10", "u-trial-quill-24", "$pageleave", "2026-06-17T17:25:00Z", { $pathname: "/records" }),
    ]),
    narration:
      "The user opened the records page and searched for import csv, which returned no results. They then created three records one at a time by hand. They left the page after finishing the manual entry.",
    findings: [
      gap(3, "No CSV import for bulk record creation", "User searched for import csv, found nothing, and manually created three records one at a time."),
    ],
  },
  {
    session: session("seed-s25", "u-trial-shore-25", "2026-06-17T17:40:00Z", "2026-06-17T17:42:30Z", [
      ev("e1", "u-trial-shore-25", "$pageview", "2026-06-17T17:40:00Z", { $pathname: "/shared/report-8f3a2c" }),
      ev("e2", "u-trial-shore-25", "page_not_found", "2026-06-17T17:40:01Z", { error: "404 Not Found", $pathname: "/shared/report-8f3a2c" }),
      ev("e3", "u-trial-shore-25", "page_refresh", "2026-06-17T17:41:00Z", { $pathname: "/shared/report-8f3a2c" }),
      ev("e4", "u-trial-shore-25", "page_not_found", "2026-06-17T17:41:01Z", { error: "404 Not Found", $pathname: "/shared/report-8f3a2c" }),
      ev("e5", "u-trial-shore-25", "page_refresh", "2026-06-17T17:42:00Z", { $pathname: "/shared/report-8f3a2c" }),
      ev("e6", "u-trial-shore-25", "page_not_found", "2026-06-17T17:42:01Z", { error: "404 Not Found", $pathname: "/shared/report-8f3a2c" }),
      ev("e7", "u-trial-shore-25", "$pageleave", "2026-06-17T17:42:30Z", { $pathname: "/shared/report-8f3a2c" }),
    ]),
    narration:
      "The user opened a shared report link and received a 404 Not Found error. They refreshed twice and hit the same 404 each time. They left without ever seeing the shared report.",
    findings: [
      bug(4, "Shared report links return a 404", "A shared report URL returned 404 Not Found on load and after two refreshes."),
    ],
  },
];

// ---------------------------------------------------------------------------
// Prioritizer seeds: batches of deduplicated findings (with ids + occurrences)
// ranked by impact * frequency * effort. Reasons cite the numbers.
// ---------------------------------------------------------------------------
interface PriorInput {
  id: string;
  kind: "bug" | "gap";
  severity: number;
  occurrences: number;
  title: string;
  evidence: string;
}
interface PriorBatch {
  findings: PriorInput[];
  ranked: { id: string; rank: number; reason: string }[];
}

const priorBatches: PriorBatch[] = [
  {
    findings: [
      { id: "f-a1", kind: "bug", severity: 5, occurrences: 14, title: "CSV export fails with a 500 error", evidence: "14 users hit a 500 on Export CSV; several escalated to support." },
      { id: "f-a2", kind: "bug", severity: 4, occurrences: 7, title: "Onboarding blocked by phone validation error", evidence: "7 trial users abandoned onboarding at the phone step." },
      { id: "f-a3", kind: "gap", severity: 3, occurrences: 4, title: "No Slack integration available", evidence: "4 users searched for Slack and requested it." },
    ],
    ranked: [
      { id: "f-a1", rank: 1, reason: "Severity 5 and the highest frequency (14 users), breaking a core export flow for paying accounts. Fix first." },
      { id: "f-a2", rank: 2, reason: "Severity 4 blocking activation for 7 trial users; directly costs conversions, so it ranks above the lower-severity gap." },
      { id: "f-a3", rank: 3, reason: "A severity-3 feature gap with 4 requests; real demand but not blocking existing users, so it trails the two bugs." },
    ],
  },
  {
    findings: [
      { id: "f-b1", kind: "bug", severity: 4, occurrences: 9, title: "Dashboard widgets fail to load", evidence: "9 users refreshed repeatedly with blank widgets." },
      { id: "f-b2", kind: "bug", severity: 3, occurrences: 5, title: "Notification settings fail to save", evidence: "5 users saw 'Could not save settings'." },
      { id: "f-b3", kind: "gap", severity: 2, occurrences: 3, title: "Help center search returns no results", evidence: "3 users got no results for common queries." },
    ],
    ranked: [
      { id: "f-b1", rank: 1, reason: "Severity 4 and 9 occurrences on the primary landing surface; a broken dashboard undermines daily use. Highest impact here." },
      { id: "f-b2", rank: 2, reason: "Severity 3 affecting 5 users; a real save failure but scoped to one settings page, so below the dashboard bug." },
      { id: "f-b3", rank: 3, reason: "Severity 2 with 3 occurrences; a discoverability gap that is annoying but non-blocking, so it ranks last." },
    ],
  },
  {
    findings: [
      { id: "f-c1", kind: "bug", severity: 3, occurrences: 22, title: "Generate API key button is unresponsive", evidence: "22 developers clicked Generate with no key produced." },
      { id: "f-c2", kind: "bug", severity: 5, occurrences: 2, title: "Upgrade payment fails with a card verification error", evidence: "2 users could not complete a paid upgrade." },
    ],
    ranked: [
      { id: "f-c2", rank: 1, reason: "Severity 5 and it blocks revenue directly; even at only 2 occurrences a broken checkout outranks a mid-severity bug because each miss is a lost paying customer." },
      { id: "f-c1", rank: 2, reason: "Severity 3 but very high frequency (22 developers); important and worth batching next, yet not revenue-blocking like the payment failure." },
    ],
  },
  {
    findings: [
      { id: "f-d1", kind: "gap", severity: 3, occurrences: 6, title: "No upgrade path shown when the seat limit is reached", evidence: "6 admins hit the seat limit with no way to add seats." },
      { id: "f-d2", kind: "gap", severity: 3, occurrences: 5, title: "Account deletion control is hard to find", evidence: "5 users searched settings for a delete option." },
      { id: "f-d3", kind: "bug", severity: 2, occurrences: 8, title: "Filter selection resets on page refresh", evidence: "8 users lost their filters after a refresh." },
    ],
    ranked: [
      { id: "f-d1", rank: 1, reason: "Severity-3 gap that blocks expansion revenue: 6 admins wanted more seats and had no path to buy them. Highest business upside." },
      { id: "f-d3", rank: 2, reason: "Only severity 2 but the highest frequency (8 users) and a cheap bug fix; good effort-to-impact ratio, so it edges out the deletion gap." },
      { id: "f-d2", rank: 3, reason: "Severity 3 with 5 occurrences; a compliance-adjacent gap worth fixing but neither revenue-blocking nor high-frequency, so it ranks last." },
    ],
  },
  {
    findings: [
      { id: "f-e1", kind: "bug", severity: 5, occurrences: 3, title: "Data export produces corrupted CSV for large reports", evidence: "3 users reported unreadable files over 50k rows." },
      { id: "f-e2", kind: "bug", severity: 4, occurrences: 11, title: "Report date filter ignores the selected timezone", evidence: "11 users saw off-by-hours totals." },
      { id: "f-e3", kind: "gap", severity: 2, occurrences: 9, title: "No way to schedule recurring reports", evidence: "9 users asked for scheduled exports." },
    ],
    ranked: [
      { id: "f-e2", rank: 1, reason: "Severity 4 and 11 occurrences, silently corrupting numbers users trust; wrong data at scale is the biggest risk here." },
      { id: "f-e1", rank: 2, reason: "Severity 5 but rare (3 users, large reports only); serious yet narrow, so it sits just under the widespread timezone bug." },
      { id: "f-e3", rank: 3, reason: "Severity 2 feature gap with steady demand (9 requests); valuable roadmap item but not a correctness or availability issue." },
    ],
  },
  {
    findings: [
      { id: "f-f1", kind: "bug", severity: 4, occurrences: 4, title: "Login redirects to a blank page on Safari", evidence: "4 Safari users could not reach the app after login." },
      { id: "f-f2", kind: "gap", severity: 3, occurrences: 7, title: "No bulk-delete action for records", evidence: "7 users searched for bulk delete." },
    ],
    ranked: [
      { id: "f-f1", rank: 1, reason: "Severity 4 and it blocks access entirely for affected Safari users; an availability bug outranks a feature gap even at lower frequency." },
      { id: "f-f2", rank: 2, reason: "Severity 3 with 7 requests; strong demand for bulk delete but users can still work around it, so it ranks below the login blocker." },
    ],
  },
  {
    findings: [
      { id: "f-g1", kind: "bug", severity: 5, occurrences: 6, title: "Session tokens are not invalidated on logout", evidence: "6 users stayed logged in on shared devices after logging out." },
      { id: "f-g2", kind: "bug", severity: 3, occurrences: 15, title: "Search is slow (>5s) on large workspaces", evidence: "15 users on big workspaces waited over five seconds per search." },
      { id: "f-g3", kind: "gap", severity: 2, occurrences: 4, title: "No dark mode", evidence: "4 users asked for a dark theme." },
    ],
    ranked: [
      { id: "f-g1", rank: 1, reason: "Severity 5 security defect: tokens surviving logout is an account-takeover risk on shared devices. Security bugs lead regardless of frequency." },
      { id: "f-g2", rank: 2, reason: "Severity 3 but very high frequency (15 users) and it degrades daily use; strong effort-to-impact case, so second." },
      { id: "f-g3", rank: 3, reason: "Severity 2 cosmetic preference with 4 requests; nice-to-have that ranks last against a security bug and a performance issue." },
    ],
  },
  {
    findings: [
      { id: "f-h1", kind: "gap", severity: 4, occurrences: 10, title: "No SSO / SAML login for enterprise", evidence: "10 enterprise evaluators required SSO before rollout." },
      { id: "f-h2", kind: "bug", severity: 3, occurrences: 5, title: "Invite emails land in spam", evidence: "5 admins reported teammates never received invites." },
    ],
    ranked: [
      { id: "f-h1", rank: 1, reason: "Severity-4 gap that gates enterprise deals: 10 evaluators named SSO a blocker, so the revenue upside outweighs the mid-severity delivery bug." },
      { id: "f-h2", rank: 2, reason: "Severity 3 affecting 5 admins; a real onboarding friction with an easy workaround (resend), so it trails the enterprise blocker." },
    ],
  },
  {
    findings: [
      { id: "f-i1", kind: "bug", severity: 4, occurrences: 8, title: "Webhook deliveries are silently dropped", evidence: "8 integrations missed events with no error surfaced." },
      { id: "f-i2", kind: "bug", severity: 4, occurrences: 3, title: "Timezone is wrong in email digests", evidence: "3 users saw digests stamped in the wrong timezone." },
      { id: "f-i3", kind: "bug", severity: 2, occurrences: 20, title: "Tooltip text overflows on mobile", evidence: "20 mobile users saw clipped tooltip text." },
    ],
    ranked: [
      { id: "f-i1", rank: 1, reason: "Severity 4 and 8 occurrences with silent data loss; undetected dropped webhooks erode trust in every downstream integration. Highest impact." },
      { id: "f-i2", rank: 2, reason: "Also severity 4 but only 3 occurrences and cosmetic-adjacent (wrong label, not lost data), so it sits below the webhook data loss." },
      { id: "f-i3", rank: 3, reason: "Highest frequency (20) but only severity 2 and purely visual; a cheap polish item that does not block anything, so it ranks last." },
    ],
  },
  {
    findings: [
      { id: "f-j1", kind: "gap", severity: 3, occurrences: 12, title: "No CSV import for bulk record creation", evidence: "12 users wanted to import records instead of adding them one by one." },
      { id: "f-j2", kind: "gap", severity: 2, occurrences: 6, title: "No keyboard shortcuts", evidence: "6 power users asked for shortcuts." },
    ],
    ranked: [
      { id: "f-j1", rank: 1, reason: "Severity 3 with the higher demand (12 users) and it removes a painful manual workflow; clear activation and retention value." },
      { id: "f-j2", rank: 2, reason: "Severity 2 with 6 requests; a productivity nicety for power users that ranks below the broader import gap." },
    ],
  },
  {
    findings: [
      { id: "f-k1", kind: "bug", severity: 5, occurrences: 1, title: "A customer was double-charged at renewal", evidence: "1 customer was billed twice and requested a refund." },
      { id: "f-k2", kind: "bug", severity: 3, occurrences: 9, title: "Avatar upload fails for PNGs over 2MB", evidence: "9 users could not upload larger profile images." },
    ],
    ranked: [
      { id: "f-k1", rank: 1, reason: "Severity 5 billing defect: even a single double-charge is a trust and compliance issue that demands an immediate fix and refund. Frequency is irrelevant here." },
      { id: "f-k2", rank: 2, reason: "Severity 3 affecting 9 users but with an obvious workaround (smaller image); worth fixing soon, yet far below a billing error." },
    ],
  },
  {
    findings: [
      { id: "f-l1", kind: "bug", severity: 4, occurrences: 7, title: "Two-factor codes are rejected intermittently", evidence: "7 users were locked out despite correct 2FA codes." },
      { id: "f-l2", kind: "gap", severity: 3, occurrences: 5, title: "No audit log export", evidence: "5 enterprise admins needed audit logs for compliance." },
      { id: "f-l3", kind: "bug", severity: 2, occurrences: 11, title: "Table columns are not resizable", evidence: "11 users wanted to resize columns in the data grid." },
    ],
    ranked: [
      { id: "f-l1", rank: 1, reason: "Severity 4 and it intermittently blocks login for 7 users; an auth lockout is an availability and security issue, so it leads." },
      { id: "f-l2", rank: 2, reason: "Severity-3 compliance gap for 5 enterprise admins; unblocks deals and audits, ranking above the cosmetic grid bug." },
      { id: "f-l3", rank: 3, reason: "Highest frequency (11) but only severity 2 and purely ergonomic; a low-effort polish item that ranks last against auth and compliance." },
    ],
  },
  {
    findings: [
      { id: "f-m1", kind: "bug", severity: 4, occurrences: 12, title: "Password reset email never arrives", evidence: "12 locked-out users submitted reset forms and got no email." },
      { id: "f-m2", kind: "bug", severity: 4, occurrences: 6, title: "Shared report links return a 404", evidence: "6 external viewers hit 404s on shared report URLs." },
      { id: "f-m3", kind: "bug", severity: 3, occurrences: 18, title: "Navigation menu does not open on mobile", evidence: "18 mobile users rage-clicked an unresponsive menu." },
      { id: "f-m4", kind: "gap", severity: 1, occurrences: 2, title: "No compact table density option", evidence: "2 users asked for a denser table view." },
    ],
    ranked: [
      { id: "f-m1", rank: 1, reason: "Severity 4 with 12 users fully locked out of their accounts; an access blocker with no workaround leads the batch." },
      { id: "f-m2", rank: 2, reason: "Also severity 4, and the 404s burn 6 external viewers at the exact moment the product is shown to outsiders; high cost-of-delay, just behind the lockouts." },
      { id: "f-m3", rank: 3, reason: "Severity 3 but the highest frequency (18 mobile users); real daily friction that still leaves the app reachable, so it follows the two blockers." },
      { id: "f-m4", rank: 4, reason: "A severity-1 preference with 2 requests; cosmetic and safely last." },
    ],
  },
  {
    findings: [
      { id: "f-n1", kind: "bug", severity: 4, occurrences: 5, title: "Webhook test deliveries time out", evidence: "5 integrators could not get a test event delivered." },
    ],
    ranked: [
      { id: "f-n1", rank: 1, reason: "The only finding in the batch, so it is rank 1 by default. Severity 4 for 5 integrators still deserves prompt attention because failed webhooks block downstream automations." },
    ],
  },
  {
    findings: [
      { id: "f-o1", kind: "gap", severity: 4, occurrences: 13, title: "No SSO / SAML login available", evidence: "13 enterprise evaluators required SSO before rollout." },
      { id: "f-o2", kind: "gap", severity: 3, occurrences: 12, title: "No CSV import for bulk record creation", evidence: "12 users wanted bulk import instead of manual entry." },
      { id: "f-o3", kind: "gap", severity: 2, occurrences: 7, title: "No way to schedule recurring reports", evidence: "7 users asked for scheduled exports." },
    ],
    ranked: [
      { id: "f-o1", rank: 1, reason: "Severity-4 gap that gates enterprise deals outright: 13 evaluators named SSO a requirement, the largest revenue upside in the batch." },
      { id: "f-o2", rank: 2, reason: "Severity 3 with 12 users stuck doing manual entry; removes a painful workflow and aids activation, so it sits above the convenience gap." },
      { id: "f-o3", rank: 3, reason: "Severity 2 with 7 requests; a workflow convenience users can live without, so it ranks last among the three gaps." },
    ],
  },
  {
    findings: [
      { id: "f-p1", kind: "bug", severity: 3, occurrences: 11, title: "Attachment preview fails for PDF files", evidence: "11 users saw a blank pane instead of a PDF preview." },
      { id: "f-p2", kind: "bug", severity: 3, occurrences: 6, title: "Weekly digest email contains duplicate rows", evidence: "6 users received digests with repeated entries." },
      { id: "f-p3", kind: "bug", severity: 3, occurrences: 2, title: "Avatar crop is misaligned on upload", evidence: "2 users ended up with off-center avatars." },
    ],
    ranked: [
      { id: "f-p1", rank: 1, reason: "All three bugs are severity 3, so frequency decides: 11 users hit the broken PDF preview, the widest reach in the batch." },
      { id: "f-p2", rank: 2, reason: "Same severity with 6 affected users, and duplicated rows chip at trust in emailed numbers; ahead of the rare crop issue." },
      { id: "f-p3", rank: 3, reason: "Severity 3 but only 2 occurrences and purely visual; last in a tie broken by reach." },
    ],
  },
  {
    findings: [
      { id: "f-q1", kind: "bug", severity: 5, occurrences: 2, title: "API keys appear in plaintext in shareable URLs", evidence: "2 users found live API keys embedded in copied links." },
      { id: "f-q2", kind: "bug", severity: 2, occurrences: 25, title: "Chart labels overlap on narrow screens", evidence: "25 users saw overlapping axis labels." },
      { id: "f-q3", kind: "gap", severity: 3, occurrences: 3, title: "No per-project access controls", evidence: "3 admins wanted to restrict members to specific projects." },
    ],
    ranked: [
      { id: "f-q1", rank: 1, reason: "Severity-5 credential leak: keys in URLs can be forwarded or logged anywhere, an incident-class risk that leads regardless of only 2 reports." },
      { id: "f-q3", rank: 2, reason: "A severity-3 permissions gap for 3 admins with security implications of its own, so it outranks the high-frequency cosmetic bug." },
      { id: "f-q2", rank: 3, reason: "Highest frequency (25) but severity 2 and purely visual; polish that trails both security items." },
    ],
  },
  {
    findings: [
      { id: "f-r1", kind: "bug", severity: 4, occurrences: 6, title: "Coupon codes rejected at checkout", evidence: "6 users had valid promo codes declined at payment." },
      { id: "f-r2", kind: "bug", severity: 3, occurrences: 10, title: "Onboarding tour crashes on step three", evidence: "10 new users had the guided tour crash midway." },
      { id: "f-r3", kind: "gap", severity: 3, occurrences: 4, title: "No annual billing option", evidence: "4 customers asked to pay yearly." },
    ],
    ranked: [
      { id: "f-r1", rank: 1, reason: "Severity 4 at the moment of purchase: 6 users with valid codes were turned away at checkout, direct revenue loss with high cost-of-delay." },
      { id: "f-r2", rank: 2, reason: "Severity 3 hitting 10 brand-new users during activation; a crashing tour sours first impressions, so it sits just behind the checkout bug." },
      { id: "f-r3", rank: 3, reason: "Severity-3 gap with 4 requests and an easy workaround (monthly billing); an expansion nicety that ranks last." },
    ],
  },
  {
    findings: [
      { id: "f-s1", kind: "bug", severity: 4, occurrences: 7, title: "Exported PDF reports are missing charts", evidence: "7 users got PDFs with blank chart areas." },
      { id: "f-s2", kind: "bug", severity: 3, occurrences: 9, title: "Search silently omits archived records", evidence: "9 users could not find records that exist in the archive." },
      { id: "f-s3", kind: "gap", severity: 3, occurrences: 8, title: "No Jira integration", evidence: "8 teams asked to push findings to Jira." },
      { id: "f-s4", kind: "bug", severity: 2, occurrences: 30, title: "Login page takes over three seconds to load", evidence: "30 users saw slow login page loads." },
    ],
    ranked: [
      { id: "f-s1", rank: 1, reason: "Severity 4 and the exported deliverable itself is wrong: 7 users already sent broken PDFs onward, so output correctness leads." },
      { id: "f-s2", rank: 2, reason: "Severity 3 silent incompleteness for 9 users; search that quietly hides records misleads without erroring, just behind the broken export." },
      { id: "f-s3", rank: 3, reason: "Solid demand from 8 teams, but a feature build costs more than the two bug fixes above it, so the gap ranks third." },
      { id: "f-s4", rank: 4, reason: "Widest reach (30 users) yet severity 2 and merely slow rather than broken; last." },
    ],
  },
  {
    findings: [
      { id: "f-t1", kind: "bug", severity: 4, occurrences: 9, title: "Email verification links expire after five minutes", evidence: "9 signups clicked expired verification links and stalled." },
      { id: "f-t2", kind: "gap", severity: 3, occurrences: 14, title: "New accounts land on an empty dashboard", evidence: "14 new users saw a blank dashboard with no sample data." },
      { id: "f-t3", kind: "bug", severity: 1, occurrences: 3, title: "Typos in the French interface", evidence: "3 users reported French translation typos." },
    ],
    ranked: [
      { id: "f-t1", rank: 1, reason: "Severity 4 stalling 9 signups before they ever reach the product; a hard activation blocker with no workaround leads." },
      { id: "f-t2", rank: 2, reason: "Severity-3 gap with the highest count (14 new users); an empty first-run dashboard hurts activation but does not stop it, so second." },
      { id: "f-t3", rank: 3, reason: "Severity 1 with 3 reports; cosmetic copy fixes rank last." },
    ],
  },
  {
    findings: [
      { id: "f-u1", kind: "bug", severity: 4, occurrences: 4, title: "API returns 500 when paginating past page 100", evidence: "4 integrations crashed on deep pagination." },
      { id: "f-u2", kind: "gap", severity: 3, occurrences: 7, title: "API docs missing the v2 endpoints", evidence: "7 developers asked where the v2 reference lives." },
      { id: "f-u3", kind: "gap", severity: 2, occurrences: 5, title: "No sandbox environment for API testing", evidence: "5 developers requested a test sandbox." },
    ],
    ranked: [
      { id: "f-u1", rank: 1, reason: "Severity 4 hard failure breaking 4 production integrations; a crashing API endpoint outranks documentation and tooling gaps." },
      { id: "f-u2", rank: 2, reason: "Severity 3 with 7 developers blocked on missing docs; cheap to fix relative to its integration-unblocking value, so second." },
      { id: "f-u3", rank: 3, reason: "Severity 2 with 5 requests; a developer-experience nicety that can wait behind the crash and the docs." },
    ],
  },
  {
    findings: [
      { id: "f-v1", kind: "bug", severity: 5, occurrences: 3, title: "Cancellation flow errors at the confirmation step", evidence: "3 customers could not complete a cancellation." },
      { id: "f-v2", kind: "bug", severity: 3, occurrences: 8, title: "Invoice PDF download fails", evidence: "8 customers could not download invoices for expense reports." },
      { id: "f-v3", kind: "gap", severity: 2, occurrences: 6, title: "No usage-based pricing plan", evidence: "6 prospects asked for usage-based pricing." },
    ],
    ranked: [
      { id: "f-v1", rank: 1, reason: "Severity 5: trapping 3 users who are trying to leave is a trust and compliance liability, so a broken cancellation flow leads even at low frequency." },
      { id: "f-v2", rank: 2, reason: "Severity 3 blocking 8 customers from invoices they need for expenses; recurring administrative pain, so it ranks second." },
      { id: "f-v3", rank: 3, reason: "Severity-2 pricing gap with 6 requests; a sales consideration rather than a product defect, ranking last." },
    ],
  },
];

// ---------------------------------------------------------------------------
// Emit + validate.
// ---------------------------------------------------------------------------
const narratorTool = getTool("narrator");
const extractorTool = getTool("extractor");
const prioritizerTool = getTool("prioritizer");

interface Pair {
  tool: string;
  teacher: string;
  input: unknown;
  output: unknown;
}

const narratorPairs: Pair[] = [];
const extractorPairs: Pair[] = [];

for (const row of seeds) {
  // narrator
  const nInput = row.session;
  const nOutput = { sessionId: row.session.sessionId, distinctId: row.session.distinctId, narration: row.narration };
  narratorTool.inputSchema.parse(nInput);
  NarratorOutputSchema.parse(nOutput);
  narratorPairs.push({ tool: "narrator", teacher: "human-seed", input: nInput, output: nOutput });

  // extractor
  const eInput = { narration: row.narration };
  const eOutput = { findings: row.findings };
  extractorTool.inputSchema.parse(eInput);
  ExtractorOutputSchema.parse(eOutput);
  extractorPairs.push({ tool: "extractor", teacher: "human-seed", input: eInput, output: eOutput });
}

const prioritizerPairs: Pair[] = priorBatches.map((batch) => {
  const input = { findings: batch.findings };
  const output = { ranked: batch.ranked };
  prioritizerTool.inputSchema.parse(input);
  PrioritizerOutputSchema.parse(output);
  // coverage: every input id ranked exactly once
  const ids = new Set(batch.findings.map((f) => f.id));
  const ranked = batch.ranked.map((r) => r.id);
  if (ranked.length !== ids.size || ranked.some((id) => !ids.has(id)) || new Set(ranked).size !== ranked.length) {
    throw new Error(`prioritizer batch coverage mismatch: ${JSON.stringify(ranked)}`);
  }
  return { tool: "prioritizer", teacher: "human-seed", input, output };
});

function toJsonl(pairs: Pair[]): string {
  return pairs.map((p) => JSON.stringify(p)).join("\n") + "\n";
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, "narrator.jsonl"), toJsonl(narratorPairs));
await writeFile(join(OUT_DIR, "extractor.jsonl"), toJsonl(extractorPairs));
await writeFile(join(OUT_DIR, "prioritizer.jsonl"), toJsonl(prioritizerPairs));

console.log("Wrote validated seed pairs to examples/seeds/:");
console.log(`  narrator.jsonl     ${narratorPairs.length} pairs`);
console.log(`  extractor.jsonl    ${extractorPairs.length} pairs (${extractorPairs.filter((p) => (p.output as { findings: unknown[] }).findings.length === 0).length} clean/no-issue sessions)`);
console.log(`  prioritizer.jsonl  ${prioritizerPairs.length} batches`);
