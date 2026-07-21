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
  const bootNonce = process.env.LEARNSTEPPER_BOOT_NONCE;
  return (
    <html lang="ja">
      <head>{bootNonce ? <meta name="learnstepper-boot-nonce" content={bootNonce} /> : null}</head>
      <body>{children}</body>
    </html>
  );
}
