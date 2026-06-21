import { startServer } from "./server.ts";

export { getGoaAccessTokens } from "./goa.ts";
export type { GoaAccessToken } from "./goa.ts";
export type {
  ImapConnectionId,
  ImapConnectionOptions,
  ImapFolder,
  ImapSecurity,
} from "./imap.ts";
export { close, closeAllConnections, connect, listFolders } from "./imap.ts";
export { handleRequest, startServer } from "./server.ts";
export type { ServerOptions } from "./server.ts";

if (import.meta.main) {
  startServer();
}
