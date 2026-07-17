export function supabaseServiceHeaders(serviceKey, inputHeaders) {
  const headers = new Headers(inputHeaders);
  headers.set("apikey", serviceKey);
  headers.set("content-type", "application/json");
  // Current secret keys are opaque API keys. Legacy service_role keys are
  // JWTs and must continue to be supplied as bearer authorization.
  if (!serviceKey.startsWith("sb_secret_")) {
    headers.set("authorization", `Bearer ${serviceKey}`);
  }
  return headers;
}
