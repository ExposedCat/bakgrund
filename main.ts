import { getGoaAccessTokens } from "./goa.ts";
import { close, closeAllConnections, connect, listFolders } from "./imap.ts";

export { getGoaAccessTokens } from "./goa.ts";
export type { GoaAccessToken } from "./goa.ts";
export type {
  ImapConnectionId,
  ImapConnectionOptions,
  ImapFolder,
  ImapSecurity,
} from "./imap.ts";
export { close, closeAllConnections, connect, listFolders } from "./imap.ts";

if (import.meta.main) {
  const accounts = await getGoaAccessTokens();

  console.log(`accounts: ${accounts.length}`);

  for (const account of accounts) {
    console.log("");
    console.log(account.email);

    if (!account.imap) {
      console.log("  no imap");
      continue;
    }

    let connection: string | undefined;

    try {
      connection = await connect({
        ...account.imap,
        accessToken: account.accessToken,
      });

      const folders = await listFolders(connection);

      console.log(`  folders: ${folders.length}`);

      for (const folder of folders) {
        console.log(`  - ${folder.name}`);
      }
    } catch (error) {
      console.log(
        `  error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (connection) {
        await close(connection);
      }
    }
  }

  closeAllConnections();
}
