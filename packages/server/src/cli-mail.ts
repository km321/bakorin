/** bakorin mail list and mail preview. */

import { buildPreview, PreviewError } from "./mail/routes.ts";
import { listTemplates } from "./mail/files.ts";
import { arg, projectDir } from "./cli-args.ts";
import { loadOrExit } from "./cli-serve.ts";

export async function cmdMail(): Promise<void> {
  const sub = process.argv[3];
  const dir = projectDir();
  if (sub === "list") {
    for (const template of listTemplates(dir)) {
      const parts = [template.html ? "html" : "", template.text ? "txt" : "", template.subject ? "subject" : ""];
      console.log(`${template.name}  (${parts.filter(Boolean).join(", ")})`);
    }
    return;
  }
  const template = process.argv[4];
  if (sub !== "preview" || !template || template.startsWith("-")) {
    console.error("usage: bakorin mail preview <template|rule> [--entity orders] [--record <id>] [--format html|text|json]");
    console.error("       bakorin mail list");
    process.exit(1);
  }
  const runtime = await loadOrExit(dir, { workers: false });
  const format = (arg("--format", "html") ?? "html").toLowerCase();
  try {
    const isRule = (runtime.ast.mail ?? []).some((rule) => rule.id === template);
    const preview = await buildPreview(runtime.context, {
      template: isRule ? undefined : template,
      ruleId: isRule ? template : undefined,
      entity: arg("--entity"),
      recordId: arg("--record"),
    });
    if (format === "json") {
      const { subject, html, text } = preview.rendered;
      const out = { template: preview.template, ruleId: preview.ruleId, sample: preview.sample, to: preview.to, subject, text, html };
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    } else if (format === "text") {
      process.stdout.write(`Subject: ${preview.rendered.subject}\n\n${preview.rendered.text}\n`);
    } else {
      process.stdout.write(`${preview.rendered.html}\n`);
    }
  } catch (error) {
    if (error instanceof PreviewError) {
      console.error(error.message);
      await runtime.close();
      process.exit(1);
    }
    throw error;
  }
  await runtime.close();
}
