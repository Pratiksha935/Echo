(() => {
  const EXTENSION_VERSION = "0.4.4";
  const runtime = window.__foundExtensionRuntime;
  if (runtime) return;
  window.__foundExtensionRuntime = { version: EXTENSION_VERSION };

  const FOUND_ORIGIN = "https://sage-profiterole-3b1c22.netlify.app";
  let rendered = false;
  let checkPromise = null;

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
    if (rendered || existing) {
      existing?.querySelector(".ec-avatar")?.classList.add("arrive");
      existing?.querySelector(".ec-card")?.classList.add("open");
      existing?.querySelector(".ec-card")?.setAttribute("aria-hidden", "false");
      return;
    }
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
    avatar.classList.add("arrive");
    setOpen(true);
  }

  async function runCheck() {
    if (!checkPromise) {
      checkPromise = findMatch().then(result => {
        if (result.match) render(result.match);
        return result;
      }).finally(() => { checkPromise = null; });
    }
    return checkPromise;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "found:runtime-status") {
      sendResponse({ version: EXTENSION_VERSION });
      return;
    }
    if (message?.type !== "found:run") return;
    runCheck().then(result => sendResponse({ matched: Boolean(result.match), reason: result.reason })).catch(() => sendResponse({ matched: false, reason: "temporary_network_failure" }));
    return true;
  });

  setTimeout(runCheck, 700);
})();
