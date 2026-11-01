# Embedded fonts

Every presentation's page draws its text in these faces, so text is drawn and
measured alike on every machine, whatever fonts it has, and the server measures
text in the very same files, so a layout worked out on the server
([`../layout.server.ts`](../layout.server.ts)) is the one the page would work
out itself. There is a text face for each of the design's `font` values, and a
fallback face for the characters any of them lacks (`∅`, `✓`, arrows,
mathematical operators, and Greek in the faces without it), second in every font
list:

| Family      | Design `font` | Subset of                        | Licence                                             |
| ----------- | ------------- | -------------------------------- | --------------------------------------------------- |
| Vis Sans    | `sans`        | Inter 4.1                        | [OFL 1.1](LICENSE-Inter.txt)                        |
| Vis Serif   | `serif`       | Source Serif 4.005               | [OFL 1.1](LICENSE-SourceSerif.md)                   |
| Vis Mono    | `mono`        | JetBrains Mono NL 2.304          | [OFL 1.1](LICENSE-JetBrainsMono.txt)                |
| Vis Legible | `legible`     | Atkinson Hyperlegible Next 2.001 | [OFL 1.1](LICENSE-AtkinsonHyperlegibleNext.txt)     |
| Vis Casual  | `casual`      | Comic Neue 2.51                  | [OFL 1.1](LICENSE-ComicNeue.txt)                    |
| Vis Slab    | `slab`        | Zilla Slab 1.002                 | [OFL 1.1](LICENSE-ZillaSlab.txt)                    |
| Vis Symbols | (fallback)    | DejaVu Sans 2.37                 | [Bitstream Vera, public domain](LICENSE-DejaVu.txt) |

Each comes in regular (400) and bold (700), the weights the design draws. The
mono face is JetBrains Mono's NL cut, without ligatures, so `!=` and `->` read
as typed. The faces are renamed, as the Open Font License asks of modified fonts
and Source Serif's reserved name `Source` requires, with a neutral prefix,
`Vis`, so neither the page nor an export names the system a participant is
using; their copyright and licence notices are kept in the files. The files' own
name tables still give the earlier names, `Sverlin Sans` and so on, until
`build.sh` is run again.

[`scripts/fonts/build.sh`](../../../../../scripts/fonts/build.sh) makes them,
from nixpkgs' font packages and `dejavu-fonts-ttf`, with fontTools
([`subset.py`](../../../../../scripts/fonts/subset.py)): each face is subset to
Latin, Greek, punctuation, arrows, mathematical operators, shapes and check
marks, stripped of hinting so every browser and the server take the same
advances, and given one set of vertical metrics every platform reads alike. Its
digits are its lining figures, all of one height (Zilla Slab's own are
old-style, each at its own height, and the page selects no figure features), and
its line is centred on them, its height kept, so a number sits in the middle of
the node around it in every font. The same sources make the same files. The
`.woff2` files are the page's, the `.ttf` files the server's, the same glyphs
and metrics.

`faces.json`, written by `subset.py`, is the one list of the design's fonts:
each `font` value with its family, the machine's fonts the page goes on to, and
the DejaVu family the PDF export draws in what no embedded face has, as the page
would go on to its machine's; the faces; and a version naming the files, which
pages check the server's layout against. The design's `font` options, the page's
font lists and the rules drawing a node in each
([`../library/fonts.ts`](../library/fonts.ts)), and the PDF export's faces
([`../targets/pdf.ts`](../targets/pdf.ts)), which embeds the `.ttf` files, all
come from it. To add a font, add its package to `build.sh` and its value to
`FACES` in `subset.py`, run `build.sh`, put its licence here and in the table
above, and describe the value where the [language guide](../README.md) lists
`font`'s values.

A character no face has is drawn by the page in a font of its machine, which the
server cannot measure, so the server leaves that presentation to the page.
