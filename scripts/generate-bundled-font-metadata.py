"""Regenerate portable-font metadata with FontTools; not needed by the app.

On this workstation: mamba run -n claude python scripts/generate-bundled-font-metadata.py
FontTools and Brotli must already be installed. No font output files are written.
"""

from pathlib import Path
import hashlib
import json

from fontTools.ttLib import TTFont


def describe(source: Path) -> dict:
    font = TTFont(source, lazy=True)
    try:
        records = []
        for record in font["name"].names:
            if record.nameID not in (1, 2, 4, 6, 16, 17, 21, 22):
                continue
            try:
                value = record.toUnicode().replace("\x00", "").strip()
            except (UnicodeError, LookupError):
                continue
            if value:
                records.append((record.nameID, value, record.platformID, record.langID))
        records.sort(
            key=lambda item: 0
            if item[3] == 0x409 or (item[2] == 1 and item[3] == 0)
            else 1 if item[2] == 0 else 2
        )

        def names(identifier):
            return list(dict.fromkeys(item[1] for item in records if item[0] == identifier))

        def first(identifier):
            return next(iter(names(identifier)), None)

        family = first(16) or first(1) or source.stem
        subfamily = first(17) or first(2) or "Regular"
        os2 = font.get("OS/2")
        italic = bool(
            getattr(os2, "fsSelection", 0) & 1
            or font["head"].macStyle & 2
            or getattr(font.get("post"), "italicAngle", 0)
            or any(word in subfamily.lower() for word in ("italic", "oblique"))
        )
        points = sorted(
            {
                code
                for table in font["cmap"].tables
                if table.isUnicode()
                for code, glyph in table.cmap.items()
                if font.getGlyphID(glyph) != 0
            }
        )
        ranges = []
        for code in points:
            if ranges and code == ranges[-1][1] + 1:
                ranges[-1][1] = code
            else:
                ranges.append([code, code])
        metadata = {
            "key": source.stem,
            "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "byteLength": source.stat().st_size,
            "family": family,
            "families": list(
                dict.fromkeys([source.stem, family, *names(1), *names(16), *names(21)])
            ),
            "subfamily": subfamily,
            "fullName": first(4) or family + " " + subfamily,
            "postscriptName": first(6) or "",
            "weight": getattr(os2, "usWeightClass", 400),
            "style": "italic" if italic else "normal",
            "fsType": getattr(os2, "fsType", None),
            "coverage": {"ranges": ranges, "complete": True},
        }
        if "fvar" in font:
            metadata["variable"] = {
                "axes": [
                    {
                        "tag": axis.axisTag,
                        "min": axis.minValue,
                        "default": axis.defaultValue,
                        "max": axis.maxValue,
                    }
                    for axis in font["fvar"].axes
                ]
            }
        return metadata
    finally:
        font.close()


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    fonts = [describe(file) for file in sorted((root / "src/assets/fonts").glob("*.woff2"))]
    destination = root / "src/configs/bundledFontMetadata.json"
    destination.write_text(
        json.dumps({"version": 1, "fonts": fonts}, ensure_ascii=False, separators=(",", ":"))
        + "\n",
        encoding="utf-8",
    )
    print(f"Updated {destination.name}: {len(fonts)} fonts, {destination.stat().st_size} bytes")
