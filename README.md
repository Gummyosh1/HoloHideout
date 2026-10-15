# Holo Hideout

Lightweight one-page site plus a custom event-registration system on Cloudflare Workers and D1. Stripe Checkout handles card payments; optional Brevo integration delivers registration confirmations. V4 is the current logo. Nothing has been deployed or pushed by this implementation.

## Local preview

Node 22+:

```sh
npm ci
npm run db:local
npm run dev -- --port 4174
```

- Website: http://localhost:4174/
- Staff desk: http://localhost:4174/admin

The development command bypasses calendar caching and staff authentication **only on localhost**. It does not simulate successful card payments. Free events and in-store registrations can be tested without payment credentials. Do not expose the development server through a public tunnel.

Local data is separate from production. The zero database ID in `wrangler.jsonc` is a local placeholder, not a provisioned remote database.

## Staff workflow

Create or duplicate an event, set its price/capacity, enter a customer-facing cancellation policy, then publish it. Draft and cancelled events are not listed publicly; closed events remain listed without new registrations. The staff desk supports attendee lists, check-in, CSV exports, in-store registrations, payment reconciliation, full Stripe refunds, and explicit seat release.

Dates in the editor use the employee device's timezone; customer displays use Eastern time. Existing order prices are snapshots. Changing or cancelling an event does not automatically refund or notify its customers: review registrations and contact attendees directly. Do not lower capacity below existing reserved seats.

In-store entries must be recorded in the same dashboard to count against capacity. Only mark them paid once the store has collected payment. Return in-store payments manually before releasing those registrations.

## Calendar coexistence

Google Calendar events remain informational listings. New events created in the staff desk support registration and are stored in D1. Avoid entering the same event in both systems. Existing Google events are not automatically imported or converted into ticketed events.

`GOOGLE_CALENDAR_ID` remains `connorlafferty0@gmail.com`. Calendar descriptions support HTTP/HTTPS links and line breaks. The public feed must remain accessible. Production caches the Google feed for five minutes; booking availability is never served from that cache.

## Database and payment behavior

`migrations/0001_bookings.sql` defines events, orders, attendees, webhook receipts, rate limits, and an audit log. A database trigger checks seat capacity inside the reservation write transaction. Order and attendee inserts are batched in one transaction. Free and in-store bookings count immediately. Paid online orders reserve capacity while checkout is active. Repeated submissions of the same request ID return the same reservation.

Stripe checkout is card-only, with approximately 31-minute expiration. A checkout begun before the registration deadline may finish during that hold; set the deadline at least 31 minutes before the event if payment must be complete before play begins. The server uses its own price and quantity; the browser cannot choose an amount.

Payment confirmation comes from signed Stripe notifications or server-side reconciliation. Payment status, amount, currency, order reference, and session ID must match. Duplicate notifications cannot create extra seats. Unpaid sessions do not confirm registration.

A five-minute scheduled task checks held sessions and retries pending email delivery. Seats are returned only after Stripe confirms a checkout has expired, never merely because a local timer elapsed. Network errors keep seats held. Ambiguous session creation is retried with the same Stripe idempotency key and exact payload for up to 23 hours; older unresolved creations require operator reconciliation with Stripe. They intentionally remain held rather than risking overselling.

Full successful refunds mark an order refunded but keep seats blocked until staff explicitly choose Release seats. Pending refunds wait for Stripe's full-refund notification. Partial refunds are not a staff-dashboard feature. Customers with abandoned checkout can view their reservation and resume payment while it remains open.

## Production setup (owner action required)

1. Create the database in the shop's Cloudflare account:

```sh
npx wrangler d1 create holo-hideout-bookings
```

Replace `database_id` in `wrangler.jsonc` with the returned ID, then apply migrations:

```sh
npx wrangler d1 migrations apply DB --remote
```

2. Configure Cloudflare Access applications/policies for **both** `/admin*` and `/api/admin/*`, allowing only shop staff. Set `ACCESS_TEAM_DOMAIN` (for example `shop.cloudflareaccess.com`) and `ACCESS_AUD` to the application audience. If separate Access applications are used, configure them to share the appropriate audience or extend the verifier deliberately. The Worker verifies the signed Access JWT and fails closed when configuration is absent. Staff should use individual accounts. Never set `LOCAL_DEV=true` in production.

3. Set `SITE_URL` to the final HTTPS origin. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` through Cloudflare secrets. Use the shop's Stripe account. Start in test mode:

```sh
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Create a Stripe webhook pointing to `https://YOUR-DOMAIN/api/stripe/webhook` for:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_succeeded`
- `charge.refunded`

For local Stripe testing, copy `.dev.vars.example` to `.dev.vars`, supply a TEST secret key, and forward Stripe notifications with the Stripe CLI:

```sh
stripe listen --forward-to localhost:4174/api/stripe/webhook
```

Use the CLI's signing secret for local `STRIPE_WEBHOOK_SECRET`, then restart the preview. Never paste live secrets into source or commit them.

4. For confirmation emails, create a Brevo account and activate transactional email sending. Authenticate a domain the shop controls using the DNS records supplied by Brevo, then add and verify a sender such as `events@holohideout.com` if that domain is owned by the shop. Do not use Yahoo as the authenticated sending domain; replies are directed to `holohideout@yahoo.com` automatically.

Generate a **Brevo API key**, not an SMTP key, and store it as a Cloudflare secret:

```sh
npx wrangler secret put BREVO_API_KEY
```

Set `EMAIL_FROM` to the verified email address only (no display name). For local testing, place `BREVO_API_KEY` and `EMAIL_FROM` in the ignored `.dev.vars` file and restart the preview. Do not paste the key into chat or tracked source. Brevo receives the recipient email and confirmation content; no marketing contact or subscription is created.

After a confirmed payment, free booking, or in-store registration, the Worker calls Brevo's HTTPS transactional email API. The email contains the event, date, attendee names, and booking reference, with replies going to the shop's Yahoo inbox. Only provider acceptance is recorded as sent; inbox delivery is not guaranteed and should be checked in Brevo's transactional logs. Failed sends remain pending in the staff roster and the scheduled task retries them. Brevo's short-lived idempotency key reduces duplicate sends during immediate retries; it is not an unlimited exactly-once delivery guarantee.

The free plan currently allows 300 sends/day. If Brevo rejects sends because of a limit or account configuration, registration remains valid and the email is retried later. Configure the sender before live sales, then complete an explicitly chosen test registration to a mailbox you control and verify receipt. No real email has been sent during the provider switch tests. Without email settings, the browser still confirms registrations and the dashboard reports that delivery is not configured. Stripe payment receipts are separate.

References: [Brevo API](https://developers.brevo.com/docs/send-a-transactional-email), [domain authentication](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC).

5. Review refund wording, ticket tax treatment, and customer privacy/retention requirements with the shop. The current ticket price is charged as entered; automatic tax calculation is not configured. Keep public sales disabled until those choices and the payment/email integrations are checked.

6. Run the checks and deploy manually:

```sh
npm test
npx wrangler deploy --dry-run
npm run deploy
```

Verify staff access, a Stripe test payment, sold-out behavior, abandoned checkout recovery, confirmation delivery, and refund/release end to end before switching to live keys. Cron tasks do not run automatically in local Wrangler; trigger them with Wrangler's documented scheduled-event testing endpoint when testing reconciliation.

## Files

- `app-worker.js`: request routing and scheduled reconciliation.
- `booking/`: booking API, Stripe calls/signature checking, and staff authentication.
- `worker.js`: retained bundled Action Packed iCalendar parser and Google feed endpoint.
- `public/`: site, customer registration UI, receipt page, and staff desk.
- `migrations/`: D1 schema.
- `tests/`: calendar, validation, access, signature, payment-status, and concurrent capacity checks.

Run `npm test` for automated checks. The concurrency check uses Python 3's SQLite library to exercise the same schema with simultaneous database writers.
