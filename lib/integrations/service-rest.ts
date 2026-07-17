import { requireSupabaseServiceConfig } from "../auth/config";
import { supabaseServiceHeaders } from "./service-headers";

export async function serviceRest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const config = requireSupabaseServiceConfig();
  const headers = supabaseServiceHeaders(config.serviceRoleKey, init.headers);
  const response = await fetch(`${config.url}/rest/v1${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });
  if (!response.ok) throw new Error(`Persistence request failed (${response.status}).`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
