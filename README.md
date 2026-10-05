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


### Advanced battle engine v8

The private Host / Join simulator now has a much broader competitive mechanics layer. It uses Brisk Emerald save data for teams, stored Tera Types, Brisk-extracted species forms, and Brisk move metadata/flags.

Implemented coverage now includes: Mega/Tera/Gigantamax hooks, PP and Pressure, priority and Trick Room, stat stages, Contrary/Simple/Unaware, major status, confusion/flinch, Disable/Encore/Torment/Taunt, trapping, recharge and charge moves, Protect chains, Substitute, hazards, screens, Tailwind, weather, terrain, Wish/Future Sight, Perish Song, Destiny Bond, Yawn, Heal Block, Aqua Ring/Ingrain, Leech Seed, Salt Cure, Baton Pass basics, phazing, pivot moves, Defog/Rapid Spin/Mortal Spin, Knock Off, Clear Smog, Pain Split, Trick/Switcheroo, Skill Swap, multi-hit moves, recoil/draining, common fixed-damage moves, common secondary effects, common weather/terrain abilities, contact reactions, absorb/immunity abilities, priority blockers, Magic Bounce/Good as Gold-style protection, Mold Breaker-style bypasses, common offensive ability families (Iron Fist, Strong Jaw, Sharpness, Mega Launcher, Punk Rock, Tough Claws, Technician, Adaptability, Reckless), common defensive abilities (Fur Coat, Ice Scales, Marvel Scale, Multiscale, Filter/Solid Rock/Prism Armor, Thick Fat, Sturdy), common knockout/stat-trigger abilities, common recovery/status berries, Choice items, Life Orb, Assault Vest, Focus Sash, Weakness Policy, Heavy-Duty Boots, Rocky Helmet, Leftovers, Black Sludge, Air Balloon, Shed Shell, Shell Bell, status orbs, White Herb, Mental Herb, and several related interactions.

The battle client shows volatile conditions, delayed effects, field state, gimmick eligibility, move locks, PP, transformations, and trapping so server-side mechanics are visible instead of hidden.

This is intentionally Brisk-data-driven where possible. Rare one-off signature effects, every historical-generation edge case, and exact pokeemerald-expansion battle-script parity should still be verified before treating the simulator as tournament-authoritative.
