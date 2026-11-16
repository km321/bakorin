/** The auth entity: which entity signs in, signup mode, and private auth fields. */
import type { AppYaml } from "./yaml-schema.ts";
import type { AuthAST, EntityAST } from "./ast.ts";
export declare function findAuthEntity(yaml: AppYaml, entities: EntityAST[]): AuthAST;
