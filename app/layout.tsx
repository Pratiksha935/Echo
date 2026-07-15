import type { Metadata } from "next";
import "./globals.css";

const metadataBase = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase,
  title: "Found — Your company already knows",
  description: "Connect Slack, Notion, Jira, Google Workspace, and GitHub. Find prior decisions before work repeats.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Found — Your company already knows",
    description: "Company memory, with receipts.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "Found company memory" }],
  },
  twitter: { card: "summary_large_image", title: "Found — Your company already knows", description: "Company memory, with receipts.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
