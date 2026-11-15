# Moon Racer

A 3D driving game in the browser. You start on a draggable map of the Moon, pick a circuit, and drive a supercar on a race track that floats above the lunar surface on rocket thrusters.

**Flow:** Moon map → dive to the circuit → showroom (choose a car) → timed laps against the ghost of your best lap.

## Play

| Key | What it does |
|---|---|
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake, then reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake |
| `C` | Switch between chase camera and cockpit view |
| `R` | Reset the car onto the track (voids the lap) |
| `T` | Restart the lap from the start lights |
| `M` | Sound on/off |
| `Esc` | Pause menu (resume, restart lap, ghost on/off, sound volume, change car, back to the map, clear best laps) |

### PS5 controller (DualSense)

Connect it by USB or Bluetooth, then press any button so the browser notices it. Works in Chrome, Edge and Safari (any "standard" controller works, such as Xbox).

| Button | What it does |
|---|---|
| `R2` / `L2` | Throttle / brake and reverse (pressure-sensitive) |
| Left stick | Steer |
| `□` Square | Handbrake |
| `△` Triangle | Chase or cockpit camera |
| Right stick | Chase camera: swing round the car (left/right) and over it (up). Let go and it glides back behind the car |
| `○` Circle | Reset onto the track. In menus: back |
| `Create` | Restart the lap |
| `Options` | Pause menu |
| D-pad, `✕` Cross | Move between buttons and change car; Cross confirms. On the volume slider, D-pad left/right changes the volume |

### Lap timing

- Press Drive: three red lights, then GO. The clock starts on GO. Lap 1 is a standing start, every lap after it is a flying lap.
- The start/finish line is the checkered strip on the main straight. Sector splits are at 1.1 km and 2.47 km. Each sector bar turns green (ahead of your best) or red (behind), and yellow for a new best lap.
- Falling off the edge or pressing reset makes the lap **void**: it is still timed but can't become your best.
- Your best lap is saved per car in the browser (`localStorage` key `moon-racer-v1`), with a **ghost**: a see-through cyan car that replays it. Switch it off in the pause menu.

### Sound

The Ferrari has engine sound: a startup click when you press Drive, idle on the start line (rev it with the throttle), then six recorded gears. An automatic gearbox shifts at about 83, 127, 170, 214 and 255 km/h; the gear shows next to the speed. Off the throttle the engine goes quieter and duller. The BYD is silent for now. Set the volume in the pause menu (remembered in `localStorage` key `moon-racer-settings`) or press `M` to mute. Browsers only allow sound after a click or key press on the page.

The track has no barriers: drive off the edge and you fall towards the Moon, then you are put back where you left.
On a phone you can use the map and the showroom. Drive switches on only when a game controller is connected.

## What is in it

- **Circuit:** Tranquility Circuit, 3.3 km, placed on the map at Tranquility Base (0.67° N, 23.47° E).
- **Cars:** BYD Yangwang U9 (500 km/h top speed) and Ferrari LaFerrari (300 km/h).
- **Physics:** simple arcade driving with normal Earth-like gravity (no Moon physics yet).
- **Time trial:** lap timer with three sectors, void laps, best lap and ghost per car.
- **Sound:** Ferrari engine (startup, idle, six gears with an automatic gearbox).

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
- `js/laps.js`: lap timing rules (countdown, line and split gates, void laps, best laps, ghost recording, saving). No 3D in it.
- `js/gamepad.js`: game controller input (PS5 DualSense layout).
- `js/engine-sound.js`: engine sound and the automatic gearbox (sound and gear readout only; it never changes how the car drives).
- `assets/audio/`: the Ferrari engine loops (WAV, so they loop with no gap) and the startup click.
- `js/sky.js`: stars, Earth and reflections.
- `assets/models/`: web-sized 3D models. `assets/data/track.json`: the track's edges.
- `tools/build_assets.py`: turns the original (large) asset files into the small web files above.
- `tools/make_engine_sounds.py`: turns the engine recordings into the loops in `assets/audio/` (plain Python and macOS `afconvert`).
- `tools/dev_server.py`: local preview server.

three.js 0.170.0 is loaded from jsDelivr (pinned in the import map in `index.html`).

## Rebuilding the assets

Only needed if a source model or the map changes. Needs Python 3 with `numpy` and `Pillow`, on a Mac (it uses `sips`):

```bash
python3 tools/build_assets.py "/path/to/the/folder/with/the/original/files"
```

The originals (about 300 MB, including a 241 MB map) are not in this repo.

## Releasing

Bump the `?v=NN` on `css/style.css` and `js/main.js` in `index.html`, and on the `game.js`, `laps.js`, `gamepad.js` and `engine-sound.js` imports inside the scripts, on every file that changed (now `?v=4`; `laps.js` is still `?v=3`).

## Testing in the browser console

- `__mr.debug.sim(seconds, {throttle: 1})` fast-forwards the physics.
- `__mr.debug.autoLap()` drives one lap on autopilot and reports where it left the road.
- `__engine.debug.live` shows the engine sound's current gear and volumes.
- `__mr.debug.timedLaps(2)` drives laps through the real lap timer (skips the countdown). At full pace the autopilot often drives off the edge, so its laps come out void.

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
| Ferrari engine sounds | recorded by the game's author, own work | steady 2-second stretch of each clip made into a loop, levels evened out |

The same list is in the game (Credits and licences, on the map screen) and in [CREDITS.md](CREDITS.md).

## Still to fill in

Everything marked `[in square brackets]` in the credits above: the authors and licences of four of the 3D models, the source of the Moon map. Update all three places together: this README, `CREDITS.md` and the Credits panel in `index.html`.
