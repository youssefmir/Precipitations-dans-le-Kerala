"""Chargement et mise en forme des données brutes du projet.

Toutes les fonctions lisent les fichiers de ``data/raw`` et renvoient des tables propres :
index explicite, noms de colonnes homogènes, types numériques.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_RAW = PROJECT_ROOT / "data" / "raw"

RAINFALL_FILE = DATA_RAW / "kerala_rainfall_1901_2017.csv"
TEMPERATURE_FILE = DATA_RAW / "india_temperatures_1901_2017.csv"
FLOODS_FILE = DATA_RAW / "kerala_floods_2018_districts.csv"
LAND_USE_FILE = DATA_RAW / "land_use_1914_1967_2007.csv"
DISTRICTS_FILE = DATA_RAW / "kerala_districts.geojson"
IMD_2018_FILE = DATA_RAW / "imd_kerala_monsoon_2018.csv"

MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
MONTHS_FR = (
    "janv.",
    "févr.",
    "mars",
    "avr.",
    "mai",
    "juin",
    "juil.",
    "août",
    "sept.",
    "oct.",
    "nov.",
    "déc.",
)
SEASONS = {
    "JF": ("JAN", "FEB"),
    "MAM": ("MAR", "APR", "MAY"),
    "JJAS": ("JUN", "JUL", "AUG", "SEP"),
    "OND": ("OCT", "NOV", "DEC"),
}
SEASONS_FR = {
    "JF": "Hiver (janv.–févr.)",
    "MAM": "Pré-mousson (mars–mai)",
    "JJAS": "Mousson du sud-ouest (juin–sept.)",
    "OND": "Mousson du nord-est (oct.–déc.)",
}

# Le tableau des inondations orthographie « Kasaragode », la carte « Kasaragod ».
DISTRICT_ALIASES = {"Kasaragode": "Kasaragod"}

FLOOD_COLUMNS = {
    "no_of_camps": "relief_camps",
    "actual_rainfall_in_mm": "rain_actual_mm",
    "normal_rainfall_in_mm": "rain_normal_mm",
    "no_of_landslides": "landslides",
    "full_damaged_houses": "houses_destroyed",
}

# Libellés français des classes d'occupation du sol.
LAND_USE_LABELS_FR = {
    "Towns/cities": "Zones bâties",
    "Paddy": "Rizières",
    "Banana": "Bananeraies",
    "Mixed vegetables": "Cultures maraîchères",
    "Rubber": "Hévéa (caoutchouc)",
    "Coconut": "Cocoteraies",
    "Mixed": "Cultures mixtes (jardins arborés)",
    "Barren rocky/stony waste": "Terrains rocheux",
    "Sand mining/industrial waste/coastal sand": "Sablières et friches industrielles",
    "Marshy land": "Marais",
    "Scrub land": "Broussailles",
    "Evergreen/semievergreen": "Forêt sempervirente",
    "Dense mixed": "Forêt dense mixte",
    "Scrub forest": "Forêt claire",
    "Eucalyptus": "Plantations d'eucalyptus",
    "River/streams": "Rivières",
    "Ponds/tanks": "Étangs et réservoirs villageois",
    "Reservoir": "Barrages-réservoirs",
}


def load_rainfall(path: Path = RAINFALL_FILE) -> pd.DataFrame:
    """Pluie mensuelle, saisonnière et annuelle du Kerala (mm), une ligne par année.

    Colonnes : ``JAN`` … ``DEC``, ``ANNUAL``, ``JF``, ``MAM``, ``JJAS``, ``OND``.
    """
    df = pd.read_csv(path).drop(columns="SUBDIVISION")
    df = df.set_index("YEAR").sort_index().astype(float)
    df.index.name = "year"
    return df


def load_temperatures(path: Path = TEMPERATURE_FILE) -> pd.DataFrame:
    """Températures mensuelles, saisonnières et annuelles de l'Inde (°C), une ligne par année.

    Les colonnes saisonnières sont renommées comme celles de la pluie (``JF``, ``MAM``,
    ``JJAS``, ``OND``) pour pouvoir comparer les deux tables.
    """
    renames = {"JAN-FEB": "JF", "MAR-MAY": "MAM", "JUN-SEP": "JJAS", "OCT-DEC": "OND"}
    df = pd.read_csv(path).rename(columns=renames)
    df = df.set_index("YEAR").sort_index().astype(float)
    df.index.name = "year"
    return df


def load_floods_2018(path: Path = FLOODS_FILE) -> pd.DataFrame:
    """Bilan des inondations d'août 2018 par district, avec l'écart à la pluie normale.

    Colonnes ajoutées : ``rain_ratio`` (observée / normale) et ``departure_pct``
    (écart à la normale, en %).
    """
    df = pd.read_csv(path).rename(columns=FLOOD_COLUMNS)
    df["district"] = df["district"].replace(DISTRICT_ALIASES)
    df["rain_ratio"] = df["rain_actual_mm"] / df["rain_normal_mm"]
    df["departure_pct"] = (df["rain_ratio"] - 1) * 100
    return df.set_index("district")


def load_imd_2018(path: Path = IMD_2018_FILE) -> pd.DataFrame:
    """Pluie de la mousson 2018 à l'échelle du Kerala (IMD) : observée, normale, écart (%).

    Index : ``JUN``, ``JUL``, ``AUG``, ``SEP`` et ``JJAS`` (saison complète).
    """
    return pd.read_csv(path).set_index("period")


def _clean_column(column: pd.Series) -> pd.Series:
    """Retire les espaces insécables qui servent de cellules vides dans le CSV source."""
    return column.str.replace("\xa0", " ", regex=False).str.strip()


def load_land_use(path: Path = LAND_USE_FILE) -> pd.DataFrame:
    """Occupation du sol (km²) d'une zone d'étude de 483 km², au format long.

    Le fichier source est un tableau mis en page : en-tête sur deux lignes, cellules vides
    (espaces insécables) pour les niveaux hiérarchiques répétés, lignes de sous-totaux.
    On reconstruit la hiérarchie (niveau 1 → classe), on écarte sous-totaux et total, et
    une surface vide devient une valeur manquante (classe non relevée cette année-là).

    Colonnes : ``group`` (niveau 1), ``subgroup`` (niveau 2), ``category`` (classe la plus
    fine), ``label_fr``, ``year``, ``area_km2``.
    """
    raw = pd.read_csv(path, header=None, dtype=str, keep_default_na=False).apply(_clean_column)
    years = [int(y) for y in raw.iloc[0, 3:]]
    body = raw.iloc[2:].copy()
    body.columns = ["group", "subgroup", "detail", *years]

    is_subtotal = body["group"].eq("Sub total")
    is_total = body[["group", "subgroup", "detail"]].eq("").all(axis=1)
    body = body.loc[~is_subtotal & ~is_total].copy()

    body["group"] = body["group"].replace("", pd.NA).ffill()
    body["subgroup"] = body["subgroup"].replace("", pd.NA)
    body["subgroup"] = body.groupby("group")["subgroup"].ffill()
    body["category"] = body["detail"].where(body["detail"].ne(""), body["subgroup"])

    long = body.melt(
        id_vars=["group", "subgroup", "category"],
        value_vars=years,
        var_name="year",
        value_name="area_km2",
    )
    long["year"] = long["year"].astype(int)
    long["area_km2"] = pd.to_numeric(long["area_km2"].replace("", pd.NA), errors="coerce")
    long["label_fr"] = long["category"].map(LAND_USE_LABELS_FR).fillna(long["category"])
    columns = ["group", "subgroup", "category", "label_fr", "year", "area_km2"]
    return long[columns].reset_index(drop=True)


def land_use_wide(land_use: pd.DataFrame) -> pd.DataFrame:
    """Tableau classes × années (km²), dans l'ordre du fichier source.

    Une classe non relevée une année donnée reste manquante (elle n'est pas mise à zéro).
    """
    order = list(dict.fromkeys(land_use["label_fr"]))
    wide = land_use.pivot(index="label_fr", columns="year", values="area_km2")
    return wide.reindex(order)


def load_districts_geojson(path: Path = DISTRICTS_FILE) -> dict:
    """Contours simplifiés des 14 districts du Kerala (GeoJSON, WGS84)."""
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)
