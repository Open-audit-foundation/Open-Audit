# open-audit-cli

Standalone CLI for testing Open-Audit translation registry blueprints offline.

## Overview

`open-audit-cli` lets you test a draft blueprint spec against raw hex event
data before registering it in the production registry. The key guarantee:

> **A spec that passes `open-audit-cli test` uses the exact same validation
> and builder logic as production registration.**

Both the CLI and `lib/translator/registry.ts` consume the shared
`validateBlueprintSpec()` and `buildBlueprintFromSpec()` functions from
`lib/translator/blueprint-spec.ts`. There is no parallel reimplementation.

## Spec file format vs production blueprints

| | `--spec` file (CLI) | `lib/translator/blueprints/*.ts` (registry) |
|---|---|---|
| Format | JSON or YAML | TypeScript |
| Type | `BlueprintSpec` | `TranslationBlueprint` |
| Validated by | `validateBlueprintSpec()` | TypeScript compiler + same validator |
| Builder | `buildBlueprintFromSpec()` | Same function |
| Versioning | `validFromLedger` field | `VersionedTranslationBlueprint` |

Both paths produce an identical `TranslationBlueprint` object at runtime.
The only difference is that production blueprints are written in TypeScript
directly (for complex matching logic) while spec files are declarative
JSON/YAML (for simpler event patterns and community submissions).

## Installation

```bash
npm run build:cli
```

## Usage

```bash
open-audit-cli test --hex <raw_hex_data> --spec <path_to_spec>
```

### Options

| Flag | Description | Default |
|---|---|---|
| `-x, --hex` | Raw hex-encoded event data | required |
| `-s, --spec` | Path to blueprint spec file (.json or .yaml) | required |
| `-c, --contract` | Stellar contract ID (C...) | test address |
| `-l, --lang` | Output language: en, es, fr, zh | en |
| `-t, --topics` | Separate topic hex strings (space-separated) | auto-parsed |
| `--ledger` | Ledger sequence number | 1000000 |
| `--verbose` | Enable verbose output | false |

## Spec file schema

```json
{
  "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "contractName": "My Token Contract",
  "version": "1.0.0",
  "validFromLedger": 0,
  "events": [
    {
      "name": "Transfer",
      "template": "{from} sent {amount} to {to}",
      "topics": [
        { "index": 0, "includes": "74726e73" }
      ],
      "fields": [
        { "name": "from", "source": "topic", "index": 1, "type": "address" },
        { "name": "to", "source": "topic", "index": 2, "type": "address" },
        { "name": "amount", "source": "data", "type": "amount", "format": "USDC" }
      ]
    }
  ]
}
```

### Field types

| Type | Description |
|---|---|
| `address` | Stellar address, shortened to `GABC...1234` |
| `amount` / `u128` / `i128` | Numeric amount, formatted with symbol |
| `string` / `symbol` | UTF-8 decoded from hex |
| `hex` / `bytes` | Truncated hex string |

## CI validation

Run all committed blueprint specs through the shared validator:

```bash
npm run validate:blueprints
```

This is the same check that runs in CI on every change to
`lib/translator/blueprints/`. A spec that passes here is guaranteed to use
the same validation and builder logic as production registration.

## Tested vs designed-but-unverified properties

The following properties are **tested** by the shared validator and CI:

- `contractId` starts with `C` (valid Stellar contract address format)
- `contractName` is a non-empty string
- `events` array has at least one entry
- Every event has `name`, `template`, and at least one `fields` entry
- Every field has `name`, `source` (`topic` or `data`), and a supported `type`
- `version` is a string if present
- `validFromLedger` is a number if present

The following are **designed but not automatically verified** by the CLI:

- That `validFromLedger` matches the actual on-chain ledger of a contract upgrade
- That topic hex values in `equals`/`includes` matchers are correctly encoded XDR
- That `format` symbols match the asset symbol registered in the production SAC map
- That the human-readable `template` string is accurate and grammatically correct

Always verify these manually before submitting a blueprint for production registration.
