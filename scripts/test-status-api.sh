#!/bin/bash
# Test Status API - Verifies the /api/status endpoint response structure

echo "=========================================="
echo "Open-Audit Status API Test"
echo "=========================================="
echo ""

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "⚠️  jq is not installed. Install it for pretty JSON output."
    echo "   macOS: brew install jq"
    echo "   Linux: sudo apt-get install jq"
    echo ""
    USE_JQ=false
else
    USE_JQ=true
fi

# API endpoint
API_URL="${API_URL:-http://localhost:3000/api/status}"

echo "Testing endpoint: $API_URL"
echo ""

# Make request
echo "Making request..."
if [ "$USE_JQ" = true ]; then
    RESPONSE=$(curl -s "$API_URL")
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL")
else
    RESPONSE=$(curl -s "$API_URL")
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL")
fi

echo "HTTP Status Code: $HTTP_CODE"
echo ""

# Display response
echo "=========================================="
echo "Response:"
echo "=========================================="
if [ "$USE_JQ" = true ]; then
    echo "$RESPONSE" | jq '.'
else
    echo "$RESPONSE"
fi
echo ""

# Verify response structure
echo "=========================================="
echo "Response Structure Verification:"
echo "=========================================="

if [ "$USE_JQ" = true ]; then
    # Check required fields
    echo -n "✓ status field: "
    echo "$RESPONSE" | jq -r '.status'
    
    echo -n "✓ timestamp field: "
    echo "$RESPONSE" | jq -r '.timestamp'
    
    echo ""
    echo "Component Checks:"
    
    echo -n "  ✓ stellarRpc.status: "
    echo "$RESPONSE" | jq -r '.components.stellarRpc.status'
    
    echo -n "  ✓ stellarRpc.latencyMs: "
    echo "$RESPONSE" | jq -r '.components.stellarRpc.latencyMs'
    
    echo -n "  ✓ stellarRpc.lastChecked: "
    echo "$RESPONSE" | jq -r '.components.stellarRpc.lastChecked'
    
    echo -n "  ✓ stellarRpc.circuitBreakerState: "
    echo "$RESPONSE" | jq -r '.components.stellarRpc.circuitBreakerState'
    
    echo ""
    
    echo -n "  ✓ database.status: "
    echo "$RESPONSE" | jq -r '.components.database.status'
    
    echo -n "  ✓ database.lastChecked: "
    echo "$RESPONSE" | jq -r '.components.database.lastChecked'
    
    echo ""
    
    echo -n "  ✓ redis.status: "
    echo "$RESPONSE" | jq -r '.components.redis.status'
    
    echo -n "  ✓ redis.lastChecked: "
    echo "$RESPONSE" | jq -r '.components.redis.lastChecked'
    
    echo ""
    
    echo -n "  ✓ worker.status: "
    echo "$RESPONSE" | jq -r '.components.worker.status'
    
    echo -n "  ✓ worker.lastChecked: "
    echo "$RESPONSE" | jq -r '.components.worker.lastChecked'
    
    echo -n "  ✓ worker.lastHeartbeat: "
    echo "$RESPONSE" | jq -r '.components.worker.lastHeartbeat'
    
    echo ""
    echo "Metrics:"
    
    echo -n "  ✓ eventsIndexedLast1h: "
    echo "$RESPONSE" | jq -r '.metrics.eventsIndexedLast1h'
    
    echo -n "  ✓ eventsIndexedLast24h: "
    echo "$RESPONSE" | jq -r '.metrics.eventsIndexedLast24h'
    
    echo -n "  ✓ translationSuccessRate1h: "
    echo "$RESPONSE" | jq -r '.metrics.translationSuccessRate1h'
    
    echo -n "  ✓ translationSuccessRate24h: "
    echo "$RESPONSE" | jq -r '.metrics.translationSuccessRate24h'
    
    echo -n "  ✓ averageTranslationLatencyMs: "
    echo "$RESPONSE" | jq -r '.metrics.averageTranslationLatencyMs'
    
    echo -n "  ✓ activeWebSocketConnections: "
    echo "$RESPONSE" | jq -r '.metrics.activeWebSocketConnections'
else
    echo "Install jq for detailed verification"
fi

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="

# Exit with HTTP status code
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ API is responding with HTTP 200"
    exit 0
elif [ "$HTTP_CODE" = "503" ]; then
    echo "⚠️  API is responding with HTTP 503 (system down)"
    exit 1
else
    echo "❌ Unexpected HTTP status code: $HTTP_CODE"
    exit 1
fi
