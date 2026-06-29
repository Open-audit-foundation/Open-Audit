"use client";
import React, { useState } from "react";
import { translateEvents } from "@/lib/translator/registry";
import { isValidHex, sanitizeHex } from "@/lib/translator/core";

const DEFAULT_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const TRANSFER_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000074726e73";

const PREFILL_TOPIC_ADDR = (seedHex: string, tailHex: string) =>
  `0x${seedHex}${"0".repeat(52)}${tailHex}`;

const DEFAULT_FROM = PREFILL_TOPIC_ADDR("ABCDEF12", "1234");
const DEFAULT_TO = PREFILL_TOPIC_ADDR("DEADBEEF", "5678");
const DEFAULT_DATA = "0x000000003B9ACA00"; // 1_000_000_000 stroops => 100.00

export default function PlaygroundPage(): JSX.Element {
  const [contractId, setContractId] = useState(DEFAULT_CONTRACT);
  const [topic1, setTopic1] = useState(DEFAULT_FROM);
  const [topic2, setTopic2] = useState(DEFAULT_TO);
  const [dataHex, setDataHex] = useState(DEFAULT_DATA);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTranslate() {
    setError(null);
    setOutput(null);

    if (!isValidHex(topic1) || !isValidHex(topic2) || !isValidHex(dataHex)) {
      setError("One or more inputs are not valid hex strings.");
      return;
    }

    const event = {
      contractId,
      ledger: 1,
      txHash: null,
      id: "playground-1",
      topics: [TRANSFER_TOPIC, sanitizeHex(topic1), sanitizeHex(topic2)],
      data: sanitizeHex(dataHex),
    } as any;

    try {
      const res = translateEvents([event]);
      const desc = res[0]?.description ?? null;
      if (!desc) setError("Could not translate the event (cryptic or no matching blueprint).");
      else setOutput(desc);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Open-Audit Playground</h1>
      <p className="mb-4 text-sm text-gray-600">Try a translation without cloning or building.</p>

      <label className="block text-sm font-medium">Contract ID</label>
      <input className="w-full mb-3 p-2 border rounded" value={contractId} onChange={(e) => setContractId(e.target.value)} />

      <label className="block text-sm font-medium">Topic (from)</label>
      <input className="w-full mb-3 p-2 border rounded" value={topic1} onChange={(e) => setTopic1(e.target.value)} />

      <label className="block text-sm font-medium">Topic (to)</label>
      <input className="w-full mb-3 p-2 border rounded" value={topic2} onChange={(e) => setTopic2(e.target.value)} />

      <label className="block text-sm font-medium">Data (hex)</label>
      <input className="w-full mb-3 p-2 border rounded" value={dataHex} onChange={(e) => setDataHex(e.target.value)} />

      <div className="flex gap-2">
        <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={runTranslate}>Translate</button>
        <button
          className="px-4 py-2 bg-gray-200 rounded"
          onClick={() => {
            setContractId(DEFAULT_CONTRACT);
            setTopic1(DEFAULT_FROM);
            setTopic2(DEFAULT_TO);
            setDataHex(DEFAULT_DATA);
            setError(null);
            setOutput(null);
          }}
        >
          Reset Example
        </button>
      </div>

      <div className="mt-6">
        <h2 className="text-lg font-medium">Result</h2>
        {error && <div className="mt-2 text-red-600">{error}</div>}
        {output && <div className="mt-2 p-3 bg-gray-50 border rounded">{output}</div>}
        {!error && !output && <div className="mt-2 text-sm text-gray-500">No result yet. Click Translate.</div>}
      </div>
    </div>
  );
}
