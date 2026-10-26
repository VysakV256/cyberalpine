"""Offline contract tests. All provider responses below are explicit test fixtures."""
from datetime import date
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fetch_sources as subject


START, END = date(2025, 10, 25), date(2026, 10, 25)
META = {"retrievedAt": "2026-10-25T20:00:00Z", "sha256": "fixture-sha256"}


class FixtureFetcher:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def json(self, name, url, body=None):
        self.calls.append((name, url, body))
        return self.payload, META


class SourceAcquisitionTests(unittest.TestCase):
    def setUp(self):
        # A regression that attempts network access fails every test immediately.
        guard = patch.object(subject.request, "urlopen", side_effect=AssertionError("Network is forbidden in these tests"))
        guard.start()
        self.addCleanup(guard.stop)

    def test_date_precision_preserves_intervals_and_rejects_invalid_days(self):
        self.assertEqual(subject.date_interval([2026]),
                         (date(2026, 1, 1), date(2026, 12, 31), "2026", "year"))
        self.assertEqual(subject.date_interval([2024, 2]),
                         (date(2024, 2, 1), date(2024, 2, 29), "2024-02", "month"))
        self.assertEqual(subject.date_interval([2026, 10, 25]),
                         (END, END, "2026-10-25", "day"))
        for parts in ([], [2026, 2, 29], [2026, 13], ["2026"]):
            with self.subTest(parts=parts), self.assertRaises(ValueError):
                subject.date_interval(parts)

    def test_month_windows_cover_exact_requested_interval_without_overlap(self):
        windows = list(subject.month_windows(START, END))
        self.assertEqual(len(windows), 13)
        self.assertEqual(windows[0], ("2025-10", START, date(2025, 10, 31)))
        self.assertEqual(windows[-1], ("2026-10", date(2026, 10, 1), END))
        for (_, _, previous_end), (_, next_start, _) in zip(windows, windows[1:]):
            self.assertEqual((next_start - previous_end).days, 1)
        self.assertEqual(list(subject.month_windows(START, START)), [("2025-10", START, START)])

    def test_bls_excludes_boundary_months_and_annual_summaries(self):
        observations = [
            {"year": "2025", "period": "M10", "value": "100"},
            {"year": "2025", "period": "M11", "value": "101", "footnotes": [{"code": "P", "text": "Fixture preliminary flag"}]},
            {"year": "2026", "period": "M09", "value": "102"},
            {"year": "2026", "period": "M10", "value": "103"},
            {"year": "2026", "period": "M13", "value": "104"},
        ]
        fetcher = FixtureFetcher({"status": "REQUEST_SUCCEEDED", "Results": {"series": [
            {"seriesID": series_id, "data": observations} for series_id in subject.SERIES]}})
        datasets = subject.get_bls(fetcher, START, END)
        self.assertEqual(len(fetcher.calls), 1)
        self.assertEqual(fetcher.calls[0][2]["startyear"], "2025")
        for dataset in datasets:
            self.assertEqual([record["date"] for record in dataset["records"]], ["2025-11", "2026-09"])
            self.assertEqual(dataset["records"][0]["footnotes"][0]["code"], "P")
            self.assertEqual(dataset["coverage"]["retainedCount"], 2)
            self.assertEqual(dataset["coverage"]["latestAvailableReportingPeriod"], "2026-09")
            self.assertEqual(dataset["coverage"]["exclusions"]["nonMonthlyPeriod"], 1)

    def test_crossref_preserves_day_precision_and_bounds_references(self):
        valid = {"DOI": "10.fixture/RETAINED", "title": ["Fixture only"],
                 "published": {"date-parts": [[2025, 10, 25]]},
                 "reference": [{"DOI": f"10.fixture/reference-{i}"} for i in range(40)]}
        payload = {"status": "ok", "message": {"total-results": 500, "items": [
            valid, {"DOI": "10.fixture/ambiguous", "published": {"date-parts": [[2025, 10]]}},
            {"DOI": "10.fixture/missing-date"}]}}
        fetcher = FixtureFetcher(payload)
        batch = subject.get_crossref_window(fetcher, START, END, "fixture", "journal-article", 6,
                                             "Fixture only", "fixture-cache")
        self.assertEqual(len(batch["records"]), 1)
        record = batch["records"][0]
        self.assertEqual(record["id"], "10.fixture/retained")
        self.assertEqual(record["datePrecision"], "day")
        self.assertEqual(len(record["references"]), 32)
        self.assertEqual(record["referenceCountAvailable"], 40)
        self.assertEqual(batch["coverage"]["referencesOmittedByCap"], 8)
        self.assertFalse(batch["coverage"]["fullTextFetched"])
        self.assertFalse(batch["coverage"]["abstractsFetched"])
        self.assertIn("rows=6", fetcher.calls[0][1])

    def test_failed_stratum_does_not_discard_successful_source_records(self):
        def window_fixture(fetcher, lo, hi, dataset_id, content_type, rows, name, cache_name):
            if lo.month == 1:
                raise ValueError("Explicit fixture failure")
            return {"sourceUrl": "https://example.invalid/fixture", "records": [
                {"id": cache_name, "dateInterval": {"start": lo.isoformat(), "end": lo.isoformat()}}],
                "coverage": {"returnedCount": 1, "providerTotalMatching": 100, "referencesOmittedByCap": 0}}
        fetcher = FixtureFetcher({"status": "ok", "message": {"total-results": 957}})
        with patch.object(subject, "get_crossref_window", side_effect=window_fixture):
            dataset = subject.get_crossref(fetcher, START, END, "fixture", "book", 3, "Fixture only")
        self.assertEqual(dataset["status"], "partial")
        self.assertEqual(len(dataset["records"]), 12)
        self.assertEqual(dataset["coverage"]["perMonthRecords"]["2026-01"]["status"], "unavailable")
        self.assertEqual(dataset["coverage"]["successfulStrata"], 12)
        # The exact whole-window count is independently retrieved, never a sum of monthly totals.
        self.assertEqual(dataset["coverage"]["providerTotalMatching"], 957)
        self.assertIn("rows=0", fetcher.calls[0][1])

    def test_unavailable_source_has_no_fabricated_records(self):
        fetcher = FixtureFetcher({"status": "ok", "message": {"total-results": 0}})
        with patch.object(subject, "get_crossref_window", side_effect=ValueError("Explicit fixture failure")):
            dataset = subject.get_crossref(fetcher, START, END, "fixture", "book", 3, "Fixture only")
        self.assertEqual(dataset["status"], "unavailable")
        self.assertEqual(dataset["records"], [])
        self.assertEqual(len(dataset["coverage"]["failedRequests"]), 13)
        self.assertEqual(dataset["coverage"]["retainedCount"], 0)

    def test_offline_cache_checksum_uses_exact_bytes_and_original_timestamp(self):
        with tempfile.TemporaryDirectory(prefix="cyberquest-source-test-") as directory:
            path = Path(directory)
            exact_bytes = b'{ "status": "ok", "message": {"items": []} }\n'
            (path / "fixture.json").write_bytes(exact_bytes)
            (path / "fixture.request.json").write_text(json.dumps({
                "url": "https://example.invalid/fixture", "retrievedAt": "2026-10-25T19:00:00Z"}))
            fetcher = subject.Fetcher(path, offline=True)
            payload, metadata = fetcher.json("fixture", "https://example.invalid/fixture")
            self.assertEqual(payload["status"], "ok")
            self.assertEqual(metadata["sha256"], hashlib.sha256(exact_bytes).hexdigest())
            self.assertEqual(metadata["bytes"], len(exact_bytes))
            self.assertEqual(metadata["retrievedAt"], "2026-10-25T19:00:00Z")
            self.assertTrue(metadata["loadedFromCache"])
            self.assertEqual(len(fetcher.requests), 1)

    def test_cache_without_original_timestamp_discloses_its_basis(self):
        with tempfile.TemporaryDirectory(prefix="cyberquest-source-test-") as directory:
            path = Path(directory)
            (path / "fixture.json").write_text("{}")
            _, metadata = subject.Fetcher(path, offline=True).json("fixture", "https://example.invalid/fixture")
            self.assertIn("original retrieval timestamp unavailable", metadata["retrievalTimestampBasis"])
            self.assertIn("retrievalTimestampBasis", subject.provenance(metadata))


if __name__ == "__main__":
    unittest.main()
