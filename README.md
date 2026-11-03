# Napkins (viewer)

An offline, full-screen viewer for **Back of the Napkin** exports. It is the same napkin page with a local storage
runtime instead of claude.ai, so there's no Claude here: you can read, search, change maths inputs and draw, all kept on the device.

- Install: open the GitHub Pages URL in Chrome on Android → ⋮ → **Install app**.
- Get notes in: in Back of the Napkin, Tables → **Export everything**; then in the viewer, Tables → **Import a file or note**,
  or share the `.json` (or an SVG / napkin note) to **Napkins** from Android's Share menu. Re-importing an export replaces those tables.
- Rebuild: `python3 build.py` (reads `tools/napkin.html`, a copy of the artifact page), then commit `docs/` (GitHub Pages serves main /docs).
