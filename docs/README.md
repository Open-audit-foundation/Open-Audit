# 📚 Open-Audit Documentation Hub

Welcome to the Open-Audit documentation directory! To help you find exactly what you need without sifting through markdown files, we have categorized our documentation by contributor goal and audience.

Choose the path below that best matches what you want to accomplish today.

---

## 🚀 "I want to run this locally"
*Guides for setting up your local environment, running servers, and starting workers.*

- **[Monolithic Quickstart](../QUICK_START.md)**  
  Get the standard development server (`server.ts`) up and running with live WebSocket streaming in under 5 minutes.
- **[Microservices Quickstart](../QUICKSTART_MICROSERVICES.md)**  
  Step-by-step instructions for deploying the decoupled production microservices topology using Docker Compose or PM2.
- **[Reconciliation Worker Quickstart](../RECONCILIATION_QUICKSTART.md)**  
  Setup guide for running standalone ledger background workers to automatically detect and reconcile missed events.
- **[Contributing Guidelines](../CONTRIBUTING.md)**  
  Essential contributor guidelines covering Git workflow, commit naming conventions, and environment preparation.

---

## 🌐 "I want to add a translation"
*Guides for authoring Soroban contract blueprints, formatting descriptions, and running validation tools.*

- **[Blueprint Authoring & Registry Linter](../REGISTRY_LINTER_README.md)**  
  Learn how to write versioned translation blueprints for smart contracts, register them, and run the automated validator (`npm run lint:registry`).
- **[Code & Sanitization Standards](../CODE_STANDARDS.md)**  
  Required TypeScript strict typing rules, UI display formatting, and HTML escaping/sanitization standards for contract descriptions.
- **[Translation Testing Guide](../TEST_LINTER.md)**  
  Instructions for writing unit tests against your translation blueprints and verifying custom ABI decoders.

---

## 🏗️ "I want to understand the architecture"
*System design documents, component breakdowns, resilience engineering, and security layers.*

- **[Core Architecture Overview](../ARCHITECTURE.md)**  
  Comprehensive system overview, high-level data flow diagram, and component deep dive (`server.ts`, polling indexer, translation registry).
- **[Microservices Production Architecture](../MICROSERVICES_ARCHITECTURE.md)**  
  Detailed breakdown of the production microservices architecture, featuring Redis Pub/Sub decoupling, standalone workers, and independent scaling.
- **[Visual Architecture Guide](../MICROSERVICES_VISUAL_GUIDE.md)**  
  ASCII diagrams, sequence flows, and comparative visual models illustrating event propagation across service boundaries.
- **[Security Hardening Guide](../SECURITY_HARDENING_GUIDE.md)**  
  Deep dive into defensive layers including XSS payload disarming, RPC rate-limit mitigation, and contract payload sanitization.
- **[Resilience Implementation Guide](../RESILIENCE_IMPLEMENTATION_GUIDE.md)**  
  Technical specifications for exponential backoff retries, circuit breakers, and Dead-Letter Queue (DLQ) persistence.
- **[Resilience Quick Reference](../RESILIENCE_QUICK_REFERENCE.md)**  
  Operational cheat-sheet covering configuration parameters, error codes, and manual recovery commands.

---

## ⚙️ "I want to write a WASM parser"
*Advanced engine internals, historical ingestion pipelines, and V8 performance optimization.*

- **[Simplified Core Engine Architecture](architecture-simple.md)**  
  A streamlined overview of the event decoding pipeline and raw XDR payload processing.
- **[Historical Ingestion Architecture](HISTORICAL_INGESTION.md)**  
  Technical design for high-throughput batch indexing, parallel ledger processing, and state store checkpoints.
- **[V8 Garbage Collection Tuning](v8-gc-tuning.md)**  
  Node.js memory management strategies and V8 engine flags for optimizing heap allocations during heavy indexing loads.
- **[UDT & WASM Decoder Engine](../lib/translator/udt-decoder.ts)**  
  Direct reference to the core TypeScript implementation responsible for parsing Soroban Custom User-Defined Types (UDT) and contract specs.

---

## 📜 Historical Archive
Looking for past implementation summaries, deliverable checklists, or milestone task completion reports?
Visit the **[Historical Archive](archive/README.md)** where project-history write-ups are stored so they don't clutter living documentation.
