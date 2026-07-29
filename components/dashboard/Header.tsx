"use client";

import { useState } from "react";
import { Eye, Github, GitBranch, Menu, Network, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useNetwork, type Network } from "@/lib/hooks/useNetwork";

const NETWORK_OPTIONS: { id: Network; label: string }[] = [
  { id: "testnet", label: "Testnet" },
  { id: "mainnet", label: "Mainnet" },
  { id: "futurenet", label: "Futurenet" },
];

export function Header(): React.JSX.Element {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { network, setNetwork } = useNetwork();

  function toggleMobileMenu(): void {
    setMobileMenuOpen(function (prev) {
      return !prev;
    });
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-600 text-white">
              <Eye className="h-4 w-4" />
            </div>
            <div>
              <span className="font-semibold text-base leading-none">Open-Audit</span>
              <p className="text-xs text-muted-foreground leading-none mt-0.5 hidden sm:block">
                Stellar Transparency Tool
              </p>
            </div>
          </div>

          {/* Desktop nav */}
          <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <a href="/dashboard">Dashboard</a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/developer/sandbox">Sandbox</a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/graph">
                <Network className="h-4 w-4 mr-1.5" />
                Graph
              </a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/dag">
                <GitBranch className="h-4 w-4 mr-1.5" />
                Call Tree
              </a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a
                href="https://github.com/your-org/open-audit"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Github className="h-4 w-4 mr-1.5" />
                GitHub
              </a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a
                href="https://github.com/your-org/open-audit/blob/main/CONTRIBUTING.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                Contribute
              </a>
            </Button>
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <ThemeToggle />

            <div className="hidden md:flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Network</label>
              <select
                className="border rounded-md p-1 bg-transparent text-sm"
                value={network}
                onChange={(e) => setNetwork(e.target.value as Network)}
                aria-label="Select network"
              >
                {NETWORK_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={toggleMobileMenu}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {mobileMenuOpen && (
          <nav aria-label="Mobile navigation" className="md:hidden border-t py-3 space-y-1">
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <a href="/dashboard" onClick={toggleMobileMenu}>
                Dashboard
              </a>
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <a href="/developer/sandbox" onClick={toggleMobileMenu}>
                Sandbox
              </a>
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <a href="/graph" onClick={toggleMobileMenu}>
                <Network className="h-4 w-4 mr-1.5" />
                Graph
              </a>
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <a href="/dag" onClick={toggleMobileMenu}>
                <GitBranch className="h-4 w-4 mr-1.5" />
                Call Tree
              </a>
            </Button>
            {/* Mobile network selector */}
            <div className="px-3">
              <label className="text-xs text-muted-foreground">Network</label>
              <select
                className="w-full border rounded-md p-2 mt-1 bg-transparent text-sm"
                value={network}
                onChange={(e) => setNetwork(e.target.value as Network)}
                aria-label="Select network"
              >
                {NETWORK_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <a
                href="https://github.com/your-org/open-audit"
                target="_blank"
                rel="noopener noreferrer"
                onClick={toggleMobileMenu}
              >
                <Github className="h-4 w-4 mr-1.5" />
                GitHub
              </a>
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <a
                href="https://github.com/your-org/open-audit/blob/main/CONTRIBUTING.md"
                target="_blank"
                rel="noopener noreferrer"
                onClick={toggleMobileMenu}
              >
                Contribute
              </a>
            </Button>
          </nav>
        )}
      </div>
    </header>
  );
}
