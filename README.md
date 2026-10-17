# 67 Arcade

A little collection of games that installs to your phone's home screen (it's a Progressive Web App). Opening the app shows a home screen of games; tap one to play, and use the ← button to get back.

## Games

### Stacky (`stacky/`)

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

### Physics (`physics/`)

A sandbox running a small physics engine written from scratch (`physics/engine.js`, no libraries).

- **Tap empty space** to drop the selected shape: ball, box, plank, triangle or hexagon.
- **Size / Mass / Bounce** sliders set what the next shape will be. The sliders cover everyday sizes and masses; **type any size or mass** into the boxes next to them (e.g. size `5000`, mass `1000000000`). Darker shapes are heavier.
- **10,000 kg or more** and a shape becomes an attractor: it glows and pulls everything toward it like a planet. Set Gravity to 0% and turn Walls off to make orbits.
- **Drag a shape** to carry or throw it. Heavy things are hard to lift.
- **✕ tool** erases shapes you tap or swipe over.
- **Gravity** slider sets how strong gravity is, from 0% (floating) to 300%.
- **Pinch** with two fingers to zoom and pan (or use the + / − / ⌂ buttons). You can zoom out as far as you like.
- **Walls** button removes the room for open, endless space.
- **Tilt** button makes gravity follow your phone, so you can pour things around. It calibrates when you turn it on, so hold the phone upright at that moment.

Engine features: circles and convex polygons, friction, restitution, warm-started impulse solver with substeps, shock propagation and mass-ratio limiting for stable stacks of very different masses, and sleeping for piles at rest, and inverse-square attraction toward heavy bodies.

### Cars (`cars/`)

**How to play:** drag left and right anywhere on the screen to steer (or use the arrow keys / A and D). Dodge the traffic. You start at 60 mph and keep speeding up, and traffic gets denser the faster you go. Your score is the miles you've driven; hit a car and it's over. There's always at least one open lane.

## Adding a game

1. Put it in its own folder, e.g. `newgame/index.html`.
2. Add a tile for it in the grid in the top-level `index.html`.
3. Add its files to `FILES` in `sw.js` so it works offline.

## Updating

After changing any file, bump `CACHE` in `sw.js` (e.g. `arcade-v3`) so installed copies pick up the new version.
