# Put your golf booth online

The source is at https://github.com/shubhamrai11/Booth-Golf-theme-api. You need your own Vercel and Supabase projects. API keys stay outside GitHub.

## 1. Create the private photo store

1. Open https://supabase.com/dashboard and create a project for this event.
2. Open **SQL Editor**. Copy [cloud/schema.sql](cloud/schema.sql) into a new query and run it.
3. This creates the settings, job/command tables and the private **booth-private** storage bucket. Leave the bucket private.
4. Find the project URL in **Connect** and the server **Secret key** in **Settings → API Keys**.

Use the current `sb_secret_...` key. Legacy service-role keys also work through `SUPABASE_SERVICE_ROLE_KEY`. See [Supabase's key instructions](https://supabase.com/docs/guides/getting-started/api-keys). Use a separate Supabase project for previews if you need to isolate test and event data.

## 2. Import the GitHub repository into Vercel

1. Open https://vercel.com/new and import **shubhamrai11/Booth-Golf-theme-api**.
2. Keep the root directory as the repository root. The committed configuration selects **Vite**, **npm run build:web** and **dist**. Use Node.js 22 or newer.
3. Deploy. A setup screen lists any missing server variables.
4. Copy your stable production address, such as `https://your-booth.vercel.app`. Use this for `BOOTH_PUBLIC_URL`, so event QR codes keep working after deployments.

## 3. Add the API key and settings

Open your Vercel project → **Settings → Environment Variables**. Add these exact names for **Production**, and also **Preview** if you need a working preview. Mark credentials **Secret** when that option is available.

| Name | Value |
| --- | --- |
| `OPENAI_API_KEY` | Your OpenAI API key, with image-model access and API billing |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SECRET_KEY` | Your private Supabase server secret key |
| `BOOTH_ADMIN_PASSWORD` | A private password with at least 12 characters |
| `BOOTH_SESSION_SECRET` | A separate random secret with at least 32 characters |
| `BOOTH_PUBLIC_URL` | Your stable Vercel HTTPS site address, with no path |
| `BOOTH_DEVICE_TOKEN` | A separate random token of 32–200 characters, without spaces; also enter this in Windows Setup |
| `BOOTH_AI_TIMEOUT_SECONDS` | `240` initially |

Generate the random secrets using a password manager. Do not paste values into chat, React code, GitHub or variables beginning with `VITE_`.

After saving, open **Deployments → latest deployment → Redeploy**. Changed variables apply to new deployments. See [Vercel's environment guide](https://vercel.com/docs/environment-variables).

### Longer Sunburst generations

The default function limit is 300 seconds; the AI timeout is 240 seconds to leave time for input downloads, framing and saving. Slow Sunburst / Max generations can exceed this budget.

On **Vercel Pro**, change `maxDuration` in `vercel.json` from `300` to `800`, set `BOOTH_AI_TIMEOUT_SECONDS=600`, and redeploy. Make both changes together. Hobby cannot use the 800-second limit. See [Vercel function limits](https://vercel.com/docs/functions/limitations).

A timeout does not prove the provider canceled or refunded the request. Failed jobs stay visible and require an explicit admin retry. There is no automatic paid retry.

## 4. Connect the Windows camera and printer

Use the updated Windows helper package, or build it with `npm ci`, `npm run build:windows`, and `npm start`.

The portable package opens **Fairway Cloud Helper.exe** at `http://127.0.0.1:4314`. It has camera, printer and pairing controls only; add the OpenAI key and reference images on Vercel. Its separate ports let you retain the existing local booth installation.

1. Start the Windows app on the PC attached to the Canon camera and printer.
2. In local **Setup**, select **Canon USB** and enter the licensed 64-bit Canon EDSDK folder, or select **EOS Utility** and enable monitoring of its JPEG download folder.
3. Select the Windows printer, configure its driver for 4×6-inch portrait paper, and save settings.
4. Under **Connect this Windows booth**, enter the Vercel website address and the same `BOOTH_DEVICE_TOKEN` used on Vercel.
5. Enable the connection and save. Cloud Setup should show **Windows booth connected** and the chosen printer.

Keep the app running during the event. It uses outbound HTTPS; no operator-port forwarding is needed. Direct Canon capture requires EOS Utility to be closed. Folder mode needs the operator/camera shutter to take the photo. After a restart, enable folder monitoring again. Device tokens are encrypted for the current Windows user.

## 5. Prepare and test the event

1. Open your Vercel site and sign in with `BOOTH_ADMIN_PASSWORD`.
2. Upload your golf reference and optional outfit reference in **Setup**, each under 4 MB. You can add your event branding later as a transparent PNG overlay.
3. Choose the same camera connection as the Windows app. Keep **Rehearsal** selected and save.
4. Click **Start guest mode & lock settings**. Admin controls now require the password again. Booth authorization lasts 12 hours.
5. Capture, review, generate the rehearsal frame, print one copy, and test the QR link on a phone using mobile data. Open `/display` on an authorized booth browser for the large screen.
6. Sign back into Setup, select **Live AI** once the API key and references are ready, save, and test one paid portrait before the event.

Guests only capture a photo. The guest photo supplies identity; references supply the scene and clothing.

## Recovery and retention

- Keep a booth screen or the helper running. Their polling advances the saved queue and deletes expired photos. Queued jobs wait if all disconnect.
- QR links expose only their finished portrait and expire after the configured retention period. Temporary storage links last 60 seconds.
- A successful print acknowledgment means Windows accepted the print job; check paper and printer errors on the PC to confirm physical printing.
- An interrupted hardware action is never re-executed automatically. Check whether it completed before issuing another command.
- Review provider billing before retrying a failed generation from **Sessions**.
- Private references are retained for queued snapshots. Original/result files are removed after expiry during polling. Stopping polling delays physical cleanup; expired photo links remain unavailable.
- Use one Supabase project per event. This is a single-event booth, not an anonymous public service that lets anyone spend your AI credits.

The code and local tests are prepared. Actual Vercel/Supabase execution, Canon capture, physical printing and a live generation still need verification after configuring your accounts.
