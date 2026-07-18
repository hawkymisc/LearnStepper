import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LearnStepper",
  description: "対話型AI学習アプリ",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
