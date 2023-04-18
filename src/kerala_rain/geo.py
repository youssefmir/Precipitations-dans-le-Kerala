"""Géographie des districts du Kerala : simplification des contours, surfaces, centroïdes.

Les contours viennent de DataMeet (via le dépôt ``geohacker/kerala``, CC BY 4.0). Ils sont
simplifiés frontière par frontière : chaque limite partagée par deux districts n'est
simplifiée qu'une fois, puis les polygones sont reconstruits. Les cartes n'ont ainsi ni
trou ni chevauchement entre districts voisins.
"""

from __future__ import annotations

import math
from collections.abc import Iterable

import pandas as pd
import shapely
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import linemerge, unary_union

SOURCE_URL = "https://raw.githubusercontent.com/geohacker/kerala/master/geojsons/district.geojson"
ATTRIBUTION = "Contours des districts : DataMeet India (via geohacker/kerala), CC BY 4.0"

KM_PER_DEG_LAT = 110.574
KM_PER_DEG_LON_EQUATOR = 111.320


def simplify_districts(geojson: dict, tolerance: float = 0.004, ndigits: int = 4) -> dict:
    """Simplifie les contours des districts en conservant les frontières communes.

    1. L'union des contours découpe les limites aux points triples : chaque frontière
       partagée n'existe plus qu'une fois.
    2. Chaque frontière est simplifiée (Douglas-Peucker, extrémités fixes) puis arrondie.
    3. Les polygones sont reconstruits et rattachés au district d'origine.

    ``tolerance`` est exprimée en degrés (0,004° ≈ 400 m) ; les coordonnées sont arrondies
    à ``ndigits`` décimales (1e-4° ≈ 11 m). Seul le nom du district est conservé.
    """
    names = [f["properties"]["DISTRICT"] for f in geojson["features"]]
    geoms = [shape(f["geometry"]) for f in geojson["features"]]

    borders = linemerge(unary_union([geom.boundary for geom in geoms]))
    lines = list(getattr(borders, "geoms", [borders]))
    grid = 10.0**-ndigits
    simplified = [
        shapely.set_precision(line.simplify(tolerance, preserve_topology=True), grid)
        for line in lines
    ]
    noded = shapely.get_parts(unary_union(simplified))
    pieces = shapely.get_parts(shapely.polygonize(noded))

    parts: dict[str, list[Polygon]] = {name: [] for name in names}
    for piece in pieces:
        point = piece.representative_point()
        owner = next((n for n, g in zip(names, geoms, strict=True) if g.contains(point)), None)
        if owner is not None:
            parts[owner].append(piece)

    features = [
        {
            "type": "Feature",
            "properties": {"district": name},
            "geometry": _round_coordinates(mapping(unary_union(parts[name])), ndigits),
        }
        for name in names
    ]
    return {"type": "FeatureCollection", "attribution": ATTRIBUTION, "features": features}


def _round_coordinates(geometry: dict, ndigits: int) -> dict:
    """Arrondit les coordonnées GeoJSON (sortie identique d'une machine à l'autre)."""

    def walk(node):
        if isinstance(node, list | tuple) and node and isinstance(node[0], int | float):
            return [round(float(v), ndigits) for v in node]
        return [walk(child) for child in node]

    return {"type": geometry["type"], "coordinates": walk(geometry["coordinates"])}


def district_shapes(geojson: dict) -> dict[str, Polygon | MultiPolygon]:
    """Dictionnaire ``nom du district → géométrie shapely``."""
    return {f["properties"]["district"]: shape(f["geometry"]) for f in geojson["features"]}


def _local_km(geom: Polygon | MultiPolygon) -> Polygon | MultiPolygon:
    """Projette une géométrie en kilomètres (équirectangulaire centrée sur la géométrie)."""
    lat0 = math.radians(geom.centroid.y)
    kx = KM_PER_DEG_LON_EQUATOR * math.cos(lat0)
    return shapely.transform(geom, lambda xy: xy * [kx, KM_PER_DEG_LAT])


def district_table(geojson: dict) -> pd.DataFrame:
    """Surface (km²) et centroïde (longitude, latitude) de chaque district."""
    rows = []
    for name, geom in district_shapes(geojson).items():
        point = geom.representative_point()
        rows.append(
            {
                "district": name,
                "area_km2": _local_km(geom).area,
                "lon": point.x,
                "lat": point.y,
            }
        )
    return pd.DataFrame(rows).set_index("district").sort_index()


def area_weighted_mean(values: pd.Series, areas: pd.Series) -> float:
    """Moyenne pondérée par la surface (index commun = districts)."""
    aligned = pd.concat([values, areas], axis=1, join="inner").dropna()
    weights = aligned.iloc[:, 1]
    return float((aligned.iloc[:, 0] * weights).sum() / weights.sum())


class Projection:
    """Projection équirectangulaire ajustée à un cadre (pixels), pour exporter en SVG."""

    def __init__(self, bounds: tuple[float, float, float, float], width: float, pad: float = 0):
        minx, miny, maxx, maxy = bounds
        self.kx = math.cos(math.radians((miny + maxy) / 2))
        span_x = (maxx - minx) * self.kx
        span_y = maxy - miny
        self.scale = (width - 2 * pad) / span_x
        self.minx, self.maxy, self.pad = minx, maxy, pad
        self.width = width
        self.height = span_y * self.scale + 2 * pad

    def __call__(self, lon: float, lat: float) -> tuple[float, float]:
        x = self.pad + (lon - self.minx) * self.kx * self.scale
        y = self.pad + (self.maxy - lat) * self.scale
        return x, y


def _rings(geom: Polygon | MultiPolygon) -> Iterable:
    polygons = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    for polygon in polygons:
        yield polygon.exterior.coords
        yield from (interior.coords for interior in polygon.interiors)


def to_svg_path(geom: Polygon | MultiPolygon, projection: Projection, ndigits: int = 1) -> str:
    """Chemin SVG (attribut ``d``) d'une géométrie projetée."""
    parts = []
    for ring in _rings(geom):
        points = [projection(lon, lat) for lon, lat in ring]
        head, *tail = points
        coords = " ".join(f"{x:.{ndigits}f},{y:.{ndigits}f}" for x, y in tail[:-1])
        parts.append(f"M{head[0]:.{ndigits}f},{head[1]:.{ndigits}f} L{coords} Z")
    return " ".join(parts)
