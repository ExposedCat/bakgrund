import { getGoaAccessTokens, type GoaAccessToken } from "./goa.ts";
import { close, connect, listFolders } from "./imap.ts";

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

    const foldersMatch = /^\/accounts\/([^/]+)\/folders$/.exec(url.pathname);

    if (foldersMatch) {
      const email = decodeURIComponent(foldersMatch[1]);
      const accounts = await getGoaAccessTokens();
      const account = accounts.find((item) => item.email === email);

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

        return json(await listFolders(connection));
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
