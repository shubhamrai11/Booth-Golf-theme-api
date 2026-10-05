# Fairway Studio

Golf photo booth for Windows with a Vercel website and a Windows camera/printer helper. Guest flow: **Capture → Review → Generate → Display → Print / QR download**. Guests have no upload option.

## Vercel deployment

Follow [VERCEL-SETUP.md](VERCEL-SETUP.md). Vercel hosts the interface and authenticated server API; Supabase stores event settings, jobs, Windows commands and private photos. OpenAI image editing runs on the server. The Windows app receives commands over outbound HTTPS for Canon capture and printing.

New installations start in **Rehearsal**, with no AI charges. Upload references in Setup before enabling Live AI. Sunburst / Max / 1536 × 2304 remain the defaults; the final branded print is 1200 × 1800. The guest supplies identity; the main and optional outfit references guide the scene and clothing.

Admin login protects settings and paid retries. **Start guest mode & lock settings** authorizes this booth browser for 12 hours, then locks admin controls. Public guests receive only an unguessable, expiring link to their finished portrait.

Generation approvals and hardware commands are saved before execution. Database claims allow one active generation per booth. Failed/interrupted AI jobs are never automatically retried. Review provider billing before an explicit retry. The Windows helper keeps a command ledger: a lost upload or acknowledgment cannot repeat a shutter release or print. A restart during an uncertain hardware action reports failure for operator review.

The queue advances while a booth screen polls or the Windows helper sends heartbeats. If all disconnect, queued jobs wait until one reconnects. Expired links stop working immediately; physical photo deletion resumes during polling. Reference assets are retained for queued snapshots. Use one Supabase project per event.

## Windows camera and printer

Requirements: 64-bit Windows 10/11, Node.js 22+, npm, PowerShell and the printer's Windows driver. Direct Canon capture requires your licensed 64-bit Canon EDSDK; it is not distributed here.

```powershell
npm ci
npm run build:windows
npm start
```

Open `http://127.0.0.1:4310/?view=setup`. Configure the Canon SDK or EOS Utility folder and printer; save settings. Under **Connect this Windows booth**, enter the Vercel address and the same `BOOTH_DEVICE_TOKEN` saved on Vercel. Enable it and keep the app running. Device credentials use Windows user encryption.

When the cloud helper is enabled, generate from the cloud screen. Local capture does not automatically generate additional copies. Folder monitoring must be enabled again after a restart; existing photos are ignored. Direct Canon capture has no live preview and shows the photo after capture.

The app also operates locally with the helper disabled. Upload references in Setup and save a local API key there, use `OPENAI_API_KEY` in the local environment, or use the ignored `api-key.local.mjs`. Rehearsal works without references. Optional preloaded personal templates in `assets/golf-reference.jpg` and `assets/golf-outfit-reference.jpg` remain excluded from Git.

| Screen | Route |
| --- | --- |
| Guest capture | `/kiosk` |
| Admin setup | `/?view=setup` |
| Operator sessions | `/` |
| Large screen | `/display` |
| Individual download | `/p/<token>` |

Locally, operator pages use port 4310; guest download links use 4311 and require booth Wi-Fi or configured guest-only HTTPS forwarding. Cloud QR downloads work over mobile data or Wi-Fi. Do not expose local operator port 4310 to the internet.

## Development and verification

```powershell
npm test
npm run build
```

Tests use synthetic images and a mock AI provider. The schema runs in local PostgreSQL via PGlite to verify queue claims, leases, grants and command expiry. Tests do not spend API credits or use real hardware.

`npm run build:web` builds the Vercel frontend; Vercel bundles `api/index.js` and its cloud dependencies separately. `npm run dev` uses the local API proxy; run `npm start` separately. Native executables and portable runtimes are built separately and ignored by Git.

Actual Vercel/Supabase operation, Canon capture, physical print quality and live OpenAI generation require an end-to-end test after account configuration. Review facial likeness and anatomy before printing.

## Private files

Do not commit real environment values, `api-key.local.mjs`, encrypted credentials, Canon SDK binaries or `data/`. Data includes photos, settings, guest tokens and the local command ledger. Never use `VITE_` for server secrets. The example environment file contains names only.

See [START-HERE.txt](START-HERE.txt) for additional local hardware instructions.
