# create-bakorin

## 0.1.0-beta.2

## 0.1.0-beta.1

### Minor Changes

- 1d6ca77: Stripe starters. The store template now takes payments with Stripe Checkout: orders are confirmed only by a verified, idempotent webhook, paid orders take stock and send a receipt email, and product descriptions are rich text. The new membership template sells plan tiers as Stripe subscriptions, keeps each member's role in step through verified webhooks, gates members only content with app.yaml rules, and links to the Stripe customer portal. Both work with Astro and Next.js and run in test mode until you switch keys.

## 0.1.0-beta.0

### Minor Changes

- f4e0b27: First public beta. Bakorin turns one app.yaml into a self hosted API with auth, CRUD, files, realtime, mail, jobs, webhooks, and an admin UI (@bakorin/server and @bakorin/core), a typed client with Astro and Next.js helpers and components (@bakorin/sdk), and a project generator with blog, marketing, SaaS, and store templates (create-bakorin).
