"use client"

import { Code, ExternalLink } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import type { TranslatedEvent } from "@/lib/translator/types"
import { formatRelativeTime } from "@/lib/translator/decode"

interface EventDetailsModalProps {
  event: TranslatedEvent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function RawDataField({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <p
        className={`text-sm break-all rounded bg-muted px-3 py-2 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  )
}

export function EventDetailsModal({
  event,
  open,
  onOpenChange,
}: EventDetailsModalProps): React.JSX.Element {
  if (!event) return <></>

  const horizonUrl = `https://horizon-testnet.stellar.org/transactions/${event.raw.txHash}`
  const isTranslated = event.status === "translated"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="h-5 w-5 text-muted-foreground" />
            Event Details
          </DialogTitle>
          <DialogDescription>
            View the human-readable translation and raw XDR payload data for this event.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="translation" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="translation" className="flex-1">Translation</TabsTrigger>
            <TabsTrigger value="raw" className="flex-1">Raw Data</TabsTrigger>
          </TabsList>

          <TabsContent value="translation" className="mt-4 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant={isTranslated ? "success" : event.status === "pending" ? "secondary" : "warning"}
                >
                  {event.status}
                </Badge>
                {event.blueprintName && (
                  <span className="text-sm text-muted-foreground">
                    by {event.blueprintName}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Time</p>
                <p className="text-sm">{formatRelativeTime(event.raw.timestamp)}</p>
              </div>

              {isTranslated && event.eventType && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Event Type</p>
                  <p className="text-sm font-medium text-violet-600 dark:text-violet-400">{event.eventType}</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</p>
                <div className="rounded-lg border bg-card p-4">
                  {isTranslated ? (
                    <p className="text-sm">{event.description}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      No translation available for this event yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contract</p>
                <p className="text-sm font-mono">{event.raw.contractId}</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="raw" className="mt-4 space-y-4">
            <div className="space-y-4">
              <RawDataField label="Event ID" value={event.raw.id} mono />
              <RawDataField label="Contract ID" value={event.raw.contractId} mono />
              <RawDataField label="Transaction Hash" value={event.raw.txHash} mono />
              <RawDataField label="Ledger" value={event.raw.ledger.toLocaleString()} />
              <RawDataField
                label="Timestamp"
                value={new Date(event.raw.timestamp * 1000).toISOString()}
              />

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Topics ({event.raw.topics.length})
                </p>
                <div className="space-y-1">
                  {event.raw.topics.map(function (topic, index) {
                    return (
                      <p
                        key={index}
                        className="text-sm break-all rounded bg-muted px-3 py-2 font-mono"
                      >
                        <span className="text-muted-foreground mr-2">[{index}]</span>
                        {topic}
                      </p>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Data</p>
                <pre className="text-sm break-all rounded bg-black text-green-400 px-3 py-4 font-mono overflow-x-auto">
                  {event.raw.data}
                </pre>
              </div>

              <div className="pt-2 border-t">
                <Button variant="outline" size="sm" asChild>
                  <a href={horizonUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View on Stellar Expert
                  </a>
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
