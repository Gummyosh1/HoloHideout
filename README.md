# Holo Hideout

A lightweight, responsive one-page site. Plain HTML, CSS, and JavaScript; no framework or website build required. The supplied logo, all five brand colors, hours, contact links, Google Maps directions, and Instagram are included.

## Preview and deploy to Cloudflare Workers

Use Node 22 or newer:

```sh
npm install
npm run dev
npm test
npx wrangler login
npm run deploy
```

Deploy from this directory. `wrangler.jsonc` serves `public/` and routes `/api/events` to the bundled Worker. Static-only drag-and-drop hosting will not run the calendar endpoint. No deployment or repository push has been performed.

## Calendar

`GOOGLE_CALENDAR_ID` is configured as `connorlafferty0@gmail.com` in `wrangler.jsonc`. The calendar must be public with event details visible: Google Calendar → Settings → Access permissions for events → Make available to public. Verify the ID under Integrate calendar. Only publish customer-facing events on this calendar.

The Worker reuses Action Packed’s public iCalendar feed implementation and bundled ical.js parser, including recurring events, exclusions, changed occurrences, cancellations, all-day dates, and Eastern time. No API key is required. Responses are cached for five minutes and open pages refresh every five minutes. The configured public feed was verified successfully and its October 2026 events parsed during development.

Edit content in `public/index.html`, styling in `public/style.css`, and event rendering in `public/app.js`. The original artwork remains at the project root. The page uses local assets and system fonts, with no analytics or third-party scripts.

## Refreshing the calendar during preview

`npm run dev` bypasses the calendar response cache locally. Refresh the page after editing an event. Google may still take a little time to update its public feed. Production keeps its five-minute Worker cache.

Descriptions display text, line breaks, and clickable HTTP/HTTPS links, including links entered with Google Calendar’s rich text editor. Other HTML is reduced to text; scripts and embedded content are not rendered.

To reset an older local cache manually, stop the preview, move `.wrangler/state/v3/cache` out of the project, and restart `npm run dev`. Restarting alone preserves Wrangler’s on-disk cache.
