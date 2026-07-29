# open-audit-cli - Standalone Translation Registry Testing Tool

**Instant offline testing for Open-Audit translation blueprints** — no database, no network, no services required.

## Overview

`open-audit-cli` enables contributors to test new translation blueprints locally before submitting to the registry. Test raw hex event data against draft JSON/YAML specifications and see the compiled output immediately in your terminal.

## Features

✅ **Zero Dependencies** - No database setup, no network calls, no running services  
✅ **Pure Function Execution** - Stateless translation engine with no side effects  
✅ **JSON & YAML Support** - Write specifications in your preferred format  
✅ **Verbose Mode** - Debug output shows parsed spec and intermediate values  
✅ **Multi-Language** - Test translations in English, Spanish, French, Chinese  
✅ **Exit Codes** - Proper success (0) and failure (1) codes for CI/CD integration  

## Installation

```bash
# Install dependencies
npm install

# Build CLI
npm run build:cli

# Make executable (Unix-like systems)
chmod +x dist/cli/open-audit-cli.js

# Add to PATH (optional)
npm link
```

## Quick Start

### Test a Transfer Event

```bash
open-audit-cli test \
  --hex 0x0000000000000000000000000000000000000000000000000000000074726e73123456789abcdef0 \
  --spec ./cli/examples/token-transfer.json
```

**Output:**
```
GABC...EF01 transferred 100.00 USDC to G1234...5678
```

### Test with Verbose Mode

```bash
open-audit-cli test \
  --hex 0x74726e7312345678 \
  --spec ./cli/examples/token-transfer.yaml \
  --verbose
```

**Output:**
```
🔍 Open-Audit CLI - Test Mode

Configuration:
  Hex Data:     0x74726e7312345678
  Spec File:    /path/to/token-transfer.yaml
  Contract ID:  CTEST...0000
  Language:     en
  Ledger:       1000000

📄 Loaded Specification:
  Contract Name: Test Token Contract
  Version:       1.0.0
  Events:        2

📋 Raw Event:
{
  "id": "mock-1719331234567",
  "contractId": "CTEST...",
  "topics": ["0x74726e73"],
  "data": "0x12345678",
  ...
}

✅ Translation Successful

Event Type: transfer
Blueprint: Test Token Contract
Description:
GABC...5678 transferred 100.00 USDC to G1234...CDEF

Schema Version: 1.0.0
```

## Command Reference

### `open-audit-cli test`

Test a raw hex event against a draft translation specification.

#### Required Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--hex <data>` | `-x` | Raw hex-encoded event data |
| `--spec <path>` | `-s` | Path to specification file (JSON/YAML) |

#### Optional Options

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `--contract <id>` | `-c` | `CTEST...0000` | Stellar contract ID |
| `--lang <language>` | `-l` | `en` | Output language (en, es, fr, zh) |
| `--topics <topics...>` | `-t` | (auto) | Space-separated topic hex strings |
| `--ledger <number>` | | `1000000` | Ledger sequence number |
| `--verbose` | | `false` | Enable verbose debug output |
| `--no-telemetry` | | `true` | Disable telemetry (always disabled) |

### `open-audit-cli --help`

Display help information.

### `open-audit-cli --version`

Display CLI version.

## Specification Format

### JSON Format

```json
{
  "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "contractName": "My Token Contract",
  "version": "1.0.0",
  "validFromLedger": 0,
  "events": [
    {
      "name": "transfer",
      "template": "{from} transferred {amount} to {to}",
      "topics": [
        {
          "index": 0,
          "decodedName": "transfer"
        }
      ],
      "fields": [
        {
          "name": "from",
          "source": "topic",
          "index": 1,
          "type": "address"
        },
        {
          "name": "to",
          "source": "topic",
          "index": 2,
          "type": "address"
        },
        {
          "name": "amount",
          "source": "data",
          "type": "amount",
          "format": "USDC"
        }
      ]
    }
  ]
}
```

### YAML Format

```yaml
contractId: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
contractName: My Token Contract
version: "1.0.0"
validFromLedger: 0

events:
  - name: transfer
    template: "{from} transferred {amount} to {to}"
    topics:
      - index: 0
        decodedName: transfer
    fields:
      - name: from
        source: topic
        index: 1
        type: address
      - name: to
        source: topic
        index: 2
        type: address
      - name: amount
        source: data
        type: amount
        format: USDC
```

### Specification Fields

#### Root Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contractId` | string | No* | Stellar contract ID (can override with CLI flag) |
| `contractName` | string | Yes | Human-readable contract name |
| `version` | string | No | Schema version (e.g., "1.0.0") |
| `validFromLedger` | number | No | First ledger this schema applies to (default: 0) |
| `events` | array | Yes | Array of event definitions (at least 1) |

#### Event Definition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Event name (e.g., "transfer", "swap") |
| `template` | string | Yes | Description template with `{field}` placeholders |
| `topics` | array | No | Topic matching criteria |
| `fields` | array | Yes | Field extraction and formatting rules |

#### Topic Matcher

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `index` | number | Yes | Topic array index to check (0-based) |
| `equals` | string | No | Exact hex value match |
| `includes` | string | No | Substring match (case-insensitive) |
| `decodedName` | string | No | Decoded event name match |

#### Field Mapping

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Field name for template interpolation |
| `source` | string | Yes | Data source: `"topic"` or `"data"` |
| `index` | number | No* | Topic index (required if source="topic") |
| `type` | string | Yes | Value type (see types below) |
| `format` | string | No | Format hint (e.g., token symbol for amounts) |

#### Supported Types

| Type | Description | Example Output |
|------|-------------|----------------|
| `address` | Stellar address | `GABC...1234` |
| `amount` / `u128` / `i128` | Token amount | `100.00 USDC` |
| `string` | UTF-8 string | `Hello World` |
| `symbol` | Symbol/identifier | `transfer` |
| `hex` / `bytes` | Raw hex | `0x1234...cdef` |

## Examples

### Example 1: Simple Transfer

**Specification** (`transfer.json`):
```json
{
  "contractName": "USDC Token",
  "events": [
    {
      "name": "transfer",
      "template": "Transfer of {amount} from {from} to {to}",
      "fields": [
        { "name": "from", "source": "topic", "index": 1, "type": "address" },
        { "name": "to", "source": "topic", "index": 2, "type": "address" },
        { "name": "amount", "source": "data", "type": "amount", "format": "USDC" }
      ]
    }
  ]
}
```

**Command:**
```bash
open-audit-cli test -x 0xabcd1234 -s transfer.json
```

**Output:**
```
Transfer of 100.00 USDC from GABC...1234 to GXYZ...5678
```

### Example 2: Multi-Event Contract

**Specification** (`dex.yaml`):
```yaml
contractName: DEX Router
events:
  - name: swap
    template: "Swapped {amountIn} {tokenIn} for {amountOut} {tokenOut}"
    topics:
      - index: 0
        decodedName: swap
    fields:
      - name: tokenIn
        source: topic
        index: 1
        type: address
      - name: tokenOut
        source: topic
        index: 2
        type: address
      - name: amountIn
        source: data
        type: amount
      - name: amountOut
        source: data
        type: amount

  - name: addLiquidity
    template: "Added liquidity: {amount0} + {amount1}"
    topics:
      - index: 0
        decodedName: addLiquidity
    fields:
      - name: amount0
        source: data
        type: amount
      - name: amount1
        source: data
        type: amount
```

**Command:**
```bash
open-audit-cli test \
  --hex 0x7377617012345678abcdef --spec dex.yaml \
  --topics 0x73776170 CDLZ...YSC CB3S...QXQ
```

### Example 3: Versioned Blueprint

**Specification** (`token-v2.json`):
```json
{
  "contractName": "Token V2",
  "version": "2.0.0",
  "validFromLedger": 500000,
  "events": [
    {
      "name": "transfer",
      "template": "[V2] {from} sent {amount} to {to} (fee: {fee})",
      "fields": [
        { "name": "from", "source": "topic", "index": 1, "type": "address" },
        { "name": "to", "source": "topic", "index": 2, "type": "address" },
        { "name": "amount", "source": "data", "type": "amount" },
        { "name": "fee", "source": "data", "type": "amount" }
      ]
    }
  ]
}
```

**Command:**
```bash
open-audit-cli test \
  --hex 0x1234567890abcdef \
  --spec token-v2.json \
  --ledger 600000
```

## Integration with CI/CD

### GitHub Actions

```yaml
name: Test Translation Blueprint

on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build:cli
      
      - name: Test Blueprint
        run: |
          open-audit-cli test \
            --hex 0x74726e7312345678 \
            --spec ./blueprints/my-contract.json
```

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Testing translation blueprints..."

for spec in blueprints/*.json; do
  echo "Testing $spec..."
  open-audit-cli test \
    --hex 0x74726e7312345678 \
    --spec "$spec" \
    --verbose || exit 1
done

echo "All blueprints passed!"
```

## Troubleshooting

### Error: "Invalid hex data"

**Cause:** Hex string contains invalid characters or is empty.

**Solution:** Ensure hex string only contains 0-9, a-f, A-F. Prefix with `0x` or omit it.

```bash
# ✅ Valid
open-audit-cli test -x 0x1234abcd -s spec.json
open-audit-cli test -x 1234ABCD -s spec.json

# ❌ Invalid
open-audit-cli test -x 0xGHIJ -s spec.json
```

### Error: "Specification file not found"

**Cause:** File path is incorrect or file doesn't exist.

**Solution:** Use absolute path or path relative to current directory.

```bash
# ✅ Correct
open-audit-cli test -x 0x1234 -s ./cli/examples/token-transfer.json

# ❌ Incorrect
open-audit-cli test -x 0x1234 -s token-transfer.json  # If not in current dir
```

### Error: "Event does not match blueprint criteria"

**Cause:** The hex data doesn't match any event patterns in the specification.

**Solution:** 
1. Use `--verbose` to see parsed event structure
2. Check topic matchers in specification
3. Verify hex data format

```bash
open-audit-cli test -x 0x1234 -s spec.json --verbose
```

### Error: "Blueprint returned null"

**Cause:** Specification doesn't have a matching event pattern.

**Solution:** Add an event definition that matches your hex data structure.

## Best Practices

### 1. Start with Examples

Copy and modify provided examples rather than starting from scratch:

```bash
cp cli/examples/token-transfer.json my-contract.json
```

### 2. Test Incrementally

Build your specification step by step:

```bash
# Test basic structure
open-audit-cli test -x 0x1234 -s my-contract.json --verbose

# Add field mappings
# Test again...

# Add topic matchers
# Test again...
```

### 3. Use Verbose Mode for Debugging

Always use `--verbose` when developing a new specification:

```bash
open-audit-cli test -x 0x1234 -s my-contract.json --verbose
```

### 4. Test Multiple Events

Create test cases for each event type in your specification:

```bash
# Transfer event
open-audit-cli test -x 0x74726e73... -s spec.json

# Mint event  
open-audit-cli test -x 0x6d696e74... -s spec.json

# Burn event
open-audit-cli test -x 0x6275726e... -s spec.json
```

### 5. Version Your Specifications

Use semantic versioning and `validFromLedger` for upgrades:

```json
{
  "version": "2.0.0",
  "validFromLedger": 500000,
  ...
}
```

## Development Workflow

1. **Create Specification**
   ```bash
   cp cli/examples/token-transfer.yaml my-contract.yaml
   # Edit my-contract.yaml
   ```

2. **Test Locally**
   ```bash
   open-audit-cli test -x <hex> -s my-contract.yaml --verbose
   ```

3. **Refine Template**
   - Adjust field mappings
   - Fix formatting
   - Test again

4. **Add to Registry**
   - Convert to TypeScript blueprint
   - Submit PR to Open-Audit
   - Include test cases

## Architecture

### Pure Function Design

The CLI executes translation in a pure function context with **zero side effects**:

- ✅ No database connections
- ✅ No network calls
- ✅ No file writes (except stdout/stderr)
- ✅ No telemetry collection
- ✅ No state mutations

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - translation executed successfully |
| 1 | Failure - translation failed or error occurred |

Use in scripts:

```bash
if open-audit-cli test -x 0x1234 -s spec.json; then
  echo "Test passed!"
else
  echo "Test failed!"
  exit 1
fi
```

## Contributing

Contributions welcome! See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## Support

- **GitHub Issues:** [Open-Audit/issues](https://github.com/your-org/Open-Audit/issues)
- **Discord:** `#translation-registry` channel
- **Documentation:** [Full docs](../README.md)

## License

MIT License - See LICENSE file for details

---

**Developer-friendly | Zero dependencies | Instant feedback**
