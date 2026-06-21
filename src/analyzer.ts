import { generateJson } from "./llm.ts";

export type EmailAnalysis = {
  bucket:
    | "ad"
    | "promo"
    | "notification"
    | "action"
    | "update"
    | "signup"
    | "event"
    | "other";
  importance: "critical" | "normal" | "low";
  spam: boolean;
  event: {
    date: string;
    title: string;
    note: string | null;
  } | null;
  status: {
    kind: "delivery" | "ticket" | "pipeline";
    value: string;
    access: string | null;
    note: string | null;
  } | null;
};

export type AnalyzeEmailMessage = {
  date?: string;
  from?: string;
  subject?: string;
  message: string;
};

const INSTRUCTIONS =
  `Your goal is to analyze given email message by following criteria:
- bucket: \`ad\` for generic ads or newsletters, \`promo\` for ads with some discount codes present, \`notification\` for service action notifications, such as replies or git notifications, \`action\` for emails requiring action, i.e. when there's some question or response is expected, \`update\` for policy changes, new features, etc., \`signup\` for login codes and service greetings, \`event\` for calendar events/meetings/reminders, \`other\` for those which don't match any other bucket.
- importance: \`critical\` for high priority, \`normal\` for useful emails, \`low\` for garbage or status updates.

Respond exactly with the following JSON:
{ bucket, importance, spam, event, status}
where:
- spam: boolean, whether email is a spam and should be considered unsubscribing/blocking
- event: nullable, only when email is an event; { date, title, note }; note is nullable, add it only when there's some important extra detail. Use null when the email is not an event.
- status: nullable, only when email is a status; { kind, value, access, note }; kind is \`delivery\`, \`ticket\` or \`pipeline\`; value is current status name, access is nullable and should be only set when there are codes, tracking numbers, etc.; note is nullable, add it only when there's some important extra detail. Use null when the email has no status.`;

const EMAIL_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bucket: {
      type: "string",
      enum: [
        "ad",
        "promo",
        "notification",
        "action",
        "update",
        "signup",
        "event",
        "other",
      ],
    },
    importance: {
      type: "string",
      enum: ["critical", "normal", "low"],
    },
    spam: {
      type: "boolean",
    },
    event: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        date: { type: "string" },
        title: { type: "string" },
        note: { type: ["string", "null"] },
      },
      required: ["date", "title", "note"],
    },
    status: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["delivery", "ticket", "pipeline"],
        },
        value: { type: "string" },
        access: { type: ["string", "null"] },
        note: { type: ["string", "null"] },
      },
      required: ["kind", "value", "access", "note"],
    },
  },
  required: ["bucket", "importance", "spam", "event", "status"],
};

export async function analyzeEmailMessage(
  message: AnalyzeEmailMessage,
): Promise<EmailAnalysis> {
  return await generateJson<EmailAnalysis>({
    name: "email_analysis",
    instructions: INSTRUCTIONS,
    input: JSON.stringify(message, null, 2),
    schema: EMAIL_ANALYSIS_SCHEMA,
  });
}
