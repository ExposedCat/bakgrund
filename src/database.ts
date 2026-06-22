import { Database as SQLiteDatabase } from "@db/sqlite";
import { type ColumnType, Kysely, sql } from "@kysely/kysely";
import { DenoSqlite3Dialect } from "@marshift/kysely-deno-sqlite3";
import type { EmailAnalysis } from "./analyzer.ts";

type AnalysisImportance = EmailAnalysis["importance"];
type AnalysisSpam = EmailAnalysis["spam"];
export type AnalysisBucket = EmailAnalysis["bucket"];

export type StoredEmailAnalysis = EmailAnalysis & {
  accountId: string;
  messageId: string;
  folder: string;
  uid: number;
  analyzedAt: number;
};

export const ANALYSIS_BUCKETS = [
  "delivery",
  "ticket",
  "ad",
  "work",
  "event",
  "signup",
  "human",
  "other",
] as const satisfies readonly AnalysisBucket[];

type AnalysisMetadata = {
  account_id: string;
  message_id: string;
  folder: string;
  uid: number;
  importance: AnalysisImportance;
  spam: AnalysisSpam;
  analyzed_at: ColumnType<number, number | undefined, number>;
};

export type DatabaseSchema = {
  analysis_delivery: AnalysisMetadata & {
    delivery_id: string | null;
    title: string;
    pickup_code: string | null;
    access_code: string | null;
    expiry_date: string | null;
    expected_date: string | null;
    status: string;
    note: string | null;
  };
  analysis_ticket: AnalysisMetadata & {
    title: string;
    filenames_json: string;
    note: string | null;
  };
  analysis_ad: AnalysisMetadata & {
    title: string;
    coupons_json: string | null;
    expiry_date: string | null;
    note: string | null;
  };
  analysis_work: AnalysisMetadata & {
    company: string;
    position: string | null;
    status: string;
    note: string | null;
  };
  analysis_event: AnalysisMetadata & {
    title: string;
    date: string | null;
    place: string | null;
    note: string | null;
  };
  analysis_signup: AnalysisMetadata & {
    note: string | null;
  };
  analysis_human: AnalysisMetadata & {
    note: string;
  };
  analysis_other: AnalysisMetadata & {
    note: string;
  };
};

export type Database = Kysely<DatabaseSchema>;

export type SaveAnalysisParams = {
  accountId: string;
  messageId: string;
  folder: string;
  uid: number;
  analysis: EmailAnalysis;
};

type AnalysisRowMetadata = {
  account_id: string;
  message_id: string;
  folder: string;
  uid: number;
  importance: AnalysisImportance;
  spam: AnalysisSpam;
  analyzed_at: number;
};

type DeliveryAnalysisRow = AnalysisRowMetadata & {
  delivery_id: string | null;
  title: string;
  pickup_code: string | null;
  access_code: string | null;
  expiry_date: string | null;
  expected_date: string | null;
  status: string;
  note: string | null;
};

type TicketAnalysisRow = AnalysisRowMetadata & {
  title: string;
  filenames_json: string;
  note: string | null;
};

type AdAnalysisRow = AnalysisRowMetadata & {
  title: string;
  coupons_json: string | null;
  expiry_date: string | null;
  note: string | null;
};

type WorkAnalysisRow = AnalysisRowMetadata & {
  company: string;
  position: string | null;
  status: string;
  note: string | null;
};

type EventAnalysisRow = AnalysisRowMetadata & {
  title: string;
  date: string | null;
  place: string | null;
  note: string | null;
};

type SignupAnalysisRow = AnalysisRowMetadata & {
  note: string | null;
};

type HumanAnalysisRow = AnalysisRowMetadata & {
  note: string;
};

type OtherAnalysisRow = AnalysisRowMetadata & {
  note: string;
};

export async function initDatabase(): Promise<Database> {
  const database = new Kysely<DatabaseSchema>({
    dialect: new DenoSqlite3Dialect({
      database: new SQLiteDatabase(
        Deno.env.get("SQLITE_PATH") ?? "bakgrund.sqlite",
        { int64: true },
      ),
    }),
  });

  await migrate(database);
  return database;
}

export async function saveAnalysisResult({
  accountId,
  messageId,
  folder,
  uid,
  analysis,
}: SaveAnalysisParams): Promise<void> {
  await (await initOnce()).transaction().execute(async (database) => {
    await deleteAnalysisResult(database, accountId, messageId);

    const metadata = {
      account_id: accountId,
      message_id: messageId,
      folder,
      uid,
      importance: analysis.importance,
      spam: analysis.spam,
    };

    switch (analysis.bucket) {
      case "delivery":
        await database.insertInto("analysis_delivery").values({
          ...metadata,
          delivery_id: analysis.data.id,
          title: analysis.data.title,
          pickup_code: analysis.data.pickupCode,
          access_code: analysis.data.accessCode,
          expiry_date: analysis.data.expiryDate,
          expected_date: analysis.data.expectedDate,
          status: analysis.data.status,
          note: analysis.data.note,
        }).execute();
        return;
      case "ticket":
        await database.insertInto("analysis_ticket").values({
          ...metadata,
          title: analysis.data.title,
          filenames_json: JSON.stringify(analysis.data.filenames),
          note: analysis.data.note,
        }).execute();
        return;
      case "ad":
        await database.insertInto("analysis_ad").values({
          ...metadata,
          title: analysis.data.title,
          coupons_json: analysis.data.coupons === null
            ? null
            : JSON.stringify(analysis.data.coupons),
          expiry_date: analysis.data.expiryDate,
          note: analysis.data.note,
        }).execute();
        return;
      case "work":
        await database.insertInto("analysis_work").values({
          ...metadata,
          company: analysis.data.company,
          position: analysis.data.position,
          status: analysis.data.status,
          note: analysis.data.note,
        }).execute();
        return;
      case "event":
        await database.insertInto("analysis_event").values({
          ...metadata,
          title: analysis.data.title,
          date: analysis.data.date,
          place: analysis.data.place,
          note: analysis.data.note,
        }).execute();
        return;
      case "signup":
        await database.insertInto("analysis_signup").values({
          ...metadata,
          note: analysis.data.note,
        }).execute();
        return;
      case "human":
        await database.insertInto("analysis_human").values({
          ...metadata,
          note: analysis.data.note,
        }).execute();
        return;
      case "other":
        await database.insertInto("analysis_other").values({
          ...metadata,
          note: analysis.data.note,
        }).execute();
        return;
    }
  });
}

export function isAnalysisBucket(value: string): value is AnalysisBucket {
  return ANALYSIS_BUCKETS.includes(value as AnalysisBucket);
}

export async function getAnalysisResultsByBucket(
  accountId: string,
  bucket: AnalysisBucket,
): Promise<StoredEmailAnalysis[]> {
  const database = await initOnce();

  switch (bucket) {
    case "delivery":
      return (
        await database.selectFrom("analysis_delivery")
          .selectAll()
          .where("account_id", "=", accountId)
          .orderBy("analyzed_at", "desc")
          .execute()
      ).map(deliveryAnalysis);
    case "ticket":
      return (
        await database.selectFrom("analysis_ticket")
          .selectAll()
          .where("account_id", "=", accountId)
          .orderBy("analyzed_at", "desc")
          .execute()
      ).map(ticketAnalysis);
    case "ad":
      return (
        await database.selectFrom("analysis_ad")
          .selectAll()
          .where("account_id", "=", accountId)
          .orderBy("analyzed_at", "desc")
          .execute()
      ).map(adAnalysis);
    case "work":
      return (
        await database.selectFrom("analysis_work")
          .selectAll()
          .where("account_id", "=", accountId)
          .orderBy("analyzed_at", "desc")
          .execute()
      ).map(workAnalysis);
    case "event":
      return (
        await database.selectFrom("analysis_event")
          .selectAll()
          .where("account_id", "=", accountId)
          .orderBy("analyzed_at", "desc")
          .execute()
      ).map(eventAnalysis);
    case "signup":
      return (
        await database.selectFrom("analysis_signup")
          .selectAll()
          .where("account_id", "=", accountId)
          .orderBy("analyzed_at", "desc")
          .execute()
      ).map(signupAnalysis);
    case "human":
      return (
        await database.selectFrom("analysis_human")
          .selectAll()
          .where("account_id", "=", accountId)
          .orderBy("analyzed_at", "desc")
          .execute()
      ).map(humanAnalysis);
    case "other":
      return (
        await database.selectFrom("analysis_other")
          .selectAll()
          .where("account_id", "=", accountId)
          .orderBy("analyzed_at", "desc")
          .execute()
      ).map(otherAnalysis);
  }
}

export async function getMessageAnalysisResult(
  accountId: string,
  messageId: string,
): Promise<StoredEmailAnalysis | undefined> {
  const database = await initOnce();

  const delivery = await database.selectFrom("analysis_delivery")
    .selectAll()
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .executeTakeFirst();

  if (delivery) {
    return deliveryAnalysis(delivery);
  }

  const ticket = await database.selectFrom("analysis_ticket")
    .selectAll()
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .executeTakeFirst();

  if (ticket) {
    return ticketAnalysis(ticket);
  }

  const ad = await database.selectFrom("analysis_ad")
    .selectAll()
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .executeTakeFirst();

  if (ad) {
    return adAnalysis(ad);
  }

  const work = await database.selectFrom("analysis_work")
    .selectAll()
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .executeTakeFirst();

  if (work) {
    return workAnalysis(work);
  }

  const event = await database.selectFrom("analysis_event")
    .selectAll()
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .executeTakeFirst();

  if (event) {
    return eventAnalysis(event);
  }

  const signup = await database.selectFrom("analysis_signup")
    .selectAll()
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .executeTakeFirst();

  if (signup) {
    return signupAnalysis(signup);
  }

  const human = await database.selectFrom("analysis_human")
    .selectAll()
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .executeTakeFirst();

  if (human) {
    return humanAnalysis(human);
  }

  const other = await database.selectFrom("analysis_other")
    .selectAll()
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .executeTakeFirst();

  return other ? otherAnalysis(other) : undefined;
}

let database: Promise<Database> | undefined;

function initOnce(): Promise<Database> {
  database ??= initDatabase();
  return database;
}

async function migrate(database: Database) {
  await sql`PRAGMA foreign_keys = ON`.execute(database);
  await sql`PRAGMA journal_mode = WAL`.execute(database);

  await database.schema
    .createTable("analysis_delivery")
    .ifNotExists()
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("message_id", "text", (column) => column.notNull())
    .addColumn("folder", "text", (column) => column.notNull())
    .addColumn("uid", "integer", (column) => column.notNull())
    .addColumn("importance", "text", (column) => column.notNull())
    .addColumn("spam", "text")
    .addColumn("delivery_id", "text")
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("pickup_code", "text")
    .addColumn("access_code", "text")
    .addColumn("expiry_date", "text")
    .addColumn("expected_date", "text")
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("note", "text")
    .addColumn(
      "analyzed_at",
      "integer",
      (column) => column.notNull().defaultTo(sql`(unixepoch())`),
    )
    .addPrimaryKeyConstraint("analysis_delivery_pk", [
      "account_id",
      "message_id",
    ])
    .execute();

  await database.schema
    .createTable("analysis_ticket")
    .ifNotExists()
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("message_id", "text", (column) => column.notNull())
    .addColumn("folder", "text", (column) => column.notNull())
    .addColumn("uid", "integer", (column) => column.notNull())
    .addColumn("importance", "text", (column) => column.notNull())
    .addColumn("spam", "text")
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("filenames_json", "text", (column) => column.notNull())
    .addColumn("note", "text")
    .addColumn(
      "analyzed_at",
      "integer",
      (column) => column.notNull().defaultTo(sql`(unixepoch())`),
    )
    .addPrimaryKeyConstraint("analysis_ticket_pk", [
      "account_id",
      "message_id",
    ])
    .execute();

  await database.schema
    .createTable("analysis_ad")
    .ifNotExists()
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("message_id", "text", (column) => column.notNull())
    .addColumn("folder", "text", (column) => column.notNull())
    .addColumn("uid", "integer", (column) => column.notNull())
    .addColumn("importance", "text", (column) => column.notNull())
    .addColumn("spam", "text")
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("coupons_json", "text")
    .addColumn("expiry_date", "text")
    .addColumn("note", "text")
    .addColumn(
      "analyzed_at",
      "integer",
      (column) => column.notNull().defaultTo(sql`(unixepoch())`),
    )
    .addPrimaryKeyConstraint("analysis_ad_pk", [
      "account_id",
      "message_id",
    ])
    .execute();

  await database.schema
    .createTable("analysis_work")
    .ifNotExists()
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("message_id", "text", (column) => column.notNull())
    .addColumn("folder", "text", (column) => column.notNull())
    .addColumn("uid", "integer", (column) => column.notNull())
    .addColumn("importance", "text", (column) => column.notNull())
    .addColumn("spam", "text")
    .addColumn("company", "text", (column) => column.notNull())
    .addColumn("position", "text")
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("note", "text")
    .addColumn(
      "analyzed_at",
      "integer",
      (column) => column.notNull().defaultTo(sql`(unixepoch())`),
    )
    .addPrimaryKeyConstraint("analysis_work_pk", [
      "account_id",
      "message_id",
    ])
    .execute();

  await database.schema
    .createTable("analysis_event")
    .ifNotExists()
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("message_id", "text", (column) => column.notNull())
    .addColumn("folder", "text", (column) => column.notNull())
    .addColumn("uid", "integer", (column) => column.notNull())
    .addColumn("importance", "text", (column) => column.notNull())
    .addColumn("spam", "text")
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("date", "text")
    .addColumn("place", "text")
    .addColumn("note", "text")
    .addColumn(
      "analyzed_at",
      "integer",
      (column) => column.notNull().defaultTo(sql`(unixepoch())`),
    )
    .addPrimaryKeyConstraint("analysis_event_pk", [
      "account_id",
      "message_id",
    ])
    .execute();

  await database.schema
    .createTable("analysis_signup")
    .ifNotExists()
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("message_id", "text", (column) => column.notNull())
    .addColumn("folder", "text", (column) => column.notNull())
    .addColumn("uid", "integer", (column) => column.notNull())
    .addColumn("importance", "text", (column) => column.notNull())
    .addColumn("spam", "text")
    .addColumn("note", "text")
    .addColumn(
      "analyzed_at",
      "integer",
      (column) => column.notNull().defaultTo(sql`(unixepoch())`),
    )
    .addPrimaryKeyConstraint("analysis_signup_pk", [
      "account_id",
      "message_id",
    ])
    .execute();

  await database.schema
    .createTable("analysis_human")
    .ifNotExists()
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("message_id", "text", (column) => column.notNull())
    .addColumn("folder", "text", (column) => column.notNull())
    .addColumn("uid", "integer", (column) => column.notNull())
    .addColumn("importance", "text", (column) => column.notNull())
    .addColumn("spam", "text")
    .addColumn("note", "text", (column) => column.notNull())
    .addColumn(
      "analyzed_at",
      "integer",
      (column) => column.notNull().defaultTo(sql`(unixepoch())`),
    )
    .addPrimaryKeyConstraint("analysis_human_pk", [
      "account_id",
      "message_id",
    ])
    .execute();

  await database.schema
    .createTable("analysis_other")
    .ifNotExists()
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("message_id", "text", (column) => column.notNull())
    .addColumn("folder", "text", (column) => column.notNull())
    .addColumn("uid", "integer", (column) => column.notNull())
    .addColumn("importance", "text", (column) => column.notNull())
    .addColumn("spam", "text")
    .addColumn("note", "text", (column) => column.notNull())
    .addColumn(
      "analyzed_at",
      "integer",
      (column) => column.notNull().defaultTo(sql`(unixepoch())`),
    )
    .addPrimaryKeyConstraint("analysis_other_pk", [
      "account_id",
      "message_id",
    ])
    .execute();
}

async function deleteAnalysisResult(
  database: Database,
  accountId: string,
  messageId: string,
) {
  await database.deleteFrom("analysis_delivery")
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .execute();
  await database.deleteFrom("analysis_ticket")
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .execute();
  await database.deleteFrom("analysis_ad")
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .execute();
  await database.deleteFrom("analysis_work")
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .execute();
  await database.deleteFrom("analysis_event")
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .execute();
  await database.deleteFrom("analysis_signup")
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .execute();
  await database.deleteFrom("analysis_human")
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .execute();
  await database.deleteFrom("analysis_other")
    .where("account_id", "=", accountId)
    .where("message_id", "=", messageId)
    .execute();
}

function metadata(row: AnalysisRowMetadata) {
  return {
    accountId: row.account_id,
    messageId: row.message_id,
    folder: row.folder,
    uid: row.uid,
    importance: row.importance,
    spam: row.spam,
    analyzedAt: row.analyzed_at,
  };
}

function deliveryAnalysis(row: DeliveryAnalysisRow): StoredEmailAnalysis {
  return {
    ...metadata(row),
    bucket: "delivery",
    data: {
      id: row.delivery_id,
      title: row.title,
      pickupCode: row.pickup_code,
      accessCode: row.access_code,
      expiryDate: row.expiry_date,
      expectedDate: row.expected_date,
      status: row.status,
      note: row.note,
    },
  };
}

function ticketAnalysis(row: TicketAnalysisRow): StoredEmailAnalysis {
  return {
    ...metadata(row),
    bucket: "ticket",
    data: {
      title: row.title,
      filenames: parseStringArray(row.filenames_json),
      note: row.note,
    },
  };
}

function adAnalysis(row: AdAnalysisRow): StoredEmailAnalysis {
  return {
    ...metadata(row),
    bucket: "ad",
    data: {
      title: row.title,
      coupons: row.coupons_json === null
        ? null
        : parseStringArray(row.coupons_json),
      expiryDate: row.expiry_date,
      note: row.note,
    },
  };
}

function workAnalysis(row: WorkAnalysisRow): StoredEmailAnalysis {
  return {
    ...metadata(row),
    bucket: "work",
    data: {
      company: row.company,
      position: row.position,
      status: row.status,
      note: row.note,
    },
  };
}

function eventAnalysis(row: EventAnalysisRow): StoredEmailAnalysis {
  return {
    ...metadata(row),
    bucket: "event",
    data: {
      title: row.title,
      date: row.date,
      place: row.place,
      note: row.note,
    },
  };
}

function signupAnalysis(row: SignupAnalysisRow): StoredEmailAnalysis {
  return {
    ...metadata(row),
    bucket: "signup",
    data: {
      note: row.note,
    },
  };
}

function humanAnalysis(row: HumanAnalysisRow): StoredEmailAnalysis {
  return {
    ...metadata(row),
    bucket: "human",
    data: {
      note: row.note,
    },
  };
}

function otherAnalysis(row: OtherAnalysisRow): StoredEmailAnalysis {
  return {
    ...metadata(row),
    bucket: "other",
    data: {
      note: row.note,
    },
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
        parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}
