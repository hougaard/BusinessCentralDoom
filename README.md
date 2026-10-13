# Can BC run DOOM?

Yes, it can. This is a Microsoft Dynamics 365 Business Central extension that runs the original 1993 DOOM, with the game itself running in AL on the Business Central server.

Created by **Erik Hougaard**.

## What this is

The game engine is [PureDOOM](https://github.com/Daivuk/PureDOOM), a single-header C port of id Software's DOOM source, translated from C to AL by a C-to-AL compiler (`c2al`). The result is one very large codeunit, [DoomEngine.Codeunit.al](src/DoomEngine.Codeunit.al), with about 45,000 lines of generated AL. C memory is emulated as a `List of [Integer]` with one element per byte, and C pointers become indexes into that list.

Business Central only acts as a display and an input device. Each frame is computed on the server:

1. The **DOOM** page hosts the `DOOM Screen` control add-in, which sends keyboard and mouse events to AL.
2. AL feeds the events into the engine, runs one or more game tics and renders a 320×200 palette-indexed frame.
3. The page sends only the rows that changed back to the browser (base64), along with palette changes and sound events.
4. The add-in draws the frame on a canvas (WebGL with an upscaling filter, or a plain 2D canvas as a fallback) and plays the sound.

Sound effects come from the WAD and are played with the Web Audio API. Music is converted from DOOM's MUS format to MIDI in the browser ([mus2mid.js](src/controladdin/mus2mid.js)) and played with [spessasynth_core](https://github.com/spessasus/spessasynth_core) and a General MIDI sound font.

## Requirements

- Business Central 2026 release wave 2 (application 29.0, AL runtime 18.0) or later.
- A browser with WebGL. Without WebGL the game still runs, but the upscaling filters are not available.
- Internet access from the browser for music: the synthesizer and the sound font are loaded from the jsDelivr CDN. Sound effects don't need it.

## Installation

1. Open the folder in VS Code with the AL Language extension.
2. Point `.vscode/launch.json` at your sandbox or container.
3. Download symbols, then publish (F5 or Ctrl+F5).

The WAD files ship inside the app as resources in [resources/](resources/), so there is nothing else to install. Freedoom WADs are larger than the 16 MB resource limit, so they are stored gzip-compressed and decompressed on import.

## Playing

1. Search for **DOOM** (page 66600) and open it.
2. Pick a game:
   - **DOOM**: the shareware episode 1 (`doom1.wad`)
   - **Freedoom: Phase 1**: free, with 4 episodes (`freedoom1.wad.gz`)
   - **Freedoom: Phase 2**: free and Doom II compatible (`freedoom2.wad.gz`)
3. The first time you pick a game, its WAD is imported into the `DOOM WAD Lump` table (one record per lump). Choosing another game later replaces the imported WAD.
4. **Click the game screen.** This focuses it so it receives keys, locks the mouse pointer for mouse look, and allows the browser to play audio. Press Esc to release the mouse.

Choosing **Quit Game** from DOOM's menu closes the page.

## Controls

### Movement and combat

| Key | Action |
| --- | --- |
| Arrow Up / Arrow Down | Move forward / backward |
| Arrow Left / Arrow Right | Turn left / right |
| Space or Ctrl | Fire |
| E | Use: open doors, press switches |
| Shift (hold) | Run |
| Alt (hold) + Left / Right | Strafe |
| `,` / `.` | Strafe left / right |
| 1 to 7 | Select weapon |
| Tab | Automap |
| `-` / `=` | Smaller / bigger view (zooms the automap while it is open) |
| Pause | Pause |

In the original game, Space opens doors and Ctrl fires. Here Space also fires and E opens doors, so you don't need to hold Ctrl, because Ctrl+W closes the browser tab.

### Mouse

Click the screen to lock the pointer.

| Input | Action |
| --- | --- |
| Move | Turn |
| Left button | Fire |
| Right button (hold) | Strafe with the mouse |
| Middle button | Move forward |

### Menus and function keys

| Key | Action |
| --- | --- |
| Esc | Open / close the menu |
| Enter | Select a menu item |
| Backspace | Go back in a menu |
| Y / N | Answer confirmation prompts |
| F1 | Help |
| F2 / F3 | Save game / Load game |
| F4 | Sound volume |
| F5 | Detail level |
| F6 / F9 | Quick save / Quick load |
| F7 | End game |
| F8 | Messages on / off |
| F10 | Quit |
| F11 | Gamma correction |

All letter keys reach the game, so the classic cheat codes work too.

### Display and diagnostics keys

The browser add-in handles these keys itself. They never reach the game.

| Key | What it does |
| --- | --- |
| `` ` `` (the backtick or tilde key, left of 1) | Shows or hides the performance overlay. |
| End | Cycles the upscaling filter: **Pixels**, **Sharp** (default), **Smooth**, **Scale2x**, **CRT**. A notice shows the selected filter. The choice is saved in the browser's local storage. |
| Home | Switches how input is sent. **immediate** (default): a key press or mouse click sends a request right away, even while a batch is being rendered, and that request renders a single frame. **with next batch**: input waits for the next regular batch request. |
| Page Up / Page Down | Raises or lowers the batch size: how many frames the server renders per round trip, from 1 to 10 (default 2). Bigger batches give a smoother frame rate when the round trip is slow, but add input lag. |

#### The performance overlay

The top line of the overlay is updated once a second:

```
24.3 fps | batch 2 (PgUp/PgDn) | input immediate (Home) | server 61ms | round trip 85ms
input lag 140ms = waiting to send 3 + round trip 92 (server 58) + display 45
```

- **fps**: frames shown per second.
- **batch**: the current batch size (Page Up / Page Down).
- **input**: the current input mode (Home).
- **server**: the time AL spent producing the last batch.
- **round trip**: the time from the last request to the response, including the server time.
- **sound: press a key**: shown until the browser allows audio. Press a key or click the screen.
- **loading music** / **music failed: ...**: the status of the music synthesizer and sound font download.
- **input lag**: measured from a key press or mouse click to the first frame that includes it. It is split into the time before the request was sent, the round trip (with the server time in parentheses) and the time before the frame was shown.

The second box is updated every 30 frames:

```
per frame: tick 52.1ms, encode 3.4ms || init 00:00:01.234 | <benchmark>
```

- **tick**: the average AL time spent running the engine for one frame.
- **encode**: the average AL time spent encoding the frame delta, palette and sound events.
- **init**: how long the engine took to start.
- **benchmark**: the result of `"DOOM Engine".RunBenchmark()`, which times the basic operations the translated code is made of. It is used for performance tuning.

## Save games and settings

DOOM's save files and config file are stored in Business Central tables instead of the file system. Both are stored per game (WAD) and per user, and are not per company.

- **DOOM Save Games** (page 66601) lists the six save slots for each game and user. You save and load from the game (F2 / F3). You can delete saves from this page.
- **DOOM Settings** (table 66602) holds DOOM's config file: volumes, mouse sensitivity, screen size, gamma and so on. It is written whenever a setting changes and read at startup.

## Project layout

| File | Contents |
| --- | --- |
| [src/Doom.Page.al](src/Doom.Page.al) | The **DOOM** page: picks and imports the WAD, runs the frame loop, encodes frames for the add-in. |
| [src/DoomEngine.Codeunit.al](src/DoomEngine.Codeunit.al) | The DOOM engine: PureDOOM translated to AL (generated, do not edit by hand). The host API is at the top. |
| [src/DoomWadLump.Table.al](src/DoomWadLump.Table.al) | The imported WAD, one record per lump. Also supplies the sound and music lumps to the add-in. |
| [src/DoomSaveGame.Table.al](src/DoomSaveGame.Table.al), [src/DoomSaveGames.Page.al](src/DoomSaveGames.Page.al) | Save games. |
| [src/DoomSettings.Table.al](src/DoomSettings.Table.al) | DOOM's config file per game and user. |
| [src/controladdin/DoomScreen.ControlAddin.al](src/controladdin/DoomScreen.ControlAddin.al) | The `DOOM Screen` control add-in definition and its protocol. |
| [src/controladdin/doom.js](src/controladdin/doom.js) | The add-in: frame queue, input, sound, music, overlay and diagnostics keys. |
| [src/controladdin/screen.js](src/controladdin/screen.js) | The WebGL renderer and its upscaling filters. |
| [src/controladdin/mus2mid.js](src/controladdin/mus2mid.js) | Converts MUS to MIDI. |
| [resources/](resources/) | The WAD files shipped with the app. |

## Credits and licenses

- Created by **Erik Hougaard**.
- DOOM source code © 1993-1996 id Software, Inc., released under the GNU GPL v2.
- [PureDOOM](https://github.com/Daivuk/PureDOOM) by Daivuk.
- `doom1.wad` is the DOOM shareware WAD © id Software.
- [Freedoom](https://freedoom.github.io) WADs © the Freedoom contributors, under the BSD-style license in [resources/freedoom-COPYING.txt](resources/freedoom-COPYING.txt).
- Music is played with [spessasynth_core](https://github.com/spessasus/spessasynth_core) and the GeneralUser GS sound font.
