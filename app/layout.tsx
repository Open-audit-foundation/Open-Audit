import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/dashboard/Header";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: {
    default: "Open-Audit — Stellar Transparency Tool",
    template: "%s — Open-Audit",
  },
  description:
    "The Google Translate for Soroban. Open-Audit translates cryptic Stellar smart contract events into human-readable English.",
  keywords: ["Stellar", "Soroban", "blockchain", "transparency", "smart contracts", "audit"],
  openGraph: {
    title: "Open-Audit",
    description: "The Google Translate for Soroban smart contract events.",
    type: "website",
  },
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased min-h-screen bg-background`}>
        <div className="relative flex min-h-screen flex-col">
          {/* Skip to main content for keyboard users */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:rounded focus:bg-background focus:text-foreground focus:shadow-md focus:outline-none"
          >
            Skip to main content
          </a>
          <Header />
          <div id="main-content" className="flex-1">{children}</div>
          <footer aria-label="Site footer" className="border-t py-6 mt-8">
            <div className="container mx-auto px-4 max-w-5xl">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
                <p>
                  Open-Audit — Open source transparency for the Stellar ecosystem.
                </p>
                <div className="flex items-center gap-4">
                  <a
                    href="https://github.com/your-org/open-audit"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors"
                  >
                    GitHub
                  </a>
                  <a
                    href="https://github.com/your-org/open-audit/blob/main/CONTRIBUTING.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors"
                  >
                    Contribute
                  </a>
                  <a
                    href="https://stellar.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground transition-colors"
                  >
                    Stellar.org
                  </a>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
