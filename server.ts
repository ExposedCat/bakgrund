import { getGoaAccessTokens, type GoaAccessToken } from "./goa.ts";
import { close, connect, listFolders, listUnreadMessages } from "./imap.ts";

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

    if (request.method !== "GET") {
      return json({ error: "method not allowed" }, 405);
    }

    if (url.pathname === "/accounts") {
      const accounts = await getGoaAccessTokens();
      return json(accounts.map(publicAccount));
    }

    const messagesMatch = /^\/accounts\/([^/]+)\/folders\/([^/]+)\/messages$/
      .exec(url.pathname);

    if (messagesMatch) {
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

        return json(await listUnreadMessages(connection, folder));
      } finally {
        if (connection) {
          await close(connection);
        }
      }
    }

    const foldersMatch = /^\/accounts\/([^/]+)\/folders$/.exec(url.pathname);

    if (foldersMatch) {
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
    return json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

async function findAccount(email: string): Promise<GoaAccessToken | undefined> {
  const accounts = await getGoaAccessTokens();
  return accounts.find((item) => item.email === email);
}

function publicAccount(account: GoaAccessToken) {
  return {
    email: account.email,
    folders: `/accounts/${encodeURIComponent(account.email)}/folders`,
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
