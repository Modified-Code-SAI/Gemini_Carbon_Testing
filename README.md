# IRON DELUGE — Tactical Armored Mech Arena Combat

**Live on GitHub Pages:** [https://modified-code-sai.github.io/Gemini_Carbon_Testing/](https://modified-code-sai.github.io/Gemini_Carbon_Testing/)

**IRON DELUGE** is a browser-native AAA-inspired 3D third-person armored mech combat showcase built with **WebGL2, Three.js PBR, and custom GLSL shaders**. Pilot `AC-04 VANGUARD` knee-deep across a flooded brutalist concrete colosseum amidst dynamic monsoon storms, supercell lightning flashes, and golden-amber storm breaches while shattering reinforced concrete pillars and unleashing multi-lock corkscrew missile salvos.

## Visual & Technical Highlights

- **Linear-HDR ACES Filmic Pipeline (`PostPipeline.js`)**: Multisampled `HalfFloatType` render targets feeding `UnrealBloomPass`, custom linear-HDR boost velocity radial streaks, chromatic impact dispersion, peripheral wet-optic droplet refraction, and Contrast-Adaptive Sharpening (`CAS`).
- **Real-Time Planar Reflective Floodwater (`WaterSystem.js`)**: Custom GLSL water shader blending oblique/clipped planar scene reflections, rain surface micro-rings, Schlick Fresnel, and a **32-slot interactive shockwave ripple buffer** driven by mech footsteps, hydro-skate wakes, tumbling concrete rubble, and boiling boss laser beams.
- **Dynamic Weather & Atmospheric PMREM Lighting (`WeatherSystem.js`)**: Transitions seamlessly between **Monsoon Squall**, **Amber Storm Breach** (volumetric god-ray shafts), and **Supercell Tempest** (fork lightning casting directional shadows + delayed procedural thunder) with 12,000 zero-CPU-overhead GPU-instanced rain streaks.
- **Multi-Stage Destructible Brutalist Cover (`ArenaWorld.js`)**: Reinforced concrete columns and bunkers chip to expose rusted steel rebar before collapsing into physics-driven tumbling rubble chunks that splash into the floodwater.
- **Articulated Heavy Bipedal Mech Rig (`MechRig.js`)**: Procedural stride kinematics, crouched ankle-thruster hydro-skating, spinning 6-barrel rotary minigun, hinged VLS shoulder missile pods, and opening molten-amber thermal radiator fins.
- **Zero-Asset Procedural Spatial WebAudio (`AudioEngine.js`)**: Real-time synthesized monsoon rain wash, jet turbine whine, hydraulic footsteps, rotary cannon punch, railgun supersonic crack, and tactical radar lock chirps.
- **Adaptive & Manual Quality Scaler (`QualityManager.js`)**: Defaults to **ULTRA** with live rolling FPS monitoring and instant `[1] ULTRA` / `[2] HIGH` / `[3] BALANCED` switching.

## Controls

| Input | Action |
| :--- | :--- |
| `W A S D` / Left Stick | Heavy Bipedal Stride / Directional Movement |
| `Mouse` / Right Stick | Gimbal Camera & Upper-Torso Aim Tracking |
| `Shift` (Tap / Hold) | Explosive Quick-Boost Dodge / Continuous Hydro-Skate |
| `Space` | Vertical Assault Jump & Sustained Hover Jets |
| `Left Click` | GAU-9 30mm Rotary Autocannon |
| `Right Click` (Hold) | HV-88 Hyper-Velocity Piercing Tungsten Rail-Cannon |
| `Q` or `E` (Hold & Release) | VLS-12 Multi-Lock Corkscrew Micro-Missile Barrage |
| `F` | AEGIS Pulse Armor EMP Shockwave (Vaporizes Incoming Missiles) |
| `1 / 2 / 3` | Instant Graphics Tier Switch (`ULTRA` / `HIGH` / `BALANCED`) |
| `P` / `ESC` | Tactical Pause & Settings Menu |

## Running Locally

Because Three.js and all PBR textures are self-contained in the repository via standard `<script type="importmap">`, no build step is required:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/` in any modern desktop browser.