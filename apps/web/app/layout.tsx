import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: {
    default: "RIFTSCOPE — CS2 2D Demo Replay & Analytics",
    template: "%s | RIFTSCOPE",
  },
  description:
    "Replay your Counter-Strike 2 demos on a 2D tactical map. Watch every round unfold — player movements, kills, smokes, bomb plants — and get deep stats on ratings, economy and clutches.",
  keywords: ["CS2", "Counter-Strike 2", "demo replay", "2D demo viewer", "esports analytics", "RIFTSCOPE"],
  openGraph: {
    title: "RIFTSCOPE — CS2 2D Demo Replay",
    description: "Replay every round on a 2D tactical map.",
    type: "website",
    locale: "en_US",
  },
};

export const viewport: Viewport = {
  themeColor: "#0DDDE8",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn("min-h-screen bg-background font-body antialiased")}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
