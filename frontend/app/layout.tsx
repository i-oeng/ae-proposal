import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aspan Proposal Engine",
  description: "Internal proposal workspace for Aspan solar PPA decks.",
  icons: {
    icon: [{ url: "/favicon.ico?v=2", type: "image/x-icon", sizes: "32x32" }],
    shortcut: "/favicon.ico?v=2",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
