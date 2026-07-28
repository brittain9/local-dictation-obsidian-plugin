#!/usr/bin/env python3
"""Prepare deterministic FLORES-200 JSONL slices for translation benchmarks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pyarrow.parquet as pq

LANGUAGE_COLUMNS = {
    "en": "eng_Latn",
    "es": "spa_Latn",
    "ja": "jpn_Jpan",
    "nl": "nld_Latn",
    "pt": "por_Latn",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parquet", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--count", default=200, type=int)
    parser.add_argument(
        "--directions",
        nargs="+",
        default=["en-nl", "nl-en", "en-es", "es-en", "en-ja", "ja-en", "en-pt"],
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    table = pq.read_table(args.parquet)
    if args.count < 1 or args.count > table.num_rows:
        raise ValueError(f"--count must be between 1 and {table.num_rows}")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for direction in args.directions:
        try:
            source_language, target_language = direction.split("-")
            source_column = LANGUAGE_COLUMNS[source_language]
            target_column = LANGUAGE_COLUMNS[target_language]
        except (KeyError, ValueError) as error:
            raise ValueError(f"Unsupported direction: {direction}") from error

        source_values = table.column(source_column).to_pylist()[: args.count]
        target_values = table.column(target_column).to_pylist()[: args.count]
        rows = [
            {
                "id": f"flores200-devtest-{index + 1:04d}",
                "source": source,
                "reference": reference,
            }
            for index, (source, reference) in enumerate(zip(source_values, target_values, strict=True))
        ]
        output_path = args.output_dir / f"{direction}.jsonl"
        output_path.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
            encoding="utf-8",
        )
        print(f"{direction}\t{len(rows)}\t{output_path}")


if __name__ == "__main__":
    main()
