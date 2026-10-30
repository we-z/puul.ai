# Puul aggregate attribution

Deployment status (2026-10-30): the D1 database/table and isolated Worker exist,
with the DB binding and logging disabled. The dashboard code editor failed to
load, so the attribution Worker source is not deployed, no Puul routes are bound,
and the client change is not published. The temporary workers.dev URL is disabled.
Complete backend deployment and verification before publishing the client.

The static page loads `attribution.js`. It reports one `landing` and at most one
trusted `email_click` per page lifetime, without changing or delaying the mailto.
Both requests go to the same-origin `/api/attribution` endpoint. Other hosts that
share this repository, including rtltasks.com, do not send events.

The Worker stores daily counters in the dedicated `puul-attribution` D1 database.
It never stores individual event records, IPs, user agents, raw referrers, full
URLs, query strings, cookies, local storage, or visitor identifiers. Only known
source categories and exact campaign values in the client/server allowlists are
accepted. Request referrers are restricted to the site's origin. No public read
endpoint exists. Worker invocation/console logging and tracing must remain off.

EU traffic, unknown geography, DNT, Global Privacy Control, and known bots when
Cloudflare supplies bot metadata are excluded. Do not describe the resulting
counts as all traffic or unique visitors. The endpoint cannot authenticate the
truth of client-supplied labels; same-origin checks, bounded payloads, an
aggregate per-isolate throttle, and a 5,000-event daily database cap limit obvious
abuse but do not make it a fraud-proof measurement system. Free account limits
are shared with other Workers/databases; failures drop analytics without blocking
the contact link. There are no retries and no backfill.

## Resources and deployment

- Account: `d61025eb40eb225a5e647fe6790eb51b`
- Worker: `puul-attribution`
- D1 database: `puul-attribution` (`c779ecd6-bfdb-41e6-9ba6-a372ed54899e`)
- Worker binding: `DB`
- Production routes: only `https://puul.ai/api/attribution` and
  `https://www.puul.ai/api/attribution` (no query string in the client request).
- Keep both existing `puul.ai/*` and `www.puul.ai/*` routes pointing to
  `rtldatasets-com`.
- `workers_dev`, preview URLs, and observability should be disabled.

`wrangler.jsonc` records the intended configuration; it contains no credentials.
Apply `schema.sql` to the dedicated database, deploy the tested Worker and its
binding, then add only the narrow routes before publishing the client script.
Never point the whole domain at this Worker. The static site deploys from the
repository's main branch through its existing Vercel integration.

## Private report and verification

Run `report.sql` in the authenticated Cloudflare D1 Console for this database. It
shows daily source/campaign → landing/email-click totals and excludes test rows.
To inspect verification data, use the same query with `WHERE is_test = 1`.

A test visit uses
`https://puul.ai/?utm_source=partner&utm_medium=referral&utm_campaign=verification`.
Click **Request Data**, confirm the original recipient, **Data request** subject,
and five-field body, and do not send an email. The `verification` campaign sets
`is_test=1` in the Worker; normal reports exclude it. This flag is a public test
label, not a credential. Cloudflare's separate Web Analytics may still include
these verification page views.

Approved campaign labels currently are `data_request` and `verification`.
Approved UTM sources: google, bing, duckduckgo, x, linkedin, github, hacker_news,
reddit, newsletter, email, partner. Approved media: organic, social, email,
referral, cpc. Unrecognized values become empty labels in the client and are
rejected if submitted directly. They are never stored.

An email click means the mailto link was activated, not that an email was sent.
`direct_unknown` includes typed/bookmarked visits and links whose referrer was
omitted by an app or browser. An aggregate report cannot identify who visited,
match a specific received email to a visitor, or reconstruct earlier activity.

## Tests

Run `node --test cloudflare/attribution.test.mjs` with Node 24 or newer. The tests
exercise the actual SQLite aggregation and cap, privacy exclusions, invalid
requests, safe client labels, test exclusion, and the unchanged mailto action.
