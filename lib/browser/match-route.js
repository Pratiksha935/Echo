const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

/**
 * Browser match request handling with dependencies supplied by the server route.
 * Keeping the request contract here makes every authorization branch executable
 * without exposing server credentials to the browser.
 */
export function createBrowserMatchHandler({ matchKnowledge, query, verifyToken, reportError = console.error }) {
  return async function handleBrowserMatch(request) {
    const origin = allowedOrigin(request);
    if (!origin) return json({ error: "forbidden_origin" }, 403);
    const headers = corsHeaders(origin);
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ") ? verifyToken(authorization.slice(7)) : null;
    if (!token) return json({ error: "unauthorized" }, 401, headers);

    let memberships;
    try {
      memberships = await query(`/memberships?select=id&organisation_id=eq.${encodeURIComponent(token.organisationId)}&user_id=eq.${encodeURIComponent(token.userId)}&limit=1`);
    } catch (error) {
      reportError("browser_match_membership_check_failed", error);
      return json({ error: "membership_check_unavailable" }, 503, headers);
    }
    if (!memberships[0]) return json({ error: "workspace_access_revoked" }, 403, headers);

    const body = await request.json().catch(() => null);
    const pageTitle = typeof body?.pageTitle === "string" ? body.pageTitle.slice(0, 500) : "";
    const pageText = typeof body?.pageText === "string" ? body.pageText.slice(0, 8_000) : "";
    const pageUrl = typeof body?.pageUrl === "string" ? body.pageUrl.slice(0, 2_000) : "";
    if (!pageTitle && !pageText && !pageUrl) return json({ match: null }, 200, headers);

    let rows;
    try {
      rows = await query(`/knowledge_records?select=source,external_id,title,body,author_name,department,source_url,metadata&organisation_id=eq.${encodeURIComponent(token.organisationId)}&order=source_updated_at.desc&limit=200`);
    } catch (error) {
      reportError("browser_match_knowledge_lookup_failed", error);
      return json({ error: "knowledge_unavailable" }, 503, headers);
    }
    const records = rows.map(row => ({ authorName: row.author_name, body: row.body, department: row.department, externalId: row.external_id, source: row.source, sourceUrl: row.source_url, status: row.metadata?.status ?? "Indexed", title: row.title }));
    const match = matchKnowledge({ pageText, pageTitle, pageUrl, records });
    if (!match) return json({ match: null }, 200, headers);
    return json({ match: {
      account: { email: token.email, organisationName: token.organisationName },
      ...match,
      url: pageUrl,
    } }, 200, headers);
  };
}

export function browserMatchOptions(request) {
  const origin = allowedOrigin(request);
  return new Response(null, { status: origin ? 204 : 403, headers: origin ? corsHeaders(origin) : undefined });
}

function allowedOrigin(request) {
  const origin = request.headers.get("origin");
  return origin && EXTENSION_ORIGIN.test(origin) ? origin : null;
}

function corsHeaders(origin) {
  return {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-origin": origin,
    "cache-control": "no-store",
    vary: "origin",
  };
}

function json(body, status, headers) {
  return Response.json(body, { status, headers });
}
