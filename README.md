# Moon Racer

A 3D driving game in the browser. You start on a draggable map of the Moon, pick a circuit, and drive a supercar on a race track that floats above the lunar surface on rocket thrusters.

**Flow:** Moon map → dive to the circuit → showroom (choose a car) → free drive.

## Play

| Key | What it does |
|---|---|
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake, then reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake |
| `C` | Switch between chase camera and cockpit view |
| `R` | Reset the car onto the track |
| `Esc` | Pause menu (resume, change car, back to the map) |

The track has no barriers: drive off the edge and you fall towards the Moon, then you are put back where you left.
Driving is keyboard only for now. On a phone you can use the map and the showroom, but not drive.

## What is in it

- **Circuit:** Tranquility Circuit, 3.3 km, placed on the map at Tranquility Base (0.67° N, 23.47° E).
- **Cars:** BYD Yangwang U9 (500 km/h top speed) and Ferrari LaFerrari (300 km/h).
- **Physics:** simple arcade driving with normal Earth-like gravity (no Moon physics yet).

## Run it on your computer

It is a static site with no build step. Because it loads 3D files, it must be opened through a local server, not by double-clicking `index.html`:

```bash
python3 tools/dev_server.py
```

Then open http://localhost:8768 in your browser.

## Files

- `index.html`, `css/style.css`: the page and all interface styling.
- `js/main.js`: the screens and how you move between them.
- `js/map.js`: the draggable Moon map (tiles in `assets/map/`).
- `js/game.js`: the 3D scene, thrusters, showroom, cameras and the frame loop.
- `js/track.js`: road markings, light strips, the drivable surface and where thrusters go.
- `js/cars.js`: the two cars and their settings (top speed, acceleration, grip, driver's eye position).
- `js/vehicle.js`: the driving physics.
- `js/sky.js`: stars, Earth and reflections.
- `assets/models/`: web-sized 3D models. `assets/data/track.json`: the track's edges.
- `tools/build_assets.py`: turns the original (large) asset files into the small web files above.
- `tools/dev_server.py`: local preview server.

three.js 0.170.0 is loaded from jsDelivr (pinned in the import map in `index.html`).

## Rebuilding the assets

Only needed if a source model or the map changes. Needs Python 3 with `numpy` and `Pillow`, on a Mac (it uses `sips`):

```bash
python3 tools/build_assets.py "/path/to/the/folder/with/the/original/files"
```

The originals (about 300 MB, including a 241 MB map) are not in this repo.

## Releasing

Bump the `?v=NN` on `css/style.css` and `js/main.js` in `index.html` with every release (now `?v=2`).

## Credits

Moon Racer is a personal, non-commercial fan project. It is not affiliated with or endorsed by BYD, Ferrari or NASA.

| Asset | Author and licence | Changes |
|---|---|---|
| BYD Yangwang U9 | Ddiaz Design, via Sketchfab, [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) | none |
| Ferrari LaFerrari (2013) | [Author and licence — to be supplied] | none |
| Race track "C .001, 3.3 km" | [Author and licence — to be supplied] | faces corrected, road rebuilt with markings |
| "BIII-5 Military Thruster" | [Author and licence — to be supplied] | textures shrunk, painted "05" removed |
| Moon surface terrain | [Author and licence — to be supplied] | file size reduced |
| Moon colour map | [Source to be confirmed] | colours darkened, cut into tiles |

The same list is in the game (Credits and licences, on the map screen) and in [CREDITS.md](CREDITS.md).

## Still to fill in

Everything marked `[in square brackets]` in the credits above: the authors and licences of four of the 3D models, and the source of the Moon map. Update all three places together: this README, `CREDITS.md` and the Credits panel in `index.html`.
