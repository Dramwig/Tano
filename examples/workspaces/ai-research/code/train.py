"""Small, intentionally boring example file for the Tano file browser."""

from pathlib import Path


def score(rows: list[dict[str, str]]) -> float:
    values = [float(row["recall"]) for row in rows]
    return sum(values) / len(values)


if __name__ == "__main__":
    print("Read experiments.csv and compare model recall")
