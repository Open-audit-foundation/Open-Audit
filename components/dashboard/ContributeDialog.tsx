"use client";

import React from "react";
import { GitBranch, Star, ExternalLink, Code2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { RawEvent } from "@/lib/translator/types";

interface ContributeDialogProps {
  event: RawEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContributeDialog({
  event,
  open,
  onOpenChange,
}: ContributeDialogProps): React.JSX.Element {
  if (!event) return <></>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-violet-500" />
            Contribute a Translation
          </DialogTitle>
          <DialogDescription>
            This event is currently unreadable. You can help make it transparent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Issue label */}
          <div className="flex items-center gap-2" role="group" aria-label="Issue properties">
            <Badge variant="warning">High Complexity Issue</Badge>
            <Badge variant="outline">Stellar Drips Eligible</Badge>
          </div>

          {/* What needs to be done */}
          <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
            <p className="text-sm font-medium">What needs to be built:</p>
            <p className="text-sm text-muted-foreground">
              A <strong>Translation Blueprint</strong> for contract{" "}
              <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                {event.contractId.slice(0, 8)}...{event.contractId.slice(-6)}
              </code>
              . This blueprint will decode the hex-encoded event data and render it as a
              plain-English sentence in the Open-Audit feed.
            </p>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            <p className="text-sm font-medium">How to contribute:</p>
            <ol className="space-y-2 text-sm text-muted-foreground list-none">
              {[
                {
                  icon: "1",
                  text: "Find the contract's ABI or event schema (check the project's GitHub or Stellar Expert).",
                },
                {
                  icon: "2",
                  text: "Create a new blueprint file in /lib/translator/blueprints/.",
                },
                {
                  icon: "3",
                  text: "Register it in /lib/translator/registry.ts.",
                },
                {
                  icon: "4",
                  text: "Open a Pull Request — your contribution earns Stellar Drips rewards.",
                },
              ].map(function (step) {
                return (
                  <li key={step.icon} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 text-xs flex items-center justify-center font-medium">
                      {step.icon}
                    </span>
                    <span>{step.text}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t">
            <Button className="flex-1" asChild>
              <a
                href="https://github.com/your-org/open-audit/blob/main/CONTRIBUTING.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Code2 className="h-4 w-4 mr-2" />
                Read the Guide
              </a>
            </Button>
            <Button variant="outline" className="flex-1" asChild>
              <a
                href="https://github.com/your-org/open-audit/issues"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Star className="h-4 w-4 mr-2" />
                View Open Issues
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
