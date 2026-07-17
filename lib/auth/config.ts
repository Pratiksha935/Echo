export type SupabasePublicConfig = {
  anonKey: string;
  url: string;
};

export type SupabaseServiceConfig = SupabasePublicConfig & {
  serviceRoleKey: string;
};

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function requireSupabasePublicConfig(): SupabasePublicConfig {
  const config = getSupabasePublicConfig();
  if (!config) {
    throw new Error("Supabase public configuration is missing.");
  }
  return config;
}

export function requireSupabaseServiceConfig(): SupabaseServiceConfig {
  const config = requireSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("Supabase service-role configuration is missing.");
  return { ...config, serviceRoleKey };
}
