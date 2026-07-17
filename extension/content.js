(() => {
  const EXTENSION_VERSION = "0.4.6";
  const runtime = window.__foundExtensionRuntime;
  if (runtime) return;
  window.__foundExtensionRuntime = { version: EXTENSION_VERSION };

  let rendered = false;
  let checkPromise = null;
  let lastCheckedUrl = "";
  let automaticAttempts = 0;
  let currentMatchId = "";
  let lastDynamicSignature = "";
  let lastAutomaticCheckAt = 0;

  async function findMatch() {
    if (/^https:\/\/www\.google\.[^/]+\/search/i.test(location.href)) return { match: null, reason: "unsupported_page" };
    const pageText = (document.querySelector("main")?.innerText || document.body?.innerText || "").slice(0, 8000);
    try {
      return await chrome.runtime.sendMessage({
        type: "found:match-page",
        page: { pageText, pageTitle: document.title, pageUrl: location.href },
      });
    } catch {
      return { match: null, reason: "temporary_network_failure" };
    }
  }

  function safeSourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : null;
    } catch { return null; }
  }

  function render(match) {
    const existing = document.getElementById("found-extension-root");
    if ((rendered || existing) && currentMatchId === match.id) {
      existing?.querySelector(".ec-avatar")?.classList.add("arrive");
      existing?.querySelector(".ec-card")?.classList.add("open");
      existing?.querySelector(".ec-card")?.setAttribute("aria-hidden", "false");
      return;
    }
    if (existing) existing.remove();
    rendered = true;
    currentMatchId = match.id;
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
        <nav aria-label="Sources"><span>CONTINUE IN FOUND</span><div class="ec-links"></div></nav>
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
    const links = root.querySelector(".ec-links");
    const dashboardUrl = safeSourceUrl(match.dashboardUrl);
    if (dashboardUrl) {
      const dashboard = document.createElement("a");
      dashboard.href = dashboardUrl; dashboard.target = "_blank"; dashboard.rel = "noreferrer"; dashboard.textContent = "Open decision timeline ↗"; links.appendChild(dashboard);
    }
    const seenUrls = new Set([canonicalUrl(location.href)]);
    const seenKinds = new Set();
    for (const source of Array.isArray(match.links) ? match.links : []) {
      const href = safeSourceUrl(source?.url);
      const kind = String(source?.label || "Evidence").replace(/\s+evidence$/i, "").toLowerCase();
      if (!href || seenUrls.has(canonicalUrl(href)) || seenKinds.has(kind)) continue;
      seenUrls.add(canonicalUrl(href)); seenKinds.add(kind);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = `${String(source?.label || "Evidence").replace(/\s+evidence$/i, "")} receipt ↗`;
      links.appendChild(anchor);
    }
    document.documentElement.appendChild(root);

    const avatar = root.querySelector(".ec-avatar");
    const card = root.querySelector(".ec-card");
    const setOpen = open => { card.classList.toggle("open", open); card.setAttribute("aria-hidden", String(!open)); };
    avatar.addEventListener("click", () => setOpen(!card.classList.contains("open")));
    card.querySelector("header button").addEventListener("click", () => setOpen(false));
    card.querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const input = root.querySelector("#found-memory-update");
      const button = form.querySelector('button[type="submit"]');
      const note = form.querySelector("small");
      const updateText = input.value.trim();
      if (updateText.length < 12) return;
      button.disabled = true;
      button.textContent = "APPENDING…";
      note.textContent = "Reviewing this update against your authorised workspace…";
      const result = await chrome.runtime.sendMessage({
        type: "found:append-memory",
        update: { recordId: match.id, sourceUrl: location.href, updateText },
      }).catch(() => ({ ok: false, reason: "temporary_network_failure" }));
      if (result?.ok) {
        input.value = "";
        input.disabled = true;
        button.textContent = "APPENDED TO FOUND ✓";
        note.textContent = "Saved as a timestamped memory layer. The original source was not changed.";
        form.classList.add("saved");
        return;
      }
      const errors = {
        invalid_update: "Enter at least 12 characters.",
        not_connected: "Reconnect this browser to Found and try again.",
        session_expired: "Your Found browser session expired. Reconnect and try again.",
        workspace_access_revoked: "Workspace access changed. Reconnect with an authorised account.",
        record_not_found: "This evidence is no longer available in your workspace.",
        service_unavailable: "Found is temporarily unavailable. Try again shortly.",
        temporary_network_failure: "Found could not be reached. Try again shortly.",
      };
      note.textContent = errors[result?.reason] || "Found could not append this update. Try again.";
      button.textContent = "REVIEW & APPEND ↗";
      button.disabled = false;
    });
    avatar.classList.add("arrive");
    setOpen(true);
  }

  function canonicalUrl(value) { try { const url=new URL(value); return `${url.origin}${url.pathname}`.replace(/\/$/,""); } catch { return value; } }
  function pageContext() { return { pageText:(document.querySelector("main")?.innerText||document.body?.innerText||"").slice(0,2500),pageTitle:document.title,pageUrl:location.href }; }
  function dynamicSignature() { const context=pageContext(); return `${context.pageUrl}|${context.pageTitle}|${context.pageText.slice(0,1200)}`; }

  async function runCheck() {
    if (!checkPromise) {
      checkPromise = findMatch().then(result => {
        if (result.match) render(result.match);
        return result;
      }).finally(() => { checkPromise = null; });
    }
    return checkPromise;
  }

  function scheduleAutomaticChecks() {
    const checkCurrentPage = () => {
      const urlChanged = location.href !== lastCheckedUrl;
      if (urlChanged) {
        lastCheckedUrl = location.href;
        automaticAttempts = 0;
      }
      const dynamicPage = /(?:app\.slack\.com|docs\.google\.com)/i.test(location.hostname);
      const signature = dynamicPage ? dynamicSignature() : "";
      const dynamicChanged = dynamicPage && signature !== lastDynamicSignature && Date.now() - lastAutomaticCheckAt > 12_000;
      if (dynamicChanged) { lastDynamicSignature = signature; automaticAttempts = 0; }
      if ((urlChanged || !rendered || dynamicChanged) && automaticAttempts < 3) {
        automaticAttempts += 1;
        lastAutomaticCheckAt = Date.now();
        runCheck();
      }
    };
    setTimeout(checkCurrentPage, 700);
    setTimeout(checkCurrentPage, 2500);
    setTimeout(checkCurrentPage, 6000);
    setInterval(checkCurrentPage, 4000);
    addEventListener("pageshow", checkCurrentPage);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkCurrentPage(); });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "found:runtime-status") {
      sendResponse({ version: EXTENSION_VERSION });
      return;
    }
    if (message?.type === "found:page-context") { sendResponse(pageContext()); return; }
    if (message?.type !== "found:run") return;
    runCheck().then(result => sendResponse({ matched: Boolean(result.match), reason: result.reason })).catch(() => sendResponse({ matched: false, reason: "temporary_network_failure" }));
    return true;
  });

  scheduleAutomaticChecks();
})();
