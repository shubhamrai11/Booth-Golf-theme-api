# Fairway Studio

Windows photo-booth software for a golf event. Capture a guest with a Canon camera or webcam, generate an AI golf portrait using saved scene and outfit references, apply event branding, and print or display the result with an individual QR download.

## Current build

This application runs on the Windows booth PC. The browser interface depends on the local Node server; it is not a standalone static website.

- Three-stage guest experience: welcome, capture/review, and finished portrait.
- Settings shortcut on welcome for camera and printer setup, with save-and-return navigation.
- Canon USB capture using a separately licensed Canon EDSDK, EOS Utility folder capture, or webcam capture.
- OpenAI image editing with the guest first, scene reference second, and optional outfit reference third.
- Sunburst / Max defaults, an editable event prompt, and no automatic paid retries.
- Placeholder branding, 1200 × 1800 output, Windows printing, and a separate large-screen display.
- Guest download links with configurable retention.

Physical Canon camera and printer operation still need validation on the event equipment. Facial likeness and anatomy require review before printing.

## Develop on Windows

Requirements: 64-bit Windows 10/11, Node.js 22 or newer, npm, and Windows PowerShell. Install the Windows driver for your event printer. Direct Canon capture additionally needs Canon's licensed 64-bit EDSDK; those files are not distributed here.

```powershell
npm ci
powershell -NoProfile -File scripts/build-native.ps1
npm run build
```

### Add your private reference photographs

The source repository excludes personal reference photographs. Before the first run, copy your approved JPEG templates into the `assets` directory with these exact names:

```text
assets/golf-reference.jpg
assets/golf-outfit-reference.jpg
```

The first image guides the setting and pose. The second guides an alternative clothing cut. Both are ignored by Git. This version requires both bundled files at startup; after startup, the optional outfit reference can be removed in Setup. Replace either through Setup as needed. Photos uploaded in Setup remain in the local `data` directory.

```powershell
npm test
npm start
```

Open:

| Page | Local address |
| --- | --- |
| Guest welcome and capture | http://127.0.0.1:4310/kiosk |
| Camera, printer and event setup | http://127.0.0.1:4310/?view=setup&from=kiosk |
| Operator sessions | http://127.0.0.1:4310/ |
| Large-screen display | http://127.0.0.1:4310/display |

Start in Rehearsal mode, which makes no paid AI request. For live generation, enter an API key locally in Setup, provide `OPENAI_API_KEY` in the server environment, or copy `api-key.example.mjs` to the ignored `api-key.local.mjs` file. Keep the key on the server, never in React source or a `VITE_` variable.

`npm run dev` starts the development interface with an API proxy to the separately running local server. The portable Windows package is built separately and includes a Node runtime; those generated binaries are not source files.

## Publishing and hosting

Publishing this repository to GitHub stores the source code. It does not start the Node server or connect an internet browser to the booth hardware.

[GitHub Pages is a static hosting service](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages). Deploying only `dist` there will not provide the `/api` routes, AI queue, photo storage, Canon capture, or printing required by this application. The current code is not configured for public hosting.

For the event booth, keep the Windows service beside the camera and printer. A hosted interface would need authenticated pairing with that service and a secure way to relay capture and print jobs. Alternatively, a service for remote guests using their own cameras needs a hosted backend, protected operator settings, guest-scoped sessions, persistent photo storage, a durable image-generation queue, and usage controls. Those hosting changes are not implemented in this build.

The existing operator service deliberately accepts only local requests. Do not remove its host/origin checks or expose operator port 4310 to the internet as a deployment shortcut. Guest port 4311 exposes token-scoped finished-photo downloads; public HTTPS download hosting is a separate configuration step.

## Source and private files

Tracked source includes `src`, `server`, `shared`, `tests`, native C# source, build scripts, and the generic golf interface artwork in `public/assets`.

The following remain local and must not be committed:

- `api-key.local.mjs`, environment files, and encrypted key files.
- `data/`, including captures, generated portraits, event configuration, and guest tokens.
- The personal reference JPEGs in `assets/`.
- `node_modules/`, generated builds, runtime binaries, and portable ZIP packages.

See [START-HERE.txt](START-HERE.txt) for detailed event operation and hardware setup.
