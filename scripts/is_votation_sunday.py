#!/usr/bin/env python3
"""Return whether a given date is an official Swiss federal voting day."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import re
import urllib.request
from zoneinfo import ZoneInfo

BK_VOTATION_DATES_URL = "https://www.bk.admin.ch/ch/f/pore/va/vab_1_3_3_1.html"
BK_CHRONOLOGY_URL = "https://www.bk.admin.ch/ch/f/pore/va/vab_2_2_4_1_gesamt.html"
DATE_PATTERN = re.compile(r"\b([0-9]{2})\.([0-9]{2})\.([0-9]{4})\b")
CELL_PATTERN = re.compile(r"<td[^>]*>(.*?)</td>", re.IGNORECASE | re.DOTALL)
INDEX_LINK_PATTERN = re.compile(r'href="([0-9]{8})/index\.html"', re.IGNORECASE)


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "SwitzerlandVote/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", "ignore")


def extract_votation_dates(content: str) -> set[dt.date]:
    dates: set[dt.date] = set()
    for cell in CELL_PATTERN.findall(content):
        text = html.unescape(re.sub(r"<[^>]+>", " ", cell)).replace("\xa0", " ")
        for day, month, year in DATE_PATTERN.findall(text):
            try:
                dates.add(dt.date(int(year), int(month), int(day)))
            except ValueError:
                continue
    return dates


def extract_chronology_dates(content: str) -> set[dt.date]:
    dates: set[dt.date] = set()
    for compact in INDEX_LINK_PATTERN.findall(content):
        try:
            dates.add(dt.date.fromisoformat(f"{compact[:4]}-{compact[4:6]}-{compact[6:8]}"))
        except ValueError:
            continue
    return dates


def parse_target_date(raw: str | None, timezone_name: str) -> dt.date:
    if raw:
        return dt.date.fromisoformat(raw)
    now = dt.datetime.now(ZoneInfo(timezone_name))
    return now.date()


def main() -> None:
    parser = argparse.ArgumentParser(description="Check whether a date is a BK voting day")
    parser.add_argument("--date", type=str, default=None, help="Date to evaluate (YYYY-MM-DD). Defaults to today.")
    parser.add_argument("--timezone", type=str, default="Europe/Zurich", help="Timezone used when --date is omitted.")
    parser.add_argument("--url", type=str, default=BK_VOTATION_DATES_URL, help="BK dates page URL.")
    parser.add_argument("--chronology-url", type=str, default=BK_CHRONOLOGY_URL, help="BK chronology page URL.")
    args = parser.parse_args()

    target_date = parse_target_date(args.date, args.timezone)
    dates_content = fetch_text(args.url)
    chronology_content = fetch_text(args.chronology_url)
    official_dates = extract_votation_dates(dates_content)
    official_dates.update(extract_chronology_dates(chronology_content))
    print("true" if target_date in official_dates else "false")


if __name__ == "__main__":
    main()
