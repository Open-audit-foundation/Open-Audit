# open-audit-cli - Quick Start Guide

## Installation (30 seconds)

```bash
npm install
npm run build:cli
```

## Test an Example (10 seconds)

```bash
npm run cli:example
```

**Output:**
```
✅ Translation Successful

Event Type: transfer
Blueprint: Test Token Contract
Description:
GABC...5678 transferred 100.00 USDC to G1234...CDEF
```

## Create Your First Specification (5 minutes)

### Step 1: Copy Template

```bash
cp cli/examples/token-transfer.json my-contract.json
```

### Step 2: Edit Contract Details

```json
{
  "contractId": "YOUR_CONTRACT_ID_HERE",
  "contractName": "My Token",
  ...
}
```

### Step 3: Define Event Template

```json
{
  "name": "transfer",
  "template": "{from} sent {amount} to {to}",
  "fields": [...]
}
```

### Step 4: Test It

```bash
npm run build:cli
node dist/cli/open-audit-cli.js test \
  --hex 0x1234567890abcdef \
  --spec my-contract.json \
  --verbose
```

## Common Commands

```bash
# Build CLI
npm run build:cli

# Run CLI directly
npm run cli -- test --hex 0x1234 --spec spec.json

# Test example
npm run cli:example

# Run test suite
npm run cli:test

# Show help
node dist/cli/open-audit-cli.js --help
```

## Minimal Specification Template

```json
{
  "contractName": "My Contract",
  "events": [
    {
      "name": "my_event",
      "template": "Something happened: {value}",
      "fields": [
        {
          "name": "value",
          "source": "data",
          "type": "hex"
        }
      ]
    }
  ]
}
```

## Next Steps

- 📖 Read full documentation: [README.md](./README.md)
- 🧪 Explore examples: [cli/examples/](./examples/)
- 🤝 Contribute: [CONTRIBUTING.md](../CONTRIBUTING.md)

## Troubleshooting

**Error: "Cannot find module 'commander'"**
```bash
npm install
```

**Error: "command not found: open-audit-cli"**
```bash
npm run build:cli
# Then use: npm run cli -- <args>
# Or: node dist/cli/open-audit-cli.js <args>
```

**Want verbose output?**
```bash
node dist/cli/open-audit-cli.js test \
  --hex 0x1234 \
  --spec spec.json \
  --verbose
```
