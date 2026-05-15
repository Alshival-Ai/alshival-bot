import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alshival Admin",
  description: "Admin panel for configuring the Alshival AI agent.",
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
