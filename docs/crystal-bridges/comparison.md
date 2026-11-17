# Crystal Bridges: comparison against references

This compares screenshots from the game (`shots/`, headless Chromium, 1280×720) with two kinds of reference: real photos of the museum and the musewalk target shots.

**Real photos** were viewed for comparison only and are not in the repository:

- crystalbridges.org/architecture hero aerial, the "close aerial looking north" (courtesy of Safdie Architects), and the night view;
- the Commons photos listed in `../crystal-bridges-research.md`.

**musewalk target shots** are in `../musewalk-reference/`.

Claude in Chrome was not connected, so Google Street View / Google Arts & Culture could not be walked. The comparison uses the museum's own published photos and web search instead.

## Exterior

| Our shot | Reference | Matches | Still differs |
|---|---|---|---|
| `shots/01-exterior-aerial-north.png` | crystalbridges.org "close aerial looking north" | Arched copper hull roofs on the bridges with eaves over the glass; concrete abutments at the bridge ends; bridges on piers over the ponds; concave hillside roofs; cedar-banded concrete; forest on the slopes | Real hillside pavilions are fan-shaped and curved in plan; ours are rectangles with one bowed long wall. Real roof seams are fewer and wider. The real ravine is deeper (16–20 m; ours ~11–13 m, scaled for play). The real water is brown-green; ours is greener |
| `shots/02-exterior-from-north-pond.png` | Audio tour description, Commons "Crystal Bridges from trail" | Eleven spanning the weir between the ponds, Walker Landing tiers stepping into the north pond, glass bridge walls | Real Walker Landing is a full circular amphitheatre; ours is an arc of tiers. Real weirs are zig-zag labyrinth weirs; ours are straight sills with a waterfall sheet |
| `shots/03-exterior-overview.png` | crystalbridges.org hero aerial | Pavilions ring the ponds; a north–south ravine; the 2026 wing closes the loop to the north | The entrance colonnade and elevator tower are simplified into one stair hall. The Fly's Eye Dome, trails and North Lawn are not modelled |

## Interior and galleries (musewalk target)

| Our shot | musewalk target | Matches | Still differs |
|---|---|---|---|
| `shots/02-wing-early-american.png`, `03-wing-nineteenth.png` | `../musewalk-reference/08-classical-c-gallery-vermeer.jpg` | Gold frames (musewalk's 0.17 m border, 0.04 m lip), light pool around each work, label plaques to the right, Cormorant italic caption near the crosshair, warm mood and vignette inside | musewalk's mirror floor (Reflector) is not used: our red-oak floor is matte. musewalk's corridor is near-black burgundy; ours keeps Crystal Bridges' concrete, cedar bands and oak, darkened by the mood blend. Spotlit wall pools are softer decals plus only three real spotlights at a time |
| `shots/08-focus.png` | `../musewalk-reference/08-classical-f-focus-info-panel.jpg` | Camera framing (musewalk distance formula, work centred left of the 440 px panel), panel CSS, gold hairlines, vertical poem line, staggered reveal | Body text is Cormorant (musewalk uses Noto Serif SC). Panel buttons are key hints, because the game keeps pointer lock |
| `shots/09-portal-strokes.png` | `../musewalk-reference/10-walk-into-painting-c-rising.jpg` | Brush-stroke chips that reassemble the painting from the front, rising relief, white veil (#f6f1e6), drifting dust | Shortened to ~3 s; musewalk then opens an orbitable "dream" scene, while we land the player at the paired spot. 22k chips instead of 42k |
| `shots/06-wing-contemporary.png` | musewalk "future" wing empty frames | Float-style empty frames with labels for in-copyright works | No stand-in imagery in Contemporary: the frames are deliberately empty |

## Fixes made after comparing

1. **Bridge roofs:** they first bulged along their length. The aerial photos show hulls that arch across the span, so the roofs were rebuilt with a cross-arch and eaves.
2. **Copper:** the orange copper was changed to weathered bronze-brown with pale standing seams.
3. **Abutments:** concrete abutments were added at the bridge corners.
4. **Gallery mood:** galleries were too bright compared with musewalk, so the interior mood blend was deepened (hemisphere ×0.5, sun ×0.25, warmer fog). Glass halls get about half of it.
5. **Light pools:** they blew out the tops of paintings in focus mode, so pool and spot strength were reduced.
6. **Portal chips:** they were large and outlined by the ink pass. They are now smaller, there are more of them, and they no longer write depth.

## Not verified

- No side-by-side Street View walk; see the note at the top.
- Frame rate on a typical laptop. The headless run on an Apple M4 held the 60 fps vsync cap everywhere.
- Real multiplayer with two browsers (portal validation and glass sync are code-reviewed and unit-tested only).
