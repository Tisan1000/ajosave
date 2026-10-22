# Payment Threat Model

Scope: everything that moves member money in Ajosave: NGN card/bank deposits through Paystack, the
conversion to USDC, contributions locked in the Ajo Soroban contract, and cycle payouts to members.
Method: STRIDE over the data flow below, plus replay/double-spend and reconciliation threats specific
to payments. Each threat lists its mitigation, the evidence (files that implement or document it) and a
status. Statuses are honest: **Partial** and **Open** entries are the backlog.

Each threat is also rated by **Likelihood** and **Impact** (High / Medium / Low) and mapped to either an
existing mitigation or an open issue. Ratings are reviewed by an external security reviewer before a
release that changes the payment flow (see [Review](#review)).

Related: [`ngn-to-usdc-flow.md`](ngn-to-usdc-flow.md), [`webhook-replay-protection.md`](webhook-replay-protection.md),
[`secure-cookies.md`](secure-cookies.md), [`external-contract-audit.md`](external-contract-audit.md),
[`transactional-outbox.md`](transactional-outbox.md).

## Assets

| Asset | Why it matters |
|---|---|
| Member funds (NGN in flight, USDC in the contract) | Direct financial loss |
| Contribution / payout ledger in PostgreSQL | Source of truth for who has paid and who is owed |
| Paystack secret key, Stellar server signing key, `NEXTAUTH_SECRET` | Forge webhooks, sign payouts, mint sessions |
| Member sessions (access JWT + refresh token) | Act as a member |
| Contract admin authority | Trigger payouts, pause, upgrade |

## Actors and trust boundaries

| Actor | Trust |
|---|---|
| Member (browser) | Untrusted input; authenticated by session |
| Circle admin / platform admin | Trusted role, but credentials can be stolen |
| Paystack | Trusted only via a valid HMAC signature on each webhook |
| Stellar network + USDC token contract | Trusted for settlement; token contract assumed correct |
| Internet attacker | Can call any public endpoint, replay traffic, flood |

## Data flow

1. Member calls `POST /api/v1/circles/[id]/contribute` (session, membership and amount checked); the API
   initialises a Paystack payment and stores a `pending` contribution with the Paystack reference.
   Partial contributions are allowed: a member may pay less than the full cycle amount, and the
   contribution is credited incrementally until the total is reached.
2. Member pays on Paystack checkout.
3. Paystack calls `POST /api/v1/webhooks/paystack`; the API verifies the signature, timestamp and
   event ID, then confirms the contribution inside one DB transaction.
4. A worker locks the USDC equivalent on-chain in the circle contract.
5. Each cycle, an admin/cron triggers `payout`, which sends the pot to the cycle's recipient.
6. A member may early-exit a cycle before payout; the contract refunds their locked USDC and the
   ledger records the exit.

## Threats

Status: **Mitigated** (control in place and tested/documented), **Partial** (control exists with a known
gap), **Open** (no effective control yet). Likelihood/Impact: **H**igh, **M**edium, **L**ow.

### NGN → Paystack (deposit initiation)

| ID | STRIDE | Threat | Likelihood | Impact | Mitigation / open issue | Evidence | Status |
|---|---|---|---|---|---|---|---|
| PT-01 | Spoofing | Attacker posts a forged "payment succeeded" webhook | L | H | HMAC-SHA512 of the raw body compared with `timingSafeEqual` before any processing | `src/lib/webhook-replay.ts`, `src/app/api/v1/webhooks/paystack/route.ts` | Mitigated |
| PT-04 | Tampering | Non-member or other user contributes to / manipulates a circle | L | H | Session required, circle must be active, caller must be a member, body validated with zod, partial amounts bounded | `src/app/api/v1/circles/[id]/contribute/route.ts`, `src/lib/money.ts` | Mitigated |
| PT-17 | Double spend | Double click or client retry creates duplicate contribution payments | M | M | A lookup of the existing contribution for member + cycle returns the existing payment. The `withIdempotency` middleware exists but is not applied to the contribute route (open issue: apply idempotency to contribute) | `src/app/api/v1/circles/[id]/contribute/route.ts`, `src/server/middleware/index.ts` | Partial |
| PT-19 | Tampering | Stale or manipulated FX rate mis-prices contributions | M | M | Rate cached 5 minutes, last-known DB rate as fallback, rate locked per payment reference. Final fallback is a hardcoded NGN rate (open issue: remove hardcoded fallback) | `src/lib/fx.ts` | Partial |

### Webhook processing

| ID | STRIDE | Threat | Likelihood | Impact | Mitigation / open issue | Evidence | Status |
|---|---|---|---|---|---|---|---|
| PT-05 | Tampering | Credited amount differs from what was actually paid | M | H | Credit comes from `metadata.payUsdc` set by our own initialisation and is capped at the contribution total. The webhook does not compare Paystack's `data.amount`/currency with the initialised amount, and `verifyPayment` is only used by the manual verify route (open issue: verify amount/currency in webhook) | `src/app/api/v1/webhooks/paystack/route.ts`, `src/lib/paystack.ts` | Partial |
| PT-06 | Tampering | Rounding/precision errors corrupt balances | L | M | Amounts validated as `numeric(20,7)` decimals; webhook credits in integer stroops | `src/lib/money.ts`, `src/app/api/v1/webhooks/paystack/route.ts` | Mitigated |
| PT-07 | Tampering | Illegal status transition (e.g. `refunded` to `pending`) from a bug or duplicate event | M | M | DB CHECK constraint on contribution status. A transition validator exists but no runtime code calls it, and `failed` is written by the webhook but missing from the constraint (open issue: enforce state machine at runtime) | `src/lib/payment-state-machine.ts`, `migrations/1746000000000_add-refunded-contribution-status.ts` | Partial |
| PT-11 | Denial of service | Flooding of payment or webhook endpoints | M | M | Payments: 10/min per user, fail-closed. Webhooks: 300/min per IP, but fail-open if the limiter backend is down (open issue: fail-closed webhook limiter) | `src/lib/rate-limit-policies.ts` | Partial |
| PT-15 | Replay | Replayed or duplicated webhook credits a contribution twice | L | H | Signature, 5 minute timestamp window, unique event ID, `processed_webhooks` insert in the same transaction as the credit | `docs/webhook-replay-protection.md`, `src/lib/webhook-replay.ts` | Mitigated |

### NGN → USDC conversion

| ID | STRIDE | Threat | Likelihood | Impact | Mitigation / open issue | Evidence | Status |
|---|---|---|---|---|---|---|---|
| PT-20 | Tampering | Partial contributions are summed past the cycle total, over-crediting a member | M | H | Credit is capped at the contribution total and partial amounts are bounded; the cap is enforced in the webhook transaction | `src/app/api/v1/webhooks/paystack/route.ts`, `src/lib/money.ts` | Mitigated |
| PT-21 | Tampering | Conversion uses a rate different from the one locked at payment time | M | M | Rate locked per payment reference at initialisation and reused at conversion | `src/lib/fx.ts`, `src/app/api/v1/webhooks/paystack/route.ts` | Mitigated |
| PT-18 | Repudiation / integrity | Paystack, database and chain drift apart (paid but not credited, credited but not locked on-chain) undetected | H | H | A pure payment reconciliation module exists but is not scheduled or called; only KYC reconciliation runs as a cron (open issue: schedule payment reconciliation) | `src/lib/reconciliation.ts`, `src/app/api/v1/cron/kyc-reconcile/route.ts` | Open |

### USDC → Soroban contract (locking contributions)

| ID | STRIDE | Threat | Likelihood | Impact | Mitigation / open issue | Evidence | Status |
|---|---|---|---|---|---|---|---|
| PT-22 | Tampering | On-chain lock amount differs from the credited USDC amount | M | H | Lock is driven by the credited amount from the same DB transaction; reconciliation gap tracked under PT-18 | `src/server/services/contribution.service.ts`, `contracts/ajo/` | Partial |
| PT-23 | Elevation | Contract admin key stolen; malicious upgrade or forced payouts | L | H | Two-step upgrade with 48h timelock and `cancel_upgrade`, emergency `pause`, optional multisig admin. A single admin key remains a single point of failure unless multisig is deployed (open issue: deploy multisig admin) | `contracts/ajo/UPGRADE.md`, `docs/multisig-admin.md` | Partial |
| PT-12 | Denial of service | Paystack, Stellar or SMS outage cascades through the app | M | M | Circuit breaker per provider; transactional outbox with retry and dead-letter | `src/lib/circuit-breaker.ts`, `docs/transactional-outbox.md` | Mitigated |

### Payout from contract

| ID | STRIDE | Threat | Likelihood | Impact | Mitigation / open issue | Evidence | Status |
|---|---|---|---|---|---|---|---|
| PT-13 | Elevation | Non-admin triggers or retries payouts | L | H | Admin routes wrapped in `withAdminAuth` (role check, consistent 401/403) | `src/server/middleware/authorization.ts`, `src/app/api/admin/payouts/[id]/retry/route.ts` | Mitigated |
| PT-16 | Double spend | Concurrent or repeated payout for the same cycle | M | H | `unique_payout_per_cycle` DB constraint is the real guard; the in-process lock does not protect multi-instance deployments (open issue: distributed payout lock) | `migrations/1745600000000_payouts-unique-cycle.ts`, `src/server/services/payout.service.ts`, `src/server/services/payout-lock.ts` | Partial |
| PT-24 | Tampering | Payout recipient is not the cycle's designated member | L | H | Recipient is derived from the cycle record and enforced by the contract; admin cannot override the recipient | `contracts/ajo/`, `src/server/services/payout.service.ts` | Mitigated |

### Early-exit refunds

| ID | STRIDE | Threat | Likelihood | Impact | Mitigation / open issue | Evidence | Status |
|---|---|---|---|---|---|---|---|
| PT-25 | Tampering | Member early-exits after receiving a payout to double-dip | L | H | Contract only allows exit before the member's payout cycle; exit is rejected once the member has received the pot | `contracts/ajo/`, `src/server/services/payout.service.ts` | Mitigated |
| PT-26 | Repudiation | Early-exit refund amount is disputed with no trail | M | M | Refund is recorded in the ledger and audit log with correlation ID; contract emits an exit event | `src/server/services/audit.service.ts`, `contracts/ajo/` | Mitigated |
| PT-27 | Double spend | Early-exit refund is paid twice (retry or replay) | M | H | Refund is idempotent per member + cycle; contract rejects a second exit for the same member (open issue: add DB unique constraint on exit refunds) | `contracts/ajo/`, `src/server/services/payout.service.ts` | Partial |

### KYC bypass attempts

| ID | STRIDE | Threat | Likelihood | Impact | Mitigation / open issue | Evidence | Status |
|---|---|---|---|---|---|---|---|
| PT-28 | Spoofing | Member submits another person's identity documents to pass KYC | M | H | KYC provider verifies document authenticity and liveness; mismatches are rejected | `src/app/api/v1/cron/kyc-reconcile/route.ts`, `src/lib/kyc.ts` | Partial |
| PT-29 | Elevation | Member bypasses KYC to contribute or receive a payout | M | H | Contribution and payout paths require a verified KYC status; KYC reconciliation cron re-checks provider state | `src/app/api/v1/cron/kyc-reconcile/route.ts`, `src/lib/kyc.ts` | Partial |
| PT-30 | Tampering | KYC status is flipped to verified by a client request | L | H | KYC status is only written by the server after provider confirmation; client cannot set it | `src/lib/kyc.ts` | Mitigated |

### Cross-cutting

| ID | STRIDE | Threat | Likelihood | Impact | Mitigation / open issue | Evidence | Status |
|---|---|---|---|---|---|---|---|
| PT-02 | Spoofing | Session takeover via stolen or replayed refresh token | M | H | HttpOnly + Secure + SameSite=Lax cookie, `no-store` on cookie responses, refresh token rotation, revocation on logout | `src/lib/cookies.ts`, `src/lib/refresh-tokens.ts`, `docs/secure-cookies.md` | Mitigated |
| PT-03 | Spoofing | OTP brute force to take over an account | M | H | OTP endpoints limited to 5 per 15 min per IP, fail-closed; account lockout | `src/lib/rate-limit-policies.ts`, `src/lib/lockout.ts`, `OTP_BRUTE_FORCE_PROTECTION.md` | Mitigated |
| PT-08 | Repudiation | Member or admin disputes a payment/payout and there is no trail | L | M | Audit service, correlation IDs on every request, full webhook payloads kept in `processed_webhooks` | `src/server/services/audit.service.ts`, `AUDIT_LOGGING_IMPLEMENTATION.md` | Mitigated |
| PT-09 | Info disclosure | Paystack / Stellar / auth secrets leak from code or CI | L | H | Secrets only from environment via server config; secret scanning in CI | `docs/secrets-security.md`, `.github/workflows/secrets-scan.yml` | Mitigated |
| PT-10 | Info disclosure | Session cookie stored by a shared cache or read by page script | L | M | `HttpOnly`, `Cache-Control: no-store` on Set-Cookie responses | `src/lib/cookies.ts`, `docs/secure-cookies.md` | Mitigated |

## Open issues

Threats with status **Partial** or **Open** are tracked as open issues. Each row above names the gap in
its mitigation column; the corresponding issue is filed under the `security` label and linked back to
this document. A threat is only downgraded to **Mitigated** once its issue is closed and the control is
tested.

## Review

This threat model is reviewed by at least one external security reviewer whenever the payment flow
changes (new endpoint, new contract entry point, new provider). The reviewer signs off on the
likelihood/impact ratings and the open-issue mapping. Review sign-off is recorded in the PR that
updates this file.
