"use server";

import { redirect } from "next/navigation";
import { api } from "../lib/bakorin.ts";
import { site } from "../lib/site.ts";

export async function verifyEmailAction(formData: FormData): Promise<string | void> {
  try {
    const client = await api();
    await client.verifyEmail({ token: String(formData.get("token") ?? "") });
  } catch (error) {
    return error instanceof Error ? error.message : "Could not verify the email";
  }
}

export async function acceptInviteAction(formData: FormData): Promise<string | void> {
  try {
    const client = await api();
    await client.acceptInvite({
      token: String(formData.get("token") ?? ""),
      password: String(formData.get("password") ?? ""),
      name: String(formData.get("name") ?? "") || undefined,
    });
  } catch (error) {
    return error instanceof Error ? error.message : "Could not accept the invite";
  }
  redirect(site.home);
}

