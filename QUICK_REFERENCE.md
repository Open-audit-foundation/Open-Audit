# Open-Audit Quick Reference

## 🚀 Quick Start

```bash
redis-server              # Terminal 1
npm run dev:ws            # Terminal 2 (WebSocket-enabled server)
```

## 📡 Key Endpoints

| Endpoint | Purpose | Response Time |
|----------|---------|---------------|
| `/` | Landing page | < 1s |
| `/dashboard` | Main dashboard | < 1s |
| `/status` | Status monitoring dashboard | < 1s |
| `/api/status` | Health check API | < 500ms |
| `/api/health` | Basic health check | < 100ms |

## 🧪 Testing Commands

```bash
# Test health check API
bash scripts/test-status-api.sh        # Linux/macOS
scripts\test-status-api.bat            # Windows

# Test WebSocket connection
node scripts/test-websocket-client.js

# Run all tests
npm test

# Test specific components
npm run test:security            # Security tests
npm run test:resilience          # Resilience tests

# Lint registry
npm run lint:registry
```

## 🔍 Status Check Commands

```bash
# Quick health check
curl http://localhost:3000/api/status | jq '.status'

# Check all components
curl http://localhost:3000/api/status | jq '.components'

# Check specific component
curl http://localhost:3000/api/status | jq '.components.stellarRpc'
curl http://localhost:3000/api/status | jq '.components.database'
curl http://localhost:3000/api/status | jq '.components.redis'
curl http://localhost:3000/api/status | jq '.components.worker'

# Check circuit breaker state
curl http://localhost:3000/api/status | jq '.components.stellarRpc.circuitBreakerState'

# Check worker heartbeat
curl http://localhost:3000/api/status | jq '.components.worker.lastHeartbeat'
redis-cli HGETALL open-audit:worker:heartbeat

# Check metrics
curl http://localhost:3000/api/status | jq '.metrics'
```

## 🐛 Troubleshooting

### Redis Shows "Down"

```bash
# Check if Redis is running
redis-cli ping

# Start Redis
redis-server                     # macOS/Linux
brew services start redis        # macOS with Homebrew
sudo systemctl start redis       # Linux with systemd
```

### Stellar RPC Shows "Degraded"

```bash
# Check circuit breaker state
curl http://localhost:3000/api/status | jq '.components.stellarRpc.circuitBreakerState'

# Check RPC endpoint
curl https://soroban-testnet.stellar.org/health
```

### No Events Appearing

```bash
# Check Redis connection
redis-cli CLIENT LIST

# Check WebSocket connection
node scripts/test-websocket-client.js
```

## 📊 Component Status Values

| Status | Meaning | Color |
|--------|---------|-------|
| `healthy` | Fully operational | 🟢 Green |
| `degraded` | Operational with issues | 🟡 Yellow |
| `down` | Not operational | 🔴 Red |
| `not-configured` | Optional, not configured | ⚪ Gray |

## 📈 Performance Targets

| Metric | Target | Typical |
|--------|--------|---------|
| Health Check API | < 500ms | 150-300ms |
| Status Dashboard Load | < 1s | 400-800ms |
| Worker Heartbeat | Every 30s | Every 30s |
| WebSocket Latency | < 100ms | 50-80ms |

## 🔑 Environment Variables

See `.env.example` for the full list. The most commonly needed ones:

```env
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
DATABASE_URL=postgresql://user:pass@localhost:5432/openaudit
PORT=3000
```

## 📝 Common Tasks

### Check System Health

```bash
# Web UI
open http://localhost:3000/status

# API
curl http://localhost:3000/api/status | jq

# Quick check
curl http://localhost:3000/api/status | jq '.status'
```

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| `README.md` | Project overview |
| `DEPLOYMENT_CHECKLIST.md` | Deployment guide |
| `ARCHITECTURE.md` | System architecture |

## 🔗 Useful Links

```bash
# Local
http://localhost:3000              # Landing page
http://localhost:3000/dashboard    # Main dashboard
http://localhost:3000/status       # Status dashboard
http://localhost:3000/api/status   # Health API
ws://localhost:3000/ws/events      # WebSocket

# Redis
redis://localhost:6379             # Redis connection
```

## 🎯 Quick Checks

```bash
# Is everything healthy?
curl -s http://localhost:3000/api/status | jq '.status'

# What components are up?
curl -s http://localhost:3000/api/status | jq '.components | to_entries[] | select(.value.status == "healthy") | .key'

# What's the worker status?
curl -s http://localhost:3000/api/status | jq '.components.worker.status'

# When was the last heartbeat?
curl -s http://localhost:3000/api/status | jq '.components.worker.lastHeartbeat'

# What's the circuit breaker state?
curl -s http://localhost:3000/api/status | jq '.components.stellarRpc.circuitBreakerState'

# How many events in the last hour?
curl -s http://localhost:3000/api/status | jq '.metrics.eventsIndexedLast1h'
```

## 💡 Pro Tips

1. **Use `jq` for JSON parsing** - Makes API responses readable
2. **Check Redis directly** - `redis-cli MONITOR` to see all commands
3. **Open status dashboard in separate tab** - Monitor at a glance
4. **Set up alerts** - Configure Prometheus/Grafana for production

## 🆘 Getting Help

1. **Check logs first** - Most issues are logged
2. **Check Redis** - Many issues are Redis-related
3. **Check environment variables** - Ensure all required vars are set

## 📦 NPM Scripts

```bash
# Development
npm run dev                      # Standard Next.js dev
npm run dev:ws                   # WebSocket-enabled server

# Testing
npm test                         # Run all tests
npm run test:security            # Security tests
npm run test:resilience          # Resilience tests

# Linting
npm run lint                     # Run ESLint
npm run lint:registry            # Validate registry
npm run format                   # Format code
```

---

**Keep this reference handy for quick lookups!**
