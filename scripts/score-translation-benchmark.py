#!/usr/bin/env python3
"""Score translation benchmark JSONL outputs with COMET and chrF++."""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from comet import download_model, load_from_checkpoint
from sacrebleu.metrics import CHRF


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--result",
        action="append",
        required=True,
        metavar="LABEL=PATH",
        help="Repeat for every result file to score in one COMET model load.",
    )
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--comet-model", default="Unbabel/wmt22-comet-da")
    parser.add_argument("--batch-size", default=8, type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    datasets: list[tuple[str, Path, list[dict[str, object]]]] = []
    comet_rows: list[dict[str, str]] = []
    slices: dict[str, tuple[int, int]] = {}

    for value in args.result:
        label, separator, raw_path = value.partition("=")
        if not separator or not label or not raw_path:
            raise ValueError(f"Expected LABEL=PATH, got {value}")
        path = Path(raw_path)
        rows = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        start = len(comet_rows)
        comet_rows.extend(
            {
                "src": row["source"],
                "mt": row["translation"],
                "ref": row["reference"],
            }
            for row in rows
        )
        slices[label] = (start, len(comet_rows))
        datasets.append((label, path, rows))

    checkpoint = download_model(args.comet_model)
    model = load_from_checkpoint(checkpoint)
    prediction = model.predict(
        comet_rows,
        batch_size=args.batch_size,
        gpus=0,
        accelerator="cpu",
        num_workers=1,
    )
    sentence_scores = [float(score) for score in prediction.scores]
    chrf = CHRF(word_order=2)
    output: dict[str, object] = {
        "cometModel": args.comet_model,
        "checkpoint": checkpoint,
        "results": {},
    }

    for label, path, rows in datasets:
        start, end = slices[label]
        elapsed = [
            float(row["elapsedMs"])
            for row in rows
            if isinstance(row.get("elapsedMs"), (int, float))
        ]
        scores = sentence_scores[start:end]
        output["results"][label] = {
            "path": str(path),
            "sentences": len(rows),
            "comet": statistics.fmean(scores),
            "chrfPlusPlus": chrf.corpus_score(
                [row["translation"] for row in rows],
                [[row["reference"] for row in rows]],
            ).score,
            "medianSentenceMs": statistics.median(elapsed) if elapsed else None,
            "sentenceComet": scores,
        }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    summary = {
        label: {key: value for key, value in values.items() if key != "sentenceComet"}
        for label, values in output["results"].items()
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
