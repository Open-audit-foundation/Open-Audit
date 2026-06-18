# Contributing to Open-Audit

Thank you for your interest in contributing! Open-Audit is a community-driven transparency tool for the Stellar/Soroban ecosystem. Every contribution — from fixing a typo to adding a full translation blueprint — makes on-chain data more readable for everyone.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [How to Add a New Contract Translation](#how-to-add-a-new-contract-translation)
5. [Translation Entry Schema](#translation-entry-schema)
6. [Testing Your Translation Locally](#testing-your-translation-locally)
7. [PR Naming Conventions](#pr-naming-conventions)
8. [Submitting a Pull Request](#submitting-a-pull-request)
9. [Good First Issues](#good-first-issues)

---

## Code of Conduct

We follow the [Contributor Covenant](https://www.contributor-covenant.org/). In short:

- Be respectful and inclusive.
- Assume good intent.
- Constructive feedback only — critique the code, not the person.

Violations can be reported by opening a private GitHub issue or contacting a maintainer directly.

---

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/open-audit.git
   cd open-audit
   ```
3. **Add the upstream remote** so you can pull in future changes:
   ```bash
   git remote add upstream https://github.com/your-org/open-audit.git
   ```
4. **Create a feature branch** (never commit directly to `main`):
   ```bash
   git checkout -b feat/your-feature-name
   ```

---

## Development Setup

### Prerequisites

- Node.js >= 18 (we recommend [nvm](https://github.com/nvm-sh/nvm))
- npm >= 9

### Install Dependencies

```bash
npm install
```

### Environment Variables

```bash
cp .env.example .env.local
```

The defaults point to Stellar **testnet**, which is safe for development. No changes are required for running tests.

### Start the Dev Server

```bash
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

---

## How to Add a New Contract Translation

The Translation Registry lives in `/lib/translator/`. Each contract gets a **blueprint** — a TypeScript module that maps raw event topics/data to a human-readable string.

### Step 1 — Gather the Contract Information

You will need:

- The **Contract ID** (a `C...` Stellar address) of the deployed contract.
- The contract's **event schema**: what topics it emits and what the `data` field encodes.

Good sources for this information:
- The contract's GitHub repository / published ABI JSON.
- Stellar Laboratory (`https://laboratory.stellar.org`) — inspect real events on the network.
- The contract author's documentation.

### Step 2 — Create the Blueprint File

Create a new file at:

```
lib/translator/blueprints/<your-contract-name>.ts
```

Use the template below. Follow the code standards — standard function declarations, no `any` types.

```typescript
/**
 * Translation Blueprint: <Your Contract Name>
 *
 * Describe the events this blueprint handles and their structure:
 *
 * ExampleEvent:
 *   topics[0] = Symbol("event_name")   — hex-encoded XDR Symbol
 *   topics[1] = Address(from)           — hex-encoded XDR Address
 *   topics[2] = Address(to)             — hex-encoded XDR Address
 *   data      = i128(amount)            — hex-encoded XDR i128
 */

import { decodeAddress, decodeAmount } from "../decode";
import type { TranslationBlueprint, TranslationResult, RawEvent } from "../types";

/** The contract ID(s) this blueprint handles. */
const CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

/**
 * Attempts to translate a <YourContract> event.
 * Returns null if the event does not match a known pattern.
 */
function translateYourEvent(event: RawEvent): TranslationResult | null {
  // topics[0] carries the event discriminant as a hex-encoded XDR Symbol.
  // Check it matches the event you're handling.
  if (!event.topics[0]?.includes("<hex_fragment_of_event_name>")) return null;
  if (event.topics.length < 3) return null;

  const from = decodeAddress(event.topics[1]);
  const to = decodeAddress(event.topics[2]);
  const amount = decodeAmount(event.data, "TOKEN");

  return {
    description: `Public Key [${from.short}] transferred ${amount.formatted} TOKEN to [${to.short}]`,
    eventType: "Transfer",
  };
}

/**
 * Creates the <YourContract> translation blueprint.
 */
export function createYourContractBlueprint(): TranslationBlueprint {
  return {
    contractId: CONTRACT_ID,
    contractName: "Your Contract Name",
    translate: function (event: RawEvent): TranslationResult | null {
      return translateYourEvent(event);
      // Chain additional event handlers with ?? if needed:
      // return translateYourEvent(event) ?? translateAnotherEvent(event);
    },
  };
}
```

Key rules:
- Return `null` from `translate()` for any event your blueprint does not recognise — the registry will mark it `"cryptic"` and move on.
- `eventType` should be a short, title-cased label like `"Transfer"`, `"Swap"`, `"Mint"`.
- `description` should be a complete, plain-English sentence a non-developer can understand.

### Step 3 — Register the Blueprint

Open `lib/translator/registry.ts` and add two lines:

```typescript
// 1. Import your blueprint at the top of the file
import { createYourContractBlueprint } from "./blueprints/your-contract-name";

// 2. Register it inside buildRegistry()
function buildRegistry(): BlueprintRegistry {
  const registry: BlueprintRegistry = new Map();

  // ... existing blueprints ...

  // Your Contract Name
  const yourBlueprint = createYourContractBlueprint();
  registry.set(yourBlueprint.contractId, yourBlueprint);

  return registry;
}
```

---

## Translation Entry Schema

This is the most impactful contribution you can make. A **blueprint** teaches Open-Audit how to translate a specific contract's events into plain English.

### Step-by-Step Guide

#### Step 1: Understand Soroban Event Structure

Soroban contract events have a consistent structure:
- `contractId`: The contract's address (starts with "C")
- `topics`: An array of hex-encoded XDR values
  - `topics[0]`: The event name/discriminant (encoded as a Symbol XDR)
  - `topics[1..n]`: Additional indexed fields (like addresses)
- `data`: Hex-encoded XDR payload for unindexed fields (like amounts)

#### Step 2: Identify the Contract

Find:
1. The contract's deployed address (Contract ID)
2. The contract's ABI or event schema (defines which topics/data each event uses)
3. Real sample events from the network (for testing)

#### Step 3: Create the Blueprint File
Every blueprint's `translate()` function must conform to the following interface (defined in `lib/translator/types.ts`):

### `TranslationBlueprint`

| Field | Type | Description |
|---|---|---|
| `contractId` | `string` | The deployed Soroban contract address (`C...`). |
| `contractName` | `string` | Human-readable name shown in the UI, e.g. `"Soroswap Router"`. |
| `translate` | `(event: RawEvent) => TranslationResult \| null` | Returns a result when the event matches, otherwise `null`. |

### `RawEvent` (input)

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique event identifier (`ledger-index`). |
| `contractId` | `string` | The contract address that emitted this event. |
| `topics` | `string[]` | Ordered hex-encoded XDR topic values. `topics[0]` is typically the event name Symbol. |
| `data` | `string` | Hex-encoded XDR payload. |
| `ledger` | `number` | Ledger sequence number. |
| `timestamp` | `number` | Unix timestamp (seconds) of ledger close. |
| `txHash` | `string` | Transaction hash that produced this event. |

### `TranslationResult` (output)

| Field | Type | Description |
|---|---|---|
| `description` | `string` | Full plain-English sentence describing the event. |
| `eventType` | `string` | Short, title-cased event label (e.g. `"Transfer"`, `"Swap"`). |

### Decode Helpers

Use the helpers in `lib/translator/decode.ts` — do not invent your own hex parsing:

| Helper | Signature | Returns |
|---|---|---|
| `decodeAddress` | `(hex: string) => DecodedAddress` | `{ publicKey, short }` |
| `decodeAmount` | `(hex: string, symbol?: string) => DecodedAmount` | `{ raw, formatted, symbol }` |
| `decodeEventName` | `(topicHex: string) => string` | Event name string (e.g. `"transfer"`) |
| `truncateHex` | `(hex: string, chars?: number) => string` | Shortened hex for display |

### Example: Full Valid Translation Entry

```typescript
import { decodeAddress, decodeAmount } from "../decode";
import type { TranslationBlueprint, TranslationResult, RawEvent } from "../types";

/** Hex-encoded event topics (Symbol XDR). */
const YOUR_EVENT_TOPIC = "0x00000000000000000000000000000000000000000000000000000000796f75725f6576656e74";

/** Translate your event. */
function translateYourEvent(event: RawEvent): TranslationResult | null {
  if (!event.topics[0]?.includes("796f75725f6576656e74")) return null;

  const field1 = decodeAddress(event.topics[1] ?? "0x00");
  const field2 = decodeAddress(event.topics[2] ?? "0x00");
  const amount = decodeAmount(event.data, "SYMBOL");

  return {
    description: `[${field1.short}] did something with [${field2.short}] for ${amount.formatted} SYMBOL`,
    eventType: "Your Event",
  };
}

/** Create the full blueprint. */
export function createYourContractBlueprint(): TranslationBlueprint {
  return {
    contractId: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    contractName: "Your Contract Name",
    translate: function (event: RawEvent): TranslationResult | null {
      return translateYourEvent(event);
    },
  };
}
```

#### Step 4: Register the Blueprint
// lib/translator/blueprints/soroswap-router.ts

import { decodeAddress, decodeAmount } from "../decode";
import type { TranslationBlueprint, TranslationResult, RawEvent } from "../types";

const CONTRACT_ID = "CCZYWKX2JOCMFKEBXSYG4XWRMHKBFKDOUBZWEMYGNKHTECYNZP2LKIV";

function translateSwap(event: RawEvent): TranslationResult | null {
  if (!event.topics[0]?.includes("73776170")) return null; // "swap"
  if (event.topics.length < 3) return null;

  const sender = decodeAddress(event.topics[1]);
  const receiver = decodeAddress(event.topics[2]);
  const amount = decodeAmount(event.data, "USDC");

  return {
    description: `Public Key [${sender.short}] swapped ${amount.formatted} USDC, received by [${receiver.short}]`,
    eventType: "Swap",
  };
}

export function createSoroswapRouterBlueprint(): TranslationBlueprint {
  return {
    contractId: CONTRACT_ID,
    contractName: "Soroswap Router",
    translate: function (event: RawEvent): TranslationResult | null {
      return translateSwap(event);
    },
  };
}
```

---

## Testing Your Translation Locally

### Step 1 — Write a Unit Test

Create a test file at:

```
lib/translator/__tests__/<your-contract-name>.test.ts
```

Model it on the existing `decode.test.ts`. At minimum, test one event per event type your blueprint handles:

```typescript
import { describe, it, expect } from "vitest";
import { translateEvent } from "../registry";
import type { RawEvent } from "../types";

// Copy a real raw event from Stellar Laboratory or Horizon, or construct
// a minimal mock that matches the expected topics/data structure.
const MOCK_SWAP_EVENT: RawEvent = {
  id: "0000001-0",
  contractId: "CCZYWKX2JOCMFKEBXSYG4XWRMHKBFKDOUBZWEMYGNKHTECYNZP2LKIV",
  topics: [
    "0x000000000000000000000000000000000000000000000000000073776170", // "swap"
    "0x000000000000000000000000GABC1234AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA00",
    "0x000000000000000000000000GXYZ5678BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB00",
  ],
  data: "0x00000000000000000000000000000000000000000005F5E100",
  ledger: 52_000_000,
  timestamp: Math.floor(Date.now() / 1000),
  txHash: "abc123",
};

describe("Soroswap Router blueprint", () => {
  it("translates a swap event to plain English", () => {
    const result = translateEvent(MOCK_SWAP_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Swap");
    expect(result.description).toContain("swapped");
    expect(result.blueprintName).toBe("Soroswap Router");
  });

  it("returns cryptic for an unknown event from the same contract", () => {
    const unknownEvent: RawEvent = { ...MOCK_SWAP_EVENT, topics: ["0xdeadbeef"] };
    const result = translateEvent(unknownEvent);
    expect(result.status).toBe("cryptic");
  });
});
```

// Add to buildRegistry()
const yourBlueprint = createYourContractBlueprint();
registry.set(yourBlueprint.contractId, yourBlueprint);
```

#### Step 5: Test Locally

Use the Custom ABI feature in the dashboard first to test your event structure:

1. Start the dev server: `npm run dev`
2. Open http://localhost:3000
3. Click "Upload ABI" and paste your JSON configuration
4. Test with sample events

#### JSON Configuration Example (for Custom ABI Testing)

Here's a clean, copy-pasteable JSON configuration you can use with the "Upload ABI" dialog:

```json
{
  "contractId": "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "contractName": "Your Contract Name",
  "events": [
    {
      "name": "your_event",
      "fields": [
        { "name": "from", "type": "address" },
        { "name": "to", "type": "address" },
        { "name": "amount", "type": "i128" }
      ]
    }
  ]
}
```

#### Step 6: Run the Test Suite

Before pushing a PR, always run:

```bash
# Run all tests
npm test

# Run type checking
npx tsc --noEmit

# Run linting
npm run lint

# Format code
npm run format
```

#### Step 7: Add a Test File (Optional but Recommended)

Add a test in `/lib/translator/__tests__/your-contract-name.test.ts` with real raw events from the network.
### Step 2 — Run the Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode while developing
npm run test:watch
```

All tests must pass before you open a PR.

### Step 3 — Type Check and Lint

```bash
# Ensure no TypeScript errors
npx tsc --noEmit

# Ensure no lint errors
npm run lint

# Auto-format your code
npm run format
```

### Step 4 — Verify in the Browser (optional but recommended)

```bash
npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard). If the mock data includes your contract's ID, you will see your translated descriptions in the event feed.

---

## PR Naming Conventions

Use the following prefixes in your PR title:

| Prefix | When to use |
|---|---|
| `feat:` | Adding a new translation blueprint or feature |
| `fix:` | Fixing a bug in an existing blueprint or component |
| `docs:` | Documentation-only changes |
| `refactor:` | Code restructuring with no behaviour change |
| `test:` | Adding or improving tests |
| `chore:` | Dependency updates, config changes |

**Format:** `<prefix>: <short imperative description>`

**Examples:**

```
feat: add Soroswap Router swap translation blueprint
fix: handle missing topics in SAC burn event
docs: add blueprint authoring guide to CONTRIBUTING.md
test: add edge cases for decodeAmount with zero values
```

- Keep the title under 72 characters.
- Use the PR body for context: what changed, why, and what was tested.
- Reference the related issue: `Closes #42` or `Part of #42`.

---

## Submitting a Pull Request

1. Ensure your branch is up to date with `upstream/main`:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```
2. Run the full quality check:
   ```bash
   npm test && npx tsc --noEmit && npm run lint
   ```
3. Push your branch:
   ```bash
   git push -u origin feat/your-feature-name
   ```
4. Open a PR against `main` on GitHub.

### PR Checklist

- [ ] Branch is based on the latest `main`
- [ ] Blueprint file created in `lib/translator/blueprints/`
- [ ] Blueprint registered in `lib/translator/registry.ts`
- [ ] Unit tests written and passing (`npm test`)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] No lint errors (`npm run lint`)
- [ ] Code follows [CODE_STANDARDS.md](CODE_STANDARDS.md) (standard function declarations, no `any`)
- [ ] PR title follows naming conventions above
- [ ] PR description explains what contract was added and where you found its event schema

---

## Good First Issues

Check [`/docs/good-first-issues.json`](docs/good-first-issues.json) for beginner-friendly tasks, or look for issues labeled `good first issue` on GitHub.

Questions? Open a GitHub Discussion or find us in the [Stellar Developer Discord](https://discord.gg/stellardev).
