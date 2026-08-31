# open-audit-cli - Command Cheat Sheet

## Installation

```bash
npm install && npm run build:cli
```

## Basic Commands

```bash
# Run example
npm run cli:example

# Show help
node dist/cli/open-audit-cli.js --help

# Show version
node dist/cli/open-audit-cli.js --version

# Test specification
node dist/cli/open-audit-cli.js test \
  --hex <hex_data> \
  --spec <spec_file>
```

## Test Command Options

| Option | Alias | Required | Default | Description |
|--------|-------|----------|---------|-------------|
| `--hex <data>` | `-x` | ✅ | - | Raw hex event data |
| `--spec <path>` | `-s` | ✅ | - | Spec file (JSON/YAML) |
| `--contract <id>` | `-c` | | `CTEST...` | Contract ID |
| `--lang <lang>` | `-l` | | `en` | Language (en/es/fr/zh) |
| `--topics <topics>` | `-t` | | (auto) | Space-separated topics |
| `--ledger <num>` | | | `1000000` | Ledger sequence |
| `--verbose` | | | `false` | Debug output |

## Quick Examples

### Test JSON Spec
```bash
node dist/cli/open-audit-cli.js test \
  -x 0x74726e7312345678 \
  -s cli/examples/token-transfer.json
```

### Test YAML Spec
```bash
node dist/cli/open-audit-cli.js test \
  -x 0x74726e73 \
  -s cli/examples/token-transfer.yaml
```

### Verbose Mode
```bash
node dist/cli/open-audit-cli.js test \
  -x 0x1234 \
  -s spec.json \
  --verbose
```

### With Custom Contract
```bash
node dist/cli/open-audit-cli.js test \
  -x 0xabcd \
  -s spec.json \
  -c CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

## Minimal Spec Template

### JSON
```json
{
  "contractName": "My Contract",
  "events": [{
    "name": "event_name",
    "template": "Description: {field}",
    "fields": [{
      "name": "field",
      "source": "data",
      "type": "hex"
    }]
  }]
}
```

### YAML
```yaml
contractName: My Contract
events:
  - name: event_name
    template: "Description: {field}"
    fields:
      - name: field
        source: data
        type: hex
```

## Field Types

| Type | Description | Example |
|------|-------------|---------|
| `address` | Stellar address | `GABC...1234` |
| `amount` | Token amount | `100.00 USDC` |
| `string` | UTF-8 string | `Hello World` |
| `symbol` | Symbol | `transfer` |
| `hex` | Raw hex | `0x1234...` |

## Topic Matchers

```json
"topics": [
  {
    "index": 0,
    "equals": "0x74726e73"
  }
]
```

```json
"topics": [
  {
    "index": 0,
    "includes": "transfer"
  }
]
```

```json
"topics": [
  {
    "index": 0,
    "decodedName": "transfer"
  }
]
```

## Field Sources

### Topic Field
```json
{
  "name": "from",
  "source": "topic",
  "index": 1,
  "type": "address"
}
```

### Data Field
```json
{
  "name": "amount",
  "source": "data",
  "type": "amount",
  "format": "USDC"
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Failure |

## Common Errors

### "Invalid hex data"
```bash
# ✅ Valid
--hex 0x1234abcd
--hex 1234ABCD

# ❌ Invalid
--hex GHIJ
```

### "Specification file not found"
```bash
# Use absolute or relative path
--spec ./path/to/spec.json
--spec /absolute/path/to/spec.json
```

### "Event does not match blueprint criteria"
```bash
# Use --verbose to debug
node dist/cli/open-audit-cli.js test \
  -x 0x1234 \
  -s spec.json \
  --verbose
```

## NPM Scripts

```bash
npm run build:cli        # Build CLI
npm run cli              # Run CLI (with args)
npm run cli:test         # Run test suite
npm run cli:example      # Run example
```

## CI/CD Example

```yaml
- name: Test Blueprint
  run: |
    npm run build:cli
    node dist/cli/open-audit-cli.js test \
      --hex 0x1234 \
      --spec blueprints/my-spec.json
```

## Links

- 📖 [Full Documentation](./README.md)
- 🚀 [Quick Start](./QUICK_START.md)
- 📦 [Examples](./examples/)
