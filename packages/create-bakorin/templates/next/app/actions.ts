"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { api } from "../lib/bakorin.ts";

export async function signupAction(formData: FormData): Promise<string | void> {
  try {
    const client = await api();
    await client.signup({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      name: String(formData.get("name") ?? ""),
    });
  } catch (error) {
    return error instanceof Error ? error.message : "Could not create the account";
  }
  redirect("/app");
}

export async function loginAction(formData: FormData): Promise<string | void> {
  try {
    const client = await api();
    await client.login({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
  } catch (error) {
    return error instanceof Error ? error.message : "Could not sign in";
  }
  redirect("/app");
}

export async function forgotAction(formData: FormData): Promise<void> {
  const client = await api();
  await client.forgotPassword({ email: String(formData.get("email") ?? "") });
}

export async function resetAction(formData: FormData): Promise<string | void> {
  try {
    const client = await api();
    await client.resetPassword({
      token: String(formData.get("token") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
  } catch (error) {
    return error instanceof Error ? error.message : "Could not reset the password";
  }
  redirect("/login");
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
  redirect("/app");
}

export async function createTaskAction(formData: FormData): Promise<string | void> {
  try {
    const client = await api();
    await client.entity("tasks").create({ title: String(formData.get("title") ?? "") });
  } catch (error) {
    return error instanceof Error ? error.message : "Could not create the task";
  }
  redirect("/app");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const refresh = store.get("bakorin_refresh")?.value;
  try {
    const client = await api();
    await client.logout(refresh);
  } catch {
    // still clear cookies
  }
  store.delete("bakorin_access");
  store.delete("bakorin_refresh");
  redirect("/");
}
