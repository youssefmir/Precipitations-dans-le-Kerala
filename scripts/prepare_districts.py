"""Télécharge et simplifie les contours des districts du Kerala.

Usage :
    python scripts/prepare_districts.py            # télécharge depuis DataMeet / geohacker
    python scripts/prepare_districts.py brut.geojson  # ou part d'un fichier local

Écrit ``data/raw/kerala_districts.geojson`` (≈ 40 Ko au lieu de 290 Ko).
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

from kerala_rain.data import DISTRICTS_FILE
from kerala_rain.geo import SOURCE_URL, simplify_districts


def read_source(argv: list[str]) -> dict:
    """Lit le GeoJSON brut depuis un fichier local ou depuis l'URL source."""
    if len(argv) > 1:
        return json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:  # noqa: S310 (URL fixe)
        return json.load(response)


def main(argv: list[str]) -> None:
    simplified = simplify_districts(read_source(argv))
    DISTRICTS_FILE.write_text(json.dumps(simplified, separators=(",", ":")), encoding="utf-8")
    size_kb = DISTRICTS_FILE.stat().st_size / 1024
    print(f"{len(simplified['features'])} districts → {DISTRICTS_FILE} ({size_kb:.0f} Ko)")


if __name__ == "__main__":
    main(sys.argv)
