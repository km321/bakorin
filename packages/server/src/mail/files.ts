import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { compileTemplate, escapeHtml, htmlToText, TemplateError } from "./engine.ts";

export const MAIL_TEMPLATE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_TEMPLATE_BYTES = 512 * 1024;

export interface TemplateInfo {
  name: string;
  html: boolean;
  text: boolean;
  subject: boolean;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export function mailDir(projectDir: string): string {
  return join(projectDir, "mail");
}

function readOptional(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  const stats = statSync(path);
  if (!stats.isFile()) {
    return null;
  }
  if (stats.size > MAX_TEMPLATE_BYTES) {
    throw new TemplateError(`${path} is larger than ${MAX_TEMPLATE_BYTES} bytes`);
  }
  return readFileSync(path, "utf8");
}

export function listTemplates(projectDir: string): TemplateInfo[] {
  const dir = mailDir(projectDir);
  if (!existsSync(dir)) {
    return [];
  }
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    const match = /^(.+)\.(html|txt)$/.exec(file);
    if (match?.[1] && MAIL_TEMPLATE_NAME.test(match[1])) {
      names.add(match[1]);
    }
  }
  return [...names].sort().map((name) => ({
    name,
    html: existsSync(join(dir, `${name}.html`)),
    text: existsSync(join(dir, `${name}.txt`)),
    subject: existsSync(join(dir, `${name}.subject`)),
  }));
}

export function hasLayout(projectDir: string): boolean {
  return existsSync(join(mailDir(projectDir), "_layout.html"));
}

export function templateExists(projectDir: string, name: string): boolean {
  if (!MAIL_TEMPLATE_NAME.test(name)) {
    return false;
  }
  const dir = mailDir(projectDir);
  return existsSync(join(dir, `${name}.html`)) || existsSync(join(dir, `${name}.txt`));
}

/** Collapses whitespace and line breaks so a subject can never inject headers. */
export function cleanSubject(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 500);
}

export interface RenderOptions {
  template?: string;
  data: Record<string, unknown>;
  /** Subject template from app.yaml or a hook. Wins over mail/<name>.subject. */
  subject?: string;
  /** Inline content for hook sends without a template file. */
  html?: string;
  text?: string;
}

/**
 * Renders a template from <project>/mail. Values are HTML escaped in .html files,
 * the optional _layout.html wraps the body through {{{ body }}}, and a plain text
 * version is generated when no .txt file exists.
 */
export function renderMail(projectDir: string, options: RenderOptions): RenderedMail {
  const dir = mailDir(projectDir);
  let bodyHtml: string | null = null;
  let bodyText: string | null = null;
  let subjectSource = options.subject ?? null;
  const name = options.template;
  if (name) {
    if (!MAIL_TEMPLATE_NAME.test(name)) {
      throw new TemplateError(`invalid template name ${JSON.stringify(name)}`);
    }
    const htmlSource = readOptional(join(dir, `${name}.html`));
    const textSource = readOptional(join(dir, `${name}.txt`));
    if (htmlSource === null && textSource === null) {
      throw new TemplateError(`template ${name} not found: add mail/${name}.html (or mail/${name}.txt)`);
    }
    if (htmlSource !== null) {
      bodyHtml = compileTemplate(htmlSource, { name: `mail/${name}.html` }).render(options.data, "html");
    }
    if (textSource !== null) {
      bodyText = compileTemplate(textSource, { name: `mail/${name}.txt` }).render(options.data, "text");
    }
    if (subjectSource === null) {
      subjectSource = readOptional(join(dir, `${name}.subject`));
    }
  } else {
    if (options.html === undefined && options.text === undefined) {
      throw new TemplateError("mail needs a template, html, or text");
    }
    bodyHtml = options.html ?? null;
    bodyText = options.text ?? null;
  }
  if (subjectSource === null || subjectSource.trim() === "") {
    throw new TemplateError(
      name ? `template ${name} has no subject: set subject in app.yaml or add mail/${name}.subject` : "mail needs a subject",
    );
  }
  const subject = cleanSubject(
    compileTemplate(subjectSource, { name: name ? `mail/${name}.subject` : "subject" }).render(options.data, "text"),
  );
  if (bodyHtml === null) {
    bodyHtml = textToHtml(bodyText ?? "");
  }
  let html = bodyHtml;
  const layoutSource = name ? readOptional(join(dir, "_layout.html")) : null;
  if (layoutSource !== null && !/^\s*(<!doctype|<html)/i.test(bodyHtml)) {
    html = compileTemplate(layoutSource, { name: "mail/_layout.html", allowRaw: ["body"] }).render(
      { ...options.data, subject, body: bodyHtml },
      "html",
    );
  }
  const text = bodyText ?? htmlToText(html);
  return { subject, html, text };
}

export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/**
 * Checks every app.yaml mail rule against the files in <project>/mail at boot and on
 * reload, so a typo in a template name or a broken {{#if}} shows up immediately.
 */
export function validateMailTemplates(
  projectDir: string,
  rules: Array<{ id: string; template: string; subject?: string }>,
): void {
  const dir = mailDir(projectDir);
  const problems: string[] = [];
  const checkSyntax = (file: string, allowRaw: string[] = []) => {
    try {
      const source = readOptional(join(dir, file));
      if (source !== null) {
        compileTemplate(source, { name: `mail/${file}`, allowRaw });
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  };
  for (const rule of rules) {
    if (!templateExists(projectDir, rule.template)) {
      problems.push(`mail rule ${rule.id}: template ${rule.template} not found, add mail/${rule.template}.html`);
      continue;
    }
    if (!rule.subject && !existsSync(join(dir, `${rule.template}.subject`))) {
      problems.push(
        `mail rule ${rule.id}: no subject, set subject in app.yaml or add mail/${rule.template}.subject`,
      );
    }
  }
  for (const template of listTemplates(projectDir)) {
    checkSyntax(`${template.name}.html`);
    checkSyntax(`${template.name}.txt`);
    checkSyntax(`${template.name}.subject`);
  }
  checkSyntax("_layout.html", ["body"]);
  if (problems.length > 0) {
    throw new TemplateError(problems.join("\n"));
  }
}
