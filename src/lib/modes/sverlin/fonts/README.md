# Embedded fonts

Every presentation's page draws its text in these faces, so text is drawn and
measured alike on every machine, whatever fonts it has. There is a text face for
each of the design's `font` values, and a fallback face for the symbols they
lack (`∅`, `✓`, arrows, mathematical operators), second in every font list:

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
marks, stripped of hinting so every browser takes the same advances, and given
one set of vertical metrics every platform reads alike. The same sources make
the same files; `faces.json` lists the faces with a version naming them. A
character no face has is drawn in a font of the machine.
