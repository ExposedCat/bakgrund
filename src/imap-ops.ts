import { command, expectOk, type ImapConnectionId } from "./imap.ts";

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
  message?: string;
};

export type ImapMessageDetail = ImapMessage & {
  body?: string;
  raw: string;
};

export type ImapMarkReadResult = {
  folder: string;
  markedRead: number;
  uids: number[];
};

export async function listFolders(
  connection: ImapConnectionId,
): Promise<ImapFolder[]> {
  const result = expectOk(await command(connection, 'LIST "" "*"'));

  return result.lines
    .filter((line) => line.startsWith("* LIST "))
    .map(parseListLine)
    .filter((folder) => folder !== undefined);
}

export async function listUnreadMessages(
  connection: ImapConnectionId,
  folder: string,
): Promise<ImapMessage[]> {
  expectOk(await command(connection, `EXAMINE ${quoteString(folder)}`));

  const uids = await searchUnreadUids(connection);

  if (uids.length === 0) {
    return [];
  }

  const fetch = expectOk(
    await command(
      connection,
      `UID FETCH ${
        uids.join(",")
      } (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])`,
    ),
  );

  return parseMessages(fetch.lines);
}

export async function getMessage(
  connection: ImapConnectionId,
  folder: string,
  uid: number,
): Promise<ImapMessageDetail | undefined> {
  expectOk(await command(connection, `EXAMINE ${quoteString(folder)}`));

  const fetch = expectOk(
    await command(
      connection,
      `UID FETCH ${uid} (UID FLAGS BODY.PEEK[])`,
    ),
  );

  return parseMessageDetail(fetch.lines);
}

export async function markMessagesRead(
  connection: ImapConnectionId,
  folder: string,
  uids: number[],
): Promise<ImapMarkReadResult> {
  expectOk(await command(connection, `SELECT ${quoteString(folder)}`));

  if (uids.length > 0) {
    expectOk(
      await command(
        connection,
        `UID STORE ${uids.join(",")} +FLAGS.SILENT (\\Seen)`,
      ),
    );
  }

  return {
    folder,
    markedRead: uids.length,
    uids,
  };
}

async function searchUnreadUids(
  connection: ImapConnectionId,
): Promise<string[]> {
  const search = expectOk(await command(connection, "UID SEARCH UNSEEN"));

  return search.lines
    .find((line) => line.startsWith("* SEARCH "))
    ?.slice("* SEARCH ".length)
    .trim()
    .split(/\s+/)
    .filter(Boolean) ?? [];
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
    subject: decodeHeader(headers.get("subject")),
    date: headers.get("date"),
    messageId: headers.get("message-id"),
  };
}

function parseMessageDetail(lines: string[]): ImapMessageDetail | undefined {
  const start = lines.findIndex((line) => /^\* \d+ FETCH /.test(line));

  if (start === -1) {
    return undefined;
  }

  const end = lines.findIndex((line, index) =>
    index > start && /^[A-Z]\d+ /.test(line)
  );
  const content = lines.slice(start + 1, end === -1 ? undefined : end);

  if (content.at(-1) === ")") {
    content.pop();
  }

  const raw = content.join("\r\n");
  const headers = parseHeaders(raw);

  return {
    ...parseMessage([lines[start]]),
    body: decodeBody(raw),
    raw,
    from: headers.get("from"),
    subject: decodeHeader(headers.get("subject")),
    date: headers.get("date"),
    messageId: headers.get("message-id"),
  };
}

function parseHeaders(value: string): Map<string, string> {
  const headers = new Map<string, string>();
  let current = "";

  for (const line of value.split(/\r?\n/)) {
    if (line === ")" || line === "") {
      break;
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

function decodeBody(raw: string): string | undefined {
  const candidates = bodyCandidates(raw);
  return candidates.find((candidate) => candidate.type === "text/plain")
    ?.body ??
    candidates.find((candidate) => candidate.type === "text/html")?.body;
}

function bodyCandidates(raw: string): Array<{ type: string; body: string }> {
  const part = parsePart(raw);
  const contentType = parseContentType(part.headers.get("content-type"));

  if (contentType.type.startsWith("multipart/")) {
    const boundary = contentType.params.get("boundary");

    if (!boundary) {
      return [];
    }

    return splitMultipart(part.body, boundary).flatMap(bodyCandidates);
  }

  if (contentType.type !== "text/plain" && contentType.type !== "text/html") {
    return [];
  }

  return [{
    type: contentType.type,
    body: cleanupBody(
      contentType.type,
      decodePartBody(
        part.body,
        part.headers.get("content-transfer-encoding"),
        contentType.params.get("charset") ?? "utf-8",
      ),
    ),
  }];
}

function parsePart(
  raw: string,
): { headers: Map<string, string>; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);

  if (!match) {
    return { headers: parseHeaders(raw), body: "" };
  }

  const headers = raw.slice(0, match.index);
  const body = raw.slice(match.index + match[0].length);

  return { headers: parseHeaders(headers), body };
}

function parseContentType(value: string | undefined): {
  type: string;
  params: Map<string, string>;
} {
  const [type = "text/plain", ...params] = (value ?? "text/plain").split(";");

  return {
    type: type.trim().toLowerCase(),
    params: new Map(
      params
        .map((param) => {
          const index = param.indexOf("=");

          if (index === -1) {
            return undefined;
          }

          return [
            param.slice(0, index).trim().toLowerCase(),
            unquote(param.slice(index + 1).trim()),
          ] as const;
        })
        .filter((param) => param !== undefined),
    ),
  };
}

function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  let current: string[] | undefined;

  for (const line of body.split(/\r?\n/)) {
    if (line === `${delimiter}--`) {
      if (current) {
        parts.push(current.join("\r\n"));
      }

      break;
    }

    if (line === delimiter) {
      if (current) {
        parts.push(current.join("\r\n"));
      }

      current = [];
      continue;
    }

    current?.push(line);
  }

  return parts;
}

function decodePartBody(
  body: string,
  encoding: string | undefined,
  charset: string,
): string {
  const normalized = encoding?.trim().toLowerCase();

  if (normalized === "base64") {
    return decodeBytes(base64Bytes(body.replaceAll(/\s/g, "")), charset);
  }

  if (normalized === "quoted-printable") {
    return decodeBytes(
      quotedPrintableBytes(body.replace(/=\r?\n/g, "")),
      charset,
    );
  }

  return body.replace(/\r\n/g, "\n");
}

function cleanupBody(type: string, body: string): string {
  const normalized = body.replace(/\r\n/g, "\n");

  if (type !== "text/html") {
    return cleanupText(normalized);
  }

  return cleanupText(
    normalized
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, ""),
  );
}

function cleanupText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n[ \t\f\v]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t\f\v]{2,}/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (
    entity,
    code,
  ) => {
    if (code.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }

    if (code.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    }

    return htmlEntities[entity] ?? entity;
  });
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('\\"', '"');
  }

  return value;
}

const htmlEntities: Record<string, string> = {
  "&amp;": "&",
  "&apos;": "'",
  "&gt;": ">",
  "&lt;": "<",
  "&nbsp;": " ",
  "&quot;": '"',
};

function quoteString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function decodeHeader(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value
    .replace(/(\?=)\s+(=\?)/g, "$1$2")
    .replace(
      /=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g,
      (_, charset, encoding, text) =>
        decodeEncodedWord(String(charset), String(encoding), String(text)),
    );
}

function decodeEncodedWord(
  charset: string,
  encoding: string,
  text: string,
): string {
  const bytes = encoding.toUpperCase() === "B"
    ? base64Bytes(text)
    : quotedPrintableBytes(text.replaceAll("_", " "));

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function quotedPrintableBytes(value: string): Uint8Array {
  const bytes: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (
      value[index] === "=" &&
      /^[0-9a-fA-F]{2}$/.test(value.slice(index + 1, index + 3))
    ) {
      bytes.push(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(value.charCodeAt(index));
    }
  }

  return new Uint8Array(bytes);
}
