"""Make the fonts every presentation embeds (see src/lib/modes/sverlin/fonts/README.md).

Run through build.sh, which finds the source fonts. Each face is instanced (variable sources),
subset to the characters Sverlin draws, given lining figures, stripped of hinting so every browser
and the server take the same unhinted advances, given one set of vertical metrics every platform
reads alike, centred on the digits, and renamed, as the Open Font License asks of modified fonts.
The fallback face holds only characters some text face lacks.
"""

import hashlib
import json
import sys
from pathlib import Path
from typing import NamedTuple

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

RANGES = [
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x017F),  # Latin-1, Latin Extended-A
    (0x0300, 0x036F),  # combining marks
    (0x0370, 0x03FF),  # Greek, for the letters algorithms name things by
    (0x2000, 0x20BF),  # punctuation, super- and subscripts, currency
    (0x2100, 0x23FF),  # letterlike, number forms, arrows, mathematical operators, technical
    (0x2500, 0x257F),  # box drawing
    (0x25A0, 0x27BF),  # shapes, symbols, dingbats (check marks)
    (0x27F0, 0x27FF),  # long arrows
    (0x2900, 0x297F),  # supplemental arrows
]
CHARACTERS = {code for start, end in RANGES for code in range(start, end + 1)}
DIGITS = range(ord("0"), ord("9") + 1)

class Face(NamedTuple):
    family: str
    source: str  # build.sh's name for the font package
    origin: str  # what it is a subset of
    fallbacks: str = ""  # the CSS fonts the page goes on to for a character no embedded face has
    pdf: str = ""  # the DejaVu family the PDF export draws what no embedded face has in


# The design's font values, each a text face, in the order the design offers them, the first the
# starter's and the page's own.
FACES = {
    "sans": Face("Sverlin Sans", "inter", "Inter 4.1", "system-ui, sans-serif", "sans"),
    "serif": Face(
        "Sverlin Serif",
        "source-serif",
        "Source Serif 4.005",
        "ui-serif, Georgia, 'Times New Roman', serif",
        "serif",
    ),
    "mono": Face(
        "Sverlin Mono",
        "jetbrains-mono",
        "JetBrains Mono NL 2.304",
        "ui-monospace, Menlo, Consolas, monospace",
        "mono",
    ),
    "legible": Face(
        "Sverlin Legible",
        "atkinson",
        "Atkinson Hyperlegible Next 2.001",
        "system-ui, sans-serif",
        "sans",
    ),
    "casual": Face(
        "Sverlin Casual",
        "comic-neue",
        "Comic Neue 2.51",
        "'Comic Sans MS', system-ui, sans-serif",
        "sans",
    ),
    "slab": Face(
        "Sverlin Slab",
        "zilla-slab",
        "Zilla Slab 1.002",
        "Rockwell, ui-serif, Georgia, serif",
        "serif",
    ),
}
# Second in every font list, for the characters some text face lacks.
FALLBACK = Face("Sverlin Symbols", "dejavu", "DejaVu Sans 2.37")
WEIGHTS = {400: "Regular", 700: "Bold"}


def source(sources: dict, role: str, weight: int) -> TTFont:
    if role == "inter":
        font = TTFont(sources["inter"] / "share/fonts/truetype/InterVariable.ttf")
        return instancer.instantiateVariableFont(font, {"wght": weight, "opsz": 14})
    names = {
        "source-serif": f"share/fonts/truetype/SourceSerif4-{WEIGHTS[weight]}.ttf",
        "jetbrains-mono": f"share/fonts/truetype/JetBrainsMonoNL-{WEIGHTS[weight]}.ttf",
        "atkinson": f"share/fonts/truetype/AtkinsonHyperlegibleNext-{WEIGHTS[weight]}.ttf",
        "comic-neue": f"share/fonts/truetype/ComicNeue-{WEIGHTS[weight]}.ttf",
        "zilla-slab": f"share/fonts/truetype/ZillaSlab-{WEIGHTS[weight]}.ttf",
        "dejavu": "ttf/DejaVuSans.ttf" if weight == 400 else "ttf/DejaVuSans-Bold.ttf",
    }
    return TTFont(sources[role] / names[role])


def covered(font: TTFont) -> set:
    return set(font.getBestCmap())


def finish(
    font: TTFont,
    family: str,
    weight: int,
    origin: str,
    characters: set,
    centre: float | None = None,
) -> TTFont:
    if font["OS/2"].version < 4:
        upgrade(font)
    options = subset.Options()
    options.hinting = False
    options.desubroutinize = True
    options.name_IDs = [0, 13, 14]
    options.name_languages = [0x409]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=sorted(characters))
    subsetter.subset(font)
    style = WEIGHTS[weight]
    names = font["name"]
    for record in list(names.names):
        if record.nameID not in (0, 13, 14):
            names.removeNames(nameID=record.nameID)
    names.setName(family, 1, 3, 1, 0x409)
    names.setName(style, 2, 3, 1, 0x409)
    names.setName(f"{family} {style}", 4, 3, 1, 0x409)
    names.setName("Version 1.0", 5, 3, 1, 0x409)
    names.setName(f"{family.replace(' ', '')}-{style}", 6, 3, 1, 0x409)
    names.setName(f"Subset of {origin} for Sverlin, renamed as its licence asks.", 10, 3, 1, 0x409)
    # One set of vertical metrics, read alike on every platform: typographic metrics equal to
    # hhea's, which FreeType and Core Text read, and marked for use, which DirectWrite then reads.
    hhea, os2 = font["hhea"], font["OS/2"]
    # A line's box centred on the digits' centre, its height unchanged, so a number is centred in
    # the box around it (a node centres its line box) whatever the font.
    if centre is not None:
        shift = round((hhea.ascent + hhea.descent) / 2 - centre)
        hhea.ascent, hhea.descent = hhea.ascent - shift, hhea.descent - shift
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = (
        hhea.ascent,
        hhea.descent,
        hhea.lineGap,
    )
    os2.fsSelection |= 1 << 7
    os2.usWeightClass = weight
    os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b100000 if weight == 700 else 0b1000000)
    font["head"].macStyle = 1 if weight == 700 else 0
    if "post" in font:
        font["post"].formatType = 3.0
    return font


def upgrade(font: TTFont) -> None:
    """Bring an OS/2 table to version 4, which defines the flag that its metrics are to be used."""
    os2 = font["OS/2"]
    if os2.version < 2:
        glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
        os2.sxHeight = bounds_top(glyphs, cmap, "x")
        os2.sCapHeight = bounds_top(glyphs, cmap, "H")
        os2.usDefaultChar, os2.usBreakChar, os2.usMaxContext = 0, 32, 2
    os2.version = 4


def bounds(glyphs, cmap, character: str) -> tuple | None:
    pen = BoundsPen(glyphs)
    glyphs[cmap[ord(character)]].draw(pen)
    return pen.bounds


def bounds_top(glyphs, cmap, character: str) -> int:
    box = bounds(glyphs, cmap, character)
    return round(box[3]) if box else 0


def lining(font: TTFont) -> TTFont:
    """Draw the digits as the font's lining figures, all of one height, where its own are not (Zilla
    Slab's are old-style, each at its own height): the page selects no figure features."""
    gsub = font["GSUB"].table if "GSUB" in font else None
    if gsub is None or gsub.FeatureList is None:
        return font
    figures = {}
    for record in gsub.FeatureList.FeatureRecord:
        if record.FeatureTag != "lnum":
            continue
        for index in record.Feature.LookupListIndex:
            lookup = gsub.LookupList.Lookup[index]
            for table in lookup.SubTable:
                table = table.ExtSubTable if lookup.LookupType == 7 else table
                figures.update(getattr(table, "mapping", {}))
    for table in font["cmap"].tables:
        for code in DIGITS:
            if table.cmap.get(code) in figures:
                table.cmap[code] = figures[table.cmap[code]]
    return font


def digits_centre(font: TTFont) -> float:
    """Halfway between the digits' lowest and highest ink, in font units."""
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    boxes = [bounds(glyphs, cmap, chr(code)) for code in DIGITS]
    return (min(box[1] for box in boxes) + max(box[3] for box in boxes)) / 2


def main() -> None:
    out = Path(sys.argv[1])
    sources = {key: Path(value) for key, value in (arg.split("=", 1) for arg in sys.argv[2:])}
    out.mkdir(parents=True, exist_ok=True)
    text_coverage: dict[int, set] = {}
    for role, face in FACES.items():
        fonts = {weight: lining(source(sources, face.source, weight)) for weight in WEIGHTS}
        # One centre for both weights, so that their lines keep one baseline.
        centre = sum(map(digits_centre, fonts.values())) / len(fonts)
        for weight, font in fonts.items():
            have = covered(font) & CHARACTERS
            text_coverage[weight] = text_coverage.get(weight, have) & have
            font = finish(font, face.family, weight, face.origin, have, centre)
            save(font, out / f"{role}-{weight}")
    for weight in WEIGHTS:
        font = source(sources, FALLBACK.source, weight)
        missing = (covered(font) & CHARACTERS) - text_coverage[weight]
        fallback = finish(font, FALLBACK.family, weight, FALLBACK.origin, missing)
        save(fallback, out / f"symbols-{weight}")
    write_manifest(out)


def write_manifest(out: Path) -> None:
    """The design's fonts, as the page, the design and the PDF export take them; the faces, in the
    order a family list tries them; and a version naming these very files."""
    fonts = [
        {"value": role, "family": face.family, "fallbacks": face.fallbacks, "pdf": face.pdf}
        for role, face in FACES.items()
    ]
    families = {role: face.family for role, face in FACES.items()} | {"symbols": FALLBACK.family}
    faces = [
        {"file": f"{role}-{weight}", "family": family, "weight": weight}
        for role, family in families.items()
        for weight in WEIGHTS
    ]
    digest = hashlib.sha256()
    for face in faces:
        digest.update((out / f"{face['file']}.ttf").read_bytes())
        digest.update((out / f"{face['file']}.woff2").read_bytes())
    manifest = {
        "version": digest.hexdigest()[:16],
        "fonts": fonts,
        "fallback": FALLBACK.family,
        "faces": faces,
    }
    (out / "faces.json").write_text(json.dumps(manifest, indent=2) + "\n")


def save(font: TTFont, stem: Path) -> None:
    # The same sources make the same files, so the version changes only when the fonts do.
    font.recalcTimestamp = False
    font.flavor = None
    font.save(f"{stem}.ttf")
    font.flavor = "woff2"
    font.save(f"{stem}.woff2")
    print(stem.name, Path(f"{stem}.ttf").stat().st_size, Path(f"{stem}.woff2").stat().st_size)


if __name__ == "__main__":
    main()
