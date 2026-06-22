import { analyzeEmailMessage } from "./analyzer.ts";
import {
  getAnalysisResultsByBucket,
  getMessageAnalysisResult,
  isAnalysisBucket,
  saveAnalysisResult,
} from "./database.ts";
import { getGoaAccessTokens, type GoaAccessToken } from "./goa.ts";
import {
  getMessage,
  type ImapMessage,
  type ImapMessageDetail,
  listFolders,
  listUnreadMessages,
  markMessagesRead,
} from "./imap-ops.ts";
import { close, connect } from "./imap.ts";

export type ServerOptions = {
  hostname?: string;
  port?: number;
};

export function startServer(options: ServerOptions = {}): Deno.HttpServer {
  return Deno.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 8080,
  }, handleRequest);
}

export async function handleRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    if (request.method === "GET" && url.pathname === "/accounts") {
      const accounts = await getGoaAccessTokens();
      return json(accounts.map(publicAccount));
    }

    const accountAnalysisMatch = /^\/accounts\/([^/]+)\/analysis\/([^/]+)\/?$/
      .exec(url.pathname);

    if (request.method === "GET" && accountAnalysisMatch) {
      const email = decodeURIComponent(accountAnalysisMatch[1]);
      const bucket = decodeURIComponent(accountAnalysisMatch[2]);
      const account = await findAccount(email);

      if (!account) {
        return json({ error: "account not found" }, 404);
      }

      if (!isAnalysisBucket(bucket)) {
        return json({ error: "invalid analysis bucket" }, 400);
      }

      return json(await getAnalysisResultsByBucket(account.id, bucket));
    }

    const messageAnalysisMatch =
      /^\/accounts\/([^/]+)\/folders\/([^/]+)\/messages\/([^/]+)\/analysis\/?$/
        .exec(url.pathname);

    if (request.method === "GET" && messageAnalysisMatch) {
      const email = decodeURIComponent(messageAnalysisMatch[1]);
      const folder = decodeURIComponent(messageAnalysisMatch[2]);
      const uid = Number(decodeURIComponent(messageAnalysisMatch[3]));

      if (!Number.isInteger(uid) || uid < 1) {
        return json({ error: "invalid message uid" }, 400);
      }

      const account = await findAccount(email);

      if (!account) {
        return json({ error: "account not found" }, 404);
      }

      if (!account.imap) {
        return json({ error: "account has no imap settings" }, 422);
      }

      let connection: string | undefined;

      try {
        connection = await connect({
          ...account.imap,
          accessToken: account.accessToken,
        });

        const message = await getMessage(connection, folder, uid);

        if (!message) {
          return json({ error: "message not found" }, 404);
        }

        const analysis = await getMessageAnalysisResult(
          account.id,
          messageIdFor(message, folder, uid),
        );

        return analysis
          ? json(analysis)
          : json({ error: "analysis not found" }, 404);
      } finally {
        if (connection) {
          await close(connection);
        }
      }
    }

    const messageMatch =
      /^\/accounts\/([^/]+)\/folders\/([^/]+)\/messages\/([^/]+)$/
        .exec(url.pathname);

    if (request.method === "GET" && messageMatch) {
      const email = decodeURIComponent(messageMatch[1]);
      const folder = decodeURIComponent(messageMatch[2]);
      const uid = Number(decodeURIComponent(messageMatch[3]));

      if (!Number.isInteger(uid) || uid < 1) {
        return json({ error: "invalid message uid" }, 400);
      }

      const account = await findAccount(email);

      if (!account) {
        return json({ error: "account not found" }, 404);
      }

      if (!account.imap) {
        return json({ error: "account has no imap settings" }, 422);
      }

      let connection: string | undefined;

      try {
        connection = await connect({
          ...account.imap,
          accessToken: account.accessToken,
        });

        const message = await getMessage(connection, folder, uid);

        if (!message) {
          return json({ error: "message not found" }, 404);
        }

        return json(publicMessageDetail(message));
      } finally {
        if (connection) {
          await close(connection);
        }
      }
    }

    if (request.method === "POST" && messageMatch) {
      const email = decodeURIComponent(messageMatch[1]);
      const folder = decodeURIComponent(messageMatch[2]);
      const uid = Number(decodeURIComponent(messageMatch[3]));
      await readMessageAction(request);

      if (!Number.isInteger(uid) || uid < 1) {
        return json({ error: "invalid message uid" }, 400);
      }

      const account = await findAccount(email);

      if (!account) {
        return json({ error: "account not found" }, 404);
      }

      if (!account.imap) {
        return json({ error: "account has no imap settings" }, 422);
      }

      let connection: string | undefined;

      try {
        connection = await connect({
          ...account.imap,
          accessToken: account.accessToken,
        });

        const message = await getMessage(connection, folder, uid);

        if (!message) {
          return json({ error: "message not found" }, 404);
        }

        return json(
          await analyzeAndPersistMessage(account, folder, uid, message),
        );
      } finally {
        if (connection) {
          await close(connection);
        }
      }
    }

    const folderActionMatch = /^\/accounts\/([^/]+)\/folders\/([^/]+)$/
      .exec(url.pathname);

    if (request.method === "POST" && folderActionMatch) {
      const email = decodeURIComponent(folderActionMatch[1]);
      const folder = decodeURIComponent(folderActionMatch[2]);
      const body = await readFolderAction(request);
      const account = await findAccount(email);

      if (!account) {
        return json({ error: "account not found" }, 404);
      }

      if (!account.imap) {
        return json({ error: "account has no imap settings" }, 422);
      }

      if (!body.analyze) {
        return json({
          email,
          folder,
          found: 0,
          analyzed: 0,
          markedRead: 0,
          results: [],
          failures: [],
          markReadFailures: [],
        });
      }

      let connection: string | undefined;

      try {
        connection = await connect({
          ...account.imap,
          accessToken: account.accessToken,
        });

        const messages = await listUnreadMessages(connection, folder);
        const results = [];
        const failures = [];
        const markReadFailures = [];
        let markedRead = 0;

        for (const item of messages) {
          try {
            const message = await getMessage(connection, folder, item.uid);

            if (!message) {
              failures.push({
                uid: item.uid,
                error: "message not found",
              });
              continue;
            }

            const analysis = await analyzeAndPersistMessage(
              account,
              folder,
              item.uid,
              message,
            );

            const result = {
              uid: item.uid,
              messageId: messageIdFor(message, folder, item.uid),
              bucket: analysis.bucket,
              markedRead: false,
            };

            try {
              await markMessagesRead(connection, folder, [item.uid]);
              result.markedRead = true;
              markedRead++;
            } catch (error) {
              markReadFailures.push({
                uid: item.uid,
                error: error instanceof Error ? error.message : String(error),
              });
            }

            results.push(result);
          } catch (error) {
            failures.push({
              uid: item.uid,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return json({
          email,
          folder,
          found: messages.length,
          analyzed: results.length,
          markedRead,
          results,
          failures,
          markReadFailures,
        });
      } finally {
        if (connection) {
          await close(connection);
        }
      }
    }

    const messagesMatch = /^\/accounts\/([^/]+)\/folders\/([^/]+)\/messages$/
      .exec(url.pathname);

    if (request.method === "GET" && messagesMatch) {
      const email = decodeURIComponent(messagesMatch[1]);
      const folder = decodeURIComponent(messagesMatch[2]);
      const account = await findAccount(email);

      if (!account) {
        return json({ error: "account not found" }, 404);
      }

      if (!account.imap) {
        return json({ error: "account has no imap settings" }, 422);
      }

      let connection: string | undefined;

      try {
        connection = await connect({
          ...account.imap,
          accessToken: account.accessToken,
        });

        const messages = await listUnreadMessages(connection, folder);

        return json(
          messages.map((message) =>
            publicMessage(account.email, folder, message)
          ),
        );
      } finally {
        if (connection) {
          await close(connection);
        }
      }
    }

    const foldersMatch = /^\/accounts\/([^/]+)\/folders$/.exec(url.pathname);

    if (request.method === "GET" && foldersMatch) {
      const email = decodeURIComponent(foldersMatch[1]);
      const account = await findAccount(email);

      if (!account) {
        return json({ error: "account not found" }, 404);
      }

      if (!account.imap) {
        return json({ error: "account has no imap settings" }, 422);
      }

      let connection: string | undefined;

      try {
        connection = await connect({
          ...account.imap,
          accessToken: account.accessToken,
        });

        const folders = await listFolders(connection);

        return json(folders.map((folder) => ({
          ...folder,
          messages: `/accounts/${encodeURIComponent(account.email)}/folders/${
            encodeURIComponent(folder.name)
          }/messages`,
        })));
      } finally {
        if (connection) {
          await close(connection);
        }
      }
    }

    return json({ error: "not found" }, 404);
  } catch (error) {
    if (isHttpError(error)) {
      return json({ error: error.message }, error.status);
    }

    return json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

async function readFolderAction(
  request: Request,
): Promise<{ analyze: boolean }> {
  const body = await request.text();

  if (!body.trim()) {
    throw httpError("invalid request body", 400);
  }

  let value: { analyze?: unknown };

  try {
    value = JSON.parse(body) as { analyze?: unknown };
  } catch {
    throw httpError("invalid request body", 400);
  }

  if (
    typeof value !== "object" || value === null ||
    typeof value.analyze !== "boolean"
  ) {
    throw httpError("invalid request body", 400);
  }

  return { analyze: value.analyze };
}

async function readMessageAction(request: Request): Promise<void> {
  const body = await request.text();

  if (!body.trim()) {
    throw httpError("invalid request body", 400);
  }

  let value: { analyze?: unknown };

  try {
    value = JSON.parse(body) as { analyze?: unknown };
  } catch {
    throw httpError("invalid request body", 400);
  }

  if (typeof value !== "object" || value === null || value.analyze !== true) {
    throw httpError("invalid request body", 400);
  }
}

async function findAccount(email: string): Promise<GoaAccessToken | undefined> {
  const accounts = await getGoaAccessTokens();
  return accounts.find((item) => item.email === email);
}

function httpError(
  message: string,
  status: number,
): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function isHttpError(error: unknown): error is Error & { status: number } {
  return error instanceof Error && "status" in error &&
    typeof error.status === "number";
}

function publicAccount(account: GoaAccessToken) {
  return {
    id: account.id,
    email: account.email,
    folders: `/accounts/${encodeURIComponent(account.email)}/folders`,
  };
}

function publicMessage(email: string, folder: string, message: ImapMessage) {
  return {
    date: message.date,
    from: message.from,
    message: `/accounts/${encodeURIComponent(email)}/folders/${
      encodeURIComponent(folder)
    }/messages/${message.uid}`,
    subject: message.subject,
  };
}

function publicMessageDetail(message: ImapMessageDetail) {
  return {
    date: message.date,
    from: message.from,
    message: message.body ?? message.raw,
    subject: message.subject,
  };
}

async function analyzeAndPersistMessage(
  account: GoaAccessToken,
  folder: string,
  uid: number,
  message: ImapMessageDetail,
) {
  const analysis = await analyzeEmailMessage({
    date: message.date,
    from: message.from,
    subject: message.subject,
    message: message.body ?? message.raw,
  });

  await saveAnalysisResult({
    accountId: account.id,
    messageId: messageIdFor(message, folder, uid),
    folder,
    uid,
    analysis,
  });

  return analysis;
}

function messageIdFor(
  message: ImapMessageDetail,
  folder: string,
  uid: number,
): string {
  return message.messageId ?? `uid:${folder}:${uid}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
