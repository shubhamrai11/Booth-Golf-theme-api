# Deploy the temporary photo booth on Vercel

1. Import [shubhamrai11/Booth-Golf-theme-api](https://github.com/shubhamrai11/Booth-Golf-theme-api)
   into [Vercel](https://vercel.com/new), or redeploy the existing project after
   the latest GitHub commit is available.
2. Use the repository root, **Vite**, **npm run build:web**, output **dist**, and
   Node.js 22 or newer. vercel.json supplies these settings and a 300-second
   maximum function duration.
3. In **Project → Settings → Environment Variables**, add **OPENAI_API_KEY** as
   a server variable for Production (and Preview if needed). Do not use VITE_.
   API billing belongs to your OpenAI account. Never paste the key in GitHub.
4. Redeploy after adding or replacing a variable. Existing Supabase and BOOTH_*
   variables are no longer read and can be removed from Vercel. This version
   needs no database, storage service or Supabase schema.
5. On the Windows event PC, extract the complete new 0.4 Memory Helper package
   and start **Fairway Memory Helper.exe**. Configure the licensed Canon SDK folder,
   Windows printer and the same OpenAI key in helper Settings. Save settings.
6. Open your Vercel **/kiosk** page in Chrome or Edge on that same PC. Select
   **Settings → Connect Windows helper**. If the browser requests local network
   access, allow the booth website. Select **Allow connection** in the local
   helper window after checking the displayed website address. Connection values
   are created automatically; no password or token needs to be copied.
7. Choose Rehearsal, save settings, return to welcome, capture, review, generate,
   print, and verify automatic return to welcome. Rehearsal makes no AI request.
   Install and test the physical printer driver before changing to Live AI.
8. Select your optional event reference and outfit images in website Settings,
   choose Live AI and save. Selected reference files last until this page is
   refreshed; select them again after a refresh. Predefined JPEGs in the helper's
   assets folder load automatically on connection. Sunburst Max is the default.
9. Open **/display** in another window of this same browser profile and origin.
   Move it to the large screen and enter Full screen. It shows only the current
   temporary portrait, then clears after print/delete/refresh.

## What is saved

Guest photos and generated results are held only in page memory and transient
server/native buffers. No gallery, guest photo file, download link or QR is stored.
Refreshing the guest page starts a new session and loses the current photo.
Equipment configuration, encrypted local key and command IDs contain no guest
pixels. Website preferences contain only prompt/model/event/frame text.

The pairing credential is generated automatically and expires after 12 hours or
helper restart. It is kept in sessionStorage solely to reconnect this tab; no
photos or photo IDs are placed there. Settings are accessible without an admin
password, as requested, so run the booth on an operator-controlled device.

Windows print-spooler behavior and the AI provider's data retention are outside
this app's photo storage. Existing files in an older build's data folder are
left untouched. Use the new helper rather than the old persistent photo build.

## Generation limits and recovery

Vercel Hobby's function limit is 300 seconds. AI gets 240 seconds here, reserving
framing time; a high-detail Sunburst Max request may exceed it. The app never
retries automatically. If the connection ends, check AI billing and the printer
before starting a new action. Refresh cannot retrieve a lost result.

The total multipart request is limited to 4 MB; camera/reference JPEGs are resized
to a maximum 1920-pixel edge before sending. Use a transparent branding PNG under
1 MB. No external image URLs are fetched by the generation API.

A signature from the connected helper protects live generation without manually
configured secrets. It binds the request bytes, website and request ID for 60
seconds. The helper records approval IDs, and a function instance rejects repeated
IDs. This is not a globally durable cloud replay ledger; manually replaying a
signed request against a different function instance is outside that guarantee.
The app itself submits once and disables retries for a failed guest session.

The hosted hardware connection targets localhost on the booth PC. It does not
control a printer on a different device. If local connections are restricted by
your browser or network policy, operate the complete app locally instead.

Official references: [Vercel limits](https://vercel.com/docs/functions/limitations),
[Chrome local network permission](https://developer.chrome.com/blog/local-network-access).
