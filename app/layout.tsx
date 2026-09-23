import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jobba",
  description: "Nye utlysninger og søknadspipeline",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
