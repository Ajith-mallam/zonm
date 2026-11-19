import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ZONM NET", template: "%s · ZONM NET" },
  description: "Stylometric authorship attribution",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
