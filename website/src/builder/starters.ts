// Starters come straight from the repo so the builder never drifts from what create-bakorin ships.
import blankYaml from "../../../packages/create-bakorin/templates/schemas/blank.yaml?raw";
import todoYaml from "../../../packages/create-bakorin/templates/schemas/todo.yaml?raw";
import leadsYaml from "../../../examples/studio-leads/app.yaml?raw";
import storeYaml from "../../../packages/create-bakorin/templates/schemas/store.yaml?raw";
import membershipYaml from "../../../packages/create-bakorin/templates/schemas/membership.yaml?raw";

export interface Starter {
  id: string;
  label: string;
  description: string;
  source: string;
  yaml: string;
}

const named = (yaml: string) => yaml.replaceAll("{{APP_NAME}}", "my-app");

export const STARTERS: Starter[] = [
  {
    id: "blank",
    label: "Blank",
    description: "Just the users entity and auth, from create-bakorin --schema blank.",
    source: "packages/create-bakorin/templates/schemas/blank.yaml",
    yaml: named(blankYaml),
  },
  {
    id: "todo",
    label: "Todo",
    description: "Users plus tasks owned by each user, from create-bakorin --schema todo.",
    source: "packages/create-bakorin/templates/schemas/todo.yaml",
    yaml: named(todoYaml),
  },
  {
    id: "leads",
    label: "Studio leads",
    description: "Users, leads, and tasks with two mail rules, from examples/studio-leads.",
    source: "examples/studio-leads/app.yaml",
    yaml: leadsYaml,
  },
  {
    id: "store",
    label: "Store with Stripe",
    description: "Products with rich text descriptions and stock, carts, orders with JSON lines, and Stripe events, from create-bakorin --template store.",
    source: "packages/create-bakorin/templates/schemas/store.yaml",
    yaml: named(storeYaml),
  },
  {
    id: "membership",
    label: "Membership with Stripe",
    description: "Plan tiers as roles, lessons for members, masterclasses for Pro, and Stripe checkouts, from create-bakorin --template membership.",
    source: "packages/create-bakorin/templates/schemas/membership.yaml",
    yaml: named(membershipYaml),
  },
];
