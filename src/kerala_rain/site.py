"""Export des données du site interactif (``docs/data.js``).

Toutes les valeurs affichées par le site sont calculées ici, avec les mêmes fonctions que
le notebook : le site ne refait aucun calcul statistique.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from .data import (
    MONTHS,
    MONTHS_FR,
    PROJECT_ROOT,
    land_use_wide,
    load_districts_geojson,
    load_floods_2018,
    load_imd_2018,
    load_land_use,
    load_rainfall,
    load_temperatures,
)
from .geo import Projection, area_weighted_mean, district_shapes, district_table, to_svg_path
from .stats import (
    Trend,
    compare_periods,
    deficient_years,
    month_shares,
    ols_trend,
    rank_in_history,
    rolling_cv,
    sen_mann_kendall,
    spearman,
    two_sigma_outliers,
)

SITE_DATA_FILE = PROJECT_ROOT / "docs" / "data.js"
EARLY = (1901, 1930)
LATE = (1988, 2017)
MAP_WIDTH = 300


def _round(values, ndigits: int = 1) -> list:
    """Liste JSON arrondie (les valeurs manquantes deviennent ``null``)."""
    return [None if pd.isna(v) else round(float(v), ndigits) for v in values]


def _pvalue(p: float) -> float:
    """p-valeur arrondie à trois chiffres significatifs."""
    return float(f"{p:.3g}")


def _trend(trend: Trend, ndigits: int = 3) -> dict:
    return {
        "method": trend.method,
        "slope": round(trend.slope, ndigits),
        "low": round(trend.slope_low, ndigits),
        "high": round(trend.slope_high, ndigits),
        "intercept": round(trend.intercept, 2),
        "p": _pvalue(trend.p_value),
    }


def _rain_block(rain: pd.DataFrame) -> dict:
    annual = rain["ANNUAL"]
    jjas = rain["JJAS"]
    sen = sen_mann_kendall(annual)
    first, last = int(rain.index.min()), int(rain.index.max())
    dry = deficient_years(jjas, 0.7)
    shares = month_shares(rain, MONTHS)
    share_tests = [compare_periods(shares[m], EARLY, LATE) for m in MONTHS]
    cv_jjas = rolling_cv(jjas)
    cv_annual = rolling_cv(annual)
    comparison = compare_periods(jjas, (1901, 1920), (2000, 2017))
    comparison_annual = compare_periods(annual, (1901, 1920), (2000, 2017))
    climatology = rain.loc[:, list(MONTHS)].mean()
    return {
        "years": [int(y) for y in rain.index],
        "months": list(MONTHS_FR),
        "monthly": [_round(row, 1) for row in rain.loc[:, list(MONTHS)].to_numpy()],
        "annual": _round(annual),
        "jjas": _round(jjas),
        "mean": round(float(annual.mean()), 1),
        "std": round(float(annual.std()), 1),
        "jjasMean": round(float(jjas.mean()), 1),
        "jjasShare": round(float(jjas.mean() / annual.mean()), 4),
        "climatology": _round(climatology, 1),
        "trend": {
            "sen": _trend(sen),
            "ols": _trend(ols_trend(annual)),
            "fitted": [round(float(sen.predict(first)), 1), round(float(sen.predict(last)), 1)],
        },
        "jjasTrend": _trend(sen_mann_kendall(jjas)),
        "outliers": [int(y) for y in annual[two_sigma_outliers(annual)].index],
        "extremes": {
            "wettest": [int(annual.idxmax()), round(float(annual.max()), 1)],
            "driest": [int(annual.idxmin()), round(float(annual.min()), 1)],
            "wettestMonth": [1924, "JUL", round(float(rain.loc[1924, "JUL"]), 1)],
        },
        "dry": {
            "threshold": round(float(0.7 * jjas.mean()), 1),
            "years": [int(y) for y in dry.index],
        },
        "variability": {
            "rollingCv": {
                "years": [int(y) for y in cv_jjas.dropna().index],
                "jjas": _round(cv_jjas.dropna(), 4),
                "annual": _round(cv_annual.dropna(), 4),
            },
            "comparison": {
                "periods": [comparison.label_a, comparison.label_b],
                "jjasStd": [round(comparison.std_a, 1), round(comparison.std_b, 1)],
                "jjasP": _pvalue(comparison.levene_p),
                "annualStd": [round(comparison_annual.std_a, 1), round(comparison_annual.std_b, 1)],
                "annualP": _pvalue(comparison_annual.levene_p),
            },
        },
        "shares": {
            "periods": [f"{EARLY[0]}–{EARLY[1]}", f"{LATE[0]}–{LATE[1]}"],
            "early": [round(t.mean_a, 4) for t in share_tests],
            "late": [round(t.mean_b, 4) for t in share_tests],
            "p": [_pvalue(t.mann_whitney_p) for t in share_tests],
        },
    }


def _aug_2018_block(rain: pd.DataFrame) -> dict:
    imd = load_imd_2018()
    august = rain["AUG"]
    aug_2018 = float(imd.loc["AUG", "actual_mm"])
    top = august.sort_values(ascending=False).head(3)
    return {
        "imd": {
            period: {
                "actual": float(row.actual_mm),
                "normal": float(row.normal_mm),
                "departure": int(row.departure_pct),
            }
            for period, row in imd.iterrows()
        },
        "augustHistory": _round(august, 1),
        "augustRank": rank_in_history(aug_2018, august),
        "augustTop": [[int(y), round(float(v), 1)] for y, v in top.items()],
        "jjasRank": rank_in_history(float(imd.loc["JJAS", "actual_mm"]), rain["JJAS"]),
    }


def _floods_block() -> dict:
    floods = load_floods_2018()
    geojson = load_districts_geojson()
    shapes = district_shapes(geojson)
    table = district_table(geojson)
    minx, miny, maxx, maxy = np.array([g.bounds for g in shapes.values()]).T
    projection = Projection((minx.min(), miny.min(), maxx.max(), maxy.max()), MAP_WIDTH, pad=6)
    districts = []
    for name, row in floods.sort_values("rain_actual_mm", ascending=False).iterrows():
        cx, cy = projection(table.loc[name, "lon"], table.loc[name, "lat"])
        districts.append(
            {
                "name": name,
                "actual": row.rain_actual_mm,
                "normal": row.rain_normal_mm,
                "departure": round(float(row.departure_pct), 2),
                "fatalities": int(row.fatalities),
                "landslides": int(row.landslides),
                "camps": int(row.relief_camps),
                "houses": int(row.houses_destroyed),
                "area": round(float(table.loc[name, "area_km2"])),
                "path": to_svg_path(shapes[name], projection),
                "cx": round(cx, 1),
                "cy": round(cy, 1),
            }
        )
    rho = {
        key: [round(v, 3) for v in spearman(floods["rain_actual_mm"], floods[key])]
        for key in ("landslides", "fatalities", "houses_destroyed")
    }
    return {
        "viewBox": [MAP_WIDTH, round(projection.height, 1)],
        "districts": districts,
        "totals": {
            "fatalities": int(floods["fatalities"].sum()),
            "landslides": int(floods["landslides"].sum()),
            "camps": int(floods["relief_camps"].sum()),
            "houses": int(floods["houses_destroyed"].sum()),
        },
        "weighted": {
            "actual": round(area_weighted_mean(floods["rain_actual_mm"], table["area_km2"]), 1),
            "normal": round(area_weighted_mean(floods["rain_normal_mm"], table["area_km2"]), 1),
        },
        "spearman": rho,
    }


def _temperature_block() -> dict:
    temps = load_temperatures()
    seasons = {"JF": "Janv.–févr.", "MAM": "Mars–mai", "JJAS": "Juin–sept.", "OND": "Oct.–déc."}
    halves = compare_periods(temps["ANNUAL"], (1901, 1959), (1960, 2017))
    annual_trend = sen_mann_kendall(temps["ANNUAL"])
    return {
        "years": [int(y) for y in temps.index],
        "annual": _round(temps["ANNUAL"], 2),
        "mean": round(float(temps["ANNUAL"].mean()), 2),
        "trend": _trend(annual_trend, 5),
        "seasons": [
            {
                "key": key,
                "label": label,
                "perCentury": round(sen_mann_kendall(temps[key]).per_century, 2),
                "low": round(sen_mann_kendall(temps[key]).slope_low * 100, 2),
                "high": round(sen_mann_kendall(temps[key]).slope_high * 100, 2),
                "p": _pvalue(sen_mann_kendall(temps[key]).p_value),
            }
            for key, label in seasons.items()
        ],
        "halves": {
            "periods": [halves.label_a, halves.label_b],
            "means": [round(halves.mean_a, 2), round(halves.mean_b, 2)],
            "welchP": _pvalue(halves.welch_p),
            "mannWhitneyP": _pvalue(halves.mann_whitney_p),
        },
        "warmest": [[int(y), round(float(v), 2)] for y, v in temps["ANNUAL"].nlargest(3).items()],
    }


def _land_use_block() -> dict:
    land_use = load_land_use()
    wide = land_use_wide(land_use)
    groups = land_use.drop_duplicates("label_fr").set_index("label_fr")["group"]
    totals = land_use.groupby(["group", "year"])["area_km2"].sum().unstack()
    return {
        "years": [int(y) for y in wide.columns],
        "area": round(float(land_use.groupby("year")["area_km2"].sum().iloc[0]), 1),
        "rows": [
            {"label": label, "group": groups[label], "values": _round(values, 2)}
            for label, values in wide.iterrows()
        ],
        "forestTotal": _round(totals.loc["Forest"], 1),
    }


def build_site_data() -> dict:
    """Assemble toutes les données du site dans un dictionnaire sérialisable en JSON."""
    rain = load_rainfall()
    return {
        "rain": _rain_block(rain),
        "aug2018": _aug_2018_block(rain),
        "floods": _floods_block(),
        "temperature": _temperature_block(),
        "landUse": _land_use_block(),
    }


def write_site_data(path: Path = SITE_DATA_FILE) -> Path:
    """Écrit ``window.SITE_DATA = {...};`` (JSON compact, déterministe)."""
    payload = json.dumps(build_site_data(), ensure_ascii=False, separators=(",", ":"))
    header = "/* Fichier généré par scripts/build_site_data.py. Ne pas modifier à la main. */\n"
    path.write_text(f"{header}window.SITE_DATA = {payload};\n", encoding="utf-8")
    return path
