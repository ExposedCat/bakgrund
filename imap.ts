export type ImapSecurity = "ssl" | "starttls" | "none";

export type ImapConnectionOptions = {
  host: string;
  port: number;
  username: string;
  accessToken: string;
  security: ImapSecurity;
};

export type ImapConnectionId = string;

export type ImapFolder = {
  name: string;
  delimiter: string | null;
  attributes: string[];
};

export type ImapMessage = {
  uid: number;
  sequence: number;
  flags: string[];
  from?: string;
  subject?: string;
  date?: string;
  messageId?: string;
};

type ImapConn = Deno.Conn | Deno.TlsConn;

type ImapState = {
  buffer: string;
  conn: ImapConn;
  nextTag: number;
  options: ImapConnectionOptions;
};

type ImapCommandResult = {
  tag: string;
  status: string;
  lines: string[];
};

const connections = new Map<ImapConnectionId, ImapState>();
let cleanupRegistered = false;

registerCleanup();

export async function connect(
  options: ImapConnectionOptions,
): Promise<ImapConnectionId> {
  const state = await connectClient(options);
  await authenticate(state);

  const id = crypto.randomUUID();
  connections.set(id, state);

  return id;
}

export async function listFolders(
  connection: ImapConnectionId,
): Promise<ImapFolder[]> {
  const state = getConnection(connection);
  const result = expectOk(await imapCommand(state, 'LIST "" "*"'));

  return result.lines
    .filter((line) => line.startsWith("* LIST "))
    .map(parseListLine)
    .filter((folder) => folder !== undefined);
}

export async function listUnreadMessages(
  connection: ImapConnectionId,
  folder: string,
): Promise<ImapMessage[]> {
  const state = getConnection(connection);

  expectOk(await imapCommand(state, `EXAMINE ${quoteString(folder)}`));

  const search = expectOk(await imapCommand(state, "UID SEARCH UNSEEN"));
  const uids = search.lines
    .find((line) => line.startsWith("* SEARCH "))
    ?.slice("* SEARCH ".length)
    .trim()
    .split(/\s+/)
    .filter(Boolean) ?? [];

  if (uids.length === 0) {
    return [];
  }

  const fetch = expectOk(
    await imapCommand(
      state,
      `UID FETCH ${
        uids.join(",")
      } (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])`,
    ),
  );

  return parseMessages(fetch.lines);
}

export async function close(connection: ImapConnectionId): Promise<void> {
  const state = connections.get(connection);

  if (!state) {
    return;
  }

  connections.delete(connection);
  await logout(state);
}

export function closeAllConnections(): void {
  for (const state of connections.values()) {
    closeConnection(state);
  }

  connections.clear();
}

function getConnection(connection: ImapConnectionId): ImapState {
  const state = connections.get(connection);

  if (!state) {
    throw new Error(`Unknown IMAP connection: ${connection}`);
  }

  return state;
}

function registerCleanup(): void {
  if (cleanupRegistered) {
    return;
  }

  cleanupRegistered = true;
  globalThis.addEventListener("unload", closeAllConnections);
}

async function connectClient(
  options: ImapConnectionOptions,
): Promise<ImapState> {
  if (options.security === "ssl") {
    const state = {
      buffer: "",
      conn: await Deno.connectTls({
        hostname: options.host,
        port: options.port,
      }),
      nextTag: 1,
      options,
    };

    await readGreeting(state);
    return state;
  }

  const conn = await Deno.connect({
    hostname: options.host,
    port: options.port,
  });
  const state: ImapState = {
    buffer: "",
    conn,
    nextTag: 1,
    options,
  };

  await readGreeting(state);

  if (options.security === "starttls") {
    expectOk(await imapCommand(state, "STARTTLS"));
    state.conn = await Deno.startTls(conn, { hostname: options.host });
    state.buffer = "";
  }

  return state;
}

async function authenticate(state: ImapState): Promise<ImapCommandResult> {
  const tag = nextTag(state);
  const initialResponse = xoauth2InitialResponse(
    state.options.username,
    state.options.accessToken,
  );

  await write(state, `${tag} AUTHENTICATE XOAUTH2\r\n`);

  const lines: string[] = [];
  let sentInitialResponse = false;

  while (true) {
    const line = await readLine(state);
    lines.push(line);

    if (line.startsWith("+")) {
      await write(
        state,
        sentInitialResponse ? "\r\n" : `${initialResponse}\r\n`,
      );
      sentInitialResponse = true;
      continue;
    }

    const result = taggedResult(tag, lines);

    if (result) {
      return expectOk(result);
    }
  }
}

async function imapCommand(
  state: ImapState,
  command: string,
): Promise<ImapCommandResult> {
  const tag = nextTag(state);
  await write(state, `${tag} ${command}\r\n`);

  const lines: string[] = [];

  while (true) {
    const line = await readLine(state);
    lines.push(line);

    const result = taggedResult(tag, lines);

    if (result) {
      return result;
    }
  }
}

async function logout(state: ImapState): Promise<void> {
  try {
    await imapCommand(state, "LOGOUT");
  } finally {
    closeConnection(state);
  }
}

function closeConnection(state: ImapState): void {
  state.conn.close();
}

async function readGreeting(state: ImapState): Promise<string> {
  const greeting = await readLine(state);

  if (!greeting.startsWith("* OK") && !greeting.startsWith("* PREAUTH")) {
    throw new Error(`Unexpected IMAP greeting: ${greeting}`);
  }

  return greeting;
}

function expectOk(result: ImapCommandResult): ImapCommandResult {
  if (result.status !== "OK") {
    throw new Error(result.lines.join("\n"));
  }

  return result;
}

async function readLine(state: ImapState): Promise<string> {
  while (!state.buffer.includes("\r\n")) {
    const chunk = new Uint8Array(4096);
    const read = await state.conn.read(chunk);

    if (read === null) {
      throw new Error("IMAP connection closed");
    }

    state.buffer += new TextDecoder().decode(chunk.subarray(0, read));
  }

  const end = state.buffer.indexOf("\r\n");
  const line = state.buffer.slice(0, end);
  state.buffer = state.buffer.slice(end + 2);

  return line;
}

async function write(state: ImapState, value: string): Promise<void> {
  await state.conn.write(new TextEncoder().encode(value));
}

function nextTag(state: ImapState): string {
  return `A${String(state.nextTag++).padStart(4, "0")}`;
}

function taggedResult(
  tag: string,
  lines: string[],
): ImapCommandResult | undefined {
  const last = lines.at(-1);

  if (!last?.startsWith(`${tag} `)) {
    return undefined;
  }

  const [, status = ""] = last.split(" ", 2);

  return { tag, status, lines };
}

function parseListLine(line: string): ImapFolder | undefined {
  const match = /^\* LIST \(([^)]*)\) (?:"([^"]*)"|NIL) "((?:\\"|[^"])*)"$/
    .exec(line);

  if (!match) {
    return undefined;
  }

  return {
    attributes: match[1] ? match[1].split(" ").filter(Boolean) : [],
    delimiter: match[2] ?? null,
    name: match[3].replaceAll('\\"', '"'),
  };
}

function parseMessages(lines: string[]): ImapMessage[] {
  const messages: ImapMessage[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^\* \d+ FETCH /.test(line)) {
      if (current.length > 0) {
        messages.push(parseMessage(current));
      }

      current = [line];
      continue;
    }

    if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    messages.push(parseMessage(current));
  }

  return messages;
}

function parseMessage(lines: string[]): ImapMessage {
  const first = lines[0] ?? "";
  const sequence = Number(/^\* (\d+) FETCH /.exec(first)?.[1] ?? 0);
  const uid = Number(/\bUID (\d+)\b/.exec(first)?.[1] ?? 0);
  const flags = /\bFLAGS \(([^)]*)\)/.exec(first)?.[1]
    ?.split(" ")
    .filter(Boolean) ?? [];
  const headers = parseHeaders(lines.slice(1).join("\r\n"));

  return {
    uid,
    sequence,
    flags,
    from: headers.get("from"),
    subject: headers.get("subject"),
    date: headers.get("date"),
    messageId: headers.get("message-id"),
  };
}

function parseHeaders(value: string): Map<string, string> {
  const headers = new Map<string, string>();
  let current = "";

  for (const line of value.split(/\r?\n/)) {
    if (line === ")" || line === "") {
      continue;
    }

    if (/^\s/.test(line) && current) {
      headers.set(current, `${headers.get(current) ?? ""} ${line.trim()}`);
      continue;
    }

    const index = line.indexOf(":");

    if (index === -1) {
      continue;
    }

    current = line.slice(0, index).toLowerCase();
    headers.set(current, line.slice(index + 1).trim());
  }

  return headers;
}

function quoteString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function xoauth2InitialResponse(username: string, accessToken: string): string {
  return base64(
    new TextEncoder().encode(
      `user=${username}\x01auth=Bearer ${accessToken}\x01\x01`,
    ),
  );
}

function base64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
