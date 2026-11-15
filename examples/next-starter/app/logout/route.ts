import { logoutAction } from "../actions.ts";

export async function GET() {
  await logoutAction();
}
