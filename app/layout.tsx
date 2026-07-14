import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EchoCheck — Your company already knows",
  description: "Search organisational memory, catch duplicate work, and turn scattered evidence into action.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
