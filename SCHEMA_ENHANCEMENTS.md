# JSON Schema Enhancements for Translation Registry

## Overview

This document describes the enhanced validation rules that should be applied to `lib/translator/registry.schema.json` to provide stricter validation and better error messages.

## Current Schema Limitations

The existing schema validates basic structure but lacks:
- Pattern validation for contract addresses
- Field naming conventions
- Type enumerations
- Duplicate prevention
- Test vector validation

## Recommended Enhancements

### 1. Contract ID Pattern Validation

**Current**:
```json
"contract_id": {
  "type": "string",
  "description": "The Soroban contract address this entry applies to"
}
```

**Enhanced**:
```json
"contract_id": {
  "type": "string",
  "description": "The Soroban contract address this entry applies to",
  "minLength": 56,
  "maxLength": 56,
  "pattern": "^[A-Z0-9]{56}$"
}
```

**Why**: Ensures contract addresses are exactly 56 characters and follow Stellar address format (uppercase alphanumeric).

### 2. Topic Name Convention

**Current**:
```json
"topics": {
  "type": "array",
  "minItems": 1,
  "items": {
    "type": "string"
  }
}
```

**Enhanced**:
```json
"topics": {
  "type": "array",
  "description": "Ordered list of event topic names (the first is the event discriminant)",
  "minItems": 1,
  "uniqueItems": true,
  "items": {
    "type": "string",
    "minLength": 1,
    "pattern": "^[a-z_][a-z0-9_]*$"
  }
}
```

**Why**: 
- Enforces snake_case naming convention
- Prevents duplicate topics in the same array
- Ensures non-empty strings

### 3. Field Name Validation

**Current**:
```json
"name": {
  "type": "string",
  "description": "The field name used in the english_template"
}
```

**Enhanced**:
```json
"name": {
  "type": "string",
  "description": "The field name used in the english_template",
  "minLength": 1,
  "pattern": "^[a-z_][a-z0-9_]*$"
}
```

**Why**: Ensures consistent snake_case naming for all field names.

### 4. Type Enumeration

**Current**:
```json
"type": {
  "type": "string",
  "description": "The Soroban type (address, i128, u32, symbol, bool, bytes)"
}
```

**Enhanced**:
```json
"type": {
  "type": "string",
  "description": "The Soroban type",
  "enum": [
    "address",
    "i128",
    "i64",
    "u32",
    "u64",
    "u128",
    "symbol",
    "bool",
    "bytes",
    "string"
  ]
}
```

**Why**: Restricts to valid Soroban types and provides clear error messages when invalid types are used.

### 5. Additional Properties Control

**Current**: Allows any extra fields

**Enhanced**: Add to root entry definition:
```json
{
  "type": "object",
  "required": ["contract_id", "topics", "event_structure", "english_template"],
  "additionalProperties": false,
  "properties": { ... }
}
```

**Why**: Catches typos in field names (e.g., `contract_ID` instead of `contract_id`).

### 6. Template String Validation

**Current**:
```json
"english_template": {
  "type": "string",
  "description": "Human-readable template"
}
```

**Enhanced**:
```json
"english_template": {
  "type": "string",
  "description": "Human-readable template describing the event, using {field} placeholders",
  "minLength": 1
}
```

**Why**: Ensures templates are not empty strings.

### 7. Test Vectors Schema

**Current**: Not in schema

**Enhanced**: Add complete test_vectors definition:
```json
"test_vectors": {
  "type": "array",
  "description": "Sample payloads used by CI to render preview translations in PRs",
  "items": {
    "type": "object",
    "required": ["params"],
    "additionalProperties": false,
    "properties": {
      "hex_payload": {
        "type": "string",
        "description": "Optional raw hex event payload for display purposes",
        "pattern": "^[0-9a-fA-F]*$"
      },
      "params": {
        "type": "object",
        "description": "Resolved template parameter values",
        "additionalProperties": {
          "type": ["string", "number", "boolean"]
        }
      }
    }
  }
}
```

**Why**: Validates optional test vectors and ensures hex_payload is valid hexadecimal.

### 8. Schema Root Structure

**Current**: Schema validates single entry

**Enhanced**: Schema validates array of entries:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Open-Audit Translation Registry",
  "description": "Schema for the Open-Audit translation registry mapping",
  "type": "array",
  "minItems": 1,
  "items": {
    "$ref": "#/$defs/registryEntry"
  },
  "$defs": {
    "registryEntry": {
      // Entry definition here
    }
  }
}
```

**Why**: Matches the actual structure of `registry.json` which is an array.

## Complete Enhanced Schema

Due to file restrictions, here's the complete enhanced schema that should replace `lib/translator/registry.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://github.com/grant-fox/Open-Audit/lib/translator/registry.schema.json",
  "title": "Open-Audit Translation Registry",
  "description": "Schema for the Open-Audit translation registry mapping. Validates an array of registry entries submitted via community PRs with strict structural rules.",
  "type": "array",
  "minItems": 1,
  "items": {
    "$ref": "#/$defs/registryEntry"
  },
  "$defs": {
    "registryEntry": {
      "type": "object",
      "required": ["contract_id", "topics", "event_structure", "english_template"],
      "additionalProperties": false,
      "properties": {
        "contract_id": {
          "type": "string",
          "description": "The Soroban contract address this entry applies to",
          "minLength": 56,
          "maxLength": 56,
          "pattern": "^[A-Z0-9]{56}$"
        },
        "topics": {
          "type": "array",
          "description": "Ordered list of event topic names (the first is the event discriminant)",
          "minItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1,
            "pattern": "^[a-z_][a-z0-9_]*$"
          }
        },
        "event_structure": {
          "type": "object",
          "description": "Describes how the raw event's topics and data map to named, typed fields",
          "required": ["topics"],
          "additionalProperties": false,
          "properties": {
            "topics": {
              "type": "array",
              "description": "Fields extracted from event topics[1..] (topic[0] is the event name)",
              "items": {
                "type": "object",
                "required": ["name", "type"],
                "additionalProperties": false,
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "The field name used in the english_template",
                    "minLength": 1,
                    "pattern": "^[a-z_][a-z0-9_]*$"
                  },
                  "type": {
                    "type": "string",
                    "description": "The Soroban type",
                    "enum": [
                      "address",
                      "i128",
                      "i64",
                      "u32",
                      "u64",
                      "u128",
                      "symbol",
                      "bool",
                      "bytes",
                      "string"
                    ]
                  }
                }
              }
            },
            "data": {
              "type": "object",
              "description": "The field extracted from the event data payload (if any)",
              "required": ["name", "type"],
              "additionalProperties": false,
              "properties": {
                "name": {
                  "type": "string",
                  "description": "The field name used in the english_template",
                  "minLength": 1,
                  "pattern": "^[a-z_][a-z0-9_]*$"
                },
                "type": {
                  "type": "string",
                  "description": "The Soroban type",
                  "enum": [
                    "address",
                    "i128",
                    "i64",
                    "u32",
                    "u64",
                    "u128",
                    "symbol",
                    "bool",
                    "bytes",
                    "string"
                  ]
                }
              }
            }
          }
        },
        "english_template": {
          "type": "string",
          "description": "Human-readable template describing the event, using {field} placeholders",
          "minLength": 1
        },
        "test_vectors": {
          "type": "array",
          "description": "Sample payloads used by CI to render preview translations in PRs",
          "items": {
            "type": "object",
            "required": ["params"],
            "additionalProperties": false,
            "properties": {
              "hex_payload": {
                "type": "string",
                "description": "Optional raw hex event payload for display purposes",
                "pattern": "^[0-9a-fA-F]*$"
              },
              "params": {
                "type": "object",
                "description": "Resolved template parameter values, e.g. { from: 'GABC...', amount: 50000000 }",
                "additionalProperties": {
                  "type": ["string", "number", "boolean"]
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Applying the Enhanced Schema

### Manual Update

Copy the complete enhanced schema above and replace the contents of:
```
lib/translator/registry.schema.json
```

### Verification

After updating, test with:
```bash
npm run validate:registry
```

## Error Message Examples

### Before Enhancement

```
Schema validation failed: must have required property
```

### After Enhancement

```
Schema validation failed at /3/contract_id: must match pattern "^[A-Z0-9]{56}$"
Schema validation failed at /5/event_structure/topics/0/type: must be equal to one of the allowed values
Schema validation failed at /7/topics: must NOT have duplicate items
```

## Impact on Existing Registry

The enhanced schema is **backward compatible** with properly formatted existing entries. However, it may catch previously undetected errors:

1. Lowercase characters in contract addresses
2. Duplicate topics in arrays
3. Typos in type names (e.g., "address" vs "Address")
4. Empty strings
5. Extra undocumented fields

## Testing Enhanced Schema

Test the enhanced schema against the bad example file:

```bash
# Copy enhanced schema
cp SCHEMA_ENHANCEMENTS.md registry.schema.enhanced.json

# Test against bad examples
npm run lint:registry
```

Expected: Should catch all 10+ errors in `registry.bad-example.json`.

## Migration Guide

If the enhanced schema reveals issues in existing registry entries:

1. **Contract ID format errors**: Ensure all IDs are exactly 56 uppercase alphanumeric characters
2. **Topic naming**: Convert any camelCase topics to snake_case
3. **Type mismatches**: Fix any typos in type names to match the enum
4. **Duplicates**: Remove duplicate topics from arrays
5. **Extra fields**: Remove or document any non-standard fields

## Benefits Summary

| Enhancement | Benefit |
|------------|---------|
| Pattern validation | Catches malformed contract addresses immediately |
| Naming conventions | Ensures consistency across all entries |
| Type enums | Prevents typos and provides autocomplete in IDEs |
| uniqueItems | Detects accidental duplicates |
| additionalProperties: false | Catches field name typos |
| minLength checks | Prevents empty strings |
| Test vector schema | Validates optional testing data |

## IDE Integration

Many IDEs support JSON Schema for autocomplete and validation:

### VSCode

Add to `.vscode/settings.json`:
```json
{
  "json.schemas": [
    {
      "fileMatch": ["lib/translator/registry.json"],
      "url": "./lib/translator/registry.schema.json"
    }
  ]
}
```

### Benefits:
- Real-time validation as you type
- Autocomplete for field names
- Inline error messages
- Hover documentation

---

**Note**: This document serves as the specification for schema enhancements. The actual schema file should be updated manually by copying the "Complete Enhanced Schema" section above into `lib/translator/registry.schema.json`.
