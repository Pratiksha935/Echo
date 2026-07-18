(() => {
  const EXTENSION_VERSION = "0.5.1";
  const FOUND_PRODUCT_HOST = /^(?:[a-z0-9-]+--)?sage-profiterole-3b1c22\.netlify\.app$/i;
  if (FOUND_PRODUCT_HOST.test(location.hostname)) return;
  const runtime = window.__foundExtensionRuntime;
  if (runtime) return;
  window.__foundExtensionRuntime = { version: EXTENSION_VERSION };

  let checkPromise = null;
  let lastCheckedUrl = "";
  let automaticAttempts = 0;
  let currentMatchId = "";
  let lastDynamicSignature = "";
  let lastAutomaticCheckAt = 0;
  let lastNoMatchReason = "";
  let latestMatch = null;

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function slackPageText(maxLength) {
    const selectors = [
      '[data-qa="message_content"]',
      '[data-qa="message-text"]',
      ".c-message_kit__text",
      '[data-qa="virtual-list-item"] .p-rich_text_section',
    ];
    const messages = [];
    const seen = new Set();
    for (const node of document.querySelectorAll(selectors.join(","))) {
      const text = compactText(node.innerText || node.textContent);
      if (text.length < 2 || seen.has(text)) continue;
      seen.add(text);
      messages.push(text);
    }
    const channel = compactText(
      document.querySelector('[data-qa="channel_name"]')?.textContent ||
      document.querySelector('[data-qa="channel-title"]')?.textContent ||
      document.querySelector("h1")?.textContent,
    );
    const recentMessages = messages.slice(-40).join("\n\n");
    return [channel, recentMessages].filter(Boolean).join("\n\n").slice(-maxLength);
  }

  function readPageText(maxLength) {
    if (location.hostname === "app.slack.com") {
      const slackText = slackPageText(maxLength);
      if (slackText) return slackText;
    }
    return (document.querySelector("main")?.innerText || document.body?.innerText || "").slice(0, maxLength);
  }

  function pageContext() {
    return { pageText: readPageText(2500), pageTitle: document.title, pageUrl: location.href };
  }

  function dynamicSignature() {
    const context = pageContext();
    const excerpt = location.hostname === "app.slack.com" ? context.pageText.slice(-1200) : context.pageText.slice(0, 1200);
    return `${context.pageUrl}|${context.pageTitle}|${excerpt}`;
  }

  function canonicalUrl(value) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`.replace(/\/$/, "");
    } catch {
      return value;
    }
  }

  function safeSourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  async function isTemporarilySuppressed() {
    const result = await chrome.runtime.sendMessage({ type: "found:redirect-suppression-status", pageUrl: location.href }).catch(() => null);
    return Boolean(result?.suppressed);
  }

  async function findMatch() {
    if (/^https:\/\/www\.google\.[^/]+\/search/i.test(location.href)) return { match: null, reason: "unsupported_page" };
    if (await isTemporarilySuppressed()) return { match: null, reason: "intentional_redirect" };
    const pageText = readPageText(8000);
    try {
      return await chrome.runtime.sendMessage({
        type: "found:match-page",
        page: { pageText, pageTitle: document.title, pageUrl: location.href },
      });
    } catch {
      return { match: null, reason: "temporary_network_failure" };
    }
  }

  function ensureRoot() {
    let root = document.getElementById("found-extension-root");
    if (root) return root;
    root = document.createElement("div");
    root.id = "found-extension-root";
    root.innerHTML = `
      <button class="ec-avatar" aria-label="Open Found memory"><span class="ec-face"><i></i><i></i><b></b></span><em hidden></em></button>
      <aside class="ec-card ec-capture-mode" aria-hidden="true">
        <header><span><i></i> FOUND · BROWSER MEMORY</span><button aria-label="Close">×</button></header>
        <div class="ec-match-view" hidden>
          <div class="ec-confidence"><b></b><span>HIGH-CONFIDENCE MATCH</span></div>
          <h2></h2>
          <dl><div><dt>OWNER</dt><dd class="ec-owner"></dd></div><div><dt>STATUS</dt><dd class="ec-status"></dd></div></dl>
          <section class="ec-explanation"><span>WHAT FOUND KNOWS</span><p class="ec-summary"></p></section>
          <section class="ec-explanation ec-recommendation"><span>RECOMMENDED NEXT STEP</span><p></p></section>
          <nav aria-label="Sources"><span>Open the receipt</span><div class="ec-links"></div></nav>
        </div>
        <form class="ec-capture-view">
          <strong>Save this page to Found</strong>
          <p>No strong prior-work match is open. Add this URL, comment, and department to company memory.</p>
          <label>Department</label>
          <select class="ec-department" required>
            <option value="Research">Research</option>
            <option value="Product">Product</option>
            <option value="GTM">GTM</option>
            <option value="Sales">Sales / client</option>
            <option value="Engineering">Engineering</option>
            <option value="Browser">General browser memory</option>
          </select>
          <label>Comment</label>
          <textarea class="ec-note" minlength="12" maxlength="1200" required placeholder="What should the team remember about this page?"></textarea>
          <small class="ec-capture-note">Found saves the current URL as the source receipt. It will not edit this page.</small>
          <button type="submit">ADD TO MEMORY <b>↗</b></button>
        </form>
        <div class="ec-update" hidden><form><label for="found-memory-update">Correct or update Found memory</label><input id="found-memory-update" type="text" maxlength="800" minlength="12" placeholder="What changed?" required><small>Your update is appended with your identity. Original Slack and Google sources stay untouched.</small><button type="submit">REVIEW &amp; APPEND <b>↗</b></button></form></div>
        <footer><span>LIVE FOUND MEMORY</span><span class="ec-account"></span></footer>
      </aside>`;
    document.documentElement.appendChild(root);

    const avatar = root.querySelector(".ec-avatar");
    const card = root.querySelector(".ec-card");
    const setOpen = open => { card.classList.toggle("open", open); card.setAttribute("aria-hidden", String(!open)); };
    avatar.addEventListener("click", () => setOpen(!card.classList.contains("open")));
    card.querySelector("header button").addEventListener("click", () => setOpen(false));
    root.querySelector(".ec-capture-view").addEventListener("submit", submitCapture);
    root.querySelector(".ec-update form").addEventListener("submit", submitUpdate);
    avatar.classList.add("arrive");
    return root;
  }

  async function submitCapture(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const note = form.querySelector(".ec-capture-note");
    const updateText = form.querySelector(".ec-note").value.trim();
    if (updateText.length < 12) return;
    button.disabled = true;
    button.textContent = "ADDING…";
    note.textContent = "Saving the URL, department, and comment to your authorised workspace…";
    const result = await chrome.runtime.sendMessage({
      type: "found:capture-page",
      capture: {
        ...pageContext(),
        department: form.querySelector(".ec-department").value,
        note: updateText,
      },
    }).catch(() => ({ ok: false, reason: "temporary_network_failure" }));
    if (result?.ok) {
      form.classList.add("saved");
      form.querySelector(".ec-note").value = "";
      note.textContent = "Saved to Found. If similar work appears later, Found can surface it as a battlecard.";
      button.disabled = false;
      button.textContent = "ADDED TO MEMORY ✓";
      return;
    }
    const errors = {
      invalid_capture: "Add a comment of at least 12 characters and choose a department.",
      not_connected: "Connect this browser to Found and try again.",
      session_expired: "Your Found browser session expired. Reconnect and try again.",
      workspace_access_revoked: "Workspace access changed. Reconnect with an authorised account.",
      service_unavailable: "Found is temporarily unavailable. Try again shortly.",
      temporary_network_failure: "Found could not be reached. Try again shortly.",
    };
    note.textContent = errors[result?.reason] || "Found could not save this page. Try again.";
    button.textContent = "ADD TO MEMORY ↗";
    button.disabled = false;
  }

  async function submitUpdate(event) {
    event.preventDefault();
    if (!latestMatch) return;
    const form = event.currentTarget;
    const input = form.querySelector("#found-memory-update");
    const button = form.querySelector('button[type="submit"]');
    const note = form.querySelector("small");
    const updateText = input.value.trim();
    if (updateText.length < 12) return;
    button.disabled = true;
    button.textContent = "APPENDING…";
    note.textContent = "Reviewing this update against your authorised workspace…";
    const result = await chrome.runtime.sendMessage({
      type: "found:append-memory",
      update: { recordId: latestMatch.id, sourceUrl: location.href, updateText },
    }).catch(() => ({ ok: false, reason: "temporary_network_failure" }));
    if (result?.ok) {
      input.value = "";
      input.disabled = true;
      const decisionUrl = safeSourceUrl(latestMatch.dashboardUrl);
      button.textContent = decisionUrl ? "VIEW UPDATED DECISION ↗" : "APPENDED TO FOUND ✓";
      button.type = "button";
      button.disabled = false;
      if (decisionUrl) button.addEventListener("click", () => openWithSuppression(decisionUrl));
      note.textContent = decisionUrl ? "Saved as a timestamped memory layer. Open the decision timeline to review it." : "Saved as a timestamped memory layer. The original source was not changed.";
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
  }

  function openWithSuppression(url) {
    chrome.runtime.sendMessage({ type: "found:note-outbound", targetUrl: url }).finally(() => {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.click();
    });
  }

  function showCaptureOnly({ open = false } = {}) {
    const root = ensureRoot();
    const card = root.querySelector(".ec-card");
    card.classList.add("ec-capture-mode");
    root.querySelector(".ec-match-view").hidden = true;
    root.querySelector(".ec-capture-view").hidden = false;
    root.querySelector(".ec-update").hidden = true;
    root.querySelector(".ec-avatar em").hidden = true;
    root.querySelector(".ec-account").textContent = "Ready to save URLs";
    if (open) {
      card.classList.add("open");
      card.setAttribute("aria-hidden", "false");
    }
  }

  function render(match) {
    latestMatch = match;
    const root = ensureRoot();
    const card = root.querySelector(".ec-card");
    if (currentMatchId === match.id && card.classList.contains("open")) return;
    currentMatchId = match.id;
    card.classList.remove("ec-capture-mode");
    root.querySelector(".ec-match-view").hidden = false;
    root.querySelector(".ec-capture-view").hidden = true;
    root.querySelector(".ec-update").hidden = false;
    const score = Number.isFinite(match.score) ? Math.max(1, Math.min(5, match.score)) : 2;
    const badge = root.querySelector(".ec-avatar em");
    badge.textContent = String(score + 1);
    badge.hidden = false;
    root.querySelector(".ec-confidence b").textContent = `${Math.min(96, 78 + score * 4)}%`;
    root.querySelector("h2").textContent = match.title || "Related company knowledge";
    root.querySelector(".ec-owner").textContent = match.owner || "Company knowledge";
    root.querySelector(".ec-status").textContent = match.status || "Indexed";
    root.querySelector(".ec-summary").textContent = match.summary || "Related indexed evidence was found.";
    root.querySelector(".ec-recommendation p").textContent = match.recommendation || "Review the source evidence before proceeding.";
    root.querySelector(".ec-account").textContent = `${match.account?.organisationName || "Authorised workspace"} · ${match.account?.email || "paired user"}`;
    const links = root.querySelector(".ec-links");
    links.textContent = "";
    const seenUrls = new Set([canonicalUrl(location.href)]);
    const dashboardUrl = safeSourceUrl(match.dashboardUrl);
    if (dashboardUrl) {
      const dashboard = document.createElement("button");
      dashboard.type = "button";
      dashboard.textContent = "Decision timeline ↗";
      dashboard.addEventListener("click", () => openWithSuppression(dashboardUrl));
      links.appendChild(dashboard);
      seenUrls.add(canonicalUrl(dashboardUrl));
    }
    const seenKinds = new Set();
    for (const source of Array.isArray(match.links) ? match.links : []) {
      const href = safeSourceUrl(source?.url);
      const kind = String(source?.label || "Evidence").replace(/\s+evidence$/i, "").toLowerCase();
      if (!href || seenUrls.has(canonicalUrl(href)) || seenKinds.has(kind)) continue;
      seenUrls.add(canonicalUrl(href)); seenKinds.add(kind);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${String(source?.label || "Evidence").replace(/\s+evidence$/i, "")} receipt ↗`;
      button.addEventListener("click", () => openWithSuppression(href));
      links.appendChild(button);
    }
    card.classList.add("open");
    card.setAttribute("aria-hidden", "false");
  }

  async function runCheck() {
    if (!checkPromise) {
      checkPromise = findMatch().then(result => {
        if (result.match) {
          lastNoMatchReason = "";
          render(result.match);
        } else {
          lastNoMatchReason = result.reason || "no_match";
          showCaptureOnly();
        }
        return result;
      }).finally(() => { checkPromise = null; });
    }
    return checkPromise;
  }

  function scheduleAutomaticChecks() {
    showCaptureOnly();
    const checkCurrentPage = () => {
      const urlChanged = location.href !== lastCheckedUrl;
      if (urlChanged) {
        lastCheckedUrl = location.href;
        automaticAttempts = 0;
        latestMatch = null;
        currentMatchId = "";
        showCaptureOnly();
      }
      const dynamicPage = /(?:app\.slack\.com|docs\.google\.com)/i.test(location.hostname);
      const signature = dynamicPage ? dynamicSignature() : "";
      const dynamicChanged = dynamicPage && signature !== lastDynamicSignature && Date.now() - lastAutomaticCheckAt > 3_000;
      if (dynamicChanged) { lastDynamicSignature = signature; automaticAttempts = 0; }
      const recoverable = /not_connected|session_expired|temporary_network_failure|service_unavailable/.test(lastNoMatchReason);
      const maxAttempts = dynamicPage || recoverable ? 12 : 5;
      if ((urlChanged || !latestMatch || dynamicChanged || recoverable) && automaticAttempts < maxAttempts) {
        automaticAttempts += 1;
        lastAutomaticCheckAt = Date.now();
        runCheck();
      }
    };
    setTimeout(checkCurrentPage, 700);
    setTimeout(checkCurrentPage, 2500);
    setTimeout(checkCurrentPage, 6000);
    setTimeout(checkCurrentPage, 12000);
    setInterval(checkCurrentPage, 4000);
    if (document.body && typeof MutationObserver === "function") {
      let mutationTimer;
      const observer = new MutationObserver(() => {
        clearTimeout(mutationTimer);
        mutationTimer = setTimeout(checkCurrentPage, 900);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    addEventListener("pageshow", checkCurrentPage);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkCurrentPage(); });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "found:runtime-status") {
      sendResponse({ version: EXTENSION_VERSION });
      return;
    }
    if (message?.type === "found:page-context") { sendResponse(pageContext()); return; }
    if (message?.type === "found:workspace-connected") {
      automaticAttempts = 0;
      lastNoMatchReason = "";
      runCheck().then(result => sendResponse({ matched: Boolean(result.match), reason: result.reason })).catch(() => sendResponse({ matched: false, reason: "temporary_network_failure" }));
      return true;
    }
    if (message?.type !== "found:run") return;
    runCheck().then(result => sendResponse({ matched: Boolean(result.match), reason: result.reason })).catch(() => sendResponse({ matched: false, reason: "temporary_network_failure" }));
    return true;
  });

  scheduleAutomaticChecks();
})();
