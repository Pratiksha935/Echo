(() => {
  const EXTENSION_VERSION = "0.4.1";
  if (window.__foundExtensionVersion === EXTENSION_VERSION) return;
  window.__foundExtensionVersion = EXTENSION_VERSION;

  const FOUND_ORIGIN = "https://sage-profiterole-3b1c22.netlify.app";
  const TOKEN_KEY = "found:browser-session";
  const PROFILE_KEY = "found:browser-profile";
  let rendered = false;

  async function findMatch() {
    if (/^https:\/\/www\.google\.[^/]+\/search/i.test(location.href)) return { match: null, reason: "unsupported_page" };
    const stored = await chrome.storage.local.get([TOKEN_KEY, PROFILE_KEY]);
    const token = stored[TOKEN_KEY];
    if (!token) return { match: null, reason: "not_connected" };

    const pageText = (document.querySelector("main")?.innerText || document.body?.innerText || "").slice(0, 8000);
    try {
      const response = await fetch(`${FOUND_ORIGIN}/api/browser/match`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ pageText, pageTitle: document.title, pageUrl: location.href }),
      });
      if (response.status === 401 || response.status === 403) {
        await chrome.storage.local.remove([TOKEN_KEY, PROFILE_KEY]);
        return { match: null, reason: response.status === 403 ? "workspace_access_revoked" : "session_expired" };
      }
      if (!response.ok) return { match: null, reason: "service_unavailable" };
      const payload = await response.json();
      return payload?.match ? { match: payload.match, reason: "matched" } : { match: null, reason: "no_match" };
    } catch {
      return { match: null, reason: "service_unavailable" };
    }
  }

  async function pairBrowser() {
    if (location.origin !== FOUND_ORIGIN) return;
    const status = document.querySelector("[data-found-pair-status]");
    const detail = document.querySelector("[data-found-pair-detail]");
    try {
      const response = await fetch("/api/browser/session", { credentials: "include" });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) await chrome.storage.local.remove([TOKEN_KEY, PROFILE_KEY]);
        if (status) status.textContent = response.status === 401 ? "Sign in to connect." : "Workspace access required.";
        if (detail) detail.textContent = "Found could not authorise this browser for a workspace yet.";
        return;
      }
      const payload = await response.json();
      if (payload?.token && payload?.profile) {
        await chrome.storage.local.set({ [TOKEN_KEY]: payload.token, [PROFILE_KEY]: payload.profile });
        if (status) status.textContent = "Browser connected.";
        if (detail) detail.textContent = `${payload.profile.organisationName} · ${payload.profile.email}. Return to the page you were reading; Found is ready.`;
      }
    } catch {
      if (status) status.textContent = "Connection could not be completed.";
      if (detail) detail.textContent = "Reload the extension and try this connection page once more.";
    }
  }

  function safeSourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : null;
    } catch { return null; }
  }

  function render(match) {
    if (rendered || document.getElementById("found-extension-root")) return;
    rendered = true;
    const root = document.createElement("div");
    root.id = "found-extension-root";
    root.innerHTML = `
      <button class="ec-avatar" aria-label="Open Found finding"><span class="ec-face"><i></i><i></i><b></b></span><em></em></button>
      <aside class="ec-card" aria-hidden="true">
        <header><span><i></i> FOUND · COMPANY INSIGHT</span><button aria-label="Close">×</button></header>
        <div class="ec-confidence"><b></b><span>HIGH-CONFIDENCE MATCH</span></div>
        <h2></h2>
        <dl><div><dt>OWNER</dt><dd class="ec-owner"></dd></div><div><dt>STATUS</dt><dd class="ec-status"></dd></div></dl>
        <section class="ec-explanation"><span>WHAT FOUND KNOWS</span><p class="ec-summary"></p></section>
        <section class="ec-explanation ec-recommendation"><span>RECOMMENDED NEXT STEP</span><p></p></section>
        <nav aria-label="Sources"><span>SOURCE RECEIPTS</span><div class="ec-links"><a class="ec-original" target="_blank" rel="noreferrer">Open page ↗</a></div></nav>
        <div class="ec-update"><form><label for="found-memory-update">Correct or update Found memory</label><input id="found-memory-update" type="text" maxlength="800" minlength="12" placeholder="What changed?" required><small>Your update is appended with your identity. Original Slack and Google sources stay untouched.</small><button type="submit">REVIEW &amp; APPEND <b>↗</b></button></form></div>
        <footer><span>LIVE FOUND MEMORY</span><span class="ec-account"></span></footer>
      </aside>`;

    const score = Number.isFinite(match.score) ? Math.max(1, Math.min(5, match.score)) : 2;
    root.querySelector(".ec-avatar em").textContent = String(score + 1);
    root.querySelector(".ec-confidence b").textContent = `${Math.min(96, 78 + score * 4)}%`;
    root.querySelector("h2").textContent = match.title || "Related company knowledge";
    root.querySelector(".ec-owner").textContent = match.owner || "Company knowledge";
    root.querySelector(".ec-status").textContent = match.status || "Indexed";
    root.querySelector(".ec-summary").textContent = match.summary || "Related indexed evidence was found.";
    root.querySelector(".ec-recommendation p").textContent = match.recommendation || "Review the source evidence before proceeding.";
    root.querySelector(".ec-account").textContent = `${match.account?.organisationName || "Authorised workspace"} · ${match.account?.email || "paired user"}`;
    root.querySelector(".ec-original").href = location.href;
    const links = root.querySelector(".ec-links");
    for (const source of Array.isArray(match.links) ? match.links : []) {
      const href = safeSourceUrl(source?.url);
      if (!href) continue;
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = `${source?.label || "Evidence"} ↗`;
      links.appendChild(anchor);
    }
    document.documentElement.appendChild(root);

    const avatar = root.querySelector(".ec-avatar");
    const card = root.querySelector(".ec-card");
    const setOpen = open => { card.classList.toggle("open", open); card.setAttribute("aria-hidden", String(!open)); };
    avatar.addEventListener("click", () => setOpen(!card.classList.contains("open")));
    card.querySelector("header button").addEventListener("click", () => setOpen(false));
    card.querySelector("form").addEventListener("submit", event => {
      event.preventDefault();
      const updateText = root.querySelector("#found-memory-update").value.trim();
      if (updateText.length < 12) return;
      const params = new URLSearchParams({ correction: updateText, record_id: match.id, source_url: location.href, title: match.title });
      window.open(`${FOUND_ORIGIN}/memory/correct?${params}`, "_blank", "noopener,noreferrer");
    });
    setTimeout(() => { avatar.classList.add("arrive"); setOpen(true); }, 500);
  }

  async function runCheck() {
    const result = await findMatch();
    if (result.match) render(result.match);
    return result;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "found:run") return;
    runCheck().then(result => sendResponse({ matched: Boolean(result.match), reason: result.reason })).catch(() => sendResponse({ matched: false, reason: "service_unavailable" }));
    return true;
  });

  pairBrowser();
  setTimeout(runCheck, 700);
  setTimeout(() => { if (!rendered) runCheck(); }, 3000);
})();
