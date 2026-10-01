# COSMOS — procedural universe explorer (Three.js · WebGPU · WGSL)

A mobile-first, fully procedural space-exploration simulator. No ships, no catalogues, no real
star data — everything (galaxy clusters, galaxies, nebulae, stars, planets, moons, asteroid belts,
black holes, pulsars…) is generated deterministically from coordinates, so **every location is
reproducible, shareable and saveable**.

Open `index.html` through any static server (it is a plain GitHub Pages site, no build step):

```
python3 -m http.server 8000     # then open http://localhost:8000
```

Requires **WebGPU** (Chrome / Edge on Android and desktop, Safari 26+ on iOS). Designed for
high-end phones; the render scale adapts automatically to hold the frame rate.

## Scales and what lives at each

| Scale | Renderer | Contents |
|---|---|---|
| Cosmic web (Mpc) | instanced WGSL galaxy sprites + far-field dust | filaments, voids, galaxy clusters; every galaxy is a perspective-correct thin disc / ellipsoid raytraced from its own orientation |
| Galaxy (kpc–pc) | ~170k-particle cloud, dust lanes, streamed star cells, ray-marched nebulae | spirals (2–6 arms, bars, rings), ellipticals, lenticulars, irregulars, dwarfs, AGN jets, supermassive black hole |
| Star system (AU–km) | WGSL planets/stars, cube-sphere LOD terrain | single / binary / triple stars, BH + star, neutron star + star, pulsars, planets, moons, tiny irregular moons, rings, belts |
| Surface | worker-generated chunks, 33×33 quadtree LOD to ~6 m spacing | multi-octave detail + bump mapping, oceans, ice caps, craters, lava fields, atmospheres |

## Navigation

* **Drag** – look (free flight) / orbit (when a target is focused). **Pinch** (or wheel) – dolly; the step is
  proportional to the distance to the nearest surface, so one gesture works from clusters to mountains.
* **Twist** – roll. **Joystick** – fly (forward/back/strafe), ▲▼ rise/sink, ⚡ boost. Speed is automatically
  scaled to the nearest object; pushing the stick leaves orbit mode.
* **Tap** an object to select it, **double-tap** or *Fly to* to travel. Travel is a single seamless
  log-distance glide through galaxy → star → planet frames (floating-origin, double precision on the CPU).
* Near a planet the camera co-rotates with the surface and levels the horizon.

## Features

* Time playback: pause, reverse, 1× → years per second. Orbits are deterministic Kepler ellipses, spins and
  tidal locking are exact; no N-body.
* Stats panel for every object (galaxy, cluster, black hole, nebula, system, star, planet, moon, belt).
* Star-system explorer (tree: stars → planets → moons → belts) + “Nearby” list.
* Favourites that capture position **and** orientation, with instant autosave to `localStorage`; the app also
  resumes the previous session and can share a location as a link (`#loc=…`).
* “Discover” jumps to a living world, ringed giant, binary, black hole + star, pulsar, white dwarf, nebula, …

## WGSL shader inventory (`js/shaders`)

`lib.js` (PCG hashing, gradient noise, fbm, ridged, Voronoi, blackbody, Rayleigh/Mie atmosphere),
`bodies.js` (rocky planets with 9 biomes, gas giants with differential rotation and storms, cloud shells,
atmosphere shell, ring system with shadows, convective star surfaces, corona/glare), `galaxy.js`
(galaxy sprites, nebula ray-marcher: emission / reflection / dark / planetary / supernova remnant, jets),
`post.js` (Schwarzschild null-geodesic black-hole lens with Doppler-beamed accretion disc, tone-map composite).

## Layout

```
index.html  css/style.css
js/core.js          constants, RNG, Kepler, formatting
js/noise.js         CPU simplex / fbm / craters (worker + collision)
js/terrain*.js      height function, cube-sphere chunk builder, worker
js/gen/             cosmos, galaxy, system generators
js/entities.js      id-addressable entity graph (resolvable for favourites)
js/world.js         time, camera, anchors, travel, orbit, collisions
js/render/          engine (HDR RT + lens + bloom), cosmos / galaxy / system views, LOD
js/ui.js, stats.js, store.js, input.js, main.js
vendor/             three.js r186 WebGPU build (+ BloomNode)
```
