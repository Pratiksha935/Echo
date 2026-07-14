(() => {
  if (window.__echoCheckLoaded) return;
  window.__echoCheckLoaded = true;

  const knowledge = [
    {
      id: "ENG-PLAT-014",
      triggers: ["internal developer portal", "service catalog", "engineering platform", "developer experience", "golden path", "scorecard", "harness engineering"],
      title: "Developer portal and service maturity scorecards",
      owner: "Vikram Rao",
      status: "Pilot running",
      source: "Notion + Slack + Jira ENG-214",
      summary: "Platform Engineering began a pilot for a unified service catalog, ownership metadata, scorecards, and paved deployment paths three weeks ago.",
      recommendation: "Attach this article to ENG-214 and compare Harness IDP scorecards with the current Backstage-based pilot.",
      links: [
        { label: "Open initiative", url: "http://localhost:3000/#memory" },
        { label: "View engineering memory", url: "http://localhost:3000/#research" }
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
      links: [{ label: "Open code reference", url: "http://localhost:3000/#research" }]
    },
    {
      id: "LOOP-ENG-042",
      triggers: ["feature flag", "progressive delivery", "canary release", "release guardrail", "deployment verification"],
      title: "Loop progressive delivery guardrails",
      owner: "Leena Rao",
      status: "Implementation approved",
      source: "Slack + Notion + Jira LOOP-42",
      summary: "Loop Engineering approved shared feature flags, canary cohorts, automated health verification and one-click rollback for high-risk releases.",
      recommendation: "Compare the article with LOOP-42 and attach any novel verification pattern to the existing rollout design.",
      links: [{ label: "Open Loop initiative", url: "http://localhost:3000/#memory" }]
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
      links: [{ label: "View metrics decision", url: "http://localhost:3000/#insights" }]
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
      links: [{ label: "View incident initiative", url: "http://localhost:3000/#research" }]
    }
  ];

  const pageText = `${document.title} ${document.querySelector("main")?.innerText || document.body.innerText}`.toLowerCase();
  const scored = knowledge.map(item => ({ ...item, score: item.triggers.filter(term => pageText.includes(term)).length })).sort((a,b) => b.score-a.score);
  const match = scored[0]?.score >= 2 ? scored[0] : null;
  if (!match) return;

  const root = document.createElement("div");
  root.id = "echocheck-extension-root";
  root.innerHTML = `
    <button class="ec-avatar" aria-label="Open EchoCheck finding">
      <span class="ec-face"><i></i><i></i><b></b></span>
      <em>${match.score + 1}</em>
    </button>
    <aside class="ec-card" aria-hidden="true">
      <header><span>ECHOCHECK · PRIOR WORK FOUND</span><button aria-label="Close">×</button></header>
      <div class="ec-confidence"><b>${Math.min(96, 78 + match.score * 4)}%</b><span>semantic relevance</span></div>
      <h2>${match.title}</h2>
      <p>${match.summary}</p>
      <dl><div><dt>OWNER</dt><dd>${match.owner}</dd></div><div><dt>STATUS</dt><dd>${match.status}</dd></div><div><dt>SOURCES</dt><dd>${match.source}</dd></div></dl>
      <section><span>WHAT TO DO</span><p>${match.recommendation}</p></section>
      <nav>${match.links.map(link => `<a href="${link.url}" target="_blank">${link.label} ↗</a>`).join("")}</nav>
      <footer>Analysed locally for the CV1 demo · page content was not transmitted</footer>
    </aside>`;
  document.documentElement.appendChild(root);
  const avatar = root.querySelector(".ec-avatar");
  const card = root.querySelector(".ec-card");
  const close = card.querySelector("header button");
  const setOpen = open => { card.classList.toggle("open", open); card.setAttribute("aria-hidden", String(!open)); };
  avatar.addEventListener("click", () => setOpen(!card.classList.contains("open")));
  close.addEventListener("click", () => setOpen(false));
  setTimeout(() => { avatar.classList.add("arrive"); setOpen(true); }, 900);
})();
