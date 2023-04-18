"""Tests de chargement et de cohérence des données brutes."""

import pytest

from kerala_rain.data import (
    MONTHS,
    land_use_wide,
    load_districts_geojson,
    load_floods_2018,
    load_imd_2018,
    load_land_use,
    load_rainfall,
    load_temperatures,
)


def test_rainfall_covers_1901_2017_without_gaps():
    rain = load_rainfall()
    assert rain.index.min() == 1901
    assert rain.index.max() == 2017
    assert rain.index.is_unique and len(rain) == 117
    assert not rain.isna().any().any()


def test_monthly_rainfall_adds_up_to_annual_total():
    rain = load_rainfall()
    gap = (rain.loc[:, list(MONTHS)].sum(axis=1) - rain["ANNUAL"]).abs()
    assert gap.max() < 0.5  # arrondis de la source, au dixième de mm


def test_temperature_seasons_are_renamed_like_rainfall():
    temps = load_temperatures()
    assert {"JF", "MAM", "JJAS", "OND", "ANNUAL"} <= set(temps.columns)
    assert len(temps) == 117


def test_flood_table_matches_reported_totals():
    floods = load_floods_2018()
    assert len(floods) == 14
    assert floods["fatalities"].sum() == 339
    assert floods["houses_destroyed"].sum() == 10319
    assert "Kasaragod" in floods.index  # orthographe harmonisée avec la carte


def test_flood_departure_is_relative_to_normal():
    idukki = load_floods_2018().loc["Idukki"]
    expected = (idukki["rain_actual_mm"] / idukki["rain_normal_mm"] - 1) * 100
    assert idukki["departure_pct"] == pytest.approx(expected)


def test_land_use_rebuilds_hierarchy_and_total_area():
    land_use = load_land_use()
    assert land_use.groupby("year")["area_km2"].sum().round(2).tolist() == [483.44] * 3
    paddy = land_use.query("category == 'Paddy'").set_index("year")["area_km2"]
    assert paddy.to_dict() == {1914: 41.268, 1967: 12.788, 2007: 11.527}
    rubber = land_use.query("category == 'Rubber'")
    assert set(rubber["subgroup"]) == {"Plantation"}


def test_land_use_keeps_missing_values():
    wide = land_use_wide(load_land_use())
    assert wide.loc["Cocoteraies", 1914] != wide.loc["Cocoteraies", 1914]  # NaN, pas zéro


def test_imd_2018_august_figure():
    imd = load_imd_2018()
    assert imd.loc["AUG", "actual_mm"] == 821.9
    assert imd.loc["AUG", "departure_pct"] == 96


def test_district_names_match_flood_table():
    names = {f["properties"]["district"] for f in load_districts_geojson()["features"]}
    assert names == set(load_floods_2018().index)
