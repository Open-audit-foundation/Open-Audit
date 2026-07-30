# Open-Audit Quick Reference

## 🚀 Quick Start

```bash
# Option 1: Docker Compose (Easiest)
npm run docker:up

# Option 2: PM2
npm run start:pm2

# Option 3: Manual
redis-server              # Terminal 1
npm run dev:decoupled     # Terminal 2
npm run worker:indexer    # Terminal 3
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
npm run test:status              # Linux/macOS
npm run test:status:win          # Windows

# Test WebSocket connection
npm run test:websocket

# Run all tests
npm test

# Test specific components
npm run test:security            # Security tests
npm run test:resilience          # Resilience tests
npm run test:wasm                # WASM sandbox tests

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

## 🔧 Service Management

### Docker Compose

```bash
# Start all services
npm run docker:up

# Stop all services
npm run docker:down

# View logs
npm run docker:logs

# Rebuild images
npm run docker:build
```

### PM2

```bash
# Start services
npm run start:pm2

# Stop services
npm run stop:pm2

# Restart services
npm run restart:pm2

# View logs
npm run logs:pm2

# Monitor processes
npm run monit:pm2

# Check status
pm2 status
```

### Manual

```bash
# Redis
redis-server                     # Start
redis-cli ping                   # Test
redis-cli shutdown               # Stop

# Web Server
npm run dev:decoupled            # Start
# Ctrl+C to stop

# Indexer Worker
npm run worker:indexer           # Start
# Ctrl+C to stop
```

## 🐛 Troubleshooting

### Worker Shows "Down"

```bash
# Check worker logs
pm2 logs indexer-worker

# Check Redis heartbeat
redis-cli HGETALL open-audit:worker:heartbeat

# Restart worker
pm2 restart indexer-worker
```

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
# Check worker logs
pm2 logs indexer-worker

# Check Redis connection
redis-cli CLIENT LIST | grep worker

# Check WebSocket connection
npm run test:websocket
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

### Required for Microservices

```env
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

### Optional Configuration

```env
# Health check interval
HEALTH_CHECK_INTERVAL_MS=30000

# Worker ID
WORKER_ID=worker-1

# Port
PORT=3000

# Database (optional)
DATABASE_URL=postgresql://user:pass@localhost:5432/openaudit
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

### Monitor Worker

```bash
# Check if worker is running
pm2 status | grep worker

# View worker logs
pm2 logs indexer-worker

# Check heartbeat
redis-cli HGET open-audit:worker:heartbeat lastSeen

# Check heartbeat age
curl http://localhost:3000/api/status | jq '.components.worker'
```

### View Logs

```bash
# PM2
pm2 logs                         # All processes
pm2 logs web-server             # Web server only
pm2 logs indexer-worker         # Worker only

# Docker
docker logs open-audit-web      # Web server
docker logs open-audit-worker   # Worker
docker logs open-audit-redis    # Redis
```

### Restart Services

```bash
# PM2
pm2 restart all                 # All services
pm2 restart web-server          # Web server only
pm2 restart indexer-worker      # Worker only

# Docker
docker restart open-audit-web
docker restart open-audit-worker
```

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| `README.md` | Project overview |
| `STATUS_MONITORING_GUIDE.md` | Complete monitoring guide (3,500+ lines) |
| `DEPLOYMENT_CHECKLIST.md` | Deployment guide |
| `QUICKSTART_MICROSERVICES.md` | 5-minute setup |
| `ARCHITECTURE.md` | System architecture |
| `FINAL_IMPLEMENTATION_SUMMARY.md` | Implementation summary |

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
2. **Monitor logs in real-time** - `pm2 logs` or `docker logs -f`
3. **Check Redis directly** - `redis-cli MONITOR` to see all commands
4. **Use the test scripts** - `npm run test:status` for automated checks
5. **Open status dashboard in separate tab** - Monitor at a glance
6. **Set up alerts** - Configure Prometheus/Grafana for production

## 🆘 Getting Help

1. **Check logs first** - Most issues are logged
2. **Use troubleshooting guide** - See `STATUS_MONITORING_GUIDE.md`
3. **Check Redis** - Many issues are Redis-related
4. **Restart services** - Often fixes transient issues
5. **Check environment variables** - Ensure all required vars are set

## 📦 NPM Scripts

```bash
# Development
npm run dev                      # Standard Next.js dev
npm run dev:ws                   # Legacy monolithic server
npm run dev:decoupled            # Microservices web server
npm run worker:indexer           # Indexer worker

# Testing
npm test                         # Run all tests
npm run test:status              # Test status API (Linux/macOS)
npm run test:status:win          # Test status API (Windows)
npm run test:websocket           # Test WebSocket
npm run test:security            # Security tests
npm run test:resilience          # Resilience tests
npm run test:wasm                # WASM tests

# Production (Docker)
npm run docker:build             # Build images
npm run docker:up                # Start services
npm run docker:down              # Stop services
npm run docker:logs              # View logs

# Production (PM2)
npm run start:pm2                # Start services
npm run stop:pm2                 # Stop services
npm run restart:pm2              # Restart services
npm run logs:pm2                 # View logs
npm run monit:pm2                # Monitor processes

# Linting
npm run lint                     # Run ESLint
npm run lint:registry            # Validate registry
npm run format                   # Format code
```

---

**Keep this reference handy for quick lookups!**

_Last updated: June 29, 2026_
