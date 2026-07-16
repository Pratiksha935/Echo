"use client";

import { useEffect, useState } from "react";

export default function MagicLinkPage() {
  const [message, setMessage] = useState("Securing your Found session…");

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    const expiresIn = fragment.get("expires_in");
    const error = fragment.get("error_description") ?? fragment.get("error");
    const returnTo = new URLSearchParams(window.location.search).get("return_to") ?? "/integrations";

    // Remove provider credentials from browser history before exchanging them
    // for Found's HTTP-only session cookies.
    window.history.replaceState({}, "", "/auth/magic");

    if (error || !accessToken || !refreshToken) {
      queueMicrotask(() => setMessage("This sign-in link is invalid or expired. Request a new one from Found."));
      return;
    }

    void fetch("/auth/magic/session", {
      body: JSON.stringify({ accessToken, expiresIn, refreshToken, returnTo }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    }).then(async response => {
      if (!response.ok) throw new Error("session_failed");
      const result = await response.json() as { returnTo?: string };
      window.location.replace(result.returnTo ?? "/integrations");
    }).catch(() => setMessage("Found could not secure this session. Request a new sign-in link."));
  }, []);

  return <main className="magicPage"><div><span>FOUND / SECURE SIGN-IN</span><h1>Opening your<br/>workspace.</h1><p>{message}</p><a href="/login">Request another sign-in link ↗</a></div></main>;
}
