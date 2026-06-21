import { getGoaAccessTokens, type GoaAccessToken } from "./goa.ts";
import {
  getMessage,
  type ImapMessage,
  type ImapMessageDetail,
  listFolders,
  listUnreadMessages,
  markUnreadMessagesRead,
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

      if (!body.markRead) {
        return json({ email, folder, markedRead: 0, uids: [] });
      }

      let connection: string | undefined;

      try {
        connection = await connect({
          ...account.imap,
          accessToken: account.accessToken,
        });

        return json({
          email,
          ...await markUnreadMessagesRead(connection, folder),
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
): Promise<{ markRead?: boolean }> {
  const body = await request.text();

  if (!body.trim()) {
    return {};
  }

  let value: { markRead?: unknown };

  try {
    value = JSON.parse(body) as { markRead?: unknown };
  } catch {
    throw httpError("invalid request body", 400);
  }

  if (
    typeof value !== "object" || value === null ||
    (value.markRead !== undefined && typeof value.markRead !== "boolean")
  ) {
    throw httpError("invalid request body", 400);
  }

  return { markRead: value.markRead };
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
