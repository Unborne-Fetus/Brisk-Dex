## License

Brisk Dex's original source code is licensed under the **PolyForm Noncommercial License 1.0.0**.

You are free to study, modify, and redistribute the software for noncommercial purposes, including personal learning, research, experimentation, and hobby projects.

**Commercial use is not permitted under this license.** This includes using Brisk Dex or derivative works for commercial purposes or selling copies or derivative versions.

Pokémon-related names, assets, artwork, game data, trademarks, and other material belonging to third parties are **not** licensed by this notice and remain the property of their respective owners.

See the `LICENSE` file for the complete license terms.



Made with Claude vibe coding


# Brisk Dex Desktop

The desktop build of Brisk Dex — the companion app for Pokémon Brisk Emerald.
This reads and edits `.sav` files directly on disk (with automatic timestamped
backups) and keeps an external Pokémon storage file independent of any single save.

External storage is available before opening a save file. It can be searched and
sorted, exported as a portable JSON archive, and merged from a previously exported
archive. Deposits are written to the archive before the source Pokémon is removed.
Desktop withdrawals remain archived until the updated save has been written; in
the browser build the archive copy is retained after download so it can be removed
after the downloaded save is safely in place.

## What you need first

- **Node.js** (LTS, v18 or newer). If you don't have it: https://nodejs.org
  Check you have it with:
  ```
  node -v
  ```

## Build it (one click)

- **Windows:** double-click `build.bat`.
- **Mac/Linux:** double-click `build.sh` (or run `./build.sh` in a terminal —
  you may need to right-click → "Open" the first time on macOS to get past
  Gatekeeper, or run `chmod +x build.sh` once on Linux).

Either script installs everything needed and builds the installer for you —
no typing npm commands required. The finished installer lands in `dist/`.
Remember: this build step is only for you, the developer. The players who
download the resulting `.exe` never need Node, npm, or any of this — they
just run the installer.

## Build it manually (if you'd rather run the steps yourself)

Open a terminal in this folder and run:

```bash
npm install
```

That downloads Electron and electron-builder (this step needs internet access
and may take a few minutes the first time).

To just try the app without building an installer:

```bash
npm start
```

To build the actual installer:

```bash
npm run dist
```

The output lands in `dist/`. On Windows this produces an NSIS installer
(`Brisk Dex Setup 1.0.0.exe`) — run it to install the app like any other
Windows program, with a Start Menu shortcut and everything.

### Building the Windows .exe from macOS or Linux

`electron-builder` can cross-build a Windows installer from macOS or Linux,
but it needs **Wine** installed on that machine:

```bash
npm run dist:win
```

If you're on Windows itself, `npm run dist` (or `npm run dist:win`) just works
with no extra setup.

### Other platforms

```bash
npm run dist:mac     # macOS .dmg (must be run on macOS)
npm run dist:linux    # Linux AppImage
```

## Getting your real Brisk Emerald data (species, moves, abilities, items, icons)

Brisk Dex includes a species, move, ability, item, growth-rate, and icon snapshot
extracted from the Brisk Emerald source. The Electron app loads this data on
startup, so the displayed species and ability names match the game. Rebuild the
snapshot after changing game data with:

```bash
python3 tools/extract_data.py /path/to/your/Pokemon-Brisk-Emerald/checkout
```

(No dependencies beyond Python 3 — it only reads the game source.) It updates
these files in the Brisk Dex folder:

- `brisk-dex-data.json` — species names/types/abilities/growth rates, move names,
  ability names, and item names, all pulled straight from `include/constants/*.h`
  and `src/data/*.h` files.
- `brisk-dex-icons/` — icon art selected from each species' `.iconSprite` field,
  plus form-specific shiny sprite sheets generated from Brisk Emerald's palettes.
- `brisk-dex-trainers/` — male and female player sprite sheets used for the save's
  trainer portrait.

Desktop builds bundle those files and load them on startup. In the browser version:

1. **Load species/move data** → pick `brisk-dex-data.json`. This overrides/extends
   the built-in vanilla baseline with your real data (custom species keep their
   real name/types/abilities; move and item names appear instead of "Move #45").
2. **Load icon folder** → pick the `brisk-dex-icons` folder. Do this *after*
   step 1, so icon files get matched to the right species IDs. (You can also
   point this directly at your repo's `graphics/pokemon` folder instead of the
   extracted copy — Brisk Dex will match subfolder names to species constants
   on its own.)

If your repo's file layout doesn't quite match what the script expects (e.g.
you've moved `species_info.h` somewhere nonstandard, or a version of expansion
changed the struct field names), it'll still write out whatever it could match
and print counts + a warning — share those details and I can adjust the script.

The app crops the first frame from each two-frame animated icon sheet. It uses
separate icons for forms when the source provides them. Shiny icon files named
`<speciesId>_shiny.png` are used when available; otherwise the app applies a shiny
tint. Brisk Emerald's current source does not include separate shiny icon sheets.

Box Pokémon levels use the species growth curve from this data. The parser also
handles Brisk Emerald's packed species, item, experience, move, and ability fields.



- `main.js` — the Electron main process. Opens native file dialogs, reads/writes
  the `.sav` file on disk, and stores external Pokémon storage as a JSON file
  in your OS's app-data folder.
- `preload.js` — exposes a small, safe `window.briskDexAPI` to the app (no raw
  Node/filesystem access is given to the page itself).
- `index.html` — the entire app (UI + Gen III save parser). This is the exact
  same file used by the browser/web version of Brisk Dex, so both stay in sync.

## Safety notes

- Every time you save changes to a `.sav` file, the app first copies your
  existing file to `<name>.backup-<timestamp>.sav` in the same folder, then
  writes the new version. If anything ever looks wrong, restore from that
  backup.
- External storage lives at (OS-dependent app data folder)/Brisk Dex/briskdex-storage.json,
  independent of any game save — that's what lets you deposit from one save
  file and withdraw into a different one for cross-save trading.


## Linux

Brisk Dex can be built as either a portable AppImage or a Debian package.

### Download from GitHub Actions

Open the repository's **Actions** tab, select **Build Linux**, open the latest successful run, and download the **Brisk-Dex-Linux** artifact. It contains:

- `Brisk Dex-1.0.0-linux-x64.AppImage`
- `Brisk Dex-1.0.0-linux-x64.deb`

For the AppImage:

```bash
chmod +x "Brisk Dex-1.0.0-linux-x64.AppImage"
./"Brisk Dex-1.0.0-linux-x64.AppImage"
```

For Debian/Ubuntu-based systems:

```bash
sudo apt install ./"Brisk Dex-1.0.0-linux-x64.deb"
```

### Build locally on Linux

Install Node.js 20 or newer, then run:

```bash
npm ci
npm run dist:linux
```

The generated AppImage and Debian package will be placed in `dist/`.


## Online Battles

Brisk Dex includes a private Host / Join battle mode that uses the party from each player's loaded Brisk Emerald save.

### Local test

Run the app and battle relay in separate terminals:

```bash
npm start
npm run battle-server
```

The default relay is `http://localhost:8787`. Open a second Brisk Dex window, host a room in one window, and join its six-character code in the other.

### Internet play

The relay in `battle-server.js` must be hosted at a publicly reachable HTTPS address. Both players enter that same address in the Online Battle tab. The relay is server-authoritative: clients submit choices while the server resolves turn order, RNG, damage, status, field effects, switching, and victory.

The current advanced simulator supports singles, six-Pokémon teams, PP, priority, accuracy/evasion stages, stat stages, major status conditions, confusion, flinching, Protect-family moves, common setup/recovery moves, recoil/draining moves, hazards, screens, Tailwind, weather, terrain, STAB, type effectiveness, critical hits, switching, common ability effects, and common held-item effects. Mechanics without a handler are reported in the battle log rather than silently pretending to work.

Room/player tokens are kept in session storage so an accidental tab refresh can reconnect while the relay still holds the room. Relay rooms expire after six hours of inactivity.


### Advanced battle engine v18

Online battles now use a selectable team of up to six Pokémon drawn from the loaded save's Party, any PC box, or Brisk Dex External Storage. Boxed and external Pokémon have battle stats reconstructed from their Brisk species data plus their actual IVs, EVs, nature, experience/level, moves, ability slot, held item, and Tera Type. The team picker includes storage-source filters and search.

Pokédex animated sprites replay every 1 second.

The simulator is server-authoritative and increasingly source-driven. Brisk Dex extracts move effect names, move flags, critical-hit stages, multi-hit metadata, and secondary MOVE_EFFECT data directly from Pokémon Brisk Emerald's current source. `brisk-battle-effects.json` is regenerated from Brisk Emerald and provides a finite parity checklist for 934 moves and their primary/secondary effect families.

The v18 engine includes the previous damage/status/weather/terrain/hazard/gimmick systems plus broad primary and secondary effect handling, variable-power/type/category families, called-move mechanics, Transform/Imposter, rooms, move locks, trapping, delayed effects, common competitive items and abilities, Counter/Mirror Coat tracking, Magic Coat, Imprison, Mimic, Last Resort, Snore, Synchronoise, Upper Hand, and many signature move families.

The manifest makes remaining parity work measurable, but exact 100% pokeemerald-expansion/Brisk Emerald parity should only be claimed after every manifest effect plus ability/item interaction is verified by tests against the game engine.

The generated Brisk battle manifest currently contains 279 primary move-effect families and 87 secondary MOVE_EFFECT families. The v18 server has direct coverage for all of those effect-family names; this is used as a coverage gate, while behavioral parity still requires interaction testing.


### Battle coverage target

The online simulator is checked against `brisk-battle-effects.json`, generated directly from Brisk Emerald's move table. The current manifest contains **279 primary effect families and 87 secondary effect families**, and all **366/366 are explicitly accounted for** by the battle server.

Run:

```bash
npm run battle:coverage
```

The Brisk data-refresh GitHub Action also runs this check automatically. If a future Brisk Emerald update introduces a new extracted move-effect family, the refresh fails until the simulator accounts for it.

Battle teams can be selected from the loaded save's Party, any PC Box, or Brisk Dex External Storage. Pokédex sprite animations replay every 1 second.

“366/366 effect-family coverage” means every effect family extracted from Brisk's move metadata is accounted for. It does not claim that every possible compound interaction, historical-generation quirk, or frame-by-frame pokeemerald-expansion behavior is mathematically proven identical; those require differential battle testing against the ROM engine.
