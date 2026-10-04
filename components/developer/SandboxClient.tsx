"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, HelpCircle, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseCustomAbi, buildCustomBlueprints } from "@/lib/translator/custom-abi";
import { translateEvent } from "@/lib/translator/registry";
import type { RawEvent, TranslatedEvent } from "@/lib/translator/types";

/**
 * The outcome of running the developer's template against their pasted event.
 * A discriminated union so the preview panel can render each stage's feedback.
 */
type PreviewResult =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ok"; translated: TranslatedEvent; contractName: string; eventCount: number };

/** A working example so developers can see a successful render immediately. */
const EXAMPLE_TEMPLATE = `{
  "contractName": "My Token",
  "events": [
    {
      "name": "transfer",
      "fields": [
        { "name": "from", "type": "address" },
        { "name": "to", "type": "address" },
        { "name": "amount", "type": "i128" }
      ]
    }
  ]
}`;

// topic[0] carries the event name. The translator matches it by looking for the
// ASCII hex of the event name ("transfer" → "7472616e73666572") inside the topic.
const EXAMPLE_TOPICS = [
  "0x" + "0".repeat(48) + "7472616e73666572",
  "0x0000000000000000000000003a1f9c2b4d6e8a0c1b3d5f7901234567abcdef0102",
  "0x0000000000000000000000009f8e7d6c5b4a39281706f5e4d3c2b1a0face123404",
].join("\n");

// SDK-serialized ScVal::I128 for 1_000_000_000 stroops = 100.00 XLM.
const EXAMPLE_DATA = "0x0000000a0000000000000000000000003b9aca00";

const EXAMPLE_CONTRACT_ID = "CSANDBOX0000000000000000000000000000000000000000000000XYZ";

/**
 * Translates a pasted event using a pasted template, entirely client-side.
 *
 * Mirrors the dashboard's custom-ABI path: parse the template into a blueprint,
 * synthesize a RawEvent from the pasted topics/data, then run it through the
 * exact same {@link translateEvent} the live feed uses — so the sandbox preview
 * matches production rendering.
 */
function runPreview(
  templateText: string,
  topicsText: string,
  dataText: string,
  contractIdInput: string
): PreviewResult {
  if (!templateText.trim()) return { kind: "empty" };

  let json: unknown;
  try {
    json = JSON.parse(templateText);
  } catch {
    return { kind: "error", message: "The translation template is not valid JSON." };
  }

  let abi;
  try {
    abi = parseCustomAbi(json, contractIdInput.trim() || EXAMPLE_CONTRACT_ID);
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : "Could not parse the template.",
    };
  }

  const topics = topicsText
    .split("\n")
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean);

  // The event is matched to the blueprint by contractId, so reuse the ABI's.
  const event: RawEvent = {
    id: "sandbox-0",
    contractId: abi.contractId,
    topics,
    data: dataText.trim() || "0x00",
    ledger: 0,
    timestamp: 0,
    txHash: "sandbox",
  };

  const translated = translateEvent(event, buildCustomBlueprints([abi]));

  return {
    kind: "ok",
    translated,
    contractName: abi.contractName,
    eventCount: abi.events.length,
  };
}

/** Shared styling for the hex/JSON textareas (matches UploadAbiDialog). */
const TEXTAREA_CLASS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs " +
  "ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function SandboxClient(): React.JSX.Element {
  const [template, setTemplate] = useState("");
  const [topics, setTopics] = useState("");
  const [data, setData] = useState("");
  const [contractId, setContractId] = useState("");

  // Recompute the preview synchronously on every keystroke — the translation is
  // pure, in-memory, and cheap, so there is no need to debounce or fetch.
  const preview = useMemo(
    function () {
      return runPreview(template, topics, data, contractId);
    },
    [template, topics, data, contractId]
  );

  function loadExample(): void {
    setTemplate(EXAMPLE_TEMPLATE);
    setTopics(EXAMPLE_TOPICS);
    setData(EXAMPLE_DATA);
    setContractId(EXAMPLE_CONTRACT_ID);
  }

  function clearAll(): void {
    setTemplate("");
    setTopics("");
    setData("");
    setContractId("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ── Inputs ──────────────────────────────────────────────────────── */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Input
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={loadExample}>
              <Wand2 className="h-3.5 w-3.5 mr-1.5" />
              Load example
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAll}>
              Clear
            </Button>
          </div>
        </div>

        {/* Contract ID */}
        <div className="space-y-1.5">
          <label htmlFor="sandbox-contract-id" className="text-sm font-medium">
            Contract ID <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Input
            id="sandbox-contract-id"
            value={contractId}
            onChange={function (e) {
              setContractId(e.target.value);
            }}
            placeholder="C..."
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Used only if your template doesn&apos;t already declare a{" "}
            <code className="font-mono">contractId</code>.
          </p>
        </div>

        {/* Raw event topics */}
        <div className="space-y-1.5">
          <label htmlFor="sandbox-topics" className="text-sm font-medium">
            Event Topics <span className="text-muted-foreground font-normal">(one hex per line)</span>
          </label>
          <textarea
            id="sandbox-topics"
            value={topics}
            onChange={function (e) {
              setTopics(e.target.value);
            }}
            rows={5}
            spellCheck={false}
            placeholder={"0x...   ← topic[0] is the event name\n0x...   ← first field\n0x...   ← second field"}
            className={TEXTAREA_CLASS}
          />
          <p className="text-xs text-muted-foreground">
            topic[0] identifies the event; the template matches it by the event name&apos;s ASCII
            hex. Remaining topics map positionally to your template&apos;s fields.
          </p>
        </div>

        {/* Raw event data */}
        <div className="space-y-1.5">
          <label htmlFor="sandbox-data" className="text-sm font-medium">
            Event Data <span className="text-muted-foreground font-normal">(hex)</span>
          </label>
          <textarea
            id="sandbox-data"
            value={data}
            onChange={function (e) {
              setData(e.target.value);
            }}
            rows={2}
            spellCheck={false}
            placeholder="0x00000000000000000000000000000000000000000005F5E100"
            className={TEXTAREA_CLASS}
          />
          <p className="text-xs text-muted-foreground">
            The payload value, mapped to the last field in your template.
          </p>
        </div>

        {/* Translation template */}
        <div className="space-y-1.5">
          <label htmlFor="sandbox-template" className="text-sm font-medium">
            JSON Translation Template
          </label>
          <textarea
            id="sandbox-template"
            value={template}
            onChange={function (e) {
              setTemplate(e.target.value);
            }}
            rows={12}
            spellCheck={false}
            placeholder={
              '{\n  "contractName": "My Token",\n  "events": [\n    { "name": "transfer", "fields": [{ "name": "from", "type": "address" }] }\n  ]\n}'
            }
            className={TEXTAREA_CLASS}
          />
        </div>
      </div>

      {/* ── Live preview ────────────────────────────────────────────────── */}
      <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Mock Rendering
        </h2>
        <PreviewPanel preview={preview} />
      </div>
    </div>
  );
}

/** Renders the result of {@link runPreview} as developer-facing feedback. */
function PreviewPanel({ preview }: { preview: PreviewResult }): React.JSX.Element {
  if (preview.kind === "empty") {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <Sparkles className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Paste a template to preview the plain English output.
          </p>
          <p className="text-xs text-muted-foreground">
            New here? Hit <span className="font-medium">Load example</span> to see a working transfer.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (preview.kind === "error") {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">Template error</p>
          <p className="mt-0.5">{preview.message}</p>
        </div>
      </div>
    );
  }

  const { translated, contractName, eventCount } = preview;

  // The template parsed, but no event in it matched the pasted topic[0].
  if (translated.status !== "translated") {
    return (
      <Card className="border-amber-300 dark:border-amber-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="h-5 w-5 text-amber-500" />
            No matching event
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Your template parsed ({contractName} — {eventCount}{" "}
            {eventCount === 1 ? "event" : "events"}), but none of its events matched{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">topic[0]</code>.
          </p>
          <p className="text-muted-foreground">
            Make sure topic[0] contains the ASCII hex of an event <code className="font-mono">name</code>{" "}
            from your template (e.g. <span className="font-mono">transfer</span> →{" "}
            <span className="font-mono">7472616e73666572</span>).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-emerald-300 dark:border-emerald-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          Plain English output
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-lg font-medium leading-snug">{translated.description}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">Translated</Badge>
          {translated.eventType && <Badge variant="secondary">{translated.eventType}</Badge>}
          {translated.blueprintName && (
            <span className="text-xs text-muted-foreground">via {translated.blueprintName}</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground border-t pt-3">
          This is a mock rendering using the same translation engine as the live dashboard. Decoded
          addresses and amounts are illustrative.
        </p>
      </CardContent>
    </Card>
  );
}
