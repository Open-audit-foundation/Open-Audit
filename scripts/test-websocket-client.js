#!/usr/bin/env node
/**
 * WebSocket Test Client for Open-Audit Event Stream
 * 
 * This script connects to the WebSocket server and logs all received events.
 * Useful for testing the microservices architecture event flow.
 * 
 * Usage:
 *   node scripts/test-websocket-client.js
 *   node scripts/test-websocket-client.js ws://localhost:3000/ws/events
 * 
 * Features:
 * - Auto-reconnect on disconnection
 * - Message statistics
 * - Pretty-printed event data
 * - Graceful shutdown (Ctrl+C)
 */

const WebSocket = require('ws');

// Configuration
const WS_URL = process.argv[2] || 'ws://localhost:3000/ws/events';
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

// Statistics
let stats = {
  totalMessages: 0,
  connectedMessages: 0,
  eventMessages: 0,
  errors: 0,
  reconnectAttempts: 0,
  connectedAt: null,
  lastMessageAt: null,
};

let ws = null;
let isShuttingDown = false;
let reconnectTimer = null;

// ============================================================================
// Color Output Helpers
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

// ============================================================================
// WebSocket Connection
// ============================================================================

function connect() {
  if (isShuttingDown) return;

  console.log(colorize(`\n🔌 Connecting to ${WS_URL}...`, 'cyan'));

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    stats.connectedAt = new Date();
    stats.reconnectAttempts = 0;
    console.log(colorize('✅ Connected to WebSocket server', 'green'));
    console.log(colorize(`⏰ Connected at: ${stats.connectedAt.toISOString()}`, 'dim'));
  });

  ws.on('message', (data) => {
    stats.totalMessages++;
    stats.lastMessageAt = new Date();

    try {
      const message = JSON.parse(data.toString());
      handleMessage(message);
    } catch (error) {
      console.error(colorize('⚠️  Failed to parse message:', 'red'), error.message);
      console.log(colorize('Raw data:', 'dim'), data.toString().substring(0, 200));
      stats.errors++;
    }
  });

  ws.on('close', (code, reason) => {
    console.log(colorize(`\n❌ Disconnected from WebSocket server`, 'red'));
    console.log(colorize(`   Code: ${code}`, 'dim'));
    console.log(colorize(`   Reason: ${reason || 'No reason provided'}`, 'dim'));
    
    if (!isShuttingDown) {
      attemptReconnect();
    }
  });

  ws.on('error', (error) => {
    console.error(colorize('⚠️  WebSocket error:', 'red'), error.message);
    stats.errors++;
  });
}

// ============================================================================
// Message Handling
// ============================================================================

function handleMessage(message) {
  switch (message.type) {
    case 'connected':
      stats.connectedMessages++;
      console.log(colorize('\n📨 Received: Connected confirmation', 'green'));
      console.log(colorize(`   Message: ${message.message}`, 'dim'));
      console.log(colorize(`   Timestamp: ${new Date(message.timestamp).toISOString()}`, 'dim'));
      break;

    case 'event':
      stats.eventMessages++;
      console.log(colorize(`\n📊 Event #${stats.eventMessages}`, 'magenta'));
      
      if (message.workerId) {
        console.log(colorize(`   Worker: ${message.workerId}`, 'dim'));
      }
      
      if (message.timestamp) {
        const eventTime = new Date(message.timestamp);
        const delay = Date.now() - eventTime.getTime();
        console.log(colorize(`   Timestamp: ${eventTime.toISOString()} (${delay}ms ago)`, 'dim'));
      }

      if (message.raw) {
        console.log(colorize('   Raw Event:', 'yellow'));
        console.log(colorize(`     ID: ${message.raw.id}`, 'dim'));
        console.log(colorize(`     Contract: ${message.raw.contractId}`, 'dim'));
        console.log(colorize(`     Ledger: ${message.raw.ledger}`, 'dim'));
      }

      if (message.data) {
        console.log(colorize('   Translated:', 'cyan'));
        console.log(colorize(`     ${message.data.english_string || JSON.stringify(message.data)}`, 'bright'));
      }
      break;

    default:
      console.log(colorize(`\n📨 Unknown message type: ${message.type}`, 'yellow'));
      console.log(colorize(JSON.stringify(message, null, 2).substring(0, 500), 'dim'));
  }
}

// ============================================================================
// Auto-Reconnect
// ============================================================================

function attemptReconnect() {
  if (isShuttingDown) return;

  stats.reconnectAttempts++;

  if (stats.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.error(colorize(`\n❌ Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`, 'red'));
    process.exit(1);
  }

  console.log(
    colorize(
      `\n🔄 Reconnecting in ${RECONNECT_DELAY_MS / 1000}s (attempt ${stats.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
      'yellow'
    )
  );

  reconnectTimer = setTimeout(() => {
    connect();
  }, RECONNECT_DELAY_MS);
}

// ============================================================================
// Statistics Display
// ============================================================================

function displayStats() {
  console.log(colorize('\n' + '='.repeat(60), 'dim'));
  console.log(colorize('📊 Session Statistics', 'bright'));
  console.log(colorize('='.repeat(60), 'dim'));
  console.log(colorize(`Total messages:     ${stats.totalMessages}`, 'dim'));
  console.log(colorize(`  - Connected msgs: ${stats.connectedMessages}`, 'dim'));
  console.log(colorize(`  - Event messages: ${stats.eventMessages}`, 'dim'));
  console.log(colorize(`Errors:             ${stats.errors}`, stats.errors > 0 ? 'red' : 'dim'));
  console.log(colorize(`Reconnect attempts: ${stats.reconnectAttempts}`, 'dim'));
  
  if (stats.connectedAt) {
    const uptime = Math.floor((Date.now() - stats.connectedAt.getTime()) / 1000);
    console.log(colorize(`Connected at:       ${stats.connectedAt.toISOString()}`, 'dim'));
    console.log(colorize(`Uptime:             ${uptime}s`, 'dim'));
  }

  if (stats.lastMessageAt) {
    const timeSinceLastMessage = Math.floor((Date.now() - stats.lastMessageAt.getTime()) / 1000);
    console.log(colorize(`Last message:       ${stats.lastMessageAt.toISOString()} (${timeSinceLastMessage}s ago)`, 'dim'));
  }

  if (stats.eventMessages > 0 && stats.connectedAt) {
    const uptime = Math.floor((Date.now() - stats.connectedAt.getTime()) / 1000);
    const rate = (stats.eventMessages / uptime).toFixed(2);
    console.log(colorize(`Event rate:         ${rate} events/sec`, 'dim'));
  }

  console.log(colorize('='.repeat(60) + '\n', 'dim'));
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(colorize(`\n\n🛑 Received ${signal}, shutting down...`, 'yellow'));
  
  // Clear reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Display final statistics
  displayStats();

  // Close WebSocket connection
  if (ws) {
    console.log(colorize('🔌 Closing WebSocket connection...', 'dim'));
    ws.close(1000, 'Client shutdown');
  }

  console.log(colorize('✅ Shutdown complete\n', 'green'));
  process.exit(0);
}

// Handle Ctrl+C and kill signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============================================================================
// Periodic Stats Display
// ============================================================================

// Display stats every 30 seconds
setInterval(() => {
  if (!isShuttingDown && stats.totalMessages > 0) {
    displayStats();
  }
}, 30000);

// ============================================================================
// Main Entry Point
// ============================================================================

console.log(colorize('\n' + '='.repeat(60), 'bright'));
console.log(colorize('🧪 Open-Audit WebSocket Test Client', 'bright'));
console.log(colorize('='.repeat(60), 'bright'));
console.log(colorize(`WebSocket URL: ${WS_URL}`, 'dim'));
console.log(colorize(`Press Ctrl+C to exit and view statistics\n`, 'dim'));

// Start connection
connect();
