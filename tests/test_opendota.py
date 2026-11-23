"""Tests for the shared OpenDota client (backend.opendota)."""

import logging
import os
from unittest.mock import MagicMock, patch

import pytest
import requests

from backend.logging_config import LOG_FILE_ENV
from backend.opendota import (
    NO_ANSWER_RETRIES,
    RATE_LIMIT_RETRIES,
    OpenDotaError,
    get_json,
    opendota_get,
    opendota_url,
)
from backend.rate_limit import DailyLimitReached


def _response(payload, status: int = 200, text: str = "") -> MagicMock:
    resp = MagicMock()
    resp.status_code = status
    resp.text = text
    resp.json.return_value = payload
    resp.headers = {}
    return resp


def test_path_is_joined_to_api_url():
    assert opendota_url("/teams/1") == "https://api.opendota.com/api/teams/1"
    assert opendota_url("https://api.opendota.com/api/x") == "https://api.opendota.com/api/x"


def test_timeout_is_repeated_once(no_opendota_retry_wait):
    waits = []
    side_effect = [requests.Timeout("slow"), _response([1])]
    with patch("backend.opendota.requests.get", side_effect=side_effect) as mock_get:
        resp = opendota_get("/proPlayers", on_wait=waits.append)
    assert resp.json() == [1]
    assert mock_get.call_count == 2
    assert waits == [10]
    assert no_opendota_retry_wait.call_count == 1


@pytest.mark.parametrize("error", [requests.Timeout("slow"), requests.ConnectionError("reset")])
def test_no_answer_after_last_repeat_is_raised(error):
    with patch("backend.opendota.requests.get", side_effect=error) as mock_get:
        with pytest.raises(type(error)):
            opendota_get("/proPlayers")
    assert mock_get.call_count == NO_ANSWER_RETRIES + 1


def test_used_up_daily_limit_is_not_repeated():
    """OpenDota counts rejected requests too, so a daily-limit 429 is never repeated."""
    used_up = _response(None, status=429, text='{"error":"daily api limit exceeded"}')
    with patch("backend.opendota.requests.get", return_value=used_up) as mock_get:
        with pytest.raises(OpenDotaError) as exc_info:
            get_json("/players/1/matches")
    assert (exc_info.value.status, exc_info.value.code) == (429, "DAILY_LIMIT")
    assert exc_info.value.message == "OpenDota daily request limit is used up"
    assert mock_get.call_count == 1


def test_get_json_errors():
    with patch("backend.opendota.requests.get", side_effect=requests.Timeout("slow")):
        with pytest.raises(OpenDotaError) as exc_info:
            get_json("/proPlayers")
    assert (exc_info.value.status, exc_info.value.code) == (503, "NETWORK_ERROR")

    with patch("backend.opendota.requests.get", return_value=_response(None, status=500)):
        with pytest.raises(OpenDotaError) as exc_info:
            get_json("/proPlayers")
    assert (exc_info.value.status, exc_info.value.code) == (500, "HTTP_ERROR")

    bad = _response(None)
    bad.json.side_effect = ValueError("bad")
    with patch("backend.opendota.requests.get", return_value=bad):
        with pytest.raises(OpenDotaError) as exc_info:
            get_json("/proPlayers")
    assert (exc_info.value.status, exc_info.value.code) == (502, "JSON_DECODE_ERROR")


def test_forbidden_is_repeated_like_rate_limit():
    side_effect = [_response(None, status=403), _response(None, status=429), _response([2])]
    with patch("backend.opendota.requests.get", side_effect=side_effect) as mock_get:
        assert get_json("/teams/1") == [2]
    assert mock_get.call_count == 3


def test_forbidden_after_last_repeat_is_an_http_error():
    with patch("backend.opendota.requests.get", return_value=_response(None, status=403)) as mock_get:
        with pytest.raises(OpenDotaError) as exc_info:
            get_json("/teams/1")
    assert (exc_info.value.status, exc_info.value.code) == (403, "HTTP_ERROR")
    assert mock_get.call_count == RATE_LIMIT_RETRIES + 1


def test_every_attempt_takes_a_limiter_slot(no_rate_limit_wait):
    waits = []
    side_effect = [_response(None, status=429), _response([3])]
    with patch("backend.opendota.requests.get", side_effect=side_effect):
        assert get_json("/teams/1", on_wait=waits.append, background=True) == [3]
    assert no_rate_limit_wait.call_count == 2
    no_rate_limit_wait.assert_called_with(background=True, on_wait=waits.append)


def test_daily_limit_is_an_opendota_error(no_rate_limit_wait):
    no_rate_limit_wait.side_effect = DailyLimitReached("opendota daily limit of 5 requests reached")
    with patch("backend.opendota.requests.get") as mock_get:
        with pytest.raises(OpenDotaError) as exc_info:
            get_json("/teams", background=True)
    assert (exc_info.value.status, exc_info.value.code) == (429, "DAILY_LIMIT")
    mock_get.assert_not_called()


def test_tests_log_to_their_own_file():
    """conftest sets the log file before any backend import, so test runs never write into the app's log."""
    assert os.environ[LOG_FILE_ENV] == "tests.log"
    files = {
        os.path.basename(h.baseFilename)
        for h in logging.getLogger("backend.opendota").handlers
        if isinstance(h, logging.FileHandler)
    }
    assert files == {"tests.log"}
