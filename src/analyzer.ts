import { generateJson } from "./llm.ts";
import { getAnalyzerInstruction } from "./prompt.ts";

export type EmailAnalysis =
  & {
    importance: "very high" | "high" | "normal" | "low" | "very low";
    spam: "absolute" | "possible" | "questionable" | null;
  }
  & (
    | {
      bucket: "delivery";
      data: {
        id: string | null;
        title: string;
        pickupCode: string | null;
        accessCode: string | null;
        expiryDate: string | null;
        expectedDate: string | null;
        status: string;
        note: string | null;
      };
    }
    | {
      bucket: "ticket";
      data: {
        title: string;
        filenames: string[];
        note: string | null;
      };
    }
    | {
      bucket: "ad";
      data: {
        title: string;
        coupons: string[] | null;
        expiryDate: string | null;
        note: string | null;
      };
    }
    | {
      bucket: "work";
      data: {
        company: string;
        position: string | null;
        status: string;
        note: string | null;
      };
    }
    | {
      bucket: "event";
      data: {
        title: string;
        date: string | null;
        place: string | null;
        note: string | null;
      };
    }
    | {
      bucket: "signup";
      data: {
        note: string | null;
      };
    }
    | {
      bucket: "human";
      data: {
        note: string;
      };
    }
    | {
      bucket: "other";
      data: {
        note: string;
      };
    }
  );

export type AnalyzeEmailMessage = {
  date?: string;
  from?: string;
  subject?: string;
  message: string;
};

const EMAIL_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bucket: {
      type: "string",
      enum: [
        "delivery",
        "ticket",
        "ad",
        "work",
        "signup",
        "event",
        "human",
        "other",
      ],
    },
    data: {
      anyOf: [
        {
          type: "object",
          description: "Use when bucket is delivery.",
          additionalProperties: false,
          properties: {
            id: { type: ["string", "null"] },
            title: { type: "string" },
            pickupCode: { type: ["string", "null"] },
            accessCode: { type: ["string", "null"] },
            expiryDate: { type: ["string", "null"] },
            expectedDate: { type: ["string", "null"] },
            status: { type: "string" },
            note: { type: ["string", "null"] },
          },
          required: [
            "id",
            "title",
            "pickupCode",
            "accessCode",
            "expiryDate",
            "expectedDate",
            "status",
            "note",
          ],
        },
        {
          type: "object",
          description: "Use when bucket is ticket.",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            filenames: {
              type: "array",
              items: { type: "string" },
            },
            note: { type: ["string", "null"] },
          },
          required: ["title", "filenames", "note"],
        },
        {
          type: "object",
          description: "Use when bucket is ad.",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            coupons: {
              anyOf: [
                {
                  type: "array",
                  items: { type: "string" },
                },
                { type: "null" },
              ],
            },
            expiryDate: { type: ["string", "null"] },
            note: { type: ["string", "null"] },
          },
          required: ["title", "coupons", "expiryDate", "note"],
        },
        {
          type: "object",
          description: "Use when bucket is work.",
          additionalProperties: false,
          properties: {
            company: { type: "string" },
            position: { type: ["string", "null"] },
            status: { type: "string" },
            note: { type: ["string", "null"] },
          },
          required: ["company", "position", "status", "note"],
        },
        {
          type: "object",
          description: "Use when bucket is event.",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            date: { type: ["string", "null"] },
            place: { type: ["string", "null"] },
            note: { type: ["string", "null"] },
          },
          required: ["title", "date", "place", "note"],
        },
        {
          type: "object",
          description: "Use when bucket is signup.",
          additionalProperties: false,
          properties: {
            note: { type: ["string", "null"] },
          },
          required: ["note"],
        },
        {
          type: "object",
          description: "Use when bucket is human.",
          additionalProperties: false,
          properties: {
            note: { type: "string" },
          },
          required: ["note"],
        },
        {
          type: "object",
          description: "Use when bucket is other.",
          additionalProperties: false,
          properties: {
            note: { type: "string" },
          },
          required: ["note"],
        },
      ],
    },
    importance: {
      type: "string",
      enum: ["very high", "high", "normal", "low", "very low"],
    },
    spam: {
      type: ["string", "null"],
      enum: ["absolute", "possible", "questionable", null],
    },
  },
  required: ["bucket", "data", "importance", "spam"],
};

export async function analyzeEmailMessage(
  message: AnalyzeEmailMessage,
): Promise<EmailAnalysis> {
  return await generateJson<EmailAnalysis>({
    name: "email_analysis",
    instructions: getAnalyzerInstruction(),
    input: JSON.stringify(message, null, 2),
    schema: EMAIL_ANALYSIS_SCHEMA,
  });
}
