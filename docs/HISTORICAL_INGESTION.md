# Historical Ledger Range Ingestion

This document describes how to use the Historical Ledger Range Ingestion tool to backfill contract events from a specific historical range.

## Overview

The Historical Ledger Range Ingestion tool allows you to fetch and backfill contract events from a specified ledger range. This is useful when you want to:

- Retrieve past events for a contract before monitoring began
- Build a complete audit trail for a contract
- Analyze historical activity

## How It Works

The tool works by:

1. **Accepting parameters**: contract ID, start ledger sequence, and end ledger sequence
2. **Chunking requests**: Dividing the range into configurable chunks to avoid RPC node memory/timeout limits
3. **Fetching events**: Making multiple RPC requests, one per chunk
4. **Handling retries**: Implementing exponential backoff for rate limit (429) errors
5. **Processing results**: Collecting and processing all events

## Usage

### Via CLI

Use the `ingest-historical.ts` script to backfill events from the command line:

```bash
# Basic usage
npx ts-node scripts/ingest-historical.ts CABC123... 1000 5000

# With custom chunk size
npx ts-node scripts/ingest-historical.ts CABC123... 1000 5000 --chunk-size 500

# With network selection
npx ts-node scripts/ingest-historical.ts CABC123... 1000 5000 --network mainnet

# Save results to file
npx ts-node scripts/ingest-historical.ts CABC123... 1000 5000 --output events.json
```

**Arguments:**
- `contractId`: The Soroban contract ID to fetch events for
- `startSequence`: The starting ledger sequence number (inclusive)
- `endSequence`: The ending ledger sequence number (inclusive)

**Options:**
- `--chunk-size N`: Number of ledgers per chunk (default: 1000)
- `--network`: Network to use: `testnet` or `mainnet` (default: testnet)
- `--output FILE`: Optional file path to save fetched events as JSON

### Via API

POST to `/api/ingest-historical` with the following JSON body:

```json
{
  "contractId": "CABC123...",
  "startSequence": 1000,
  "endSequence": 5000,
  "chunkSize": 1000
}
```

**Response:**

```json
{
  "success": true,
  "contractId": "CABC123...",
  "range": {
    "start": 1000,
    "end": 5000
  },
  "results": {
    "totalEvents": 125,
    "totalChunks": 5,
    "events": [
      {
        "id": "event-1",
        "type": "contract",
        "ledger": 1000,
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ]
  }
}
```

### Via Code

Import and use the `ingestHistoricalRange` function in your TypeScript code:

```typescript
import { ingestHistoricalRange } from "@/lib/stellar/historical-ingester";
import { TESTNET_CONFIG } from "@/lib/stellar/client";

await ingestHistoricalRange({
  networkConfig: TESTNET_CONFIG,
  contractId: "CABC123...",
  startSequence: 1000,
  endSequence: 5000,
  chunkSize: 1000,
  onChunkComplete: async (result) => {
    console.log(`Fetched ${result.eventCount} events for chunk ${result.chunkIndex}`);
    // Save to database, etc.
  },
  onComplete: async (totalEvents, totalChunks) => {
    console.log(`Completed: ${totalEvents} events in ${totalChunks} chunks`);
  },
  onError: (error, chunkIndex) => {
    console.error(`Error in chunk ${chunkIndex}: ${error.message}`);
  },
});
```

## Configuration

### Chunk Size

The chunk size determines how many ledgers are fetched per RPC request. Factors to consider:

- **Larger chunks** (e.g., 5000): Faster but may hit RPC node memory limits
- **Smaller chunks** (e.g., 500): Slower but more reliable
- **Default**: 1000 ledgers per chunk

Adjust based on your RPC node's capacity and your network conditions.

### Network Selection

By default, the tool uses the Testnet configuration from your environment variables. You can override this:

- Use `--network mainnet` in CLI to use Mainnet
- Set `networkConfig` parameter when calling the function directly

### Retry Configuration

The tool uses exponential backoff for rate limit errors (HTTP 429):

- Initial delay: 1 second
- Max delay: 32 seconds
- Max retries: 10
- Backoff multiplier: 2x

These can be customized by passing `retryConfig` to `ingestHistoricalRange()`.

## Error Handling

The tool handles various error scenarios:

- **Parameter validation**: Throws an error if required parameters are invalid
- **Rate limiting**: Automatically retries with exponential backoff
- **Network errors**: Throws after max retries exhausted

If an error occurs during ingestion, the process stops and the error is propagated.

## Examples

### Example 1: Backfill 10,000 ledgers

```bash
npx ts-node scripts/ingest-historical.ts CABC123... 10000 20000 --chunk-size 2000 --output backfill.json
```

This fetches events from ledgers 10,000 to 20,000 in 5 chunks of 2,000 ledgers each.

### Example 2: API request

```bash
curl -X POST http://localhost:3000/api/ingest-historical \
  -H "Content-Type: application/json" \
  -d '{
    "contractId": "CABC123...",
    "startSequence": 1000,
    "endSequence": 5000
  }'
```

## Performance Considerations

- Each chunk requires one RPC request
- Total time depends on: ledger range size, chunk size, RPC node capacity, network latency
- For large ranges (100,000+ ledgers), consider running multiple ingestions sequentially with different contracts
- Monitor your RPC node's rate limits and adjust chunk size accordingly

## Troubleshooting

### "429 Too Many Requests"

Your RPC node is rate limiting. Solutions:

1. Reduce `--chunk-size` to smaller values (e.g., 500)
2. Increase timeout between chunks (modify `retryConfig`)
3. Use a different RPC node with higher rate limits

### "Timeout"

RPC request took too long. Solutions:

1. Reduce `--chunk-size` to smaller values
2. Try a different time of day when RPC is less busy
3. Use a faster RPC node

### Empty results

Verify:

1. Contract ID is correct
2. Ledger range contains actual events for this contract
3. Network configuration is correct (testnet vs mainnet)
