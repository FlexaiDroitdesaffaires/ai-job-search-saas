#!/usr/bin/env python3
"""Reproducible, read-only comparison on public Greenhouse job pages.

No raw page or personal data is persisted. Official Greenhouse GET endpoints are
the ground truth. ScrapeGraphAI is optional and must use a local Ollama model.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import resource
import statistics
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from typing import Any


USER_AGENT = "AI Job Search SaaS source evaluation/0.1"


@dataclass
class MethodResult:
    elapsed_ms: float
    error: str | None
    fields_correct: int
    fields_total: int


class PageSignals(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.json_ld: list[Any] = []
        self._in_title = False
        self._in_json_ld = False
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "title":
            self._in_title = True
        if tag == "script" and values.get("type") == "application/ld+json":
            self._in_json_ld = True
            self._buffer = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag == "script" and self._in_json_ld:
            try:
                self.json_ld.append(json.loads("".join(self._buffer)))
            except json.JSONDecodeError:
                pass
            self._in_json_ld = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._in_json_ld:
            self._buffer.append(data)


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read(2_000_000).decode(response.headers.get_content_charset() or "utf-8", errors="replace")


def greenhouse_target(url: str) -> tuple[str, str] | None:
    parsed = urllib.parse.urlparse(url)
    if parsed.hostname not in {"boards.greenhouse.io", "job-boards.greenhouse.io"}:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if "jobs" not in parts:
        return None
    index = parts.index("jobs")
    if index < 1 or index + 1 >= len(parts) or not parts[index + 1].isdigit():
        return None
    return parts[index - 1], parts[index + 1]


def collect_targets(limit: int) -> list[tuple[str, str, str]]:
    seen: set[tuple[str, str]] = set()
    targets: list[tuple[str, str, str]] = []
    for page in range(1, 15):
        payload = fetch_json(f"https://aidevboard.com/api/v1/jobs?workplace=remote&limit=50&page={page}")
        for job in payload.get("jobs", []):
            url = job.get("apply_url", "")
            target = greenhouse_target(url)
            if target and target not in seen:
                seen.add(target)
                targets.append((target[0], target[1], url))
                if len(targets) >= limit:
                    return targets
    return targets


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(value or ""))).strip().casefold()


def expected_fields(job: dict[str, Any]) -> dict[str, str]:
    return {
        "title": normalize(job.get("title")),
        "company": normalize(job.get("company_name")),
        "location": normalize((job.get("location") or {}).get("name")),
        "description": normalize(re.sub(r"<[^>]+>", " ", html.unescape(job.get("content") or ""))),
    }


def score_fields(actual: dict[str, Any], expected: dict[str, str]) -> tuple[int, int]:
    correct = 0
    for key, value in expected.items():
        candidate = normalize(actual.get(key))
        if value and candidate and (candidate == value or candidate in value or value in candidate):
            correct += 1
    return correct, len(expected)


def deterministic_extract(page: str) -> dict[str, Any]:
    parser = PageSignals()
    parser.feed(page)
    objects: list[dict[str, Any]] = []
    for value in parser.json_ld:
        values = value if isinstance(value, list) else [value]
        objects.extend(item for item in values if isinstance(item, dict))
    posting = next((item for item in objects if item.get("@type") == "JobPosting"), {})
    location = posting.get("jobLocation", {})
    if isinstance(location, list):
        location = location[0] if location else {}
    address = location.get("address", {}) if isinstance(location, dict) else {}
    organization = posting.get("hiringOrganization", {})
    return {
        "title": posting.get("title") or parser.title.split("|")[0],
        "company": organization.get("name") if isinstance(organization, dict) else "",
        "location": address.get("addressLocality") or posting.get("jobLocationType") if isinstance(address, dict) else "",
        "description": re.sub(r"<[^>]+>", " ", posting.get("description", "")),
    }


def scrapegraph_extract(page: str, model: str) -> dict[str, Any]:
    os.environ.setdefault("SCRAPEGRAPHAI_TELEMETRY_ENABLED", "false")
    from scrapegraphai.graphs import SmartScraperGraph  # type: ignore

    graph = SmartScraperGraph(
        prompt=("Extract the job title, hiring company, location, and full job description. "
                "Return exactly JSON keys title, company, location, description. Do not infer missing values."),
        source=page,
        config={
            "llm": {
                "model": f"ollama/{model}", "model_tokens": 4096,
                "max_tokens": 512, "num_predict": 512, "format": "json", "temperature": 0,
            },
            "verbose": False,
            "headless": True,
        },
    )
    result = graph.run()
    return result if isinstance(result, dict) else {}


def summarize(rows: list[MethodResult]) -> dict[str, Any]:
    successful = [row for row in rows if not row.error]
    complete = [row for row in successful if row.fields_correct == row.fields_total]
    return {
        "pages": len(rows),
        "successful": len(successful),
        "complete_valid_offers": len(complete),
        "errors": len(rows) - len(successful),
        "field_accuracy": round(sum(row.fields_correct for row in rows) / max(1, sum(row.fields_total for row in rows)), 4),
        "median_ms": round(statistics.median([row.elapsed_ms for row in rows]), 1) if rows else None,
        "total_ms": round(sum(row.elapsed_ms for row in rows), 1),
        "external_cost_per_valid_offer_usd": 0 if complete else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20, choices=range(20, 31))
    parser.add_argument("--model", default="qwen2.5:0.5b")
    parser.add_argument("--skip-scrapegraph", action="store_true")
    args = parser.parse_args()
    results: dict[str, list[MethodResult]] = {"official_api": [], "html_jsonld": [], "scrapegraphai": []}
    targets = collect_targets(args.limit)
    for position, (board, job_id, page_url) in enumerate(targets, start=1):
        print(f"page {position}/{len(targets)}", file=sys.stderr, flush=True)
        started = time.perf_counter()
        try:
            official = fetch_json(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job_id}?questions=true")
            expected = expected_fields(official)
            correct, total = score_fields(expected, expected)
            results["official_api"].append(MethodResult((time.perf_counter() - started) * 1000, None, correct, total))
        except Exception as exc:
            results["official_api"].append(MethodResult((time.perf_counter() - started) * 1000, type(exc).__name__, 0, 4))
            results["html_jsonld"].append(MethodResult(0, "GROUND_TRUTH_UNAVAILABLE", 0, 4))
            results["scrapegraphai"].append(MethodResult(0, "GROUND_TRUTH_UNAVAILABLE", 0, 4))
            continue
        try:
            page = fetch_text(page_url)
        except Exception as exc:
            results["html_jsonld"].append(MethodResult(0, type(exc).__name__, 0, 4))
            results["scrapegraphai"].append(MethodResult(0, "PAGE_FETCH_FAILED", 0, 4))
            continue
        started = time.perf_counter()
        try:
            extracted = deterministic_extract(page)
            correct, total = score_fields(extracted, expected)
            results["html_jsonld"].append(MethodResult((time.perf_counter() - started) * 1000, None, correct, total))
        except Exception as exc:
            results["html_jsonld"].append(MethodResult((time.perf_counter() - started) * 1000, type(exc).__name__, 0, 4))
        if args.skip_scrapegraph:
            results["scrapegraphai"].append(MethodResult(0, "SKIPPED", 0, 4))
            continue
        started = time.perf_counter()
        try:
            extracted = scrapegraph_extract(page, args.model)
            correct, total = score_fields(extracted, expected)
            results["scrapegraphai"].append(MethodResult((time.perf_counter() - started) * 1000, None, correct, total))
        except Exception as exc:
            results["scrapegraphai"].append(MethodResult((time.perf_counter() - started) * 1000, type(exc).__name__, 0, 4))
    peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)
    report = {
        "sample_size": len(targets), "model": None if args.skip_scrapegraph else args.model,
        "external_api_cost_usd": 0, "peak_process_rss_mb": round(peak_mb, 1),
        "methods": {name: summarize(rows) for name, rows in results.items()},
        "errors": {name: sorted({row.error for row in rows if row.error}) for name, rows in results.items()},
    }
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
