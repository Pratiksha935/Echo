(() => {
  if (window.__echoCheckLoaded) return;
  window.__echoCheckLoaded = true;

  const FOUND_ORIGIN = "https://sage-profiterole-3b1c22.netlify.app";
  const TOKEN_KEY = "found:browser-session";
  const knowledge = [
    {
      id: "ENG-PLAT-014",
      documentIds: ["1eh7J9rAhvuWYWuB8MD-A3h97MAFWhYRtysFI53ABBYE"],
      triggers: ["internal developer portal", "service catalog", "engineering platform", "developer experience", "golden path", "scorecard", "harness engineering"],
      title: "Developer portal and service maturity scorecards",
      owner: "Vikram Rao",
      status: "Pilot running",
      source: "Notion + Slack + Jira ENG-214",
      summary: "Platform Engineering began a pilot for a unified service catalog, ownership metadata, scorecards, and paved deployment paths three weeks ago.",
      recommendation: "Attach this article to ENG-214 and compare Harness IDP scorecards with the current Backstage-based pilot.",
      links: [
        { label: "Slack", url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX" },
        { label: "Found record", url: "https://sage-profiterole-3b1c22.netlify.app/workspace" }
      ]
    },
    {
      id: "ENG-CODE-031",
      triggers: ["deployment pipeline", "continuous delivery", "pipeline template", "software delivery"],
      title: "Reusable deployment pipeline templates",
      owner: "Ishaan Verma",
      status: "In production",
      source: "GitHub + Jira ENG-188",
      summary: "The engineering enablement team already maintains shared deployment templates with policy checks and rollback defaults.",
      recommendation: "Reuse the existing template package before proposing another delivery workflow abstraction.",
      links: [{ label: "Code reference", url: "https://sage-profiterole-3b1c22.netlify.app/code-review" }]
    },
    {
      id: "LOOP-ENG-042",
      documentIds: ["1ntnatEG2BnzvhYyICLakSeD9rp-FWuoDI8E4SCIxpCU"],
      triggers: ["feature flag", "progressive delivery", "canary release", "release guardrail", "deployment verification"],
      title: "Loop progressive delivery guardrails",
      owner: "Leena Rao",
      status: "Implementation approved",
      source: "Slack + Notion + Jira LOOP-42",
      summary: "Loop Engineering approved shared feature flags, canary cohorts, automated health verification and one-click rollback for high-risk releases.",
      recommendation: "Compare the article with LOOP-42 and attach any novel verification pattern to the existing rollout design.",
      links: [{ label: "Slack", url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX" }, { label: "Found record", url: "https://sage-profiterole-3b1c22.netlify.app/workspace" }]
    },
    {
      id: "LOOP-ENG-057",
      triggers: ["dora metrics", "engineering metrics", "lead time", "change failure rate", "deployment frequency", "developer productivity"],
      title: "Loop engineering effectiveness baseline",
      owner: "Maya Singh",
      status: "Baseline complete",
      source: "Slack + Notion + Jira LOOP-57",
      summary: "The team already measures deployment frequency, lead time, change failure rate and recovery time by service tier, with explicit warnings against individual developer scoring.",
      recommendation: "Reuse the service-level baseline and add only metrics that lead to a concrete platform action.",
      links: [{ label: "Slack", url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX" }, { label: "Found record", url: "https://sage-profiterole-3b1c22.netlify.app/workspace" }]
    },
    {
      id: "LOOP-ENG-063",
      triggers: ["incident review", "postmortem", "incident learning", "root cause", "operational readiness"],
      title: "Loop incident-learning knowledge graph",
      owner: "Kabir Malhotra",
      status: "Pilot running",
      source: "Slack + GitHub + Jira LOOP-63",
      summary: "Loop is linking postmortems to services, owners, runbooks and repeated failure modes so new initiatives can discover earlier operational lessons.",
      recommendation: "Link this article to LOOP-63 if it adds a new incident taxonomy or retrieval method.",
      links: [{ label: "Slack", url: "https://app.slack.com/client/T08LC40MYVB/C0BGU0STURX" }, { label: "Found record", url: "https://sage-profiterole-3b1c22.netlify.app/workspace" }]
    }
  ];

  let rendered = false;

  function findDemoMatch() {
    const pageText = `${location.href} ${document.title} ${document.querySelector("main")?.innerText || document.body?.innerText || ""}`.toLowerCase();
    const scored = knowledge.map(item => {
      const knownDocument = item.documentIds?.some(id => location.href.includes(id));
      const semanticScore = item.triggers.filter(term => pageText.includes(term)).length;
      return { ...item, score: knownDocument ? Math.max(4, semanticScore) : semanticScore };
    }).sort((a,b) => b.score-a.score);
    return scored[0]?.score >= 2 ? scored[0] : null;
  }

  async function findMatch() {
    if (/^https:\/\/www\.google\.[^/]+\/search/i.test(location.href)) return null;
    const pageText = (document.querySelector("main")?.innerText || document.body?.innerText || "").slice(0, 8000);
    try {
      const stored = await chrome.storage.local.get(TOKEN_KEY);
      const token = stored[TOKEN_KEY];
      if (!token) return findDemoMatch();
      const response = await fetch(`${FOUND_ORIGIN}/api/browser/match`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ pageText, pageTitle: document.title, pageUrl: location.href }),
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.match) return payload.match;
      }
    } catch { /* Fall through to the bundled offline demo. */ }
    return findDemoMatch();
  }

  async function pairBrowser() {
    if (location.origin !== FOUND_ORIGIN) return;
    try {
      const response = await fetch("/api/browser/session", { credentials: "include" });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload?.token) await chrome.storage.local.set({ [TOKEN_KEY]: payload.token });
    } catch { /* Pairing is retried on the next Found page load. */ }
  }

  function render(match) {
    if (rendered || document.getElementById("found-extension-root")) return;
    rendered = true;
    const root = document.createElement("div");
    root.id = "found-extension-root";
    root.innerHTML = `
    <button class="ec-avatar" aria-label="Open Found finding">
      <span class="ec-face"><i></i><i></i><b></b></span>
      <em>${match.score + 1}</em>
    </button>
    <aside class="ec-card" aria-hidden="true">
      <header><span><i></i> FOUND · PRIOR WORK</span><button aria-label="Close">×</button></header>
      <div class="ec-confidence"><b>${Math.min(96, 78 + match.score * 4)}%</b><span>HIGH-CONFIDENCE MATCH</span></div>
      <h2>${match.title}</h2>
      <dl><div><dt>OWNER</dt><dd>${match.owner}</dd></div><div><dt>STATUS</dt><dd>${match.status}</dd></div></dl>
      <section class="ec-explanation"><span>WHY THIS MATCHES</span><p class="ec-summary"></p></section>
      <nav aria-label="Sources"><span>SOURCE RECEIPTS</span><div><a class="ec-original" target="_blank" rel="noreferrer">Original doc ↗</a>${match.links.map(link => `<a href="${link.url}" target="_blank" rel="noreferrer">${link.label} ↗</a>`).join("")}</div></nav>
      <div class="ec-update">
        <form>
          <label for="found-memory-update">Correct or update Found memory</label>
          <input id="found-memory-update" type="text" maxlength="800" minlength="12" placeholder="What changed?" required>
          <small>Opens signed-in review. Your update is appended with your identity; Slack and Google Docs stay untouched.</small>
          <button type="submit">REVIEW &amp; APPEND <b>↗</b></button>
        </form>
      </div>
      <footer><span>FOUND MEMORY</span><span>${match.live ? "Live authorised workspace" : "Offline demo memory"} · Silent in Slack · no automatic replies</span></footer>
    </aside>`;
    document.documentElement.appendChild(root);
    root.querySelector(".ec-summary").textContent = match.summary;
    root.querySelector(".ec-original").href = location.href;
    const avatar = root.querySelector(".ec-avatar");
    const card = root.querySelector(".ec-card");
    const close = card.querySelector("header button");
    const updateForm = card.querySelector(".ec-update form");
    const updateInput = updateForm.querySelector("input");
    const setOpen = open => { card.classList.toggle("open", open); card.setAttribute("aria-hidden", String(!open)); };
    avatar.addEventListener("click", () => setOpen(!card.classList.contains("open")));
    close.addEventListener("click", () => setOpen(false));
    updateForm.addEventListener("submit", event => {
      event.preventDefault();
      const updateText = updateInput.value.trim();
      if (updateText.length < 12) return;
      const params = new URLSearchParams({ correction: updateText, record_id: match.id, source_url: location.href, title: match.title });
      window.open(`https://sage-profiterole-3b1c22.netlify.app/memory/correct?${params}`, "_blank");
    });
    setTimeout(() => { avatar.classList.add("arrive"); setOpen(true); }, 700);
  }

  let attempts = 0;
  pairBrowser();
  let checking = false;
  const detector = setInterval(async () => {
    if (checking) return;
    checking = true;
    attempts += 1;
    const match = await findMatch();
    if (match) {
      clearInterval(detector);
      render(match);
    } else if (attempts >= 30) {
      clearInterval(detector);
    }
    checking = false;
  }, 500);
})();
