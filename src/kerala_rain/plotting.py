"""Style graphique commun aux figures du notebook (aligné sur la palette du site).

Couleurs validées pour la vision des couleurs (paires utilisées ensemble) :
pluie / mousson sèche, rizières / hévéa. La rampe « pluie » est séquentielle
(jaune-vert → bleu nuit, dérivée de ColorBrewer YlGnBu), la rampe « bilan » ne sert
qu'au bilan humain de 2018, la rampe divergente aux anomalies de température.
"""

from __future__ import annotations

import matplotlib as mpl
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd
from matplotlib import font_manager
from matplotlib.axes import Axes
from matplotlib.colors import LinearSegmentedColormap, Normalize
from matplotlib.patches import Polygon as MplPolygon
from shapely.geometry import MultiPolygon

from .data import MONTHS, MONTHS_FR
from .geo import district_shapes

INK = "#0e1f1b"
INK_2 = "#3c4f49"
MUTED = "#6b7b75"
LINE = "#dbe3df"
AXIS = "#b5c2bc"
SURFACE = "#ffffff"
ACCENT = "#0d6e5f"

RAIN = "#2f77bd"
DRY = "#c08410"
PADDY = "#c08410"
RUBBER = "#0a8a72"
CORAL = "#d9553f"
CONTEXT = "#b9c4bf"

RAIN_RAMP = (
    "#ffffd9",
    "#edf8b1",
    "#c7e9b4",
    "#7fcdbb",
    "#41b6c4",
    "#1d91c0",
    "#225ea8",
    "#253494",
    "#081d58",
)
TOLL_RAMP = ("#fde9e3", "#f9c9bb", "#f2a28c", "#e6785e", "#d4553d", "#b13a26", "#83271a")
DIVERGING_RAMP = (
    "#1d4f91",
    "#3e75b5",
    "#7ba3d2",
    "#bdd2ea",
    "#efeeea",
    "#f1c6b4",
    "#e08d70",
    "#c4513a",
    "#8e2416",
)

SOURCE_IMD = "Source : India Meteorological Department (data.gov.in)"


FONT_PREFERENCES = ("Instrument Sans", "Inter", "DejaVu Sans")


def _first_available_font() -> str:
    """Première police de ``FONT_PREFERENCES`` installée (évite les avertissements)."""
    installed = {font.name for font in font_manager.fontManager.ttflist}
    return next((name for name in FONT_PREFERENCES if name in installed), "DejaVu Sans")


def use_style() -> None:
    """Applique le style des figures (polices, grille discrète, couleurs d'encre)."""
    mpl.rcParams.update(
        {
            "figure.dpi": 110,
            "savefig.dpi": 200,
            "figure.facecolor": SURFACE,
            "axes.facecolor": SURFACE,
            "font.family": _first_available_font(),
            "font.size": 10.5,
            "text.color": INK,
            "axes.labelcolor": INK_2,
            "axes.edgecolor": AXIS,
            "axes.linewidth": 0.8,
            "axes.titlesize": 13,
            "axes.titleweight": "semibold",
            "axes.titlelocation": "left",
            "axes.titlepad": 12,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "axes.grid.axis": "y",
            "axes.axisbelow": True,
            "grid.color": LINE,
            "grid.linewidth": 0.8,
            "xtick.color": MUTED,
            "ytick.color": MUTED,
            "xtick.major.size": 0,
            "ytick.major.size": 0,
            "legend.frameon": False,
            "legend.fontsize": 9.5,
            "lines.linewidth": 2,
            "lines.solid_capstyle": "round",
        }
    )


def cmap(ramp: tuple[str, ...], name: str) -> LinearSegmentedColormap:
    """Palette continue à partir d'une rampe de couleurs."""
    return LinearSegmentedColormap.from_list(name, list(ramp))


RAIN_CMAP = cmap(RAIN_RAMP, "pluie")
TOLL_CMAP = cmap(TOLL_RAMP, "bilan")
DIVERGING_CMAP = cmap(DIVERGING_RAMP, "anomalie")


def source_note(fig: plt.Figure, text: str = SOURCE_IMD) -> None:
    """Ajoute la source en bas à gauche de la figure."""
    fig.text(0.01, 0.005, text, fontsize=8.5, color=MUTED, ha="left", va="bottom")


def annual_bars(
    ax: Axes,
    series: pd.Series,
    highlight: dict[int, str] | None = None,
    color: str = RAIN,
) -> None:
    """Barres annuelles fines ; les années de ``highlight`` reçoivent leur propre couleur."""
    highlight = highlight or {}
    colors = [highlight.get(int(year), color) for year in series.index]
    ax.bar(series.index, series.to_numpy(), width=0.72, color=colors, linewidth=0)
    ax.set_xlim(series.index.min() - 1.5, series.index.max() + 1.5)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:,.0f}".replace(",", " ")))


def label_bars(ax: Axes, series: pd.Series, years: list[int], window: int = 2) -> None:
    """Nomme des barres annuelles ; l'étiquette passe au-dessus des barres voisines.

    Quand une barre basse est entourée de barres plus hautes, l'étiquette est posée au-dessus
    du maximum local (``window`` années de part et d'autre) et reliée à la barre par un trait.
    """
    span = ax.get_ylim()[1] - ax.get_ylim()[0]
    for year in years:
        value = series[year]
        neighbours = series.loc[year - window : year + window].max()
        label_y = max(value, neighbours) + 0.02 * span
        leader = (
            {"arrowstyle": "-", "lw": 0.8, "color": MUTED}
            if label_y > value + 0.03 * span
            else None
        )
        ax.annotate(
            str(year),
            xy=(year, value),
            xytext=(year, label_y),
            ha="center",
            va="bottom",
            fontsize=8.5,
            color=INK_2,
            arrowprops=leader,
        )


def trend_line(ax: Axes, trend, years: np.ndarray, label: str, color: str = INK) -> None:
    """Droite de tendance et sa bande d'incertitude (IC 95 % de la pente, pivot au centre)."""
    years = np.asarray(years, dtype=float)
    centre = np.median(years)
    level = trend.predict(centre)
    low = level + trend.slope_low * (years - centre)
    high = level + trend.slope_high * (years - centre)
    ax.fill_between(
        years, np.minimum(low, high), np.maximum(low, high), color=color, alpha=0.08, lw=0
    )
    ax.plot(years, trend.predict(years), color=color, lw=2, label=label)


def month_year_heatmap(ax: Axes, rain: pd.DataFrame) -> mpl.image.AxesImage:
    """Carte de chaleur mois × années (racine carrée des mm, pour lire aussi la saison sèche)."""
    values = rain.loc[:, list(MONTHS)].T.to_numpy()
    years = rain.index.to_numpy()
    image = ax.imshow(
        np.sqrt(values),
        aspect="auto",
        cmap=RAIN_CMAP,
        interpolation="nearest",
        extent=(years.min() - 0.5, years.max() + 0.5, 11.5, -0.5),
    )
    ax.set_yticks(range(12), MONTHS_FR)
    ax.grid(False)
    ax.spines[["left", "bottom"]].set_visible(False)
    return image


def sqrt_colorbar(fig: plt.Figure, image, ax: Axes, ticks_mm: tuple[int, ...], label: str) -> None:
    """Barre de couleur graduée en mm pour une image tracée en racine carrée."""
    bar = fig.colorbar(image, ax=ax, fraction=0.025, pad=0.01)
    bar.set_ticks(
        [np.sqrt(t) for t in ticks_mm], labels=[f"{t:,}".replace(",", " ") for t in ticks_mm]
    )
    bar.set_label(label, color=INK_2)
    bar.outline.set_visible(False)


def choropleth(
    ax: Axes,
    geojson: dict,
    values: pd.Series,
    colormap: LinearSegmentedColormap,
    vmin: float | None = None,
    vmax: float | None = None,
    label_values: bool = True,
    fmt: str = "{:.0f}",
) -> mpl.cm.ScalarMappable:
    """Carte choroplèthe des districts ; renvoie l'objet pour la barre de couleur."""
    norm = Normalize(
        vmin=values.min() if vmin is None else vmin, vmax=values.max() if vmax is None else vmax
    )
    for name, geom in district_shapes(geojson).items():
        polygons = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
        face = colormap(norm(values[name]))
        for polygon in polygons:
            patch = MplPolygon(
                np.asarray(polygon.exterior.coords),
                closed=True,
                facecolor=face,
                edgecolor=SURFACE,
                lw=1.2,
            )
            ax.add_patch(patch)
        if label_values:
            point = geom.representative_point()
            luminance = np.dot(face[:3], [0.2126, 0.7152, 0.0722])
            ax.text(
                point.x,
                point.y,
                fmt.format(values[name]),
                ha="center",
                va="center",
                fontsize=8,
                fontweight="semibold",
                color="white" if luminance < 0.45 else INK,
            )
    ax.autoscale_view()
    ax.set_aspect(1 / np.cos(np.radians(10.5)))
    ax.axis("off")
    return mpl.cm.ScalarMappable(norm=norm, cmap=colormap)


def warming_stripes(ax: Axes, series: pd.Series, reference: float | None = None) -> None:
    """« Bandes de réchauffement » : une bande par année, couleur = écart à la moyenne."""
    reference = series.mean() if reference is None else reference
    anomaly = series - reference
    limit = float(np.abs(anomaly).max())
    norm = Normalize(-limit, limit)
    for year, value in anomaly.items():
        ax.axvspan(year - 0.5, year + 0.5, color=DIVERGING_CMAP(norm(value)), lw=0)
    ax.set_xlim(series.index.min() - 0.5, series.index.max() + 0.5)
    ax.set_yticks([])
    ax.grid(False)
    ax.spines[["left", "bottom"]].set_visible(False)


def emphasis_bars(
    ax: Axes,
    labels: list[str],
    values: np.ndarray,
    emphasised: set[str],
    color: str = RAIN,
    fmt: str = "{:.0f}",
) -> None:
    """Barres verticales : les catégories mises en avant en couleur, les autres en gris."""
    colors = [color if label in emphasised else CONTEXT for label in labels]
    bars = ax.bar(labels, values, width=0.62, color=colors, linewidth=0)
    for bar, value in zip(bars, values, strict=True):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height(),
            fmt.format(value),
            ha="center",
            va="bottom",
            fontsize=8.5,
            color=INK_2,
        )


def dumbbell(
    ax: Axes,
    labels: list[str],
    before: np.ndarray,
    after: np.ndarray,
    names: tuple[str, str],
    colors: tuple[str, str] = (CONTEXT, RAIN),
) -> None:
    """Graphique « haltère » : une ligne par catégorie, de la valeur avant à la valeur après."""
    positions = np.arange(len(labels))[::-1]
    for y, start, end in zip(positions, before, after, strict=True):
        ax.plot([start, end], [y, y], color=LINE, lw=3, solid_capstyle="round", zorder=1)
    ax.scatter(before, positions, s=46, color=colors[0], label=names[0], zorder=2, ec=SURFACE)
    ax.scatter(after, positions, s=46, color=colors[1], label=names[1], zorder=3, ec=SURFACE)
    ax.set_yticks(positions, labels)
    ax.grid(axis="x")
    ax.grid(axis="y", visible=False)


def labelled_scatter(
    ax: Axes, x: pd.Series, y: pd.Series, n_labels: int = 5, color: str = CORAL
) -> None:
    """Nuage de points ; seuls les ``n_labels`` points les plus hauts sont nommés."""
    ax.scatter(x, y, s=48, color=color, ec=SURFACE, lw=1.5, zorder=3)
    for name in y.nlargest(n_labels).index:
        ax.annotate(
            name,
            (x[name], y[name]),
            xytext=(6, 3),
            textcoords="offset points",
            fontsize=8.5,
            color=INK_2,
        )
    ax.grid(axis="both")


def _spread(positions: list[float], min_gap: float) -> list[float]:
    """Écarte des positions verticales triées pour garantir un intervalle minimal."""
    spread = list(positions)
    for i in range(1, len(spread)):
        spread[i] = max(spread[i], spread[i - 1] + min_gap)
    return spread


def slope_chart(
    ax: Axes,
    wide: pd.DataFrame,
    highlight: dict[str, str],
    annotate: tuple[str, ...] = (),
) -> None:
    """Évolution de chaque classe d'une année à l'autre.

    ``highlight`` associe une couleur aux classes mises en avant ; les autres restent en gris.
    Les classes de ``annotate`` (en gris) sont nommées en fin de ligne, comme les classes
    mises en avant. Les étiquettes trop proches sont écartées et reliées à leur ligne.
    """
    years = list(wide.columns)
    labels = []
    for label, values in wide.iterrows():
        emphasised = label in highlight
        ax.plot(
            years,
            values.to_numpy(dtype=float),
            color=highlight.get(label, CONTEXT),
            lw=2.4 if emphasised else 1.2,
            marker="o",
            ms=5 if emphasised else 3,
            mec=SURFACE,
            zorder=3 if emphasised else 2,
        )
        last = values.dropna()
        if (emphasised or label in annotate) and not last.empty:
            labels.append((float(last.iloc[-1]), int(last.index[-1]), label, emphasised))

    labels.sort()
    span = float(np.nanmax(wide.to_numpy(dtype=float)))
    targets = _spread([value for value, *_ in labels], 0.055 * span)
    for (value, year, label, emphasised), target in zip(labels, targets, strict=True):
        ax.annotate(
            f"{label} ({value:.1f} km²)".replace(".", ","),
            xy=(year, value),
            xytext=(year + 4, target),
            va="center",
            fontsize=9,
            color=INK if emphasised else INK_2,
            arrowprops={"arrowstyle": "-", "lw": 0.8, "color": MUTED},
        )
    ax.set_xticks(years, [str(y) for y in years])
    ax.set_xlim(years[0] - 4, years[-1] + 38)
