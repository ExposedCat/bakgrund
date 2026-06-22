export type ImapSecurity = "ssl" | "starttls" | "none";

export type ImapConnectionOptions = {
  host: string;
  port: number;
  username: string;
  accessToken: string;
  security: ImapSecurity;
};

export type ImapConnectionId = string;

export type ImapCommandResult = {
  command: string;
  tag: string;
  status: string;
  lines: string[];
};

type ImapConn = Deno.Conn | Deno.TlsConn;

type ImapState = {
  buffer: string;
  conn: ImapConn;
  nextTag: number;
  options: ImapConnectionOptions;
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

export async function command(
  connection: ImapConnectionId,
  value: string,
): Promise<ImapCommandResult> {
  return await imapCommand(getConnection(connection), value);
}

export function expectOk(result: ImapCommandResult): ImapCommandResult {
  if (result.status !== "OK") {
    throw new Error(
      `IMAP command failed: ${result.command}\n${result.lines.join("\n")}`,
    );
  }

  return result;
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
      return expectOk({ ...result, command: "AUTHENTICATE XOAUTH2" });
    }
  }
}

async function imapCommand(
  state: ImapState,
  value: string,
): Promise<ImapCommandResult> {
  const tag = nextTag(state);
  await write(state, `${tag} ${value}\r\n`);

  const lines: string[] = [];

  while (true) {
    const line = await readLine(state);
    lines.push(line);

    const result = taggedResult(tag, lines);

    if (result) {
      return { ...result, command: value };
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
): Omit<ImapCommandResult, "command"> | undefined {
  const last = lines.at(-1);

  if (!last?.startsWith(`${tag} `)) {
    return undefined;
  }

  const [, status = ""] = last.split(" ", 2);

  return { tag, status, lines };
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
