"""Tests de tendance, comparaisons de périodes et indicateurs de variabilité.

Conventions : les séries sont des ``pd.Series`` indexées par l'année ; les pentes sont
exprimées en unités par an (mm/an, °C/an) et converties au besoin (par décennie, par siècle).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import pymannkendall as mk
from scipy import stats

RANDOM_STATE = 42
ALPHA = 0.05


@dataclass(frozen=True)
class Trend:
    """Tendance linéaire d'une série annuelle et son intervalle de confiance à 95 %."""

    method: str
    slope: float
    intercept: float
    slope_low: float
    slope_high: float
    p_value: float
    n: int

    @property
    def per_decade(self) -> float:
        return self.slope * 10

    @property
    def per_century(self) -> float:
        return self.slope * 100

    @property
    def significant(self) -> bool:
        return self.p_value < ALPHA

    def predict(self, years: float | np.ndarray) -> float | np.ndarray:
        return self.intercept + self.slope * np.asarray(years, dtype=float)


def sen_mann_kendall(series: pd.Series, *, autocorrelation: bool = False) -> Trend:
    """Pente de Sen (IC 95 %) et p-valeur du test de Mann-Kendall.

    Méthode robuste et non paramétrique : la pente est la médiane des pentes entre toutes
    les paires d'années, insensible aux années extrêmes. Avec ``autocorrelation=True``, la
    p-valeur vient de la variante de Hamed & Rao, qui corrige l'autocorrélation de la série.
    """
    clean = series.dropna()
    years = clean.index.to_numpy(dtype=float)
    values = clean.to_numpy(dtype=float)
    test = mk.hamed_rao_modification_test(values) if autocorrelation else mk.original_test(values)
    slope, intercept, low, high = stats.theilslopes(values, years, alpha=1 - ALPHA)
    method = "Sen + Mann-Kendall (Hamed-Rao)" if autocorrelation else "Sen + Mann-Kendall"
    return Trend(method, slope, intercept, low, high, float(test.p), len(values))


def ols_trend(series: pd.Series) -> Trend:
    """Régression linéaire ordinaire (moindres carrés), IC 95 % de Student sur la pente."""
    clean = series.dropna()
    years = clean.index.to_numpy(dtype=float)
    fit = stats.linregress(years, clean.to_numpy(dtype=float))
    t_crit = stats.t.ppf(1 - ALPHA / 2, len(clean) - 2)
    half = t_crit * fit.stderr
    return Trend(
        "Moindres carrés",
        fit.slope,
        fit.intercept,
        fit.slope - half,
        fit.slope + half,
        fit.pvalue,
        len(clean),
    )


def bootstrap_slope_ci(
    series: pd.Series, n_boot: int = 2000, seed: int = RANDOM_STATE
) -> tuple[float, float]:
    """IC 95 % de la pente des moindres carrés par bootstrap des couples (année, valeur).

    C'est la méthode du projet d'origine, conservée comme vérification.
    """
    clean = series.dropna()
    years = clean.index.to_numpy(dtype=float)
    values = clean.to_numpy(dtype=float)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(values), size=(n_boot, len(values)))
    x = years[idx]
    y = values[idx]
    x_c = x - x.mean(axis=1, keepdims=True)
    slopes = (x_c * (y - y.mean(axis=1, keepdims=True))).sum(axis=1) / (x_c**2).sum(axis=1)
    low, high = np.percentile(slopes, [2.5, 97.5])
    return float(low), float(high)


def two_sigma_outliers(series: pd.Series) -> pd.Series:
    """Masque des années à plus de deux écarts-types de la moyenne (règle du projet d'origine).

    Ces années ne sont pas des erreurs : ce sont des extrêmes réels (1924, 2016…). On ne les
    retire que pour un test de sensibilité.
    """
    centred = (series - series.mean()).abs()
    return centred > 2 * series.std()


@dataclass(frozen=True)
class PeriodComparison:
    """Comparaison de deux périodes : moyennes, Welch, Mann-Whitney, dispersion."""

    label_a: str
    label_b: str
    n_a: int
    n_b: int
    mean_a: float
    mean_b: float
    welch_p: float
    mann_whitney_p: float
    std_a: float
    std_b: float
    cv_a: float
    cv_b: float
    levene_p: float

    @property
    def difference(self) -> float:
        return self.mean_b - self.mean_a


def compare_periods(
    series: pd.Series, period_a: tuple[int, int], period_b: tuple[int, int]
) -> PeriodComparison:
    """Compare deux périodes (bornes incluses) d'une série annuelle.

    - moyennes : test t de Welch (variances inégales) et test de Mann-Whitney (rangs) ;
    - dispersion : test de Brown-Forsythe (Levene centré sur la médiane), robuste aux
      distributions asymétriques comme la pluie.
    """
    a = series.loc[period_a[0] : period_a[1]].dropna()
    b = series.loc[period_b[0] : period_b[1]].dropna()
    welch = stats.ttest_ind(a, b, equal_var=False)
    mann_whitney = stats.mannwhitneyu(a, b, alternative="two-sided")
    levene = stats.levene(a, b, center="median")
    return PeriodComparison(
        label_a=f"{period_a[0]}–{period_a[1]}",
        label_b=f"{period_b[0]}–{period_b[1]}",
        n_a=len(a),
        n_b=len(b),
        mean_a=float(a.mean()),
        mean_b=float(b.mean()),
        welch_p=float(welch.pvalue),
        mann_whitney_p=float(mann_whitney.pvalue),
        std_a=float(a.std()),
        std_b=float(b.std()),
        cv_a=float(a.std() / a.mean()),
        cv_b=float(b.std() / b.mean()),
        levene_p=float(levene.pvalue),
    )


def rolling_cv(series: pd.Series, window: int = 30) -> pd.Series:
    """Coefficient de variation (écart-type / moyenne) sur une fenêtre glissante centrée.

    La valeur affectée à une année décrit la fenêtre de ``window`` ans qui l'entoure.
    """
    rolling = series.rolling(window, center=True, min_periods=window)
    return rolling.std() / rolling.mean()


def month_shares(rain: pd.DataFrame, months: tuple[str, ...]) -> pd.DataFrame:
    """Part de chaque mois dans le total annuel (somme des mois), année par année."""
    monthly = rain.loc[:, list(months)]
    return monthly.div(monthly.sum(axis=1), axis=0)


def deficient_years(series: pd.Series, threshold: float = 0.7) -> pd.Series:
    """Années sous ``threshold`` × la moyenne de la série (moussons « sèches »)."""
    limit = threshold * series.mean()
    return series[series < limit]


def rank_in_history(value: float, history: pd.Series) -> int:
    """Rang d'une valeur parmi une série historique (1 = la plus forte)."""
    return int((history > value).sum()) + 1


def spearman(x: pd.Series, y: pd.Series) -> tuple[float, float]:
    """Corrélation de rang de Spearman (rho, p-valeur), robuste aux valeurs extrêmes."""
    rho, p_value = stats.spearmanr(x, y)
    return float(rho), float(p_value)


def trend_summary(series: pd.Series, n_boot: int = 2000) -> pd.DataFrame:
    """Tendance d'une série estimée par plusieurs méthodes, exprimée par décennie.

    Permet de vérifier que la conclusion ne dépend ni de la méthode (robuste ou non), ni
    de l'autocorrélation, ni des années extrêmes retirées par la règle des deux écarts-types.
    """
    outliers = two_sigma_outliers(series)
    ols = ols_trend(series)
    boot_low, boot_high = bootstrap_slope_ci(series, n_boot)
    rows = [
        ("Sen + Mann-Kendall", sen_mann_kendall(series)),
        ("Sen + Mann-Kendall corrigé (Hamed-Rao)", sen_mann_kendall(series, autocorrelation=True)),
        ("Moindres carrés", ols),
        ("Moindres carrés sans les années à ±2σ", ols_trend(series[~outliers])),
    ]
    table = pd.DataFrame(
        [
            {
                "méthode": name,
                "pente / décennie": trend.per_decade,
                "IC 95 % bas": trend.slope_low * 10,
                "IC 95 % haut": trend.slope_high * 10,
                "p-valeur": trend.p_value,
                "années": trend.n,
            }
            for name, trend in rows
        ]
    ).set_index("méthode")
    table.loc["Moindres carrés, IC par bootstrap"] = [
        ols.per_decade,
        boot_low * 10,
        boot_high * 10,
        np.nan,
        ols.n,
    ]
    table["années"] = table["années"].astype(int)
    return table


def trends_by_column(frame: pd.DataFrame, labels: dict[str, str]) -> pd.DataFrame:
    """Pente de Sen (par décennie et en % de la moyenne par siècle) et p-valeur, par colonne."""
    rows = []
    for column, label in labels.items():
        series = frame[column]
        trend = sen_mann_kendall(series)
        rows.append(
            {
                "série": label,
                "moyenne": series.mean(),
                "pente / décennie": trend.per_decade,
                "IC 95 % bas": trend.slope_low * 10,
                "IC 95 % haut": trend.slope_high * 10,
                "variation / siècle (% de la moyenne)": 100 * trend.per_century / series.mean(),
                "p-valeur": trend.p_value,
            }
        )
    return pd.DataFrame(rows).set_index("série")


def format_p(p_value: float) -> str:
    """p-valeur lisible : « 0,013 », « < 0,001 » (vide si non définie)."""
    if p_value != p_value:  # NaN
        return ""
    if p_value < 0.001:
        return "< 0,001"
    return f"{p_value:.3f}".replace(".", ",")
