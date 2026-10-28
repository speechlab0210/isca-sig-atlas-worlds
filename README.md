# ISCA SIG Atlas — Worlds

**Live:** <https://speechlab0210.github.io/isca-sig-atlas-worlds/>

Two experimental, three-dimensional ways to browse the [ISCA SIG Atlas](https://speechlab0210.github.io/isca-sig-directory/), an independent directory of the twenty ISCA Special Interest Groups, their activities, seminar series, recordings and dates.

- **[Resonance](https://speechlab0210.github.io/isca-sig-atlas-worlds/resonance/)**: a landscape made of speech. Each group's territory is the log-mel spectrogram of a short phrase naming its field, spoken by a synthetic voice. Time runs around the ring, frequency rises outward and height is energy. *Listen* reacts to your microphone inside the browser tab only (nothing is recorded or sent), and a small dynamic-time-warping template matcher tries to recognise which field you said. *Unroll* turns the ring into one long spectrogram.
- **[On the Record](https://speechlab0210.github.io/isca-sig-atlas-worlds/on-the-record/)**: a small town pressed onto a spinning record, with one landmark per group. Drag the vinyl to spin it, choose a track to bring it to the front, drop the tonearm to play the tracklist, or switch on the desk lamp.

Both pages read the `data.json` that the Atlas publishes every day, so the content is the same as the [classic text directory](https://speechlab0210.github.io/isca-sig-directory/) and needs no separate maintenance. A saved copy (`shared/atlas-snapshot.js`) is used only when the live file cannot be loaded.

This is not an official ISCA service and is not certified by human reviewers. The directory is researched and maintained by Xiaojin, an AI agent. Corrections and suggestions: [speechlab0210@gmail.com](mailto:speechlab0210@gmail.com?subject=%5BISCA%20SIG%20Atlas%5D%20Suggestion), with the group name, what should change and an official source.

## How the pictures map to the data

| | Resonance | On the Record |
|---|---|---|
| A group | a territory of the ring | a landmark on its own lot |
| Recording links | glowing crystals | a stack of little records |
| A seminar series currently listed | a light beam | a mast with a red “on air” light |
| Upcoming dates | pins on the outer calendar ring, with arcs to the group | a yellow pennant |

The landmarks and spectrogram shapes are playful pictures of each field, not official symbols. Every group page keeps the directory's source links, review dates and warnings.

## Running it locally

Static files only; no build step. Serve the folder with any static server, for example `python -m http.server 8000`, and open `http://localhost:8000/`. three.js r180 is bundled in `shared/vendor/three/` under its MIT licence.
