"""Tests de la géographie (surfaces, projection) et de l'export du site."""

import json

import pytest
from shapely.geometry import box

from kerala_rain.data import load_districts_geojson
from kerala_rain.geo import Projection, district_table, simplify_districts, to_svg_path
from kerala_rain.site import build_site_data


def test_kerala_area_is_close_to_official_figure():
    total = district_table(load_districts_geojson())["area_km2"].sum()
    assert total == pytest.approx(38_863, rel=0.01)  # superficie officielle : 38 863 km²


def test_simplification_keeps_shared_borders():
    left = box(0, 0, 1, 1)
    right = box(1, 0, 2, 1)
    geojson = {
        "features": [
            {"properties": {"DISTRICT": "A"}, "geometry": left.__geo_interface__},
            {"properties": {"DISTRICT": "B"}, "geometry": right.__geo_interface__},
        ]
    }
    names = [f["properties"]["district"] for f in simplify_districts(geojson)["features"]]
    assert names == ["A", "B"]


def test_projection_and_svg_path():
    projection = Projection((0, 0, 1, 1), width=100)
    assert projection(0, 1) == (0, 0)
    path = to_svg_path(box(0, 0, 1, 1), projection)
    assert path.startswith("M") and path.endswith("Z")


def test_site_data_is_complete_and_serialisable():
    data = build_site_data()
    assert set(data) == {"rain", "aug2018", "floods", "temperature", "landUse"}
    assert len(data["rain"]["monthly"]) == 117
    assert data["aug2018"]["augustRank"] == 4
    assert len(data["floods"]["districts"]) == 14
    json.dumps(data)
