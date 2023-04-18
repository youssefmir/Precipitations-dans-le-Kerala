"""Tests des fonctions statistiques sur des séries synthétiques."""

import numpy as np
import pandas as pd
import pytest

from kerala_rain.stats import (
    bootstrap_slope_ci,
    compare_periods,
    deficient_years,
    month_shares,
    ols_trend,
    rank_in_history,
    rolling_cv,
    sen_mann_kendall,
    two_sigma_outliers,
)

YEARS = pd.RangeIndex(1901, 2001)


def linear_series(slope: float, noise: float = 0.0, seed: int = 0) -> pd.Series:
    rng = np.random.default_rng(seed)
    values = 100 + slope * (YEARS - 1901) + rng.normal(0, noise, len(YEARS))
    return pd.Series(values, index=YEARS)


def test_sen_slope_recovers_exact_linear_trend():
    trend = sen_mann_kendall(linear_series(-2.0))
    assert trend.slope == pytest.approx(-2.0)
    assert trend.per_decade == pytest.approx(-20.0)
    assert trend.significant


def test_no_trend_in_pure_noise():
    trend = sen_mann_kendall(linear_series(0.0, noise=10, seed=1))
    assert not trend.significant
    assert trend.slope_low < 0 < trend.slope_high


def test_ols_and_bootstrap_agree_on_noisy_trend():
    series = linear_series(1.5, noise=5)
    trend = ols_trend(series)
    low, high = bootstrap_slope_ci(series, n_boot=500)
    assert trend.slope_low < 1.5 < trend.slope_high
    assert low < trend.slope < high


def test_two_sigma_rule_flags_injected_extreme():
    series = linear_series(0.0, noise=1)
    series.loc[1950] = 1000
    assert two_sigma_outliers(series).loc[1950]


def test_compare_periods_detects_shift_in_mean():
    series = pd.Series(np.r_[np.full(50, 10.0), np.full(50, 20.0)], index=YEARS)
    series += np.random.default_rng(2).normal(0, 1, len(series))
    result = compare_periods(series, (1901, 1950), (1951, 2000))
    assert result.difference == pytest.approx(10, abs=1)
    assert result.welch_p < 0.001 and result.mann_whitney_p < 0.001


def test_rolling_cv_of_constant_series_is_zero():
    cv = rolling_cv(pd.Series(5.0, index=YEARS), window=30).dropna()
    assert len(cv) == len(YEARS) - 29
    assert (cv == 0).all()


def test_month_shares_sum_to_one():
    rain = pd.DataFrame({"JAN": [1.0, 2.0], "FEB": [3.0, 2.0]})
    shares = month_shares(rain, ("JAN", "FEB"))
    assert shares.sum(axis=1).tolist() == [1.0, 1.0]


def test_deficient_years_and_rank():
    series = pd.Series([100.0, 100.0, 50.0, 150.0], index=[1, 2, 3, 4])
    assert deficient_years(series, 0.7).index.tolist() == [3]
    assert rank_in_history(120.0, series) == 2


def test_format_p():
    from kerala_rain.stats import format_p

    assert format_p(0.0214) == "0,021"
    assert format_p(1e-9) == "< 0,001"
    assert format_p(float("nan")) == ""
