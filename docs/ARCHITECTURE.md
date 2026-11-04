# MilestonePay Agent Architecture

## Overview
MilestonePay Agent facilitates trustless milestone-based payments between clients and service providers/freelancers. It integrates PayPal's Authorization & Capture APIs with an AI-driven verification pipeline to validate completion before releasing funds.

## Core Milestone Lifecycle & Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Frontend as Client/Frontend (Vite/React)
    participant Backend as Server (Node.js/Express)
    participant PayPal as PayPal Sandbox API
    participant AI as Verifier Service (LLM)
    actor Freelancer

    Note over Client,Freelancer: 1. Milestone Initiation & Authorization
    Client->>Backend: Create Milestone Order
    Backend->>PayPal: POST /v2/checkout/orders (intent: AUTHORIZE, currency: USD)
    PayPal-->>Backend: Return order_id & approval_url
    Backend-->>Frontend: Return Order details
    Client->>PayPal: Approve Order authorization
    PayPal-->>Backend: Webhook / Callback confirmation
    Backend->>PayPal: POST /v2/checkout/orders/{id}/authorize
    PayPal-->>Backend: Return authorization_id (Funds on Hold)

    Note over Client,Freelancer: 2. Work Submission
    Freelancer->>Backend: Submit deliverable / milestone proof

    Note over Backend,AI: 3. AI Verification
    Backend->>AI: Evaluate submission against acceptance criteria
    AI-->>Backend: Verification Result (Passed / Failed + Confidence Score)

    alt Verification Passed
        Note over Backend,PayPal: 4. Capture & Payout
        Backend->>PayPal: POST /v2/payments/authorizations/{authorization_id}/capture
        PayPal-->>Backend: Capture Confirmed
        Backend->>PayPal: POST /v1/payments/payouts (Transfer to Freelancer)
        PayPal-->>Backend: Payout Initiated
        Backend-->>Client: Milestone Completed & Paid
        Backend-->>Freelancer: Funds Disbursed
    else Verification Failed
        Backend-->>Freelancer: Revision Requested with Feedback
    end
```

## Step-by-Step Flow Description
1. **Per-Milestone PayPal Order (`intent: AUTHORIZE`)**:
   - For every distinct project milestone, an individual PayPal order is created with `intent: AUTHORIZE` specifying the milestone amount in USD.
2. **Client Approval & Hold**:
   - The client approves the payment on PayPal. The backend performs the authorization call (`/v2/checkout/orders/{id}/authorize`) to place an authorized hold on the client's funds without capturing immediately.
3. **AI Verifies the Submission**:
   - The freelancer submits evidence, links, files, or deliverables.
   - The Verifier Service evaluates the output against explicit milestone specifications using an LLM.
4. **Capture**:
   - Upon successful AI verification (and client confirmation if configured), the backend captures the authorized payment (`/v2/payments/authorizations/{authorization_id}/capture`).
5. **Payout**:
   - Funds are disbursed to the freelancer via the PayPal Payouts API.

## Directory Layout
- `client/`: React frontend (Vite)
  - `src/pages/`: Screen views
  - `src/components/`: Reusable UI modules
  - `src/api/`: API integration layer
- `server/`: Express backend
  - `src/routes/`: Express endpoint routes
  - `src/services/paypal/`: PayPal client, auth, orders, authorizations, and payouts
  - `src/services/verifier/`: LLM verification agent logic
  - `src/db/`: SQLite schema, migrations, and query interfaces
  - `src/webhooks/`: PayPal webhook listeners
  - `tests/`: Automated unit and integration tests
- `scripts/`: Operational and database helper scripts

