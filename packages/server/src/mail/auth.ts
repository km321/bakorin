import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchemaAST } from "@bakorin/core";
import type { BakorinDb } from "../db/dialects.ts";
import { compileTemplate, htmlToText, TemplateError } from "./engine.ts";
import { cleanSubject, mailDir } from "./files.ts";
import { renderAccountEmail, type AccountEmailKind } from "./templates.ts";
import type { Mailer, MailMessage } from "./types.ts";

export const AUTH_EMAIL_KINDS = ["verify", "reset", "invite"] as const;
export type AuthEmailKind = (typeof AUTH_EMAIL_KINDS)[number];

const EXPIRES: Record<AuthEmailKind, string> = {
  verify: "24 hours",
  reset: "1 hour",
  invite: "7 days",
};

const PATHS: Record<AuthEmailKind, string> = {
  verify: "/verify-email",
  reset: "/reset-password",
  invite: "/accept-invite",
};

export function isAuthKind(value: unknown): value is AuthEmailKind {
  return typeof value === "string" && (AUTH_EMAIL_KINDS as readonly string[]).includes(value);
}

/** "_auth/reset" -> "reset". */
export function authKindFromTemplate(template: string | undefined | null): AuthEmailKind | null {
  if (!template || !template.startsWith("_auth/")) {
    return null;
  }
  const kind = template.slice("_auth/".length);
  return isAuthKind(kind) ? kind : null;
}

export interface AuthTemplateInfo {
  kind: AuthEmailKind;
  template: string;
  html: boolean;
  text: boolean;
  subject: boolean;
}

function authFile(projectDir: string, kind: AuthEmailKind, ext: "html" | "txt" | "subject"): string {
  return join(mailDir(projectDir), "_auth", `${kind}.${ext}`);
}

function readIf(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function listAuthTemplates(projectDir: string): AuthTemplateInfo[] {
  return AUTH_EMAIL_KINDS.map((kind) => ({
    kind,
    template: `_auth/${kind}`,
    html: existsSync(authFile(projectDir, kind, "html")),
    text: existsSync(authFile(projectDir, kind, "txt")),
    subject: existsSync(authFile(projectDir, kind, "subject")),
  }));
}

export interface AuthEmailData {
  appName: string;
  appUrl: string;
  link: string;
  email: string;
}

/**
 * Renders a built in account email. Files in mail/_auth/<kind>.html|.txt|.subject
 * override the defaults one by one; an overridden HTML body uses mail/_layout.html.
 */
export function renderAuthEmail(
  projectDir: string,
  kind: AuthEmailKind,
  input: AuthEmailData,
): { subject: string; html: string; text: string } {
  const fallback = renderAccountEmail(kind as AccountEmailKind, { appName: input.appName, link: input.link });
  const htmlSource = readIf(authFile(projectDir, kind, "html"));
  const textSource = readIf(authFile(projectDir, kind, "txt"));
  const subjectSource = readIf(authFile(projectDir, kind, "subject"));
  if (htmlSource === null && textSource === null && subjectSource === null) {
    return fallback;
  }
  const data = {
    app: { name: input.appName, url: input.appUrl },
    link: input.link,
    email: input.email,
    expires: EXPIRES[kind],
    purpose: kind,
  };
  const name = `mail/_auth/${kind}`;
  const subject =
    subjectSource === null
      ? fallback.subject
      : cleanSubject(compileTemplate(subjectSource, { name: `${name}.subject` }).render(data, "text"));
  let html = fallback.html;
  if (htmlSource !== null) {
    html = compileTemplate(htmlSource, { name: `${name}.html` }).render(data, "html");
    const layout = readIf(join(mailDir(projectDir), "_layout.html"));
    if (layout !== null && !/^\s*(<!doctype|<html)/i.test(html)) {
      html = compileTemplate(layout, { name: "mail/_layout.html", allowRaw: ["body"] }).render(
        { ...data, subject, body: html },
        "html",
      );
    }
  }
  let text = fallback.text;
  if (textSource !== null) {
    text = compileTemplate(textSource, { name: `${name}.txt` }).render(data, "text");
  } else if (htmlSource !== null) {
    text = htmlToText(html);
  }
  return { subject, html, text };
}

/** Boot check for mail/_auth overrides: valid syntax, and every body must contain the link. */
export function validateAuthTemplates(projectDir: string): string[] {
  const problems: string[] = [];
  for (const kind of AUTH_EMAIL_KINDS) {
    for (const ext of ["html", "txt", "subject"] as const) {
      const source = readIf(authFile(projectDir, kind, ext));
      if (source === null) {
        continue;
      }
      try {
        compileTemplate(source, { name: `mail/_auth/${kind}.${ext}` });
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (ext !== "subject" && !/\{\{\s*link\s*\}\}/.test(source)) {
        problems.push(`mail/_auth/${kind}.${ext} must include {{ link }}, otherwise the email is useless`);
      }
      if (ext === "subject" && /\{\{\s*link\s*\}\}/.test(source)) {
        problems.push(`mail/_auth/${kind}.subject must not include {{ link }}`);
      }
    }
  }
  return problems;
}

export function sampleAuthLink(appUrl: string, kind: AuthEmailKind): string {
  return `${appUrl.replace(/\/$/, "")}${PATHS[kind]}?token=preview-token-not-valid`;
}

// Sealing: the real message (with the one time link) is stored encrypted with a key
// derived from the JWT secret. The html/body_text columns only hold a redacted copy,
// so the delivery log, the database, and backups never show a usable token.

const SEAL_PREFIX = "v1:";

function sealKey(secret: string): Buffer {
  return createHash("sha256").update(`bakorin-mail-seal:${secret}`).digest();
}

export interface SealedMail {
  html: string;
  text: string;
  meta?: MailMessage["meta"];
}

export function sealMail(secret: string, payload: SealedMail): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `${SEAL_PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function unsealMail(secrets: Array<string | undefined>, sealed: string): SealedMail | null {
  if (!sealed.startsWith(SEAL_PREFIX)) {
    return null;
  }
  const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", sealKey(secret), iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
      return JSON.parse(plain) as SealedMail;
    } catch {
      // try the previous secret
    }
  }
  return null;
}

export const REDACTED = "[redacted]";

/** Removes the token (and with it every usable form of the link) from a rendered body. */
export function redactToken(value: string, token: string): string {
  if (!token) {
    return value;
  }
  return value.split(token).join(REDACTED);
}

export function mailSecrets(ast: SchemaAST): Array<string | undefined> {
  return [ast.runtime.jwtSecret, ast.runtime.jwtSecretPrevious];
}

export interface AuthMailContext {
  ast: SchemaAST;
  db: BakorinDb;
  mailer: Mailer;
  projectDir: string;
}

export function authLinkPath(kind: AuthEmailKind): string {
  return PATHS[kind];
}

export { TemplateError };
