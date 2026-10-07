# Lichess chess.com-style shapes

Browser extension (Manifest V3) that redraws Lichess board shapes in the chess.com style:

- Arrows are filled polygons with a thin shaft and a wide head. Knight moves are drawn as an
  L-shape: the two-square leg first, then the one-square leg ending in the arrowhead.
- The arrow starts about a third of a square away from the origin center, so it does not sit
  on top of the piece being moved.
- Right-click square marks fill the whole square instead of drawing a circle.
- Colors follow chess.com: plain right-click arrows are orange, plain square marks are red.
  Shift / Alt / Shift+Alt (Lichess's red / blue / yellow brushes) map to red / blue / green.
- Engine and analysis arrows (other Lichess brushes) keep their original colors but get the
  same chess.com shape.

## Install (Chrome, Brave, Arc, Chromium, Edge)

1. Open `chrome://extensions` (or `brave://extensions`, `arc://extensions`).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Reload any open Lichess tab.

## Tweaking

All sizes and colors live in the `CONFIG` object at the top of `content.js`. Sizes are in
squares (1 = one board square) and were measured from chess.com screenshots:

| key           | value | meaning                                              |
|---------------|-------|------------------------------------------------------|
| `shaftWidth`  | 0.21  | thickness of the arrow shaft                         |
| `headWidth`   | 0.47  | width of the arrowhead base                          |
| `headLength`  | 0.35  | length of the arrowhead                              |
| `startOffset` | 0.36  | gap from the origin square center to the arrow start |
| `tipOffset`   | 0.04  | how far before the destination center the tip stops  |

After editing, click the reload icon on the extension card in `chrome://extensions`.

## How it works

Lichess's board library (chessground) renders every shape inside
`<svg class="cg-shapes" viewBox="-4 -4 8 8">` as `<g cgHash="...">` groups holding a
`<line>` (arrow) or `<circle>` (square mark). The hash encodes origin, destination and brush.
`content.js` watches the DOM with a `MutationObserver`, hides the original element in each
group and appends a `<path>` or `<rect>` of its own inside the same group. Chessground removes
the whole group when a shape disappears, so the replacement is cleaned up automatically.
