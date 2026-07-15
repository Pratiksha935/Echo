import { redirect } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { getSupabasePublicConfig } from "../lib/auth/config";
import { getDemoAccessUser, getSupabaseUser, hasRefreshToken, type FoundUser } from "../lib/auth/session";

export async function getFoundUser(): Promise<FoundUser | null> {
  const demoUser = await getDemoAccessUser();
  if (demoUser) return demoUser;
  if (getSupabasePublicConfig()) return getSupabaseUser();

  const user = await getChatGPTUser();
  return user ? { ...user, id: user.email } : null;
}

export async function requireFoundUser(returnTo: string): Promise<FoundUser> {
  const user = await getFoundUser();
  if (user) return user;

  if (getSupabasePublicConfig()) {
    const target = encodeURIComponent(returnTo);
    if (await hasRefreshToken()) redirect(`/auth/refresh?return_to=${target}`);
    redirect(`/login?return_to=${target}`);
  }

  redirect(chatGPTSignInPath(returnTo));
}

export function foundSignInPath(returnTo: string): string {
  return getSupabasePublicConfig()
    ? `/login?return_to=${encodeURIComponent(returnTo)}`
    : chatGPTSignInPath(returnTo);
}
