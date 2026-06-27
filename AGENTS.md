Body:
Summary
Currently, the only way to consume Open-Audit translated events in real time is to maintain a persistent WebSocket connection to the server. This is impractical for server-side integrations, monitoring tools, alerting pipelines, and third-party applications. This issue adds a webhook delivery system that lets external services register a URL and receive translated events as HTTP POST requests.
Required work
New Prisma models (add to prisma/schema.prisma):
prismamodel WebhookSubscription {
id String @id @default(cuid())
url String
contractId String
secret String // HMAC-SHA256 signing secret
active Boolean @default(true)
createdAt DateTime @default(now())
deliveries WebhookDelivery[]
}

model WebhookDelivery {
id String @id @default(cuid())
subscriptionId String
subscription WebhookSubscription @relation(fields: [subscriptionId], references: [id])
payload Json
statusCode Int?
success Boolean
attemptCount Int @default(1)
deliveredAt DateTime @default(now())
}
New API routes (app/api/webhooks/):

POST /api/webhooks — register a new subscription (url, contractId required; validate URL format; generate and return a signing secret)
GET /api/webhooks — list all subscriptions (paginated)
DELETE /api/webhooks/[id] — deactivate a subscription
GET /api/webhooks/[id]/deliveries — view delivery history and status codes for a subscription

Delivery logic (extend the event pipeline in src/worker/indexer.ts or the Redis consumer in server-decoupled.ts):

After a translated event is produced, query active subscriptions matching the event's contractId
For each matching subscription, POST the translated event payload to the registered URL within 5 seconds
Sign each request with X-Open-Audit-Signature: sha256= using the subscription's secret so receivers can verify authenticity
On failure (non-2xx, timeout): retry up to 3 times with exponential backoff (1s, 4s, 16s); after 3 failures, mark the subscription active: false and record the final status code
Record every delivery attempt in WebhookDelivery

Input validation:

Validate url is a valid HTTPS URL (reject HTTP, localhost, and private IP ranges to prevent SSRF)
Validate contractId matches the Stellar contract ID format
Rate limit subscription creation to 10 per IP per hour

Acceptance criteria

POST /api/webhooks creates a subscription and returns the signing secret (shown only once)
Registered webhooks receive a POST within 5 seconds of a matching translated event being produced
HMAC signature is present and verifiable on every delivery
Failed deliveries are retried with exponential backoff; subscription is deactivated after 3 consecutive failures
Private/localhost URLs are rejected at registration time with a descriptive error
WebhookDelivery records are created for every attempt (success and failure)
Unit tests cover: registration validation, SSRF URL rejection, HMAC signing, retry logic, deactivation on max failures
npm run lint and npm test pass; new Prisma migration included