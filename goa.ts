import { busctl, busctlJson } from "./dbus.ts";

const GOA_BUS = "org.gnome.OnlineAccounts";
const GOA_ACCOUNTS = "/org/gnome/OnlineAccounts/Accounts/";
const ACCOUNT_IFACE = "org.gnome.OnlineAccounts.Account";
const MAIL_IFACE = "org.gnome.OnlineAccounts.Mail";
const OAUTH2_IFACE = "org.gnome.OnlineAccounts.OAuth2Based";
const PROPERTIES_IFACE = "org.freedesktop.DBus.Properties";

export type GoaAccessToken = {
  email: string;
  accessToken: string;
  imap?: GoaMailConnection;
  smtp?: GoaMailConnection;
};

export type GoaMailConnection = {
  host: string;
  port: number;
  username: string;
  security: "ssl" | "starttls" | "none";
};

export async function getGoaAccessTokens(): Promise<GoaAccessToken[]> {
  const accounts = await busctl(["--list", "tree", GOA_BUS]);
  const paths = accounts
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(GOA_ACCOUNTS));

  const tokens: GoaAccessToken[] = [];

  for (const path of paths) {
    const interfaces = await busctl(["introspect", GOA_BUS, path]);

    if (!interfaces.includes(OAUTH2_IFACE)) {
      continue;
    }

    const properties = await busctlJson([
      "call",
      GOA_BUS,
      path,
      PROPERTIES_IFACE,
      "GetAll",
      "s",
      ACCOUNT_IFACE,
    ]);
    const email = properties.data?.[0]?.Identity?.data;

    if (typeof email !== "string") {
      continue;
    }

    await busctlJson([
      "call",
      GOA_BUS,
      path,
      ACCOUNT_IFACE,
      "EnsureCredentials",
    ]);

    const token = await busctlJson([
      "call",
      GOA_BUS,
      path,
      OAUTH2_IFACE,
      "GetAccessToken",
    ]);
    const accessToken = token.data?.[0];

    if (typeof accessToken === "string") {
      tokens.push({
        email,
        accessToken,
        ...interfaces.includes(MAIL_IFACE)
          ? await getMailConnections(path)
          : {},
      });
    }
  }

  return tokens;
}

async function getMailConnections(
  path: string,
): Promise<Pick<GoaAccessToken, "imap" | "smtp">> {
  const mail = propertiesFrom(
    await busctlJson([
      "call",
      GOA_BUS,
      path,
      PROPERTIES_IFACE,
      "GetAll",
      "s",
      MAIL_IFACE,
    ]),
  );

  const imapHost = stringProperty(mail, "ImapHost");
  const imapUserName = stringProperty(mail, "ImapUserName");
  const smtpHost = stringProperty(mail, "SmtpHost");
  const smtpUserName = stringProperty(mail, "SmtpUserName");

  return {
    imap: imapHost && imapUserName
      ? {
        host: imapHost,
        port: booleanProperty(mail, "ImapUseSsl") ? 993 : 143,
        username: imapUserName,
        security: mailSecurity(
          booleanProperty(mail, "ImapUseSsl"),
          booleanProperty(mail, "ImapUseTls"),
        ),
      }
      : undefined,
    smtp: smtpHost && smtpUserName
      ? {
        host: smtpHost,
        port: smtpPort(
          booleanProperty(mail, "SmtpUseSsl"),
          booleanProperty(mail, "SmtpUseTls"),
        ),
        username: smtpUserName,
        security: mailSecurity(
          booleanProperty(mail, "SmtpUseSsl"),
          booleanProperty(mail, "SmtpUseTls"),
        ),
      }
      : undefined,
  };
}

function propertiesFrom(json: { data?: unknown }) {
  const properties = Array.isArray(json.data) ? json.data[0] : undefined;
  return properties && typeof properties === "object"
    ? properties as Record<string, { data?: unknown }>
    : {};
}

function stringProperty(
  properties: Record<string, { data?: unknown }>,
  name: string,
): string | undefined {
  const value = properties[name]?.data;
  return typeof value === "string" ? value : undefined;
}

function booleanProperty(
  properties: Record<string, { data?: unknown }>,
  name: string,
): boolean {
  return properties[name]?.data === true;
}

function mailSecurity(
  useSsl: boolean,
  useTls: boolean,
): GoaMailConnection["security"] {
  if (useSsl) {
    return "ssl";
  }

  if (useTls) {
    return "starttls";
  }

  return "none";
}

function smtpPort(useSsl: boolean, useTls: boolean): number {
  if (useSsl) {
    return 465;
  }

  if (useTls) {
    return 587;
  }

  return 25;
}
