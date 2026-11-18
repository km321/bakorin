---
"create-bakorin": minor
---

Stripe starters. The store template now takes payments with Stripe Checkout: orders are confirmed only by a verified, idempotent webhook, paid orders take stock and send a receipt email, and product descriptions are rich text. The new membership template sells plan tiers as Stripe subscriptions, keeps each member's role in step through verified webhooks, gates members only content with app.yaml rules, and links to the Stripe customer portal. Both work with Astro and Next.js and run in test mode until you switch keys.
