# Bunny.net Stream — one-time setup

Stage 2 of the recorded courses platform. Roughly 10 minutes start to finish. You do the dashboard work; I do everything else.

## Why Bunny.net Stream

We picked Bunny.net Stream over Cloudflare Stream / Mux / Supabase Storage because it gives us all four of:

1. **Adaptive bitrate streaming** — mobile users on weak connections still get a watchable stream.
2. **Signed URLs with token authentication** — paid lesson playback links expire in 5 min, can't be shared.
3. **TUS resumable upload** — teachers uploading 1-2 GB lectures over flaky connections don't restart from zero on disconnect.
4. **Cheapest pro tier** — ~$0.005/GB delivered + $0.01/GB stored. ~$5-10/month at our launch volume.

## Account creation

1. Go to https://bunny.net/ and click **Sign up**.
2. Use a real billing email (not a personal one) so the team can rotate access later.
3. Add a payment method. Stream is pay-as-you-go — no minimum.

## Create a Stream library

A "library" is Bunny's container for a logical group of videos. We'll use one library for all furqan course lessons.

1. In the Bunny dashboard sidebar, click **Stream**.
2. Click **+ Add Video Library**.
3. Name it `furqan-courses`.
4. **Replication regions**: pick at least 2 close to your audience. For furqan that's:
   - Frankfurt (DE) — covers Egypt + Saudi well
   - Singapore (SG) — covers Southeast Asia
   - Add Sydney (AU) only if you have AU students.
5. Leave **Player Language** at English (we override per-locale on our side).
6. Click **Add Video Library**.

You'll land on the library overview page. Two values you need from here:

- **Library ID** — top of the page, looks like `123456`. Copy it.
- **API Key** — Settings → API → click "Show". Looks like `01234abc-…`. Copy it.

## Create a Pull Zone with token authentication

A pull zone is the CDN edge that serves video segments. We use token auth so playback URLs are signed and short-lived.

1. From the library overview, click **Replication & API → Storage Zone & CDN**.
2. Bunny may have auto-created a pull zone named after your library (e.g. `furqan-courses.b-cdn.net`). If yes, skip to step 4.
3. If not, click **Create Pull Zone**, name it `furqan-courses-cdn`, accept defaults.
4. Click into the pull zone, then **Security** in the left tab.
5. Toggle **Token Authentication** ON.
6. Set **Token Authentication Key** — Bunny generates this. Copy it. Looks like a 32-char hex string.
7. Save.

Two more values you need:

- **Pull Zone Hostname** — looks like `vz-12345678-abc.b-cdn.net`. From the pull zone overview page.
- **Token Authentication Key** — what you just copied.

## Set the webhook

Bunny will POST to our webhook when a video finishes processing.

1. Library → **Settings** → **Webhook**.
2. **Webhook URL**: `https://furqan.today/api/webhooks/bunny`
3. **Webhook events**: tick `Video Encoded`, `Video Failed`. Leave others off.
4. **Webhook Authorization**: pick **Custom HMAC SHA256**. Bunny generates a signing secret. Copy it.
5. Save.

Last value:

- **Webhook Signing Secret** — what you just copied.

## Paste the four env vars

You now have four values. Add them to `.env.local`:

```bash
BUNNY_STREAM_API_KEY=01234abc-...
BUNNY_STREAM_LIBRARY_ID=123456
BUNNY_STREAM_PULL_ZONE_HOSTNAME=vz-12345678-abc.b-cdn.net
BUNNY_STREAM_TOKEN_AUTH_KEY=<32-char hex string>
BUNNY_WEBHOOK_SECRET=<webhook signing secret>
```

Then add the same five to Vercel:

```bash
echo "01234abc-..." | npx vercel env add BUNNY_STREAM_API_KEY production
echo "01234abc-..." | npx vercel env add BUNNY_STREAM_API_KEY preview
echo "01234abc-..." | npx vercel env add BUNNY_STREAM_API_KEY development
# repeat for the other four
```

Or use the Vercel dashboard → Settings → Environment Variables.

## Done

When you're back from doing all this, tell me "bunny ready". I'll verify the credentials with a quick API ping then continue with Stage 3 client integration.

Until then I'm building Stages 3–7 in parallel. The code paths needing live Bunny calls (lesson upload, video playback) won't be exercised end-to-end until you've done this setup, but everything that doesn't depend on a live HTTP round-trip with Bunny — schema, types, UI scaffolding, admin review screens, free-course enrollment, public catalog — gets built without you in the loop.

## Cost expectation

Worth knowing in advance:

- **Storage**: $0.01/GB/month. A 1-hour 1080p lecture is ~1 GB → $0.01/month/lecture.
- **Delivery**: $0.005-0.01/GB depending on region. A 1-hour lesson watched at 1080p uses ~1 GB → $0.005-0.01 per view.
- **Encoding**: free (included in storage).
- **At launch volume** (say 50 lectures, 100 viewers/lecture/month): roughly $5-10/month total.

This scales linearly with viewership. If a viral course pushes 10,000 views in a month, expect $50-100 for that course. The platform's 30% revenue cut covers this many times over.
