# Testing the Registry Linter

This document provides instructions for testing the 3-tier validation pipeline.

## Prerequisites

1. Install dependencies (including `ajv` and `tsx`):
```bash
npm install
```

## Test 1: Validate Current Registry (Should Pass)

The current registry file should pass all validation checks:

```bash
npm run lint:registry
```

**Expected Output**:
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

## Test 2: Validate Bad Example (Should Fail)

Test the linter against a file with intentional errors:

```bash
# Backup current registry
copy lib\translator\registry.json lib\translator\registry.backup.json

# Use bad example
copy lib\translator\registry.bad-example.json lib\translator\registry.json

# Run linter (should fail)
npm run lint:registry

# Restore original
copy lib\translator\registry.backup.json lib\translator\registry.json
del lib\translator\registry.backup.json
```

**Expected Output**: Should detect and report 10+ errors including:
- Missing required fields
- Template variable mismatches
- Invalid contract_id formats
- Topics array length mismatches
- Duplicate entries
- Invalid type enums
- Test vector issues

## Test 3: Test Individual Error Types

### Test 3a: Template Variable Mismatch

Create a test file `test-mismatch.json`:
```json
[
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
    "english_template": "Transfer of {value} from {from} to {to}"
  }
]
```

Run:
```bash
copy test-mismatch.json lib\translator\registry.json
npm run lint:registry
```

**Expected Error**:
```
❌ Template references '{value}' but event_structure only provides [from, to, amount]
```

### Test 3b: Invalid Contract ID

Create test file with invalid contract_id:
```json
[
  {
    "contract_id": "INVALID",
    "topics": ["transfer", "from", "to"],
    "event_structure": {
      "topics": [
        { "name": "from", "type": "address" },
        { "name": "to", "type": "address" }
      ],
      "data": { "name": "amount", "type": "i128" }
    },
    "english_template": "Transfer of {amount} from {from} to {to}"
  }
]
```

**Expected Error**: Schema validation should fail on contract_id pattern (if schema is enhanced).

### Test 3c: Topics Length Mismatch

```json
[
  {
    "contract_id": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "topics": ["burn"],
    "event_structure": {
      "topics": [
        { "name": "from", "type": "address" },
        { "name": "to", "type": "address" }
      ],
      "data": { "name": "amount", "type": "i128" }
    },
    "english_template": "Burned {amount}"
  }
]
```

**Expected Error**:
```
❌ Topics array length mismatch: expected 3 (1 event name + 2 fields), got 1
```

### Test 3d: Duplicate Detection

```json
[
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
    "english_template": "Transfer {amount} from {from} to {to}"
  },
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
    "english_template": "Different template but same entry"
  }
]
```

**Expected Error**:
```
❌ Duplicate entry detected (same contract_id and topics as index 0)
```

## Test 4: Verify GitHub Actions Workflow

You can test the GitHub Actions workflow locally using [act](https://github.com/nektos/act):

```bash
# Install act (requires Docker)
# Then run:
act pull_request --workflows .github/workflows/registry-lint.yml
```

Or simply push a test branch and open a PR to see the workflow in action.

## Test 5: Validate Legacy Script Still Works

The old validation script should still work:

```bash
npm run validate:registry
```

This runs the basic JSON schema validation without the advanced checks.

## Continuous Testing

Add to your development workflow:

1. **Before committing registry changes**:
   ```bash
   npm run lint:registry
   ```

2. **In git pre-commit hook** (optional):
   Add to `.git/hooks/pre-commit`:
   ```bash
   #!/bin/sh
   if git diff --cached --name-only | grep -q "lib/translator/registry.json"; then
     npm run lint:registry || exit 1
   fi
   ```

## Troubleshooting

### Error: "Cannot find module 'ajv'"

**Solution**:
```bash
npm install
```

### Error: "tsx: command not found"

**Solution**:
```bash
npm install tsx --save-dev
```

Or use npx:
```bash
npx tsx scripts/lint-registry.ts
```

### Error: "Schema file not found"

**Solution**: Ensure you're running from the project root directory:
```bash
cd "c:\Users\Admin\Desktop\Issues on ground\Open-Audit"
npm run lint:registry
```

### Linter passes but CI fails

**Possible causes**:
1. Different Node.js versions (ensure v20+)
2. Schema file differences
3. Package versions mismatch

**Solution**: Check CI logs for specific error and ensure local environment matches CI.

## Performance Benchmarks

Expected validation times:

| Registry Size | Validation Time |
|--------------|----------------|
| 25 entries   | < 1 second    |
| 100 entries  | < 2 seconds   |
| 500 entries  | < 5 seconds   |
| 1000 entries | < 10 seconds  |

If validation is slower, check for:
- Large test_vectors arrays
- Very long template strings
- Disk I/O issues

## Automated Testing

You can add the linter to your test suite in `vitest.config.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('Registry Validation', () => {
  it('should pass all validation checks', () => {
    expect(() => {
      execSync('npm run lint:registry', { stdio: 'inherit' });
    }).not.toThrow();
  });
});
```

## Summary

The 3-tier validation pipeline provides comprehensive error detection:

- ✅ **Tier 1**: Catches structural and type errors
- ✅ **Tier 2**: Catches template variable mismatches
- ✅ **Tier 3**: Catches logical inconsistencies

All tests should complete in under 5 seconds for typical registry sizes.
