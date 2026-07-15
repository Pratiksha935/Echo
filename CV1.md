# Found CV1

CV1 proves one complete loop: a person posts an informal idea in Slack, Hermes decides whether it is worth checking, extracts the intent, compares it with durable memory, and either logs it or surfaces prior work with a permalink to the original Slack thread.

## Demo sources

- `#product-lab` — early product exploration
- `#gtm-ideas` — campaign and positioning decisions
- `#sales-floor` — deal learnings and commercial decisions
- `#customer-voice` — support patterns and customer needs
- `#engineering` — technical decisions and noise-control test

The reproducible seed pack is in `data/slack-seed.json`.
Naturalistic surrounding discussion is recorded in `data/slack-context.json`.

## Hermes roles

1. Manager: rejects noise or routes a signal.
2. Intent specialist: extracts the underlying proposal or decision.
3. Prior-art specialist: returns exact, same-idea, tangential, or no-match.
4. Surfacing specialist: drafts a notification with evidence and source links.
5. Manager: reviews before any notification is sent.

## Source-of-truth contract

Found is the durable index of organisational intent, decisions, match reasoning, and outcomes. Slack, Notion, and Jira remain the systems of record for the full underlying conversation. Every Found record therefore requires a stable `source_url` that opens the exact original thread, page, or issue.

## CV1 acceptance test

- SIG-A logs as new.
- SIG-B matches SIG-A despite different wording and triggers a notification.
- SIG-C resolves as a near-exact match and triggers a notification.
- SIG-D is related but does not trigger a notification.
- SIG-IGNORE is rejected by the manager before extraction.
- Selecting any record in the dashboard exposes its Hermes trace and an original-source link.

## Slack seeding status

Seeded live on July 12, 2026. The five channels exist in the connected workspace and all ten messages were posted. Their real message permalinks are recorded in `data/slack-seed.json`; the dashboard uses those links for source handoff.
