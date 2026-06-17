"use client";

import { useState } from "react";
import { Eye, Github, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export function Header(): React.JSX.Element {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
          <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
            <Button variant="ghost" size="sm" asChild>
              <a href="/dashboard">Dashboard</a>
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
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={toggleMobileMenu}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </Button>
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {mobileMenuOpen && (
          <nav id="mobile-nav" className="md:hidden border-t py-3 space-y-1" aria-label="Mobile navigation">
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <a href="/dashboard" onClick={toggleMobileMenu}>
                Dashboard
              </a>
            </Button>
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
