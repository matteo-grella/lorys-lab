# Turning Lory's Lab into an iPhone / iPad app

Two routes exist. Pick based on what you want:

| | **Route A — Home-Screen web app** | **Route B — Capacitor native app (recommended)** |
|---|---|---|
| Feels like an app | ✓ (fullscreen icon on home screen) | ✓✓ (real app) |
| App Store | ✗ | ✓ (also TestFlight for family/testing) |
| Requires a Mac + Xcode | No | Yes |
| Requires hosting the file on a website | Yes (any static host) | No |
| Apple developer account ($99/yr) | No | Only for App Store/TestFlight; free account works for installing on your own devices (7-day re-sign) |
| Save persistence (progress + created puzzles) | Good, with caveats (see A.3) | **Guaranteed** via the storage bridge (see B.4) |
| Offline | ✓ (single file, after adding a service worker) | ✓ (bundled) |
| Effort | ~30 minutes | ~2–3 hours first time |

The game is already mobile-ready: pointer/touch events with `touch-action:none`,
uniform scaling to any screen, audio unlocking on first tap (required by iOS),
44px+ touch targets, and iOS meta tags (`apple-mobile-web-app-capable`,
`viewport-fit=cover`) are in `index.html`. **Nothing about gameplay needs to change.**

---

## Route A — Home-Screen web app (no Mac, no App Store)

### A.1 Host the file

Put `dist/lorys-lab.html` on any static host, renamed to `index.html`.
Easiest: a GitHub repository with GitHub Pages enabled (Settings → Pages →
deploy from branch). Result: `https://<you>.github.io/<repo>/`.

### A.2 Install on the device

On the iPhone/iPad, open the URL **in Safari** → Share button → **"Add to Home
Screen"**. The meta tags already make it launch fullscreen (no Safari chrome)
with the game's name and warm cream theme.

### A.3 Persistence — what to know

- A Home-Screen web app gets its **own storage container**, separate from
  Safari, and it is **exempt from Safari's 7-day inactivity storage eviction**
  (that rule targets regular browsing). Progress and created puzzles persist
  across launches in normal use.
- However, iOS may still purge web-app storage **under severe disk pressure**,
  and **deleting the icon deletes the data**. There is no backup. That is the
  honest limit of Route A — acceptable for casual play, not for a kid's
   6-month puzzle collection.
- The game already warns visibly if storage is blocked entirely (private
  mode / misconfigured host): the `persist()` wrapper shows a one-time toast.

### A.4 Optional: make it installable offline (PWA)

Add next to `index.html` on the host:

1. `manifest.json`:
   ```json
   {
     "name": "Lory's Lab", "short_name": "Lory's Lab",
     "display": "fullscreen", "orientation": "landscape",
     "background_color": "#FBF1DE", "theme_color": "#FBF1DE",
     "start_url": ".", "icons": [
       { "src": "icon-180.png", "sizes": "180x180", "type": "image/png" },
       { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
     ]
   }
   ```
2. A minimal service worker `sw.js` (cache-first for `.`):
   ```js
   self.addEventListener('install', e => e.waitUntil(
     caches.open('lorys-v1').then(c => c.addAll(['.']))));
   self.addEventListener('fetch', e => e.respondWith(
     caches.match(e.request).then(r => r || fetch(e.request))));
   ```
3. In the HTML `<head>`: `<link rel="manifest" href="manifest.json">`,
   `<link rel="apple-touch-icon" href="icon-180.png">`, and before `</body>`:
   `<script>navigator.serviceWorker && navigator.serviceWorker.register('sw.js')</script>`.
4. Icons: export two PNGs of Lory (the title-screen mascot at 2.4× scale on the
   cream background works well) at 180×180 and 512×512.

---

## Route B — Capacitor native app (recommended)

[Capacitor](https://capacitorjs.com) wraps the game in a real iOS app: a
WKWebView loading the bundled file from disk, with native plugins for storage.
One codebase → the exact same game, now an app. Requirements: a Mac with Xcode
(free), Node (already used by this project).

### B.1 Project setup (one time)

```bash
cd lorys-lab
npm init -y                       # if package.json doesn't exist yet
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/preferences

# Capacitor serves a folder; give it one containing the game as index.html
node build.mjs
mkdir -p www && cp dist/lorys-lab.html www/index.html

npx cap init "Lorys Lab" "com.yourname.loryslab" --web-dir=www
npx cap add ios
```

### B.2 The build loop (every iteration)

```bash
node build.mjs && cp dist/lorys-lab.html www/index.html && npx cap sync ios
npx cap open ios      # opens Xcode; then Run ▶ on a simulator or plugged-in device
```

Add a `package.json` script so agents/humans can't forget the copy step:

```json
"scripts": { "ios": "node build.mjs && cp dist/lorys-lab.html www/index.html && npx cap sync ios" }
```

### B.3 Xcode configuration (once, in the opened project)

- **Deployment Info** → check iPhone + iPad; **Device Orientation**: Landscape
  Left + Landscape Right only (the game is a 1280×830 landscape board; portrait
  would waste half the screen).
- **Signing & Capabilities** → select your Apple ID team (a free account is
  enough to install on your own devices).
- **App icons**: `Assets.xcassets → AppIcon` — drop in Lory renders
  (1024×1024 master; Xcode 14+ generates the rest).
- In `ios/App/App/Info.plist` add
  `<key>UIRequiresFullScreen</key><true/>` (avoids iPad Split View squeezing
  the canvas) — optional but recommended for a kids' game.

### B.4 Guaranteed persistence — the storage bridge

**This is the important part.** Inside an app's WKWebView, `localStorage`
lives in the app container and normally persists — but Apple documents it as
*purgeable* under storage pressure, and "Offload App" clears it. For a
guaranteed store, bridge the game's saves to the native **Preferences** plugin
(UserDefaults-backed, never purged while the app is installed).

The game already exposes the hook: `src/game.js` reads
**`window.LoryStorage = { get(key), set(key, value) }`** (synchronous) if it
exists *before* the game scripts run, and falls back to `localStorage`
otherwise. The pattern: hydrate a cache from Preferences before injecting the
game, write-through asynchronously afterwards.

Concretely, edit `www/index.html`: wrap the game's `<script>` blocks in a
loader (or simpler — add this **before** the first game script):

```html
<script type="module">
  import { Preferences } from '@capacitor/preferences';
  const KEY = 'lorys-lab-save-v1';
  const { value } = await Preferences.get({ key: KEY });   // hydrate first
  const cache = { [KEY]: value };
  window.LoryStorage = {
    get: (k) => cache[k] ?? null,
    set: (k, v) => { cache[k] = v; Preferences.set({ key: k, value: v }); },
  };
  // now load the game (move the game <script> tags into a dynamically
  // inserted script, or mark them type="module" so this runs first)
</script>
```

Simplest robust wiring given our single-file build: in `build.mjs`, emit the
game body as a separate `www/game.js` file and have `www/index.html` load the
storage shim first, then `<script src="game.js">`. (A 10-line change to
build.mjs — follow the pattern of the existing artifact variant.)

Because `Preferences.set` is async while the game's `set` is sync, the cache
absorbs the difference; the flush completes in the background. Data lives in
UserDefaults → survives OS storage pressure, app updates, and reboots. It is
also included in device backups (so a new iPad restores the puzzles).

### B.5 iOS-specific checks (all already handled, verify after wrapping)

- **Audio**: WKWebView requires a user gesture to start audio — the game
  already unlocks on first `pointerdown`, and suspends/resumes on visibility
  change. Optionally set `WKWebViewConfiguration.allowsInlineMediaPlayback`
  (Capacitor default is fine).
- **No zoom / no scroll bounce**: `user-scalable=no`, `touch-action:none` on
  the canvas, and `overflow:hidden` are already in place. If you see rubber-
  banding, set `webView.scrollView.bounces = false` in `AppDelegate` or via
  Capacitor config `ios: { scrollEnabled: false }`.
- **Safe areas** (notch/home indicator): `viewport-fit=cover` is set; the
  board is centered with letterboxing so nothing sits under the notch in
  landscape. If the home-indicator overlaps the tray on some devices, pad
  `#app` with `env(safe-area-inset-bottom)`.
- **Performance**: the game is a single canvas at ≤2× DPR with capped
  particles — it runs 60 fps on any iPad that runs iOS 15+. No changes needed.

### B.6 Shipping

- **Your own devices**: Xcode Run with a free Apple ID (re-install weekly) or
  a $99 account for 1-year provisioning.
- **Family/testers**: archive (Product → Archive) → upload → **TestFlight**.
- **App Store**: same archive → App Store Connect. For a kids' game note:
  Kids Category rules (no tracking, no external links without a parental
  gate) — this game has zero network calls, zero ads, zero tracking, so it is
  already compliant; you only need store metadata + screenshots.

### B.7 Android, for free

The identical setup works for Android: `npm i @capacitor/android`,
`npx cap add android`, open in Android Studio. The storage bridge code is
platform-neutral (Preferences maps to SharedPreferences).

---

## Summary of code hooks relevant to native wrapping

| Hook | Where | Purpose |
|---|---|---|
| `window.LoryStorage {get,set}` | inject before game scripts | redirect saves to native storage (B.4) |
| `persist()` warning toast | `src/game.js` | visible alert if storage is blocked |
| iOS meta tags | `index.html` (both dist builds inherit them) | fullscreen, status bar, home-screen title |
| Audio unlock on gesture + visibility suspend | `src/audio.js` / `src/game.js` | iOS audio policy compliance |
| `window.__loryDebug.state` | `src/game.js` | E2E assertions inside the wrapped app too |
