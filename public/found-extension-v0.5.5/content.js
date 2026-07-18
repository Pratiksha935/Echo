(() => {
  const EXTENSION_VERSION = "0.5.5";
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
  let slackDestinationsLoaded = false;
  let slackDestinationsPromise = null;
  let savedDecisionUrl = "";
  let savedCaptureNote = "";

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
      if (node.closest('[contenteditable="true"], [data-qa="message_input"], [data-qa="message_input_container"], .ql-editor')) continue;
      const text = compactText(node.innerText || node.textContent);
      if (!isSlackMessageCandidate(text) || seen.has(text)) continue;
      seen.add(text);
      const rect = node.getBoundingClientRect?.();
      const visible = !rect || (rect.bottom > 0 && rect.top < window.innerHeight);
      if (!visible) continue;
      messages.push({ bottom: rect?.bottom ?? messages.length, text });
    }
    messages.sort((left, right) => left.bottom - right.bottom);
    const latestMessage = messages.at(-1)?.text || "";
    return latestMessage ? `Most recent Slack message:\n${latestMessage}`.slice(-maxLength) : "";
  }

  function isSlackMessageCandidate(text) {
    if (text.length < 8) return false;
    if (/^(today|yesterday|messages|view thread|\\d+ repl(?:y|ies)|enable notifications)$/i.test(text)) return false;
    if (/^(?:.+ joined #[\\w-]+\\.?|.+ was added to #[\\w-]+ by .+\\.?)/i.test(text)) return false;
    if (/^message #[\\w-]+$/i.test(text)) return false;
    return true;
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
        <section class="ec-capture-view">
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
          <button type="button" class="ec-save-memory">ADD TO MEMORY <b>↗</b></button>
          <button type="button" class="ec-view-memory" hidden>VIEW IN FOUND <b>↗</b></button>
          <div class="ec-slack-share">
            <div class="ec-share-heading"><span>Share this page in Slack</span><small>Optional</small></div>
            <div class="ec-share-tabs" role="tablist" aria-label="Slack destinations">
              <button type="button" class="active" data-share-tab="user" role="tab" aria-selected="true">Teammates</button>
              <button type="button" data-share-tab="channel" role="tab" aria-selected="false">Channels</button>
            </div>
            <div class="ec-destinations" data-share-panel="user" role="tabpanel"><small>Loading teammates…</small></div>
            <div class="ec-destinations" data-share-panel="channel" role="tabpanel" hidden><small>Loading channels…</small></div>
            <small class="ec-share-note">Choose one or more destinations. Found shares only when you press send.</small>
            <button type="button" class="ec-send-slack">SEND TO SELECTED <b>↗</b></button>
          </div>
        </section>
        <div class="ec-update" hidden><form><label for="found-memory-update">Correct or update Found memory</label><input id="found-memory-update" type="text" maxlength="800" minlength="12" placeholder="What changed?" required><small>Your update is appended with your identity. Original Slack and Google sources stay untouched.</small><button type="submit">REVIEW &amp; APPEND <b>↗</b></button></form></div>
        <footer><span>LIVE FOUND MEMORY</span><span class="ec-account"></span></footer>
      </aside>`;
    document.documentElement.appendChild(root);

    const avatar = root.querySelector(".ec-avatar");
    const card = root.querySelector(".ec-card");
    const setOpen = open => {
      card.classList.toggle("open", open);
      card.setAttribute("aria-hidden", String(!open));
      if (open && !root.querySelector(".ec-capture-view").hidden) loadSlackDestinations();
    };
    avatar.addEventListener("click", () => setOpen(!card.classList.contains("open")));
    card.querySelector("header button").addEventListener("click", () => setOpen(false));
    root.querySelector(".ec-save-memory").addEventListener("click", saveCapture);
    root.querySelector(".ec-view-memory").addEventListener("click", () => {
      if (savedDecisionUrl) openWithSuppression(savedDecisionUrl);
    });
    root.querySelector(".ec-send-slack").addEventListener("click", shareToSlack);
    for (const tab of root.querySelectorAll("[data-share-tab]")) tab.addEventListener("click", () => selectShareTab(tab.dataset.shareTab));
    root.querySelector(".ec-update form").addEventListener("submit", submitUpdate);
    avatar.classList.add("arrive");
    return root;
  }

  async function saveCapture() {
    const view = ensureRoot().querySelector(".ec-capture-view");
    const button = view.querySelector(".ec-save-memory");
    const viewButton = view.querySelector(".ec-view-memory");
    const note = view.querySelector(".ec-capture-note");
    const updateText = view.querySelector(".ec-note").value.trim();
    if (updateText.length < 12) return;
    button.disabled = true;
    button.textContent = "ADDING…";
    note.textContent = "Saving the URL, department, and comment to your authorised workspace…";
    const result = await chrome.runtime.sendMessage({
      type: "found:capture-page",
      capture: {
        ...pageContext(),
        department: view.querySelector(".ec-department").value,
        note: updateText,
      },
    }).catch(() => ({ ok: false, reason: "temporary_network_failure" }));
    if (result?.ok) {
      view.classList.add("saved");
      savedCaptureNote = updateText;
      view.querySelector(".ec-note").value = "";
      savedDecisionUrl = safeSourceUrl(result.decisionUrl) || "";
      note.textContent = savedDecisionUrl
        ? "Saved to company memory. Open the timestamped decision record in Found."
        : "Saved to company memory. If similar work appears later, Found can surface it as a battlecard.";
      button.hidden = true;
      button.disabled = false;
      button.innerHTML = "ADD TO MEMORY <b>↗</b>";
      viewButton.hidden = !savedDecisionUrl;
      viewButton.innerHTML = savedDecisionUrl ? "OPEN SAVED RECORD <b>↗</b>" : "SAVED TO MEMORY ✓";
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
    button.innerHTML = "ADD TO MEMORY <b>↗</b>";
    button.disabled = false;
  }

  function selectShareTab(type) {
    const root = ensureRoot();
    for (const tab of root.querySelectorAll("[data-share-tab]")) {
      const active = tab.dataset.shareTab === type;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    for (const panel of root.querySelectorAll("[data-share-panel]")) panel.hidden = panel.dataset.sharePanel !== type;
  }

  function destinationLabel(destination, type) {
    return compactText(
      type === "channel"
        ? destination?.name || destination?.displayName || destination?.id
        : destination?.displayName || destination?.realName || destination?.name || destination?.email || destination?.id,
    );
  }

  function renderSlackDestinations(type, destinations) {
    const panel = ensureRoot().querySelector(`[data-share-panel="${type}"]`);
    panel.textContent = "";
    if (!destinations.length) {
      const empty = document.createElement("small");
      empty.textContent = type === "channel" ? "No available channels found." : "No available teammates found.";
      panel.appendChild(empty);
      return;
    }
    for (const destination of destinations) {
      if (!destination?.id) continue;
      const label = document.createElement("label");
      label.className = "ec-destination";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = destination.id;
      checkbox.dataset.destinationType = type;
      const title = document.createElement("span");
      const name = destinationLabel(destination, type);
      title.textContent = type === "channel" ? `# ${name}` : name;
      const detail = document.createElement("small");
      detail.textContent = type === "channel" ? "Channel" : compactText(destination.email || "Teammate");
      title.appendChild(detail);
      label.append(checkbox, title);
      panel.appendChild(label);
    }
  }

  async function loadSlackDestinations({ force = false } = {}) {
    if (slackDestinationsLoaded && !force) return;
    if (slackDestinationsPromise) return slackDestinationsPromise;
    const root = ensureRoot();
    const note = root.querySelector(".ec-share-note");
    note.textContent = "Loading teammates and channels from your connected Slack workspace…";
    slackDestinationsPromise = chrome.runtime.sendMessage({ type: "found:list-slack-destinations" })
      .then(result => {
        if (!result?.ok) throw new Error(result?.reason || "service_unavailable");
        renderSlackDestinations("user", result.users || []);
        renderSlackDestinations("channel", result.channels || []);
        slackDestinationsLoaded = true;
        note.textContent = "Choose teammates or channels. Nothing is sent until you confirm.";
      })
      .catch(error => {
        const message = error?.message === "slack_not_connected"
          ? "Connect Slack in Found to share this page with teammates or channels."
          : error?.message === "slack_reconnect_required"
            ? "Reconnect Slack in Found so it can list teammates and channels for sharing."
            : error?.message === "not_connected" || error?.message === "session_expired"
              ? "Connect or switch this browser to a Found workspace first."
              : "Slack destinations could not be loaded. Open this panel again to retry.";
        for (const panel of root.querySelectorAll("[data-share-panel]")) {
          panel.textContent = "";
          const detail = document.createElement("small");
          detail.textContent = message;
          panel.appendChild(detail);
        }
        note.textContent = "Reconnect Slack from Found integrations, then reopen this panel.";
      })
      .finally(() => { slackDestinationsPromise = null; });
    return slackDestinationsPromise;
  }

  async function shareToSlack() {
    const root = ensureRoot();
    const view = root.querySelector(".ec-capture-view");
    const button = root.querySelector(".ec-send-slack");
    const note = root.querySelector(".ec-share-note");
    const recipients = Array.from(root.querySelectorAll(".ec-destination input:checked"), input => ({
      type: input.dataset.destinationType,
      id: input.value,
    }));
    if (!recipients.length) {
      note.textContent = "Select at least one teammate or channel first.";
      return;
    }
    button.disabled = true;
    button.textContent = "SENDING…";
    const result = await chrome.runtime.sendMessage({
      type: "found:share-to-slack",
      share: {
        recipients,
        department: view.querySelector(".ec-department").value,
        note: view.querySelector(".ec-note").value.trim() || savedCaptureNote,
        pageTitle: document.title,
        pageUrl: location.href,
      },
    }).catch(() => ({ ok: false, reason: "temporary_network_failure" }));
    if (result?.ok) {
      note.textContent = `Sent this page to ${result.sent || recipients.length} Slack destination${(result.sent || recipients.length) === 1 ? "" : "s"}.`;
      button.textContent = "SENT IN SLACK ✓";
      for (const checkbox of root.querySelectorAll(".ec-destination input:checked")) checkbox.checked = false;
      setTimeout(() => { button.disabled = false; button.textContent = "SEND TO SELECTED ↗"; }, 1800);
      return;
    }
    const errors = {
      no_destinations: "Select at least one teammate or channel first.",
      slack_not_connected: "Connect Slack in Found before sharing this page.",
      slack_reconnect_required: "Reconnect Slack in Found before sharing this page.",
      session_expired: "Reconnect this browser to Found and try again.",
      workspace_access_revoked: "Workspace access changed. Reconnect with an authorised account.",
      service_unavailable: "Slack sharing is temporarily unavailable. Try again shortly.",
      temporary_network_failure: "Found could not reach Slack. Try again shortly.",
    };
    note.textContent = errors[result?.reason] || "Found could not share this page in Slack.";
    button.disabled = false;
    button.textContent = "SEND TO SELECTED ↗";
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
    const capture = root.querySelector(".ec-capture-view");
    card.classList.add("ec-capture-mode");
    root.querySelector(".ec-match-view").hidden = true;
    capture.hidden = false;
    root.querySelector(".ec-update").hidden = true;
    root.querySelector(".ec-avatar em").hidden = true;
    root.querySelector(".ec-account").textContent = "Ready to save URLs";
    if (!savedDecisionUrl) {
      capture.classList.remove("saved");
      capture.querySelector(".ec-save-memory").hidden = false;
      capture.querySelector(".ec-view-memory").hidden = true;
    }
    if (open) {
      card.classList.add("open");
      card.setAttribute("aria-hidden", "false");
      loadSlackDestinations();
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
