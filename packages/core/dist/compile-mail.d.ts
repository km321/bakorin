/** Mail rules in app.yaml and checks on their template placeholders. */
import type { AppYaml } from "./yaml-schema.ts";
import { type EntityAST, type MailRuleAST } from "./ast.ts";
export declare function compileMailRules(yaml: AppYaml, entityMap: Record<string, EntityAST>): MailRuleAST[];
