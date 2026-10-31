# Embedded fonts

Every presentation's page draws its text in these faces, so text is drawn and
measured alike on every machine, whatever fonts it has, and the server measures
text in the very same files, so a layout worked out on the server
([`../layout.server.ts`](../layout.server.ts)) is the one the page would work
out itself. There is a text face for each of the design's `font` values, and a
fallback face for the symbols they lack (`∅`, `✓`, arrows, mathematical
operators), second in every font list:

| Family          | Design `font` | Subset of               | Licence                                             |
| --------------- | ------------- | ----------------------- | --------------------------------------------------- |
| Sverlin Sans    | `sans`        | Inter 4.1               | [OFL 1.1](LICENSE-Inter.txt)                        |
| Sverlin Serif   | `serif`       | Source Serif 4.005      | [OFL 1.1](LICENSE-SourceSerif.md)                   |
| Sverlin Mono    | `mono`        | JetBrains Mono NL 2.304 | [OFL 1.1](LICENSE-JetBrainsMono.txt)                |
| Sverlin Symbols | (fallback)    | DejaVu Sans 2.37        | [Bitstream Vera, public domain](LICENSE-DejaVu.txt) |

Each comes in regular (400) and bold (700), the weights the design draws. The
mono face is JetBrains Mono's NL cut, without ligatures, so `!=` and `->` read
as typed. The faces are renamed, as the Open Font License asks of modified fonts
and Source Serif's reserved name `Source` requires; their copyright and licence
notices are kept in the files.

[`scripts/fonts/build.sh`](../../../../../scripts/fonts/build.sh) makes them,
from nixpkgs' font packages and `dejavu-fonts-ttf`, with fontTools
([`subset.py`](../../../../../scripts/fonts/subset.py)): each face is subset to
Latin, Greek, punctuation, arrows, mathematical operators, shapes and check
marks, stripped of hinting so every browser and the server take the same
advances, and given one set of vertical metrics every platform reads alike. The
same sources make the same files; `faces.json` lists the faces with a version
naming them, which pages check the server's layout against. The `.woff2` files
are the page's, the `.ttf` files the server's, the same glyphs and metrics.

A character no face has is drawn by the page in a font of its machine, which the
server cannot measure, so the server leaves that presentation to the page.
