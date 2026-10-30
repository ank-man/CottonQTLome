#!/usr/bin/env python3
"""Load computed meta-QTL and complete trait coverage into cotton_qtl.sqlite.

Run after analysis/meta_qtl.R; the analysis files remain the reproducible source.
Usage: python3 scripts/integrate_meta_qtl.py PROJECT_DIR
"""
import csv
import sqlite3
import sys
from pathlib import Path


TABLES = {
    "meta_qtl": "meta_qtl.tsv",
    "meta_qtl_members": "meta_qtl_members.tsv",
    "meta_qtl_models": "meta_qtl_models.tsv",
    "meta_qtl_trait_coverage": "meta_qtl_trait_coverage.tsv",
}


def load_tsv(con, table, path):
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        columns = reader.fieldnames
        if not columns:
            raise ValueError(f"Missing header: {path}")
        quoted = ", ".join(f'"{column}" TEXT' for column in columns)
        con.execute(f'CREATE TABLE "{table}" ({quoted})')
        placeholders = ", ".join("?" for _ in columns)
        con.executemany(
            f'INSERT INTO "{table}" VALUES ({placeholders})',
            ([row[column] if row[column] != "" else None for column in columns] for row in reader),
        )
    return con.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]


def main(project):
    project = Path(project)
    database = project / "data/processed/cotton_qtl.sqlite"
    if not database.is_file():
        raise FileNotFoundError(database)
    paths = {table: project / "analysis/tables" / filename for table, filename in TABLES.items()}
    for path in paths.values():
        if not path.is_file():
            raise FileNotFoundError(path)
    with sqlite3.connect(database) as con:
        con.execute("BEGIN")
        for table in TABLES:
            con.execute(f'DROP TABLE IF EXISTS "{table}"')
        counts = {table: load_tsv(con, table, path) for table, path in paths.items()}
        con.execute("CREATE UNIQUE INDEX ix_meta_qtl_id ON meta_qtl(mqtl_id)")
        con.execute("CREATE INDEX ix_meta_qtl_trait_chr ON meta_qtl(trait, chromosome)")
        con.execute("CREATE INDEX ix_meta_qtl_members_id ON meta_qtl_members(mqtl_id)")
        con.execute("CREATE INDEX ix_meta_qtl_members_record ON meta_qtl_members(record_id)")
        con.execute("CREATE UNIQUE INDEX ix_meta_qtl_coverage_trait ON meta_qtl_trait_coverage(trait)")
        missing_members = con.execute("""SELECT count(*) FROM meta_qtl_members m
            LEFT JOIN meta_qtl q ON q.mqtl_id = m.mqtl_id WHERE q.mqtl_id IS NULL""").fetchone()[0]
        missing_records = con.execute("""SELECT count(*) FROM meta_qtl_members m
            LEFT JOIN records r ON r.record_id = m.record_id WHERE r.record_id IS NULL""").fetchone()[0]
        missing_traits = con.execute("""SELECT count(*) FROM trait_summary t
            LEFT JOIN meta_qtl_trait_coverage c ON c.trait = t.trait_harmonized
            WHERE c.trait IS NULL""").fetchone()[0]
        if missing_members or missing_records or missing_traits:
            raise ValueError(f"Broken links: meta-QTL {missing_members}, records {missing_records}, "
                             f"uncovered traits {missing_traits}")
    print("Integrated into", database)
    for table, count in counts.items():
        print(f"  {table}: {count:,}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
