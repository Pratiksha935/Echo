import { requireSupabaseServiceConfig } from "../auth/config";

export async function serviceRest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const config = requireSupabaseServiceConfig();
  const response = await fetch(`${config.url}/rest/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Persistence request failed (${response.status}).`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
