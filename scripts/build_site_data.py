"""Régénère ``docs/data.js`` à partir des données brutes et du package ``kerala_rain``.

Usage : python scripts/build_site_data.py
"""

from __future__ import annotations

from kerala_rain.site import write_site_data


def main() -> None:
    path = write_site_data()
    print(f"Données du site écrites dans {path} ({path.stat().st_size / 1024:.0f} Ko)")


if __name__ == "__main__":
    main()
