#!/bin/bash

# Test script for open-audit-cli
# Runs example test cases to verify CLI functionality

set -e

echo "================================================"
echo "Testing open-audit-cli"
echo "================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0

# Function to run test
run_test() {
    local name="$1"
    local command="$2"
    local expected_exit="$3"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    echo "Test $TESTS_RUN: $name"
    echo "Command: $command"
    
    if eval "$command" > /tmp/cli-test-output.txt 2>&1; then
        actual_exit=0
    else
        actual_exit=$?
    fi
    
    if [ "$actual_exit" -eq "$expected_exit" ]; then
        echo -e "${GREEN}✅ PASSED${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        cat /tmp/cli-test-output.txt
    else
        echo -e "${RED}❌ FAILED${NC}"
        echo "Expected exit code: $expected_exit"
        echo "Actual exit code: $actual_exit"
        cat /tmp/cli-test-output.txt
        exit 1
    fi
    
    echo ""
}

# Build CLI first
echo "Building CLI..."
npm run build:cli
echo ""

# Test 1: Help command
run_test "Help command" \
    "node dist/cli/open-audit-cli.js --help" \
    0

# Test 2: Version command
run_test "Version command" \
    "node dist/cli/open-audit-cli.js --version" \
    0

# Test 3: Valid transfer event (JSON spec)
run_test "Valid transfer event (JSON)" \
    "node dist/cli/open-audit-cli.js test --hex 0x0000000000000000000000000000000000000000000000000000000074726e7312345678 --spec cli/examples/token-transfer.json" \
    0

# Test 4: Valid transfer event (YAML spec)
run_test "Valid transfer event (YAML)" \
    "node dist/cli/open-audit-cli.js test --hex 0x74726e7312345678 --spec cli/examples/token-transfer.yaml" \
    0

# Test 5: Verbose mode
run_test "Verbose mode" \
    "node dist/cli/open-audit-cli.js test --hex 0x74726e73 --spec cli/examples/token-transfer.json --verbose" \
    0

# Test 6: Missing required option (should fail)
run_test "Missing --hex option (should fail)" \
    "node dist/cli/open-audit-cli.js test --spec cli/examples/token-transfer.json" \
    1

# Test 7: Missing required option (should fail)
run_test "Missing --spec option (should fail)" \
    "node dist/cli/open-audit-cli.js test --hex 0x1234" \
    1

# Test 8: Invalid hex (should fail)
run_test "Invalid hex data (should fail)" \
    "node dist/cli/open-audit-cli.js test --hex INVALID --spec cli/examples/token-transfer.json" \
    1

# Test 9: Non-existent spec file (should fail)
run_test "Non-existent spec file (should fail)" \
    "node dist/cli/open-audit-cli.js test --hex 0x1234 --spec /nonexistent/file.json" \
    1

# Summary
echo "================================================"
echo "Test Summary"
echo "================================================"
echo "Tests run: $TESTS_RUN"
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo "Tests failed: $((TESTS_RUN - TESTS_PASSED))"

if [ "$TESTS_PASSED" -eq "$TESTS_RUN" ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
