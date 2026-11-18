# Crystal Bridges: comparison against references

This compares screenshots from the game (`shots/`, headless Chromium, 1280×720) with two kinds of reference: real photos of the museum and the musewalk target shots.

**Real photos** were viewed for comparison only and are not in the repository:

- crystalbridges.org/architecture hero aerial, the "close aerial looking north" (courtesy of Safdie Architects), and the night view;
- the Commons photos listed in `../crystal-bridges-research.md`.

**musewalk target shots** are in `../musewalk-reference/`.

Google Arts & Culture Street View was opened on 2026-11-17 at
https://artsandculture.google.com/streetview/crystal-bridges-museum/_AEbw7HTnoSD4w
(start pano ~36.38274 N, 94.20325 W, looking at *Kindred Spirits*). The WebGL
tour rendered once, then went black in this browser, so later rooms were not
walked. The comparison uses that first pano, the museum's own published photos,
and web search.

## Exterior

| Our shot | Reference | Matches | Still differs |
|---|---|---|---|
| `shots/01-exterior-aerial-north.png` | crystalbridges.org "close aerial looking north" | Arched copper hull roofs on the bridges with eaves over the glass; concrete abutments at the bridge ends; bridges on piers over the ponds; concave hillside roofs; cedar-banded concrete; forest on the slopes | Real hillside pavilions are fan-shaped and curved in plan; ours are rectangles with one bowed long wall. Real roof seams are fewer and wider. The real ravine is deeper (16–20 m; ours ~11–13 m, scaled for play). The real water is brown-green; ours is greener |
| `shots/02-exterior-from-north-pond.png` | Audio tour description, Commons "Crystal Bridges from trail" | Eleven spanning the weir between the ponds, Walker Landing tiers stepping into the north pond, glass bridge walls | Real Walker Landing is a full circular amphitheatre (144×58 ft). Ours now wraps west and north into the pond (>180°) but still cannot close on the east because the Early American galleries sit there. Weirs are now zig-zag labyrinth teeth with a walkable spine; the real overflow edge is finer |
| `shots/03-exterior-overview.png` | crystalbridges.org hero aerial | Pavilions ring the ponds; a north–south ravine; the 2026 wing closes the loop to the north | The entrance colonnade and elevator tower are simplified into one stair hall. The Fly's Eye Dome, trails and North Lawn are not modelled |

## Interior vs Street View (first pano)

The first Street View frame is a gallery looking at Durand's *Kindred Spirits*: cream walls, red-oak floor, gold frames, glulam ribs, a long glass wall to the right, and a lot of daylight.

| Street View | Our galleries | Matches | Still differs |
|---|---|---|---|
| Kindred Spirits on a cream wall, gilt frame, oak floor, timber ribs | Early American / People on the Move wings | Same painting (public domain), gilt frames, oak floor, glulam ribs, glass to the pond | Street View is much brighter (daylight). Our galleries keep musewalk's darker mood by design (prompt §7.3: musewalk lighting, Crystal Bridges materials). Street View walls are paler cream; ours mix concrete bands with cedar |

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
7. **Labyrinth weirs:** straight sills under Eleven and the Modern Art bridge were rebuilt as zig-zag teeth with a walkable spine, matching the audio-tour "labyrinth weir".
8. **Walker Landing:** the seating arc now wraps more than 180° west and north into the pond instead of a south-facing half-arc.
9. **Floors:** visitor rooms used grey 4 m stone tile. They now use red-oak strip flooring (~12 cm boards) like the Street View galleries. Eleven keeps green quartzite. The library is a thin oak deck with a stair hole, not a plinth through the Great Hall Corridor. Gallery mood ground colour was lifted from near-black to oak so the boards stay readable.
10. **Windows:** floor-to-ceiling glass and exterior door openings were clear views of the simplified outside. They are now milky frosted panes; interior circulation openings stay open so you can still walk the route.
11. **Camera clip:** looking up pulled the third-person camera through museum floors because the orbit clamp used ravine terrain, not walkable slabs. It now shortens the orbit boom against walkable ground and the ceiling. Frosted door glass is camera-solid but still walkable, so the lens no longer slides through those panes.
12. **Fog:** interior mood used near-black fog only inside pavilions. It is now a sage/cream mist, with haze in the ravine between halls.

## Not verified

- Full Street View walk of every room; the pano went black after the first gallery. See the note at the top.
- Frame rate on a typical laptop. The headless run on an Apple M4 held the 60 fps vsync cap everywhere.
- Real multiplayer with two browsers (portal validation and glass sync are code-reviewed and unit-tested only).
