import { connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import { recipientList, type MailMessage, type Mailer } from "./types.ts";

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  secure: boolean;
  from: string;
}

type SmtpSocket = Socket | TLSSocket;

export function createSmtpMailer(config: SmtpConfig): Mailer {
  return {
    driver: "smtp",
    async send(message: MailMessage) {
      await sendSmtp(config, message);
    },
  };
}

export function extractEmail(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match?.[1] ?? from).trim();
}

async function sendSmtp(config: SmtpConfig, message: MailMessage): Promise<void> {
  let socket: SmtpSocket = await openSocket(config.host, config.port, config.secure);
  try {
    await readReply(socket);
    await command(socket, `EHLO bakorin`);
    if (!config.secure) {
      const start = await command(socket, "STARTTLS");
      if (start.startsWith("2")) {
        socket = await upgradeTls(socket, config.host);
        await command(socket, `EHLO bakorin`);
      }
    }
    if (config.user && config.pass) {
      await command(socket, "AUTH LOGIN");
      await command(socket, Buffer.from(config.user).toString("base64"));
      await command(socket, Buffer.from(config.pass).toString("base64"));
    }
    await command(socket, `MAIL FROM:<${extractEmail(config.from)}>`);
    const to = recipientList(message.to);
    const cc = message.cc ?? [];
    for (const address of [...to, ...cc, ...(message.bcc ?? [])]) {
      await command(socket, `RCPT TO:<${headerSafe(extractEmail(address))}>`);
    }
    await command(socket, "DATA");
    const headers = [
      `From: ${headerSafe(config.from)}`,
      `To: ${to.map(headerSafe).join(", ")}`,
      ...(cc.length > 0 ? [`Cc: ${cc.map(headerSafe).join(", ")}`] : []),
      ...(message.replyTo ? [`Reply-To: ${headerSafe(message.replyTo)}`] : []),
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${messageIdLocal(message.idempotencyKey)}@${domainOf(config.from)}>`,
    ];
    const payload = [
      ...headers,
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="bakorin"',
      "",
      "--bakorin",
      "Content-Type: text/plain; charset=utf-8",
      "",
      dotStuff(message.text),
      "",
      "--bakorin",
      "Content-Type: text/html; charset=utf-8",
      "",
      dotStuff(message.html),
      "",
      "--bakorin--",
      ".",
    ].join("\r\n");
    await command(socket, payload);
    await command(socket, "QUIT");
  } finally {
    socket.end();
  }
}

/** Strips CR and LF so a value can never start a new header or SMTP command. */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeader(value: string): string {
  const safe = headerSafe(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(safe)) {
    return safe;
  }
  return `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

function messageIdLocal(key: string | undefined): string {
  const base = key ? key.replace(/[^A-Za-z0-9._-]/g, "") : crypto.randomUUID();
  return base || crypto.randomUUID();
}

function domainOf(from: string): string {
  const email = extractEmail(from);
  const domain = email.split("@")[1] ?? "bakorin.local";
  return domain.replace(/[^A-Za-z0-9.-]/g, "") || "bakorin.local";
}

function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function openSocket(host: string, port: number, secure: boolean): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    if (secure) {
      const socket = tlsConnect({ host, port, servername: host }, () => {
        socket.off("error", onError);
        resolve(socket);
      });
      socket.once("error", onError);
      return;
    }
    const socket = tcpConnect({ host, port }, () => {
      socket.off("error", onError);
      resolve(socket);
    });
    socket.once("error", onError);
  });
}

function upgradeTls(socket: SmtpSocket, host: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tls = tlsConnect({ socket, servername: host }, () => resolve(tls));
    tls.once("error", reject);
  });
}

function command(socket: SmtpSocket, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.write(`${line}\r\n`, (error) => {
      if (error) {
        reject(error);
      }
    });
    readReply(socket).then(resolve, reject);
  });
}

function readReply(socket: SmtpSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter((line) => line.length > 0);
      const last = lines.at(-1);
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        if (last.startsWith("4") || last.startsWith("5")) {
          reject(new Error(`SMTP ${last}`));
          return;
        }
        resolve(buffer);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}
