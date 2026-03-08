#!/usr/bin/env python3
"""Build Switzerland vote dataset JSON from XLSX/CSV source files.

This script reads the sheet containing vote results and party recommendations,
normalizes key fields, and exports a single JSON payload consumed by the site.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from zipfile import ZipFile
import xml.etree.ElementTree as ET

XML_NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}

SOURCE_DEFAULT = Path("data/source/recommandations-de-vote-des-partis.xlsx")
OUTPUT_DEFAULT = Path("data/votes.json")

MATCH_YEAR_OFFSETS = (0, -1, 1, -2, 2, -3, 3)
GENERIC_MATCH_WORDS = {
    "initiative",
    "populaire",
    "arrete",
    "federal",
    "article",
    "constitutionnel",
    "loi",
}
# Known workbook typo in JLR sheet (2025 line).
SUPPLEMENTAL_OBJECT_ALIASES = {
    (2025, "initiative environnement respsonsable"): "initiative pour la responsabilite environnementale",
}


@dataclass(frozen=True)
class PartyColumn:
    party_id: str
    party_name: str
    recommendation_idx: int
    won_idx: int | None


@dataclass(frozen=True)
class SupplementalPartyColumn:
    party_id: str
    party_name: str
    recommendation_headers: tuple[str, ...]
    won_headers: tuple[str, ...] = ()


def strip_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def ascii_fold(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def normalize_key(value: str) -> str:
    folded = ascii_fold(value).lower()
    folded = re.sub(r"[^a-z0-9]+", "-", folded)
    return folded.strip("-")


def normalize_match_text(value: str) -> str:
    text = ascii_fold(normalize_spaces(value)).lower()
    text = text.replace("’", "'")
    text = text.replace("«", " ").replace("»", " ").replace("“", " ").replace("”", " ")
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def build_match_key(value: str) -> str:
    words = [word for word in normalize_match_text(value).split() if word not in GENERIC_MATCH_WORDS]
    return "".join(words)


def col_to_index(cell_ref: str) -> int:
    letters = ""
    for ch in cell_ref:
        if ch.isalpha():
            letters += ch
        else:
            break
    col = 0
    for ch in letters.upper():
        col = col * 26 + (ord(ch) - 64)
    return col - 1


def parse_xlsx_rows(path: Path, sheet_hint: str | None = None) -> list[list[str]]:
    with ZipFile(path) as workbook:
        shared_strings = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", XML_NS):
                text = "".join(t.text or "" for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"))
                shared_strings.append(text)

        wb_root = ET.fromstring(workbook.read("xl/workbook.xml"))
        rels_root = ET.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))
        rel_targets = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rels_root.findall("pr:Relationship", XML_NS)
            if "Id" in rel.attrib and "Target" in rel.attrib
        }

        target = None
        sheets = wb_root.find("m:sheets", XML_NS)
        if sheets is None:
            raise ValueError("No sheets found in workbook")

        for sheet in sheets.findall("m:sheet", XML_NS):
            name = strip_text(sheet.attrib.get("name", ""))
            rel_id = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", "")
            maybe_target = rel_targets.get(rel_id, "")
            if sheet_hint and sheet_hint.lower() in name.lower():
                target = maybe_target
                break
            if target is None and "recommand" in ascii_fold(name).lower():
                target = maybe_target

        if target is None:
            first_sheet = sheets.find("m:sheet", XML_NS)
            if first_sheet is None:
                raise ValueError("No sheet available to parse")
            rel_id = first_sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", "")
            target = rel_targets.get(rel_id, "")

        if not target:
            raise ValueError("Could not resolve worksheet path from workbook relationships")

        sheet_path = target
        if not sheet_path.startswith("xl/"):
            sheet_path = f"xl/{sheet_path}"

        sheet_root = ET.fromstring(workbook.read(sheet_path))
        sheet_data = sheet_root.find("m:sheetData", XML_NS)
        if sheet_data is None:
            raise ValueError("Worksheet does not contain <sheetData>")

        rows: list[list[str]] = []
        max_width = 0

        for row in sheet_data.findall("m:row", XML_NS):
            values: dict[int, str] = {}
            row_width = 0
            for cell in row.findall("m:c", XML_NS):
                ref = cell.attrib.get("r", "A1")
                idx = col_to_index(ref)
                row_width = max(row_width, idx + 1)
                cell_type = cell.attrib.get("t", "")

                value = ""
                if cell_type == "inlineStr":
                    node = cell.find("m:is", XML_NS)
                    if node is not None:
                        value = "".join(t.text or "" for t in node.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"))
                else:
                    v = cell.find("m:v", XML_NS)
                    if v is not None and v.text is not None:
                        raw = v.text
                        if cell_type == "s" and raw.isdigit():
                            idx_s = int(raw)
                            value = shared_strings[idx_s] if idx_s < len(shared_strings) else raw
                        elif cell_type == "b":
                            value = "true" if raw == "1" else "false"
                        else:
                            value = raw

                values[idx] = strip_text(value)

            max_width = max(max_width, row_width)
            dense = [""] * row_width
            for idx, val in values.items():
                if idx < row_width:
                    dense[idx] = val
            rows.append(dense)

        if max_width == 0:
            return rows

        normalized_rows: list[list[str]] = []
        for row in rows:
            padded = row + [""] * (max_width - len(row))
            normalized_rows.append(padded)

        return normalized_rows


def parse_csv_rows(path: Path) -> list[list[str]]:
    text = path.read_text(encoding="utf-8-sig")
    sample = text[:8192]
    dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")

    rows: list[list[str]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, dialect)
        for row in reader:
            rows.append([strip_text(cell) for cell in row])

    max_width = max((len(r) for r in rows), default=0)
    return [r + [""] * (max_width - len(r)) for r in rows]


def find_column(headers: list[str], candidates: list[str]) -> int | None:
    lowered = [ascii_fold(h).lower() for h in headers]
    for candidate in candidates:
        candidate_fold = ascii_fold(candidate).lower()
        for idx, header in enumerate(lowered):
            if candidate_fold in header:
                return idx
    return None


def find_header_row(rows: list[list[str]], required_tokens: list[str]) -> int:
    folded_required = [ascii_fold(token).lower() for token in required_tokens]
    for idx, row in enumerate(rows[:40]):
        folded_row = [ascii_fold(cell).lower() for cell in row]
        if all(any(token in cell for cell in folded_row) for token in folded_required):
            return idx
    return 0


def is_win_column(header: str) -> bool:
    folded = ascii_fold(header).lower()
    return folded.startswith("gagne/perdu")


def normalize_party_name(raw: str) -> str:
    clean = normalize_spaces(re.sub(r"\*+", "", raw))
    folded = ascii_fold(clean).lower()

    if folded.startswith("plr"):
        return "PLR"
    if folded.startswith("ps"):
        return "PS"
    if folded.startswith("pdc") or "centre" in folded:
        return "Le Centre"
    if folded.startswith("udc"):
        return "UDC"
    if folded.startswith("pvl"):
        return "PVL"
    if folded.startswith("pbd"):
        return "PBD"
    if folded.startswith("verts"):
        return "Verts"
    if "conseil federal" in folded:
        return "Conseil federal"

    return clean


def normalize_recommendation(raw: str) -> str | None:
    text = normalize_spaces(raw)
    if not text:
        return None

    lowered = ascii_fold(text).lower()
    lowered = lowered.replace("’", "'")

    if lowered in {".", "-", "na", "n/a"}:
        return None
    if lowered in {"oui", "o", "yes", "ou", "oui."}:
        return "oui"
    if lowered in {"non", "n", "no", "ono"}:
        return "non"
    if "pas d'accord" in lowered:
        return "non"
    if lowered == "d'accord":
        return "oui"
    if "liberte de vote" in lowered:
        return "liberte de vote"
    if "pas de position" in lowered or "pas de recommandation" in lowered or "pas de prise de position" in lowered:
        return "pas de position"
    if "neutre" in lowered or "blanc" in lowered:
        return "neutre"

    return text.lower()


def normalize_result(raw: str) -> str | None:
    text = normalize_spaces(raw)
    if not text:
        return None
    lowered = ascii_fold(text).lower()
    if lowered == "oui":
        return "oui"
    if lowered == "non":
        return "non"
    return None


def normalize_won(raw: str) -> bool | None:
    text = normalize_spaces(raw)
    if not text:
        return None
    lowered = ascii_fold(text).lower()
    if lowered == "gagne":
        return True
    if lowered == "perdu":
        return False
    return None


def parse_percent(raw: str) -> float | None:
    text = normalize_spaces(raw)
    if not text:
        return None

    text = text.replace("%", "").replace(",", ".")
    try:
        value = float(text)
    except ValueError:
        return None

    if value <= 1:
        value = value * 100

    return round(value, 2)


def get_cell(row: list[str], idx: int | None) -> str:
    if idx is None:
        return ""
    if idx < 0 or idx >= len(row):
        return ""
    return strip_text(row[idx])


def build_party_summaries(votes: list[dict[str, Any]]) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    parties: dict[str, str] = {}
    for vote in votes:
        for rec in vote["recommendations"]:
            party_id = strip_text(rec.get("partyId"))
            party_name = strip_text(rec.get("party"))
            if not party_id or not party_name:
                continue
            parties.setdefault(party_id, party_name)

    sorted_parties = sorted(
        [{"id": party_id, "name": party_name} for party_id, party_name in parties.items()],
        key=lambda item: item["name"],
    )

    party_stats: dict[str, dict[str, Any]] = {}
    for party in sorted_parties:
        party_stats[party["id"]] = {
            "partyId": party["id"],
            "party": party["name"],
            "recommendations": 0,
            "oui": 0,
            "non": 0,
            "liberteDeVote": 0,
            "neutre": 0,
            "pasDePosition": 0,
            "wins": 0,
            "losses": 0,
            "alignmentRate": None,
        }

    for vote in votes:
        for rec in vote["recommendations"]:
            stats = party_stats.get(strip_text(rec.get("partyId")))
            if stats is None:
                continue

            recommendation = rec.get("recommendation")
            if recommendation is not None:
                stats["recommendations"] += 1
                if recommendation == "oui":
                    stats["oui"] += 1
                elif recommendation == "non":
                    stats["non"] += 1
                elif recommendation == "liberte de vote":
                    stats["liberteDeVote"] += 1
                elif recommendation == "neutre":
                    stats["neutre"] += 1
                elif recommendation == "pas de position":
                    stats["pasDePosition"] += 1

            won = rec.get("won")
            if won is True:
                stats["wins"] += 1
            elif won is False:
                stats["losses"] += 1

    for stats in party_stats.values():
        outcomes = stats["wins"] + stats["losses"]
        if outcomes > 0:
            stats["alignmentRate"] = round(stats["wins"] / outcomes * 100, 1)

    return sorted_parties, list(party_stats.values())


def build_payload(votes: list[dict[str, Any]], source_name: str) -> dict[str, Any]:
    years = [vote["year"] for vote in votes]
    sorted_parties, party_stats = build_party_summaries(votes)
    return {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "sourceFile": source_name,
        "stats": {
            "objects": len(votes),
            "fromYear": min(years),
            "toYear": max(years),
            "withResult": sum(1 for vote in votes if vote["result"] is not None),
            "upcoming": sum(1 for vote in votes if vote["result"] is None),
        },
        "parties": sorted_parties,
        "partyStats": party_stats,
        "votes": votes,
    }


def parse_supplemental_records(
    rows: list[list[str]],
    *,
    required_headers: list[str],
    subject_headers: list[str],
    party_columns: list[SupplementalPartyColumn],
) -> list[dict[str, Any]]:
    if not rows:
        return []

    header_idx = find_header_row(rows, required_headers)
    headers = [normalize_spaces(cell) for cell in rows[header_idx]]
    subject_idx = find_column(headers, subject_headers)
    if subject_idx is None:
        return []

    year_idx = max(0, subject_idx - 1)

    party_indices: list[tuple[SupplementalPartyColumn, int | None, int | None]] = []
    for party in party_columns:
        recommendation_idx = find_column(headers, list(party.recommendation_headers))
        won_idx = find_column(headers, list(party.won_headers)) if party.won_headers else None
        if recommendation_idx is None and won_idx is None:
            continue
        party_indices.append((party, recommendation_idx, won_idx))

    if not party_indices:
        return []

    records: list[dict[str, Any]] = []
    current_year: int | None = None

    for row in rows[header_idx + 1 :]:
        year_cell = get_cell(row, year_idx)
        if year_cell:
            try:
                current_year = int(float(year_cell))
            except ValueError:
                pass

        subject = normalize_spaces(get_cell(row, subject_idx))
        if not subject or subject.startswith("*") or current_year is None:
            continue

        recommendations = []
        for party, recommendation_idx, won_idx in party_indices:
            recommendation = normalize_recommendation(get_cell(row, recommendation_idx))
            won = normalize_won(get_cell(row, won_idx))
            if recommendation is None and won is None:
                continue
            recommendations.append(
                {
                    "partyId": party.party_id,
                    "party": party.party_name,
                    "recommendation": recommendation,
                    "won": won,
                }
            )

        if recommendations:
            records.append({"year": current_year, "object": subject, "recommendations": recommendations})

    return records


def collect_supplemental_records_from_xlsx(path: Path) -> list[dict[str, Any]]:
    jlr_rows = parse_xlsx_rows(path, sheet_hint="JLR")
    prd_pls_rows = parse_xlsx_rows(path, sheet_hint="PRD-PLS")

    jlr_records = parse_supplemental_records(
        jlr_rows,
        required_headers=["Sujets de votations", "JLR"],
        subject_headers=["Sujets de votations", "Objet"],
        party_columns=[
            SupplementalPartyColumn(
                party_id="jlr",
                party_name="JLR",
                recommendation_headers=("JLR CH", "JLR"),
                won_headers=("Gagne/perdu", "Gagné/perdu"),
            )
        ],
    )

    prd_pls_records = parse_supplemental_records(
        prd_pls_rows,
        required_headers=["Objet", "PRD", "PLS"],
        subject_headers=["Objet", "Sujets de votations"],
        party_columns=[
            SupplementalPartyColumn(
                party_id="prd",
                party_name="PRD",
                recommendation_headers=("PRD",),
            ),
            SupplementalPartyColumn(
                party_id="pls",
                party_name="PLS",
                recommendation_headers=("PLS",),
            ),
        ],
    )

    return jlr_records + prd_pls_records


def build_vote_lookup(votes: list[dict[str, Any]]) -> tuple[dict[tuple[int, str], list[int]], dict[int, list[int]], dict[int, str]]:
    by_year_key: dict[tuple[int, str], list[int]] = defaultdict(list)
    by_year: dict[int, list[int]] = defaultdict(list)
    normalized_objects: dict[int, str] = {}

    for idx, vote in enumerate(votes):
        by_year_key[(vote["year"], build_match_key(vote["object"]))].append(idx)
        by_year[vote["year"]].append(idx)
        normalized_objects[idx] = normalize_match_text(vote["object"])

    return by_year_key, by_year, normalized_objects


def pick_best_index(indices: list[int], votes: list[dict[str, Any]], reference_year: int) -> int:
    if len(indices) == 1:
        return indices[0]
    return sorted(indices, key=lambda idx: (abs(votes[idx]["year"] - reference_year), votes[idx]["id"]))[0]


def find_best_vote_match(
    record: dict[str, Any],
    votes: list[dict[str, Any]],
    by_year_key: dict[tuple[int, str], list[int]],
    by_year: dict[int, list[int]],
    normalized_objects: dict[int, str],
) -> int | None:
    year = record["year"]
    raw_object = record["object"]
    object_norm = normalize_match_text(raw_object)
    alias = SUPPLEMENTAL_OBJECT_ALIASES.get((year, object_norm))
    if alias:
        object_norm = alias

    match_key = build_match_key(object_norm)

    for offset in MATCH_YEAR_OFFSETS:
        indices = by_year_key.get((year + offset, match_key))
        if indices:
            return pick_best_index(indices, votes, year)

    # Fuzzy fallback for remaining spelling/typographic drifts.
    best_idx: int | None = None
    best_score = 0.0
    for candidate_year in range(year - 3, year + 4):
        for idx in by_year.get(candidate_year, []):
            ratio = SequenceMatcher(None, object_norm, normalized_objects[idx]).ratio()
            if ratio > best_score:
                best_score = ratio
                best_idx = idx

    if best_idx is not None and best_score >= 0.95:
        return best_idx
    return None


def merge_supplemental_recommendations(votes: list[dict[str, Any]], supplemental_records: list[dict[str, Any]]) -> None:
    if not supplemental_records:
        return

    by_year_key, by_year, normalized_objects = build_vote_lookup(votes)

    for record in supplemental_records:
        vote_idx = find_best_vote_match(record, votes, by_year_key, by_year, normalized_objects)
        if vote_idx is None:
            continue

        vote = votes[vote_idx]
        existing_by_party = {rec["partyId"]: rec for rec in vote["recommendations"]}

        for rec in record["recommendations"]:
            existing = existing_by_party.get(rec["partyId"])
            if existing is None:
                vote["recommendations"].append(rec)
                existing_by_party[rec["partyId"]] = rec
                continue

            # Keep existing values unless supplemental source provides missing fields.
            if existing.get("recommendation") is None and rec.get("recommendation") is not None:
                existing["recommendation"] = rec["recommendation"]
            if existing.get("won") is None and rec.get("won") is not None:
                existing["won"] = rec["won"]


def parse_records(rows: list[list[str]], source_name: str) -> dict[str, Any]:
    if not rows:
        raise ValueError("No data rows found")

    headers = [normalize_spaces(cell) for cell in rows[0]]
    subject_idx = find_column(headers, ["Sujets de votations", "Objet"])
    yes_idx = find_column(headers, ["oui en %", "oui %"])
    no_idx = find_column(headers, ["non en %", "non %"])
    result_idx = find_column(headers, ["Resultat CH", "Résultat CH"])

    if subject_idx is None or result_idx is None:
        raise ValueError("Could not locate mandatory columns (subjects/results) in source")

    year_idx = max(0, subject_idx - 1)

    party_columns: list[PartyColumn] = []
    seen_party_ids: set[str] = set()

    cursor = result_idx + 1
    while cursor < len(headers):
        header = normalize_spaces(headers[cursor])
        if not header:
            cursor += 1
            continue
        if is_win_column(header):
            cursor += 1
            continue

        party_name = normalize_party_name(header)
        party_id = normalize_key(party_name)
        if not party_id:
            cursor += 1
            continue

        if party_id in seen_party_ids:
            suffix = 2
            while f"{party_id}-{suffix}" in seen_party_ids:
                suffix += 1
            party_id = f"{party_id}-{suffix}"

        seen_party_ids.add(party_id)

        won_idx = None
        if cursor + 1 < len(headers) and is_win_column(headers[cursor + 1]):
            won_idx = cursor + 1

        party_columns.append(
            PartyColumn(
                party_id=party_id,
                party_name=party_name,
                recommendation_idx=cursor,
                won_idx=won_idx,
            )
        )

        cursor += 2 if won_idx is not None else 1

    year_counters: dict[int, int] = defaultdict(int)
    current_year: int | None = None
    votes: list[dict[str, Any]] = []

    for row in rows[1:]:
        year_cell = get_cell(row, year_idx)
        if year_cell:
            try:
                current_year = int(float(year_cell))
            except ValueError:
                pass

        subject = normalize_spaces(get_cell(row, subject_idx))
        if not subject:
            continue
        if subject.startswith("*"):
            # Skip workbook notes/footnotes.
            continue

        if current_year is None:
            continue

        year_counters[current_year] += 1
        vote_id = f"{current_year}-{year_counters[current_year]:03d}"

        recommendations = []
        for party in party_columns:
            recommendation = normalize_recommendation(get_cell(row, party.recommendation_idx))
            won = normalize_won(get_cell(row, party.won_idx))
            if recommendation is None and won is None:
                continue

            recommendations.append(
                {
                    "partyId": party.party_id,
                    "party": party.party_name,
                    "recommendation": recommendation,
                    "won": won,
                }
            )

        vote = {
            "id": vote_id,
            "year": current_year,
            "object": subject,
            "yesPercent": parse_percent(get_cell(row, yes_idx)),
            "noPercent": parse_percent(get_cell(row, no_idx)),
            "result": normalize_result(get_cell(row, result_idx)),
            "recommendations": recommendations,
        }
        votes.append(vote)

    if not votes:
        raise ValueError("No vote records parsed from source")
    return build_payload(votes, source_name)


def load_rows(source: Path, sheet_hint: str | None = None) -> list[list[str]]:
    suffix = source.suffix.lower()
    if suffix == ".xlsx":
        return parse_xlsx_rows(source, sheet_hint=sheet_hint)
    if suffix == ".csv":
        return parse_csv_rows(source)
    raise ValueError(f"Unsupported source format: {source.suffix}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build votes dataset JSON from source workbook")
    parser.add_argument("--input", type=Path, default=SOURCE_DEFAULT, help="Path to XLSX or CSV source")
    parser.add_argument("--output", type=Path, default=OUTPUT_DEFAULT, help="Path to output JSON")
    parser.add_argument(
        "--sheet",
        type=str,
        default="recommand",
        help="Sheet name hint (used for XLSX only, case-insensitive contains match)",
    )
    args = parser.parse_args()

    source = args.input
    if not source.exists():
        raise SystemExit(f"Input file not found: {source}")

    rows = load_rows(source, sheet_hint=args.sheet)
    payload = parse_records(rows, source.name)

    if source.suffix.lower() == ".xlsx":
        supplemental_records = collect_supplemental_records_from_xlsx(source)
        merge_supplemental_recommendations(payload["votes"], supplemental_records)
        payload = build_payload(payload["votes"], source.name)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        f"Wrote {payload['stats']['objects']} objects ({payload['stats']['fromYear']}-{payload['stats']['toYear']}) to {args.output}"
    )


if __name__ == "__main__":
    main()
