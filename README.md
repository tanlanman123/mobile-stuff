# Stacky

A one-tap tower stacking game that installs to your phone's home screen (it's a Progressive Web App).

**How to play:** a block slides back and forth. Tap to drop it. Whatever hangs off the edge gets sliced off, so the tower gets narrower. Miss completely and it's game over. Line a block up perfectly to start a combo; after 3 perfects in a row, your blocks start growing back.

## Put it on your phone

1. In this repo on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the branch, folder `/ (root)`, and **Save**.
3. Wait a minute, then open `https://<your-username>.github.io/mobile-stuff/` on your phone.
4. Add it to your home screen:
   - **iPhone (Safari):** Share button → **Add to Home Screen**
   - **Android (Chrome):** ⋮ menu → **Install app** / **Add to Home screen**

It opens full-screen like a regular app and works offline after the first load.

## Running it locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Updating

After changing any file, bump `CACHE` in `sw.js` (e.g. `stacky-v2`) so installed copies pick up the new version.
