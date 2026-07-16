# Found browser extension — CV1 demo

## Load it locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this `extension` folder.
5. Visit `https://sage-profiterole-3b1c22.netlify.app/demo-article` or open one of the seeded Google Docs.

The extension analyses that demo article locally and displays the Found avatar. This CV1 build uses embedded test knowledge; the production version will call the authenticated Found/Hermes analysis endpoint.

## Updating memory

Choose **Something changed? Update Found**, enter the latest context, and review it in the hosted Found workspace. The extension keeps the update for the next visit while Found stores the confirmed update as an append-only memory layer. The original source is never edited.
