# Translation Registry Validation System

## Overview

This document describes the 3-tier validation pipeline that automatically checks translation registry contributions for errors before they are merged into the codebase.

## Problem Statement

Community contributors update translation registry files (JSON) that map raw blockchain events to human-readable English templates. Common issues include:

- **Malformed syntax**: Invalid JSON structure, missing required fields
- **Invalid data types**: Wrong field types (string instead of array, etc.)
- **Mismatched template variables**: Using `{amount}` in the template when the event payload only provides `{value}`
- **Duplicate entries**: Multiple entries with the same contract_id and topics
- **Inconsistent field definitions**: Topics array length doesn't match event_structure

## Solution: 3-Tier Validation Pipeline

### Tier 1: JSON Schema Validation

**Purpose**: Enforce strict structural rules and data types

**What it checks**:
- All required fields are present (`contract_id`, `topics`, `event_structure`, `english_template`)
- Correct data types for each field
- Contract ID format (56-character alphanumeric Stellar address)
- Topic names follow snake_case convention
- Field types match allowed Soroban types (address, i128, u32, etc.)
- No additional unexpected properties

**Tool**: [AJV (Another JSON Schema Validator)](https://ajv.js.org/)

**Schema Location**: `lib/translator/registry.schema.json`

### Tier 2: Template Variable Cross-Examination

**Purpose**: Verify template placeholders match available event fields

**What it checks**:
- Extracts all bracketed variables from `english_template` (e.g., `{from}`, `{amount}`, `{to.short}`)
- Compares against fields defined in `event_structure.topics` and `event_structure.data`
- Ensures every template variable has a corresponding field definition
- Supports dot notation (e.g., `{from.short}` checks for `from` field)

**Example Error**:
```
Error in lib/translator/registry.json:
  Entry [5]:
    Contract: CAZAQB3D7KSLSNOSQKYD2V4JP5V2Y3B4RDJZRLBFCCIXDCTE3WHSY3UE
    Topics: [swap]
    ❌ Template references '{amount_out}' but event_structure only provides [user, amount_in]
```

### Tier 3: Logical Consistency Checks

**Purpose**: Validate business logic and detect structural issues

**What it checks**:
- **Topics Alignment**: The `topics` array length must equal `event_structure.topics.length + 1` (first topic is the event name)
- **Duplicate Detection**: No two entries can have the same `contract_id` + `topics` combination
- **Test Vector Validation**: If `test_vectors` are provided, their params must match the defined fields

## Usage

### Running Locally

```bash
# Run full 3-tier validation
npm run lint:registry

# Run only JSON schema validation (legacy)
npm run validate:registry
```

### Expected Output (Success)

```
🔍 Starting Translation Registry Validation...

✓ Schema loaded successfully
✓ Registry loaded successfully (25 entries)

📋 Running Tier 1: JSON Schema Validation...
✓ Schema validation passed

📋 Running Tier 2: Template Variable Cross-Examination...
📋 Running Tier 3: Logical Consistency Checks...
✓ Logic validation passed

================================================================================
✅ ALL VALIDATION CHECKS PASSED
================================================================================

25 registry entries validated successfully.
```

### Expected Output (Failure)

```
================================================================================
TRANSLATION REGISTRY VALIDATION FAILED
================================================================================

📄 File: lib/translator/registry.json
--------------------------------------------------------------------------------

  Entry [1]:
    Contract: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
    Topics: [transfer]
    ❌ Template references '{value}' but event_structure only provides [from, to, amount]

  Entry [3]:
    Contract: INVALID
    Topics: [mint]
    ❌ Schema validation failed at /3/contract_id: must match pattern "^[A-Z0-9]{56}$"

  Entry [7]:
    Contract: CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
    Topics: [transfer, from, to]
    ❌ Duplicate entry detected (same contract_id and topics as index 6)

================================================================================
Total: 3 error(s), 0 warning(s)
================================================================================
```

## GitHub Actions Integration

### Workflow Configuration

**File**: `.github/workflows/registry-lint.yml`

**Triggers**:
- Pull requests that modify:
  - `lib/translator/registry.json`
  - `lib/translator/registry.schema.json`
  - Linting scripts
- Pushes to `main` branch (for the same files)

**Path Filtering**: The workflow only runs when translation-related files change, saving CI runner minutes.

### PR Workflow

1. Contributor opens PR with registry changes
2. GitHub Actions automatically triggers validation
3. If validation fails:
   - Job fails with detailed error logs
   - Bot comments on PR with helpful error explanation
   - PR is blocked from merging
4. If validation passes:
   - Green checkmark appears on PR
   - PR can be reviewed and merged

### Error Reporting in CI

Errors are presented in three places:

1. **Action Logs**: Full detailed output with color coding
2. **Job Summary**: Markdown table showing which tiers passed/failed
3. **PR Comment**: User-friendly explanation with links to detailed logs

## Registry File Structure

### Valid Entry Example

```json
{
  "contract_id": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "topics": ["transfer", "from", "to"],
  "event_structure": {
    "topics": [
      { "name": "from", "type": "address" },
      { "name": "to", "type": "address" }
    ],
    "data": { "name": "amount", "type": "i128" }
  },
  "english_template": "Public Key [{from.short}] transferred {amount.formatted} USDC to [{to.short}]",
  "test_vectors": [
    {
      "hex_payload": "0000000a",
      "params": {
        "from": "GABC123...",
        "to": "GXYZ789...",
        "amount": 1000000
      }
    }
  ]
}
```

### Field Descriptions

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `contract_id` | ✅ | string | 56-character Soroban contract address (uppercase alphanumeric) |
| `topics` | ✅ | array | Event topic names; first is the event discriminant, rest map to fields |
| `event_structure` | ✅ | object | Defines how raw event data maps to named fields |
| `event_structure.topics` | ✅ | array | Field definitions extracted from event topics[1..n] |
| `event_structure.data` | | object | Optional field extracted from event data payload |
| `english_template` | ✅ | string | Human-readable template with `{variable}` placeholders |
| `test_vectors` | | array | Optional test payloads for CI preview rendering |

### Supported Soroban Types

- `address` - Stellar account or contract address
- `i128`, `i64` - Signed integers
- `u32`, `u64`, `u128` - Unsigned integers
- `symbol` - Short string identifier
- `bool` - Boolean value
- `bytes` - Arbitrary byte data
- `string` - Text data

### Template Variable Syntax

- Basic variable: `{from}`, `{amount}`, `{to}`
- With formatter: `{from.short}`, `{amount.formatted}`
- Nested objects: `{token.symbol}`, `{pool.id}`

**Important**: Only the base variable name (before the dot) needs to be defined in `event_structure`.

## Testing the Linter

A mock "bad" registry file is provided for testing: `lib/translator/registry.bad-example.json`

This file contains 10 intentional errors covering all validation tiers:

1. Missing required `contract_id` field
2. Template variable mismatch (`{value}` vs `{amount}`)
3. Invalid contract_id format
4. Topics array length mismatch
5. Multiple missing template variables
6. Invalid type enum value
7. Duplicate entry (first)
8. Duplicate entry (second)
9. Invalid test_vectors param
10. Empty topics array

**To test**:
```bash
# Temporarily replace the registry file
cp lib/translator/registry.json lib/translator/registry.backup.json
cp lib/translator/registry.bad-example.json lib/translator/registry.json

# Run linter (should fail with 10+ errors)
npm run lint:registry

# Restore original
mv lib/translator/registry.backup.json lib/translator/registry.json
```

## Enhanced Schema Features

The enhanced JSON schema (`registry.schema.json`) includes:

### Strict Validation Rules

- **Pattern matching**: Contract IDs must be exactly 56 uppercase alphanumeric characters
- **Field naming**: Topic and field names must follow snake_case (`^[a-z_][a-z0-9_]*$`)
- **Type enums**: Only valid Soroban types are accepted
- **Unique items**: Topics array cannot have duplicates
- **Additional properties forbidden**: No extra fields allowed

### Improved Error Messages

- Specific pattern mismatch messages
- Clear indication of which field failed
- Enum value suggestions when type is invalid

## Common Errors and Fixes

### Error: "Template references '{X}' but event_structure only provides [Y, Z]"

**Cause**: You used a variable in `english_template` that isn't defined in `event_structure`

**Fix**: Either:
1. Add the missing field to `event_structure.topics` or `event_structure.data`
2. Update the template to use an existing field name

### Error: "Topics array length mismatch"

**Cause**: The `topics` array length doesn't match the structure

**Rule**: `topics.length` must equal `event_structure.topics.length + 1`

**Example**:
```json
{
  "topics": ["transfer", "from", "to"],  // 3 items
  "event_structure": {
    "topics": [                           // 2 items (first topic is event name)
      { "name": "from", "type": "address" },
      { "name": "to", "type": "address" }
    ]
  }
}
```

### Error: "Duplicate entry detected"

**Cause**: Two entries have the same `contract_id` AND `topics` combination

**Fix**: Remove one of the duplicate entries or modify the topics to make them unique

### Error: "must match pattern '^[A-Z0-9]{56}$'"

**Cause**: Invalid Stellar contract address format

**Fix**: Ensure contract_id is exactly 56 characters and contains only uppercase letters and numbers

## Contributing

When submitting a PR with registry changes:

1. **Test locally first**: Run `npm run lint:registry` before pushing
2. **Fix all errors**: The CI will block merging if validation fails
3. **Review CI feedback**: Check the detailed logs if the action fails
4. **Ask for help**: If stuck, reference this document or ask in Discord

## File Locations

```
Open-Audit/
├── .github/workflows/
│   └── registry-lint.yml          # GitHub Actions workflow
├── lib/translator/
│   ├── registry.json              # Main registry file (validated)
│   ├── registry.schema.json       # JSON schema definition
│   └── registry.bad-example.json  # Test file with errors
├── scripts/
│   ├── lint-registry.ts           # Advanced 3-tier linter
│   └── validate-registry.ts       # Legacy schema validator
└── REGISTRY_VALIDATION.md         # This document
```

## Dependencies

- **ajv**: JSON schema validator
- **tsx**: TypeScript execution for scripts
- **node**: Runtime (v20+)

All dependencies are listed in `package.json` and installed via `npm ci`.

## Future Enhancements

Potential improvements to consider:

- [ ] Auto-fix suggestions for common errors
- [ ] YAML support in addition to JSON
- [ ] Multi-language template validation
- [ ] Integration with VSCode extension for real-time validation
- [ ] Registry entry generator CLI tool
- [ ] Automated test vector generation from blockchain data

---

## Questions?

- **Documentation**: See `CONTRIBUTING.md`
- **Issues**: Open a GitHub issue with the `registry` label
- **Community**: Join the Discord server

Last updated: 2026-06-20
