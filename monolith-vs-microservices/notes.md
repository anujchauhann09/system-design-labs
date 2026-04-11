# Notes: Monolith → Microservices (E-commerce System)

This document captures exactly what was built, the decisions made at each stage,
and the real trade-offs observed — not theory, but what actually changed in the code.

---

## Stage 1: Monolithic Architecture

### What I Built

A single Node.js + Express application with three internal modules:
- `src/auth/` — signup, login, JWT generation
- `src/orders/` — create order, fetch orders per user
- `src/payments/` — mock payment processing

One PostgreSQL database. One Docker container for the app. One `docker-compose.yml`.

### Project Structure

```
monolith/
├── src/
│   ├── auth/           auth.service.js, auth.routes.js
│   ├── orders/         orders.service.js, orders.routes.js
│   ├── payments/       payments.service.js
│   ├── middlewares/    authenticate.js
│   └── utils/          db.js, initDb.js
├── Dockerfile
└── docker-compose.yml
```

### Internal Flow

```
POST /orders
  → authenticate middleware   (jwt.verify locally — instant, no network)
  → orders.routes.js          (parse + validate input)
  → orders.service.js         (insert order to DB)
      → processPayment()      (direct require() — just a function call)
          → payments.service.js
      ← payment result
  → update order status in DB
  ← response to client
```

The key line in `orders.service.js`:
```js
const { processPayment } = require('../payments/payments.service');
```
This is a plain import. No HTTP. No latency. No failure handling needed.

### What Made This Simple

- One codebase, one deployment, one process
- All modules share the same DB pool (`utils/db.js`)
- `initDb.js` creates all three tables (`users`, `orders`, `payments`) on startup
- Debugging is a single stack trace
- `docker-compose up --build` and everything runs

### Where the Pain Lives

- `orders.service.js` directly imports `payments.service.js` — they are glued together
- A bug in payments can crash the entire app
- To update payment logic, you redeploy everything
- You cannot scale payments independently if it becomes the bottleneck
- As modules grow, the codebase becomes harder to navigate and own

### Docker Setup

```
app container (Node.js monolith) → port 3000
postgres container               → port 5432
```

---

## Stage 2: Full Microservices Architecture

### What I Built

The monolith was split into four independent services, each running in its own container:

```
microservices/
├── api-gateway/        proxies client requests to correct service
├── auth-service/       owns user auth and JWT verification
├── order-service/      owns order creation and retrieval
├── payment-service/    owns payment processing
└── docker-compose.yml  wires all services together
```

### Service Responsibilities

| Service | Port | Owns |
|---|---|---|
| api-gateway | 8080 | routing only, no business logic |
| auth-service | 3001 | users table, JWT sign/verify |
| order-service | 3003 | orders table, calls auth + payment |
| payment-service | 3002 | payments table, mock processing |

### Request Flow

```
Client → api-gateway:8080
  /auth/*    → auth-service:3001
  /orders/*  → order-service:3003
  /payments/* → payment-service:3002

POST /orders (inside order-service):
  → middleware.js          HTTP POST auth-service:3001/verify  (token check)
  → order.service.js       insert order to DB
      → payment.client.js  HTTP POST payment-service:3002/payments/process
      ← payment result
  → update order status
  ← response to client
```

### The Boundary That Changed Everything

In the monolith:
```js
// orders.service.js
const { processPayment } = require('../payments/payments.service');
```

In microservices:
```js
// order-service/src/payment.client.js
const payment = await post(`${process.env.PAYMENT_SERVICE_URL}/payments/process`, { orderId, amount });
```

Same intent. Completely different failure surface.

### What `payment.client.js` Represents

This file is the service boundary made explicit. It is where:
- A function call became a network call
- Latency was introduced
- Failure handling became mandatory
- The two services became independently deployable

### New Failure Modes That Didn't Exist Before

| Scenario | Monolith | Microservices |
|---|---|---|
| Payment logic crashes | whole app crashes | only payment-service crashes |
| Payment logic is slow | whole app slows | only order creation slows |
| Deploy payment fix | redeploy everything | redeploy payment-service only |
| payment-service is down | impossible | orders fail with 500 |
| auth-service is down | impossible | all protected routes fail with 403 |

### API Gateway Role

`api-gateway/src/index.js` is intentionally simple — pure proxy routing using `http-proxy-middleware`. No auth logic, no business logic. Its only job is to give clients a single port (8080) to talk to, hiding the internal service topology.

If order-service moves to port 3010 tomorrow, only the gateway config changes. Clients notice nothing.

### Docker Setup

```
api-gateway      :8080   (client-facing)
auth-service     :3001
order-service    :3003
payment-service  :3002
postgres         :5432   (shared DB — in production each service would own its own)
```

Run everything:
```bash
cd microservices
docker-compose up --build
```

---

## What Actually Changed Between the Two Stages

| Concern | Monolith | Microservices |
|---|---|---|
| Token verification | `jwt.verify()` locally in middleware | HTTP call to auth-service `/verify` |
| Payment processing | `require()` function call | HTTP call to payment-service `/payments/process` |
| DB access | shared pool, all modules | each service has its own pool |
| Table creation | one `initDb.js` creates all tables | each service creates its own table on startup |
| Deployment | one container | four containers + gateway |
| Debugging | single stack trace | distributed logs across services |
| Failure isolation | none — one crash = full outage | partial — one service down ≠ full outage |

---

## Engineering Decisions Made

**Shared DB in microservices (for now)**
Each service connects to the same postgres instance but owns its own table.
This is a pragmatic starting point. The next evolution would be separate databases per service — but that introduces data consistency challenges (no joins across services, eventual consistency).

**No message queue**
order-service calls payment-service synchronously. In production, this would likely be async via a queue (Kafka, RabbitMQ) — so a slow payment processor doesn't block order creation. That's the next layer of complexity.

**API Gateway as pure proxy**
No auth logic in the gateway. Auth is the responsibility of each service that needs it. This keeps the gateway stateless and easy to scale.

---

## Key Takeaway

The monolith wasn't wrong. It was the right starting point.

Every line of complexity added in the microservices version — the HTTP clients, the error handling, the service URLs in env vars, the gateway — exists because we chose independence over simplicity. That trade-off is only worth making when the pain of the monolith (scaling bottlenecks, team ownership, deployment coupling) becomes real.

> Build simple. Feel the pain. Then evolve with intention.

---

A full visual walkthrough of this system — with architecture diagrams and step-by-step explanation — is available as a blog post at [https://scriptory.vercel.app/articles/monolith-vs-microservices-how-backend-systems-actually-evolve](https://scriptory.vercel.app/articles/monolith-vs-microservices-how-backend-systems-actually-evolve).
