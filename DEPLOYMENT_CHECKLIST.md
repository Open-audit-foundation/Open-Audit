# Open-Audit Deployment Checklist

Complete checklist for deploying Open-Audit with all features enabled.

## Pre-Deployment

### Environment Setup

- [ ] Node.js 18+ installed
- [ ] Redis server installed and configured
- [ ] PostgreSQL database setup (optional, but recommended)
- [ ] Environment variables configured (`.env.local` or `.env`)

### Configuration Files

- [ ] `.env.local` or `.env` created from `.env.microservices.example`
- [ ] `NEXT_PUBLIC_NETWORK` set (`testnet` or `mainnet`)
- [ ] `NEXT_PUBLIC_HORIZON_URL` configured
- [ ] `NEXT_PUBLIC_SOROBAN_RPC_URL` configured
- [ ] `REDIS_URL` configured (for microservices)
- [ ] `DATABASE_URL` configured (optional)
- [ ] `PORT` set (default: 3000)

### Key Environment Variables

```env
# Required for microservices
REDIS_URL=redis://localhost:6379
REDIS_CHANNEL=stellar:events

# Required for Stellar integration
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Required for web server
PORT=3000

# Optional for monitoring
HEALTH_CHECK_INTERVAL_MS=30000
WORKER_ID=worker-1
```

---

## Microservices Architecture Deployment

### Option 1: Docker Compose (Recommended)

#### Build & Start

- [ ] Build Docker images: `npm run docker:build`
- [ ] Start all services: `npm run docker:up`
- [ ] Verify containers running: `docker ps`
- [ ] Check logs: `npm run docker:logs`

#### Verify Services

- [ ] Redis container running: `docker ps | grep redis`
- [ ] Web server container running: `docker ps | grep web`
- [ ] Indexer worker container running: `docker ps | grep worker`
- [ ] PostgreSQL container running (optional): `docker ps | grep postgres`

#### Health Checks

- [ ] Web server responding: `curl http://localhost:3000`
- [ ] Health API responding: `curl http://localhost:3000/api/health`
- [ ] Status API responding: `curl http://localhost:3000/api/status`
- [ ] Status dashboard accessible: `http://localhost:3000/status`

---

### Option 2: PM2 Process Manager

#### Start Services

- [ ] Redis server running: `redis-server` or `brew services start redis`
- [ ] Start PM2 services: `npm run start:pm2`
- [ ] Verify processes: `pm2 status`
- [ ] Check logs: `npm run logs:pm2`

#### Verify Processes

- [ ] `web-server` process running
- [ ] `indexer-worker` process running
- [ ] Both processes in `online` state
- [ ] No errors in logs

#### Health Checks

- [ ] Web server responding: `curl http://localhost:3000`
- [ ] Health API responding: `curl http://localhost:3000/api/health`
- [ ] Status API responding: `curl http://localhost:3000/api/status`
- [ ] Status dashboard accessible: `http://localhost:3000/status`

---

### Option 3: Manual (Development)

#### Start Services Manually

- [ ] Redis server started: `redis-server`
- [ ] Web server started: `npm run dev:decoupled` (Terminal 1)
- [ ] Indexer worker started: `npm run worker:indexer` (Terminal 2)

#### Verify Processes

- [ ] Redis responding: `redis-cli ping` (should return `PONG`)
- [ ] Web server logs showing "Server started"
- [ ] Worker logs showing "Worker started successfully"
- [ ] No connection errors in logs

#### Health Checks

- [ ] Web server responding: `curl http://localhost:3000`
- [ ] Health API responding: `curl http://localhost:3000/api/health`
- [ ] Status API responding: `curl http://localhost:3000/api/status`
- [ ] Status dashboard accessible: `http://localhost:3000/status`

---

## Component Verification

### 1. Stellar RPC Connection

- [ ] RPC endpoint reachable: `curl https://soroban-testnet.stellar.org/health`
- [ ] Circuit breaker in CLOSED state: `curl http://localhost:3000/api/status | jq '.circuitBreaker.state'`
- [ ] Stellar RPC component healthy: `curl http://localhost:3000/api/status | jq '.components.stellarRpc.status'`
- [ ] No RPC errors in logs

### 2. Redis Connection

- [ ] Redis server running: `redis-cli ping`
- [ ] Redis component healthy: `curl http://localhost:3000/api/status | jq '.components.redis.status'`
- [ ] Worker can connect to Redis (check worker logs)
- [ ] Web server can connect to Redis (check web logs)

### 3. Database Connection (Optional)

- [ ] PostgreSQL running: `psql $DATABASE_URL -c "SELECT 1"`
- [ ] Database component healthy: `curl http://localhost:3000/api/status | jq '.components.database.status'`
- [ ] Prisma migrations applied: `npm run db:migrate`
- [ ] No database errors in logs

### 4. Indexer Worker

- [ ] Worker process running
- [ ] Worker heartbeat in Redis: `redis-cli HGETALL open-audit:worker:heartbeat`
- [ ] Worker component healthy: `curl http://localhost:3000/api/status | jq '.components.worker.status'`
- [ ] Heartbeat age < 90 seconds: `curl http://localhost:3000/api/status | jq '.components.worker.details.ageSeconds'`
- [ ] Events being processed (check worker logs)

### 5. WebSocket Connection

- [ ] WebSocket endpoint accessible: `ws://localhost:3000/ws/events`
- [ ] Test client connects: `npm run test:websocket`
- [ ] Events received by client (check test output)
- [ ] No WebSocket errors in browser console

---

## Feature Verification

### Translation Registry

- [ ] Registry file exists: `lib/translator/blueprints/registry.json`
- [ ] Registry validated: `npm run lint:registry`
- [ ] Translations working (check dashboard)
- [ ] No translation errors in logs

### Security Hardening

- [ ] XDR parser security enabled (default)
- [ ] Security metrics API: `curl http://localhost:3000/api/security/metrics`
- [ ] No security violations in logs
- [ ] Parser handles malformed XDR gracefully

### Resilience Layer

- [ ] Rate limiter enabled: `ENABLE_RESILIENCE=true`
- [ ] Circuit breaker functional (check status API)
- [ ] Fallback endpoints configured (optional)
- [ ] Rate limiting working (no 429 errors)

### Status Monitoring

- [ ] Status dashboard accessible: `http://localhost:3000/status`
- [ ] All components showing status
- [ ] Circuit breaker state displayed
- [ ] Metrics displayed (events, translations, connections)
- [ ] Auto-refresh working (30s interval)
- [ ] Manual refresh button working

---

## Performance Verification

### Response Times

- [ ] Health API < 500ms: `time curl http://localhost:3000/api/health`
- [ ] Status API < 500ms: `time curl http://localhost:3000/api/status`
- [ ] Dashboard loads < 1s
- [ ] WebSocket latency < 100ms

### Resource Usage

- [ ] Worker memory < 500 MB
- [ ] Web server memory < 500 MB
- [ ] Redis memory < 100 MB
- [ ] CPU usage < 50% under normal load

### Throughput

- [ ] Worker processing events (check logs)
- [ ] Events reaching WebSocket clients
- [ ] No queue overflow errors
- [ ] No dropped events

---

## Security Verification

### Access Control

- [ ] CORS configured correctly (if needed)
- [ ] Rate limiting enabled (if configured)
- [ ] API keys validated (if configured)
- [ ] No sensitive data exposed in logs

### Data Protection

- [ ] Environment variables not exposed in client
- [ ] Database credentials secured
- [ ] Redis password set (if configured)
- [ ] No secrets in source control

### Network Security

- [ ] Firewall rules configured
- [ ] Redis port 6379 protected
- [ ] Database port 5432 protected
- [ ] Only necessary ports open

---

## Monitoring Setup

### Health Checks

- [ ] Health check endpoint working: `/api/health`
- [ ] Status endpoint working: `/api/status`
- [ ] Load balancer health checks configured (if applicable)
- [ ] Uptime monitoring configured (optional)

### Logging

- [ ] Application logs visible
- [ ] Error logs visible
- [ ] Log aggregation configured (optional)
- [ ] Log rotation configured (optional)

### Alerting (Optional)

- [ ] Prometheus configured
- [ ] Grafana dashboard created
- [ ] Alert rules defined
- [ ] Notification channels configured (Slack, email, etc.)

---

## Testing

### Automated Tests

- [ ] All tests passing: `npm test`
- [ ] Security tests passing: `npm run test:all-security`
- [ ] Resilience tests passing: `npm run test:resilience`
- [ ] Status tests passing: `npm test -- __tests__/status.test.ts`

### Manual Tests

#### WebSocket Connection

- [ ] Connect to WebSocket: `npm run test:websocket`
- [ ] Receive events in real-time
- [ ] Connection stable (no disconnects)
- [ ] Events properly translated

#### Worker Heartbeat

- [ ] Worker heartbeat visible: `redis-cli HGETALL open-audit:worker:heartbeat`
- [ ] Heartbeat updates every 30 seconds
- [ ] Stop worker → heartbeat stops
- [ ] Status API marks worker as down after 90s

#### Circuit Breaker

- [ ] Circuit breaker in CLOSED state initially
- [ ] Simulate RPC failures → circuit opens
- [ ] Circuit transitions to HALF_OPEN → CLOSED
- [ ] Status dashboard shows circuit state

#### Status Dashboard

- [ ] Dashboard loads successfully
- [ ] All components show status
- [ ] Color coding correct (green/yellow/red)
- [ ] Auto-refresh working
- [ ] Manual refresh working

---

## Post-Deployment

### Smoke Tests

- [ ] Navigate to landing page: `http://localhost:3000`
- [ ] Navigate to dashboard: `http://localhost:3000/dashboard`
- [ ] Navigate to status: `http://localhost:3000/status`
- [ ] All pages load without errors
- [ ] No console errors

### Functional Tests

- [ ] Events appearing in dashboard
- [ ] Translations correct and readable
- [ ] Real-time updates working
- [ ] Search functionality working (if available)
- [ ] Filters working (if available)

### Load Tests (Optional)

- [ ] Simulate high event volume
- [ ] Monitor CPU/memory usage
- [ ] Verify no dropped events
- [ ] Verify no degraded performance

---

## Troubleshooting

### Common Issues

#### Worker shows "down" in status

**Solution:**
1. Check worker logs: `pm2 logs indexer-worker` or `docker logs open-audit-worker`
2. Verify Redis connection: `redis-cli ping`
3. Check heartbeat: `redis-cli HGETALL open-audit:worker:heartbeat`
4. Restart worker: `pm2 restart indexer-worker` or `docker restart open-audit-worker`

#### Redis shows "down" or "not-configured"

**Solution:**
1. Verify Redis is running: `redis-cli ping`
2. Check `REDIS_URL` environment variable
3. Start Redis: `redis-server` or `brew services start redis`
4. Check firewall rules for port 6379

#### No events appearing

**Solution:**
1. Check worker logs for errors
2. Verify `NEXT_PUBLIC_NETWORK` matches RPC endpoint
3. Check `CONTRACT_IDS` filter (empty = all contracts)
4. Verify Stellar RPC endpoint is reachable
5. Check circuit breaker state

#### WebSocket connection fails

**Solution:**
1. Verify web server is running
2. Check WebSocket endpoint: `ws://localhost:3000/ws/events`
3. Check browser console for errors
4. Verify firewall allows WebSocket connections
5. Check `MAX_WS_CONNECTIONS_PER_IP` not exceeded

---

## Rollback Plan

### Docker Compose

```bash
# Stop all services
npm run docker:down

# Remove containers
docker-compose -f docker-compose.microservices.yml down -v

# Revert to previous version
git checkout <previous-commit>

# Rebuild and restart
npm run docker:build
npm run docker:up
```

### PM2

```bash
# Stop all services
npm run stop:pm2

# Revert to previous version
git checkout <previous-commit>

# Restart services
npm run start:pm2
```

---

## Production Checklist

### Infrastructure

- [ ] Load balancer configured
- [ ] Auto-scaling configured (optional)
- [ ] Backup strategy in place
- [ ] Disaster recovery plan documented
- [ ] CDN configured for static assets (optional)

### Security

- [ ] SSL/TLS certificates installed
- [ ] HTTPS enforced
- [ ] Security headers configured
- [ ] Vulnerability scanning enabled
- [ ] Secrets management configured

### Monitoring

- [ ] APM configured (Application Performance Monitoring)
- [ ] Error tracking configured (Sentry, etc.)
- [ ] Log aggregation configured (ELK, Datadog, etc.)
- [ ] Uptime monitoring configured
- [ ] Performance monitoring configured

### Compliance

- [ ] Privacy policy reviewed
- [ ] Terms of service reviewed
- [ ] GDPR compliance (if applicable)
- [ ] Data retention policy defined
- [ ] Audit logging enabled

---

## Support & Documentation

### Documentation

- [ ] Architecture documentation reviewed: `ARCHITECTURE.md`
- [ ] Microservices guide reviewed: `MICROSERVICES_ARCHITECTURE.md`
- [ ] Security guide reviewed: `SECURITY_HARDENING_GUIDE.md`
- [ ] Status monitoring guide reviewed: `STATUS_MONITORING_GUIDE.md`
- [ ] API documentation reviewed

### Team Training

- [ ] Development team trained
- [ ] Operations team trained
- [ ] Support team trained
- [ ] Runbooks created for common issues
- [ ] Escalation procedures documented

### Contact Information

- [ ] On-call rotation defined
- [ ] Contact list updated
- [ ] Communication channels established (Slack, Discord, etc.)
- [ ] Incident response plan documented

---

## Sign-Off

### Development Team

- [ ] Code reviewed and approved
- [ ] All tests passing
- [ ] No known critical bugs
- [ ] Performance acceptable
- [ ] Security review complete

**Signed:** _________________ Date: _________

### Operations Team

- [ ] Infrastructure ready
- [ ] Monitoring configured
- [ ] Backup strategy in place
- [ ] Runbooks ready
- [ ] Team trained

**Signed:** _________________ Date: _________

### Product Team

- [ ] Features verified
- [ ] User acceptance testing complete
- [ ] Documentation complete
- [ ] Support ready
- [ ] Launch plan approved

**Signed:** _________________ Date: _________

---

## Post-Deployment Monitoring

### First Hour

- [ ] Monitor logs for errors
- [ ] Check status dashboard every 5 minutes
- [ ] Monitor CPU/memory usage
- [ ] Verify events processing
- [ ] Check circuit breaker state

### First Day

- [ ] Review error logs
- [ ] Check performance metrics
- [ ] Verify all features working
- [ ] Monitor uptime
- [ ] Collect user feedback

### First Week

- [ ] Performance trending analysis
- [ ] Error rate analysis
- [ ] Capacity planning review
- [ ] User satisfaction survey
- [ ] Plan optimizations if needed

---

**Deployment Date:** _____________

**Deployed By:** _________________

**Version:** _____________________

**Environment:** Production / Staging / Development

**Status:** ✅ Successful / ⚠️ Degraded / ❌ Failed

**Notes:**
_________________________________________________
_________________________________________________
_________________________________________________
