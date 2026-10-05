# Fairway Studio

A responsive golf photo booth with a Vercel website and Windows camera/printer helper.
The guest cycle is **Capture → Review → Generate → Print → Clear**. Guests have
one input option: capture a photo.

## Temporary photos

One guest's capture and result live only in browser memory. Refresh, Delete,
retake, or Next guest releases them. After a confirmed Windows print submission,
the app clears the photo and returns to welcome. No guest photo files, database,
cloud bucket, resumable session, photo history or QR download links are created.

The server handles image bytes in RAM for the current request and returns the
finished JPEG directly, with caching disabled. Canon downloads to a memory stream;
the print bridge reads image bytes from stdin. Windows still uses its normal
print spooler. The AI provider's own retention and billing rules remain separate
from this app. Refresh does not undo a request already sent to the provider.

Small equipment settings, encrypted credentials and command IDs are saved on
the Windows PC. Command IDs contain no photos and prevent a repeated shutter or
print after a lost response or helper restart. Old photo files from earlier app
versions are not migrated or deleted by this version.

## Deployment

Follow [VERCEL-SETUP.md](VERCEL-SETUP.md). The only required deployment variable is
**OPENAI_API_KEY**. No Supabase account, admin password, session secret, public URL
setting or manually entered device token is required. The key stays server-side.

Copy [.env.example](.env.example) to **.env** in the repository root and paste
your key after `OPENAI_API_KEY=`. The local app reads this file at startup;
restart after changing it. On Vercel, import the private file through
**Project → Settings → Environment Variables**, select Production, save, and
redeploy. The `.env` file is ignored by Git and must stay out of public files.

Live generation on Vercel needs the Windows helper connected from Settings using
the same OpenAI key. The helper creates a temporary, origin-specific connection
and signs the exact generation request. Visitors without an approved helper
connection cannot use the paid AI endpoint. Connections expire after 12 hours or
when the helper restarts; connect again when starting the next event.

Rehearsal is the default and makes no paid AI call. It frames the captured photo;
it does not turn the guest into a golfer. Live defaults remain Sunburst, Max,
1536 × 2304, composed into a 1200 × 1800 print. Each capture needs an explicit
Use this photo action before generation. There are no automatic AI retries.

Vercel Hobby functions allow at most 300 seconds. This app gives AI 240 seconds
and reserves time for framing. Sunburst Max can exceed that budget. An interrupted
request may be charged and its result cannot be recovered after refresh. Try
High quality or run locally if Max generation consistently exceeds the limit.
See [Vercel function limits](https://vercel.com/docs/functions/limitations).

## Windows operation

64-bit Windows 10/11, a printer driver, and a licensed 64-bit Canon EDSDK runtime
are needed for physical capture/printing. The SDK is not distributed here.

```powershell
npm ci
npm run build:windows
npm start
```

Open http://127.0.0.1:4310/?view=setup. Select the Canon SDK folder and printer,
save the OpenAI key, choose Rehearsal or Live, and save settings. The portable
**Fairway Memory Helper.exe** runs on port 4314 for a hosted Vercel booth.
Keep the entire extracted helper folder together.

Direct Canon capture has no live video preview. It downloads the JPEG after the
countdown. Set the camera to JPEG and close EOS Utility. Folder watching was
removed because it requires photo files on disk. Browser webcam capture remains
available. Physical R100/200D capture and actual print output need testing on
the event equipment; compilation and simulated equipment tests do not verify them.

For the portable Windows helper, put **.env** beside the helper EXE and restart
it, or save the key in Settings. Startup key priority is a nonempty private
api-key.local.mjs, then OPENAI_API_KEY from the process environment, then .env,
then the encrypted Settings key. If you previously used
[api-key.example.mjs](api-key.example.mjs), clear the private code value to use
.env. Never commit keys.

## Settings, references and display

Settings are available from the welcome screen. Model, prompt, event name and
frame text remain saved between guests. Optional event reference, outfit and
transparent PNG files are held in page memory, retained while moving between
Settings and welcome, and removed by a full refresh. A bundled illustrative golf
reference is available by default. Select your final reference design before an
event; references guide composition/clothing, and the capture supplies identity.

The Windows helper can also load predefined assets/golf-reference.jpg and
assets/golf-outfit-reference.jpg. These event templates remain on the PC and
are loaded into memory when the local app opens or the website reconnects.
They contain the reusable design, not newly captured guest photographs.

Open /display in another window of the same browser profile and website origin,
move it to the large screen, and select Full screen. The current result is sent
through a browser BroadcastChannel; it clears with the guest session. A disconnected
or closed guest window also clears the display after at most ten seconds. This
is a local browser display connection, not a gallery available on other devices.

Hosted webcam Rehearsal can use the browser print dialog without the helper.
Because cancellation cannot be reliably detected, select **Done & clear photo**
after printing. Direct Windows helper printing clears automatically once the
spooler accepts the job; this does not confirm that paper has physically printed.

## Development

```powershell
npm test
npm run build
```

Tests use synthetic images, mock AI and simulated hardware, with no API charges.
They verify memory cleanup, stale response handling, signed requests, validation,
no automatic retries, equipment replay prevention and absence of guest image files.
Vite development proxies /api to the local server; run npm start separately.

[AGENTS.md](AGENTS.md) requests automatic commits after completed, tested coding
changes. It does not install a timer or commit unfinished file saves.

Keep settings/, old data/, api-key.local.mjs, real environment values, licensed
SDK binaries and generated builds out of Git. Never prefix an API key with VITE_.
