// Shared, environment-agnostic types for the automated client reports.
// Used by both the browser (test preview + download) and the Deno edge function
// (scheduled 48h / weekly sends), so nothing here may touch the DOM or Node/Deno APIs.

export type ReportKind = "48h" | "weekly";

export interface ReportBranding {
  /** Client / company name shown in the header. */
  company: string;
  /** Brand accent color as #RRGGBB. */
  brandColor: string;
  /** Logo already decoded to a PNG data URL (data:image/png;base64,…) or null.
   *  Decoding is caller-side because it differs per environment (canvas in the
   *  browser, fetch+base64 in Deno). */
  logoPngDataUrl?: string | null;
  logoW?: number;
  logoH?: number;
}

/** One campaign's numbers inside a report. */
export interface CampaignReportBlock {
  name: string;
  sent: number;
  contacted: number; // distinct people emailed (lifetime)
  replied: number; // distinct leads who replied (lifetime)
  opened: number;
  bounced: number;
  positive: number; // inbox messages labelled "Interesado"
  sequences: number; // number of steps
  remaining: number; // pending leads not yet contacted
  /** Numbers for the reporting window only (last 48h or the week). */
  periodSent: number;
  periodNewContacts: number;
  periodReplies: number;
  /** Daily series over the window for the chart. */
  daily: { day: string; sends: number; replies: number }[];
}

/** The AI-written narrative that accompanies the numbers. */
export interface ReportNarrative {
  summary: string; // 2-4 sentence executive summary
  highlights: string[]; // bullet points of what went well / notable
  nextSteps: string[]; // concrete recommended next actions
  suggestions: string[]; // Friday only: ideas (optimize message, add variant, enable X)
  alert: string | null; // low-contacts or other warning, or null
}

export interface ReportData {
  kind: ReportKind;
  clientName: string;
  /** Human label for the window, e.g. "Últimas 48 horas" or "Semana del 14–18 jul". */
  periodLabel: string;
  /** ISO timestamp when generated (stamped by the caller — Date is unavailable in some contexts). */
  generatedAtLabel: string;
  totals: {
    sent: number;
    contacted: number;
    replied: number;
    opened: number;
    bounced: number;
    positive: number;
    remaining: number;
    periodSent: number;
    periodNewContacts: number;
    periodReplies: number;
  };
  /** replied / contacted, as a percentage (0-100). */
  replyRate: number;
  campaigns: CampaignReportBlock[];
  narrative: ReportNarrative;
}
