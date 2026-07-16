# Found — CTO demo script

## 1. Start with the executive view

Open `https://sage-profiterole-3b1c22.netlify.app/workspace` and select **Executive**.

Show:

- the three decisions accumulating the most linked evidence;
- the source-linked activity pulse;
- the latest verified changes across Product, Sales, Engineering and GTM;
- the knowledge graph connecting decisions to Slack, Google Docs, Jira and code.

Click any trend or **Open original source** to show that Found always retains the receipt.

## 2. Demonstrate prior work inside a document

With Found extension `0.2.0` loaded in Chrome, open:

`https://docs.google.com/document/d/1eh7J9rAhvuWYWuB8MD-A3h97MAFWhYRtysFI53ABBYE`

Found should surface **Developer portal and service maturity scorecards**, owner Vikram Rao, status Pilot running and Jira ENG-214.

## 3. Correct the memory without editing the source

1. Select **Something changed? Update Found**.
2. Enter: `The platform review is complete. The Backstage pilot moves to a ten-service rollout; Vikram remains the owner.`
3. Select **Review memory update**.
4. On the Found review page, open the original source, confirm the text, and select **Add to Found memory**.
5. Return to the workspace. The new append-only layer appears under **Memory changed**.
6. Reopen the same Google Doc. The extension shows the latest layer from local extension memory while the confirmed copy remains in Found.

The Google Doc is never rewritten.

## 4. Demonstrate Slack continual learning

After the Slack Events request URL and signing secret are configured, post this in an approved engineering channel:

`Platform review is complete for the developer portal and service catalog. The scorecard pilot now moves to a ten-service rollout.`

The message contains a strong known-intent match. Found appends it as a Slack-origin memory update, retains the Slack channel URL, and includes it in future retrieval. Casual conversation remains silent and is not written.

## 5. Close with the product principle

> Found does not replace company sources. It turns their changing evidence into a versioned, searchable and explainable company memory.
