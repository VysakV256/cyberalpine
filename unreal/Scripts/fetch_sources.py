#!/usr/bin/env python3
"""Fetch bounded public observations and bibliographic metadata for Cyberquest.

No API keys or third-party packages required. No abstracts or full texts requested.
The output is a fetched snapshot, not an exhaustive historical archive.
"""
from __future__ import annotations

import argparse
import calendar
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import time
from urllib import error, parse, request

DEFAULT_START = "2025-10-25"
DEFAULT_END = "2026-10-25"
USER_AGENT = "CyberquestInformationUniverse/0.1 (bounded public metadata prototype)"
MAX_RESPONSE_BYTES = 6 * 1024 * 1024
BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
CROSSREF_URL = "https://api.crossref.org/works"
SERIES = {
    "CUUR0000SA0": ("bls-cpi", "US consumer price index, all items, not seasonally adjusted", "index, 1982–84=100"),
    "LNS14000000": ("bls-unemployment", "US civilian unemployment rate, seasonally adjusted", "percent"),
}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class Fetcher:
    def __init__(self, raw_dir, offline=False):
        self.raw_dir = raw_dir
        self.offline = offline
        self.requests = []
        self.last_crossref_request = None

    def json(self, name, url, body=None):
        if self.offline:
            raw_file = self.raw_dir / (name + ".json")
            data = raw_file.read_bytes()
            if len(data) > MAX_RESPONSE_BYTES:
                raise ValueError("Cached response exceeded the bounded 6 MiB limit")
            payload = json.loads(data)
            metadata_file = self.raw_dir / (name + ".request.json")
            metadata = json.loads(metadata_file.read_text()) if metadata_file.exists() else {
                "url": url, "method": "POST" if body is not None else "GET", "requestBody": body,
                "retrievedAt": datetime.fromtimestamp(raw_file.stat().st_mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "retrievalTimestampBasis": "cache file modification time; original retrieval timestamp unavailable",
                "httpStatus": None}
            metadata.update({"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "loadedFromCache": True})
            self.requests.append(metadata)
            return payload, metadata
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        encoded = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            encoded = json.dumps(body).encode("utf-8")
        req = request.Request(url, data=encoded, headers=headers)
        if parse.urlparse(url).hostname == "api.crossref.org":
            if self.last_crossref_request is not None:
                time.sleep(max(0, 1.1 - (time.monotonic() - self.last_crossref_request)))
            self.last_crossref_request = time.monotonic()
        retrieved = utc_now()
        with request.urlopen(req, timeout=30) as response:
            data = response.read(MAX_RESPONSE_BYTES + 1)
            if len(data) > MAX_RESPONSE_BYTES:
                raise ValueError("Response exceeded the bounded 6 MiB limit")
            status = response.status
        payload = json.loads(data)
        digest = hashlib.sha256(data).hexdigest()
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        (self.raw_dir / (name + ".json")).write_bytes(data)
        metadata = {"url": url, "method": "POST" if body is not None else "GET",
                    "requestBody": body, "retrievedAt": retrieved, "httpStatus": status,
                    "sha256": digest, "bytes": len(data)}
        write_json(self.raw_dir / (name + ".request.json"), metadata)
        self.requests.append(metadata)
        return payload, metadata


def provenance(metadata):
    return {"retrievedAt": metadata["retrievedAt"], "responseSha256": metadata["sha256"],
            **({"retrievalTimestampBasis": metadata["retrievalTimestampBasis"]} if metadata.get("retrievalTimestampBasis") else {})}


def date_interval(parts):
    """Preserve source precision rather than inventing a publication day."""
    if not parts or not isinstance(parts[0], int):
        raise ValueError("Missing publication date")
    year = parts[0]
    if len(parts) >= 3:
        exact = date(year, parts[1], parts[2])
        return exact, exact, exact.isoformat(), "day"
    if len(parts) == 2:
        month = parts[1]
        return (date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1]),
                f"{year:04d}-{month:02d}", "month")
    return date(year, 1, 1), date(year, 12, 31), str(year), "year"


def coverage(records, returned_count, start, end, selection, exclusions=None):
    return {"requestedStart": start.isoformat(), "requestedEnd": end.isoformat(),
            "retainedCount": len(records), "returnedCount": returned_count,
            "earliest": min((r["dateInterval"]["start"] for r in records), default=None),
            "latest": max((r["dateInterval"]["end"] for r in records), default=None),
            "selection": selection, "exclusions": exclusions or {}}


def get_bls(fetcher, start, end):
    payload, meta = fetcher.json("bls-series", BLS_URL,
                               {"seriesid": list(SERIES), "startyear": str(start.year), "endyear": str(end.year)})
    if payload.get("status") != "REQUEST_SUCCEEDED":
        raise ValueError("BLS returned " + str(payload.get("status")) + ": " + "; ".join(payload.get("message", [])))
    returned = {s["seriesID"]: s.get("data", []) for s in payload.get("Results", {}).get("series", [])}
    datasets = []
    for series_id, (dataset_id, name, unit) in SERIES.items():
        observations = returned.get(series_id, [])
        records = []
        excluded = {"outsideWindowOrIncompleteBoundaryMonth": 0, "nonMonthlyPeriod": 0}
        for observation in observations:
            period = observation.get("period", "")
            if not period.startswith("M") or not 1 <= int(period[1:]) <= 12:
                excluded["nonMonthlyPeriod"] += 1
                continue
            year, month = int(observation["year"]), int(period[1:])
            lo, hi, label, precision = date_interval([year, month])
            if lo < start or hi > end:
                excluded["outsideWindowOrIncompleteBoundaryMonth"] += 1
                continue
            records.append({"id": f"{series_id}:{label}", "title": f"{name} · {label}",
                            "date": label, "datePrecision": precision,
                            "dateInterval": {"start": lo.isoformat(), "end": hi.isoformat()},
                            "value": float(observation["value"]), "unit": unit,
                            "footnotes": [f for f in observation.get("footnotes", []) if f],
                            "provenance": provenance(meta)})
        records.sort(key=lambda record: record["date"])
        ds_coverage = coverage(records, len(observations), start, end,
                               "All returned monthly reporting periods wholly contained in the requested window; latest available values at retrieval, not vintage-as-released data.", excluded)
        ds_coverage["latestAvailableReportingPeriod"] = records[-1]["date"] if records else None
        datasets.append({"id": dataset_id, "name": name, "structure": "tabular", "seriesId": series_id,
                         "sourceUrl": BLS_URL, "sourceDocs": "https://www.bls.gov/developers/api_signature_v2.htm",
                         "recordSourceUrl": f"https://data.bls.gov/timeseries/{series_id}",
                         "licenseNote": "US Bureau of Labor Statistics public data; preserve source attribution and footnotes. No API key used.",
                         "status": "fetched", "records": records, "coverage": ds_coverage})
    return datasets


def get_crossref_window(fetcher, start, end, dataset_id, content_type, rows, name, cache_name):
    query = parse.urlencode({"filter": f"from-pub-date:{start},until-pub-date:{end},type:{content_type}",
                             "rows": rows, "sort": "published", "order": "desc",
                             "select": "DOI,title,author,published,reference,type,publisher,URL,subject"})
    url = CROSSREF_URL + "?" + query
    payload, meta = fetcher.json(cache_name, url)
    if payload.get("status") != "ok":
        raise ValueError("Crossref did not return status=ok")
    message = payload["message"]
    items = message.get("items", [])
    records = []
    excluded = {"outsideWindowOrAmbiguousBoundaryDate": 0, "invalidOrMissingDate": 0, "missingDoi": 0}
    truncated = 0
    for item in items:
        doi = str(item.get("DOI", "")).strip().lower()
        if not doi:
            excluded["missingDoi"] += 1
            continue
        try:
            lo, hi, label, precision = date_interval(item.get("published", {}).get("date-parts", [[]])[0])
        except (ValueError, TypeError, IndexError):
            excluded["invalidOrMissingDate"] += 1
            continue
        if lo < start or hi > end:
            excluded["outsideWindowOrAmbiguousBoundaryDate"] += 1
            continue
        # DOI-only references avoid fetching or redistributing article text.
        references = list(dict.fromkeys(str(ref["DOI"]).strip().lower()
                          for ref in item.get("reference", []) if ref.get("DOI")))
        truncated += max(0, len(references) - 32)
        title = " ".join(item.get("title", [])) or "Untitled metadata record"
        records.append({"id": doi, "doi": doi, "title": title,
                        "date": label, "datePrecision": precision,
                        "dateInterval": {"start": lo.isoformat(), "end": hi.isoformat()},
                        "type": item.get("type", content_type), "publisher": item.get("publisher"),
                        "url": item.get("URL") or "https://doi.org/" + doi,
                        "authors": [{"name": " ".join(filter(None, [a.get("given"), a.get("family")])) or a.get("name", "Unnamed author"),
                                     **({"orcid": a["ORCID"]} if a.get("ORCID") else {})} for a in item.get("author", [])],
                        "subjects": item.get("subject", []),
                        "references": [{"doi": ref, "relationship": "deposited-reference", "inferred": False} for ref in references[:32]],
                        "referenceCountAvailable": len(references), "provenance": provenance(meta)})
    records.sort(key=lambda record: (record["dateInterval"]["start"], record["id"]))
    ds_coverage = coverage(records, len(items), start, end,
                           f"Bounded sample: first {rows} records returned by Crossref sorted by publication date descending, then strict date-interval filtering; not a representative or exhaustive corpus.", excluded)
    ds_coverage.update({"providerTotalMatching": message.get("total-results"), "requestRows": rows,
                        "maximumReferencesPerRecord": 32, "referencesOmittedByCap": truncated,
                        "fullTextFetched": False, "abstractsFetched": False})
    return {"id": dataset_id, "name": name, "structure": "relational" if content_type == "journal-article" else "object",
            "sourceUrl": url, "sourceDocs": "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
            "licenseNote": "Bibliographic metadata and DOI references only. Full text and abstracts are excluded; metadata access does not grant rights to underlying works.",
            "status": "fetched", "records": records, "coverage": ds_coverage}


def month_windows(start, end):
    cursor = date(start.year, start.month, 1)
    while cursor <= end:
        last = date(cursor.year, cursor.month, calendar.monthrange(cursor.year, cursor.month)[1])
        yield cursor.strftime("%Y-%m"), max(cursor, start), min(last, end)
        cursor = date(cursor.year + (cursor.month == 12), 1 if cursor.month == 12 else cursor.month + 1, 1)


def get_crossref(fetcher, start, end, dataset_id, content_type, rows, name):
    """Sample every calendar-month stratum, keeping failures local and visible."""
    by_id, per_month, failures, batch_coverages = {}, {}, [], []
    sources, references_omitted, returned_count = [], 0, 0
    for month, lo, hi in month_windows(start, end):
        try:
            batch = get_crossref_window(fetcher, lo, hi, dataset_id, content_type, rows, name,
                                        f"{dataset_id}-{month}")
            source_coverage = batch["coverage"]
            sources.append(batch["sourceUrl"])
            batch_coverages.append(source_coverage)
            returned_count += source_coverage["returnedCount"]
            references_omitted += source_coverage["referencesOmittedByCap"]
            per_month[month] = {"start": lo.isoformat(), "end": hi.isoformat(), "status": "fetched",
                                "retainedCount": len(batch["records"]),
                                "providerTotalMatching": source_coverage.get("providerTotalMatching"),
                                "exclusions": source_coverage.get("exclusions", {})}
            for record in batch["records"]:
                record["sampleStratum"] = month
                record["sourceUrl"] = batch["sourceUrl"]
                by_id.setdefault(record["id"], record)
        except (error.URLError, TimeoutError, ValueError, KeyError, OSError) as exc:
            failure = {"stratum": month, "start": lo.isoformat(), "end": hi.isoformat(), "message": str(exc)[:500]}
            failures.append(failure)
            per_month[month] = {**failure, "status": "unavailable", "retainedCount": 0, "providerTotalMatching": None}
    total_url = CROSSREF_URL + "?" + parse.urlencode({
        "filter": f"from-pub-date:{start},until-pub-date:{end},type:{content_type}", "rows": 0})
    provider_total = None
    try:
        totals, _ = fetcher.json(dataset_id + "-totals", total_url)
        if totals.get("status") != "ok":
            raise ValueError("Crossref total-count request did not return status=ok")
        provider_total = totals["message"]["total-results"]
    except (error.URLError, TimeoutError, ValueError, KeyError, OSError) as exc:
        failures.append({"stratum": "whole-window-count", "message": str(exc)[:500]})
    records = sorted(by_id.values(), key=lambda record: (record["dateInterval"]["start"], record["id"]))
    ds_coverage = coverage(records, returned_count, start, end,
                           f"Calendar-month-stratified bounded sample: up to {rows} records in each calendar month, sorted within each stratum by publication date descending, then strict date-interval filtering and DOI deduplication. Partial first/last months are clipped to the requested window. Neither exhaustive nor representative of all research or books.")
    ds_coverage.update({"providerTotalMatching": provider_total, "providerTotalMatchingMeaning": "Exact provider-reported whole-window count at retrieval; may change with metadata updates. Null when the dedicated count request failed.",
                        "perMonthRecords": per_month, "maximumRowsPerMonth": rows,
                        "successfulStrata": len(batch_coverages), "requestedStrata": len(per_month),
                        "maximumReferencesPerRecord": 32, "referencesOmittedByCap": references_omitted,
                        "fullTextFetched": False, "abstractsFetched": False, "failedRequests": failures})
    status = "unavailable" if not batch_coverages else "partial" if failures else "fetched"
    return {"id": dataset_id, "name": name, "structure": "relational" if content_type == "journal-article" else "object",
            "sourceUrl": total_url, "sampleRequestUrls": sources,
            "sourceDocs": "https://www.crossref.org/documentation/retrieve-metadata/rest-api/",
            "licenseNote": "Bibliographic metadata and DOI references only. Full text and abstracts are excluded; metadata access does not grant rights to underlying works.",
            "status": status, "records": records, "coverage": ds_coverage}


def unavailable(dataset_id, name, structure, url, exc):
    return {"id": dataset_id, "name": name, "structure": structure, "sourceUrl": url,
            "licenseNote": "No records were fabricated or substituted for this unavailable request.",
            "status": "unavailable", "records": [], "coverage": {"retainedCount": 0},
            "error": str(exc)[:500]}


def main():
    project = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default=DEFAULT_START)
    parser.add_argument("--end", default=DEFAULT_END)
    parser.add_argument("--output", type=Path, default=project / "Content/Data/source-records.json")
    parser.add_argument("--raw-dir", type=Path, default=project.parent.parent / "work/unreal-data/raw")
    parser.add_argument("--offline", action="store_true", help="Normalize previously acquired exact provider JSON from --raw-dir without network calls")
    args = parser.parse_args()
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    if end < start or end.year - start.year > 9:
        parser.error("Use an ordered window spanning at most ten calendar years")
    fetcher = Fetcher(args.raw_dir, offline=args.offline)
    datasets, errors = [], []
    try:
        datasets.extend(get_bls(fetcher, start, end))
    except (error.URLError, TimeoutError, ValueError, KeyError, OSError) as exc:
        errors.append({"provider": "BLS", "message": str(exc)[:500]})
        for series_id, (dataset_id, name, _) in SERIES.items():
            datasets.append(unavailable(dataset_id, name, "tabular", BLS_URL, exc))
    requests = [("research-crossref", "journal-article", 6, "Crossref research article metadata"),
                ("books-crossref", "book", 3, "Crossref book metadata")]
    for dataset_id, content_type, rows, name in requests:
        # Sequential, bounded requests keep this sample polite and reproducible.
        try:
            dataset = get_crossref(fetcher, start, end, dataset_id, content_type, rows, name)
            datasets.append(dataset)
            errors.extend({"provider": "Crossref", "datasetId": dataset_id, **failure}
                          for failure in dataset["coverage"].get("failedRequests", []))
        except (error.URLError, TimeoutError, ValueError, KeyError, OSError) as exc:
            errors.append({"provider": "Crossref", "datasetId": dataset_id, "message": str(exc)[:500]})
            datasets.append(unavailable(dataset_id, name, "relational" if content_type == "journal-article" else "object", CROSSREF_URL, exc))
    snapshot = {"schemaVersion": 1, "window": {"start": start.isoformat(), "end": end.isoformat(), "inclusive": True,
                  "interpretation": "Trailing year requested by the user. Monthly reporting and publication intervals are retained only when wholly within this date window; publication metadata is not acquisition-date evidence."},
                "fetchedAt": utc_now(), "datasets": datasets, "errors": errors,
                "requestCountSucceeded": len(fetcher.requests), "acquisitionMode": "cached-provider-responses" if args.offline else "network",
                "notes": ["Actual provider records only; unavailable sources remain explicit empty datasets.",
                          "This snapshot captures current responses; it does not reconstruct historical database vintages.",
                          "The date window can extend beyond the latest available reporting period. Future or unreleased observations are never synthesized."]}
    write_json(args.output, snapshot)
    print(json.dumps({"output": str(args.output), "datasets": [{"id": d["id"], "status": d["status"], "records": len(d["records"]), "coverage": d["coverage"]} for d in datasets], "errors": errors}, indent=2))
    return 0 if any(dataset["records"] for dataset in datasets) else 1


if __name__ == "__main__":
    raise SystemExit(main())
