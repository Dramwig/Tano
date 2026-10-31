# Presentation preview fixtures

These two files were authored for Tano's preview tests on 2026-10-31 using
PowerPoint, then saved as PPT and PPTX. They contain only a green 32pt italic
"Original layout test" text box at (170pt, 90pt) and a blue ellipse at
(70pt, 250pt), on a 960 × 540pt slide. They are test data under Tano's MIT license.
PowerPoint is not used by the tests or the plugin runtime.

`two-slides.pptx` duplicates the fixture slide through OOXML package editing,
replacing the second slide's text with "Second slide" for navigation checks.

Browser acceptance checks both formats in the actual plugin sandbox, preserves
the original aspect ratio and styles, and exercises zoom and attachment transfer.
