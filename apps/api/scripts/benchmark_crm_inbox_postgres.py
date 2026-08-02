from __future__ import annotations

import argparse
import json
import os
import statistics
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

import psycopg


@dataclass
class Measurement:
    name: str
    sql_count: int
    loaded_rows: int
    latencies_ms: list[float]

    def summary(self) -> dict[str, float | int | str]:
        return {
            "name": self.name,
            "sql_count": self.sql_count,
            "loaded_rows": self.loaded_rows,
            "p50_ms": round(statistics.median(self.latencies_ms), 2),
            "p95_ms": round(statistics.quantiles(self.latencies_ms, n=20)[18], 2) if len(self.latencies_ms) >= 20 else round(max(self.latencies_ms), 2),
        }


def database_url() -> str:
    value = os.environ.get("BENCHMARK_DATABASE_URL") or os.environ.get("DATABASE_URL") or ""
    if not value:
        raise SystemExit("Set BENCHMARK_DATABASE_URL or DATABASE_URL to a PostgreSQL database.")
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def execute(conn: psycopg.Connection, sql: str, params: tuple = ()) -> None:
    with conn.cursor() as cur:
        cur.execute(sql, params)


def fetchall(conn: psycopg.Connection, sql: str, params: tuple = ()) -> list[tuple]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def setup_schema(conn: psycopg.Connection, schema: str, companies: int, history_per_parent: int) -> tuple[str, list[str], list[str]]:
    workspace_id = str(uuid4())
    company_ids = [str(uuid4()) for _ in range(companies)]
    lead_ids = [str(uuid4()) for _ in range(companies)]
    now = datetime.utcnow()
    execute(conn, f"DROP SCHEMA IF EXISTS {schema} CASCADE")
    execute(conn, f"CREATE SCHEMA {schema}")
    execute(
        conn,
        f"""
        CREATE TABLE {schema}.companies (
          id UUID PRIMARY KEY,
          workspace_id UUID NOT NULL,
          lead_id UUID NOT NULL,
          updated_at TIMESTAMP NOT NULL
        );
        CREATE TABLE {schema}.contacts (
          id UUID PRIMARY KEY,
          workspace_id UUID NOT NULL,
          company_id UUID NOT NULL,
          lead_id UUID,
          created_at TIMESTAMP NOT NULL
        );
        CREATE TABLE {schema}.deals (
          id UUID PRIMARY KEY,
          workspace_id UUID NOT NULL,
          company_id UUID NOT NULL,
          lead_id UUID,
          created_at TIMESTAMP NOT NULL
        );
        CREATE TABLE {schema}.notes (
          id UUID PRIMARY KEY,
          workspace_id UUID NOT NULL,
          company_id UUID NOT NULL,
          lead_id UUID,
          created_at TIMESTAMP NOT NULL
        );
        CREATE TABLE {schema}.email_messages (
          id UUID PRIMARY KEY,
          workspace_id UUID NOT NULL,
          lead_id UUID,
          direction TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL
        );
        CREATE TABLE {schema}.audit_logs (
          id UUID PRIMARY KEY,
          workspace_id UUID NOT NULL,
          action TEXT NOT NULL,
          metadata_json JSONB NOT NULL,
          created_at TIMESTAMP NOT NULL
        );
        """,
    )
    rows = []
    for index, (company_id, lead_id) in enumerate(zip(company_ids, lead_ids)):
        rows.append((company_id, workspace_id, lead_id, now - timedelta(minutes=index)))
    with conn.cursor() as cur:
        cur.executemany(f"INSERT INTO {schema}.companies(id, workspace_id, lead_id, updated_at) VALUES (%s, %s, %s, %s)", rows)
        for table in ("contacts", "deals", "notes"):
            child_rows = []
            for company_id, lead_id in zip(company_ids, lead_ids):
                for item in range(history_per_parent):
                    child_rows.append((str(uuid4()), workspace_id, company_id, lead_id, now - timedelta(seconds=item)))
            cur.executemany(f"INSERT INTO {schema}.{table}(id, workspace_id, company_id, lead_id, created_at) VALUES (%s, %s, %s, %s, %s)", child_rows)
        email_rows = []
        audit_rows = []
        for lead_id in lead_ids:
            for item in range(history_per_parent):
                email_rows.append((str(uuid4()), workspace_id, lead_id, "inbound" if item % 7 == 0 else "outbound", now - timedelta(seconds=item)))
                audit_rows.append((str(uuid4()), workspace_id, "email.approved" if item == history_per_parent - 1 else "email.event", json.dumps({"lead_id": lead_id}), now - timedelta(seconds=item)))
        cur.executemany(f"INSERT INTO {schema}.email_messages(id, workspace_id, lead_id, direction, created_at) VALUES (%s, %s, %s, %s, %s)", email_rows)
        cur.executemany(f"INSERT INTO {schema}.audit_logs(id, workspace_id, action, metadata_json, created_at) VALUES (%s, %s, %s, %s::jsonb, %s)", audit_rows)
    conn.commit()
    return workspace_id, company_ids, lead_ids


def create_indexes(conn: psycopg.Connection, schema: str) -> None:
    conn.autocommit = True
    for sql in (
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_workspace_company_created_id ON {schema}.contacts(workspace_id, company_id, created_at DESC, id DESC)",
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_workspace_company_created_id ON {schema}.deals(workspace_id, company_id, created_at DESC, id DESC)",
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_workspace_company_created_id ON {schema}.notes(workspace_id, company_id, created_at DESC, id DESC)",
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_workspace_lead_created_id ON {schema}.email_messages(workspace_id, lead_id, created_at DESC, id DESC)",
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_messages_workspace_direction_created_id ON {schema}.email_messages(workspace_id, direction, created_at DESC, id DESC)",
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_workspace_lead_created_id ON {schema}.audit_logs(workspace_id, (metadata_json->>'lead_id'), created_at DESC, id DESC)",
    ):
        execute(conn, sql)
    conn.autocommit = False


def measure(conn: psycopg.Connection, name: str, statements: list[tuple[str, tuple]], iterations: int) -> Measurement:
    latencies: list[float] = []
    loaded_rows = 0
    for _ in range(iterations):
        started = time.perf_counter()
        current_rows = 0
        for sql, params in statements:
            current_rows += len(fetchall(conn, sql, params))
        latencies.append((time.perf_counter() - started) * 1000)
        loaded_rows = current_rows
    return Measurement(name=name, sql_count=len(statements), loaded_rows=loaded_rows, latencies_ms=latencies)


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark CRM/inbox PostgreSQL read paths before and after production hardening.")
    parser.add_argument("--companies", type=int, default=250)
    parser.add_argument("--history-per-parent", type=int, default=50)
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--keep-fixture", action="store_true")
    args = parser.parse_args()

    schema = f"outreachai_bench_{uuid4().hex[:12]}"
    with psycopg.connect(database_url()) as conn:
        workspace_id, company_ids, lead_ids = setup_schema(conn, schema, args.companies, args.history_per_parent)
        create_indexes(conn, schema)
        company_tuple = tuple(company_ids)
        lead_tuple = tuple(lead_ids)
        before = [
            (f"SELECT * FROM {schema}.contacts WHERE workspace_id = %s AND company_id = ANY(%s::uuid[]) ORDER BY company_id, created_at DESC", (workspace_id, list(company_tuple))),
            (f"SELECT * FROM {schema}.deals WHERE workspace_id = %s AND company_id = ANY(%s::uuid[]) ORDER BY company_id, created_at DESC", (workspace_id, list(company_tuple))),
            (f"SELECT * FROM {schema}.notes WHERE workspace_id = %s AND company_id = ANY(%s::uuid[]) ORDER BY company_id, created_at DESC", (workspace_id, list(company_tuple))),
            (f"SELECT * FROM {schema}.email_messages WHERE workspace_id = %s AND lead_id = ANY(%s::uuid[]) ORDER BY lead_id, created_at DESC", (workspace_id, list(lead_tuple))),
            (f"SELECT * FROM {schema}.audit_logs WHERE workspace_id = %s AND metadata_json->>'lead_id' = ANY(%s::text[]) ORDER BY created_at DESC", (workspace_id, list(lead_tuple))),
        ]
        after = [
            (f"SELECT * FROM (SELECT c.*, row_number() OVER (PARTITION BY company_id ORDER BY created_at DESC, id DESC) rn FROM {schema}.contacts c WHERE workspace_id = %s AND company_id = ANY(%s::uuid[])) r WHERE rn <= 10", (workspace_id, list(company_tuple))),
            (f"SELECT * FROM (SELECT d.*, row_number() OVER (PARTITION BY company_id ORDER BY created_at DESC, id DESC) rn FROM {schema}.deals d WHERE workspace_id = %s AND company_id = ANY(%s::uuid[])) r WHERE rn <= 10", (workspace_id, list(company_tuple))),
            (f"SELECT * FROM (SELECT n.*, row_number() OVER (PARTITION BY company_id ORDER BY created_at DESC, id DESC) rn FROM {schema}.notes n WHERE workspace_id = %s AND company_id = ANY(%s::uuid[])) r WHERE rn <= 20", (workspace_id, list(company_tuple))),
            (f"SELECT * FROM (SELECT e.*, row_number() OVER (PARTITION BY lead_id ORDER BY created_at DESC, id DESC) rn FROM {schema}.email_messages e WHERE workspace_id = %s AND lead_id = ANY(%s::uuid[])) r WHERE rn <= 20", (workspace_id, list(lead_tuple))),
            (f"SELECT * FROM (SELECT a.*, row_number() OVER (PARTITION BY metadata_json->>'lead_id' ORDER BY created_at DESC, id DESC) rn FROM {schema}.audit_logs a WHERE workspace_id = %s AND metadata_json->>'lead_id' = ANY(%s::text[])) r WHERE rn <= 10", (workspace_id, list(lead_tuple))),
            (f"SELECT metadata_json->>'lead_id', action, min(created_at) FROM {schema}.audit_logs WHERE workspace_id = %s AND metadata_json->>'lead_id' = ANY(%s::text[]) AND action = ANY(%s::text[]) GROUP BY metadata_json->>'lead_id', action", (workspace_id, list(lead_tuple), ["lead.found", "lead.saved_to_crm", "email.approved"])),
        ]
        results = [measure(conn, "before_wide_history_load", before, args.iterations).summary(), measure(conn, "after_sql_limited_partitions", after, args.iterations).summary()]
        explain = fetchall(
            conn,
            f"EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM {schema}.audit_logs WHERE workspace_id = %s AND metadata_json->>'lead_id' = %s ORDER BY created_at DESC, id DESC LIMIT 10",
            (workspace_id, lead_ids[0]),
        )
        output = {"fixture": {"schema": schema, "companies": args.companies, "history_per_parent": args.history_per_parent}, "results": results, "audit_explain_analyze": [row[0] for row in explain]}
        print(json.dumps(output, indent=2))
        if not args.keep_fixture:
            execute(conn, f"DROP SCHEMA IF EXISTS {schema} CASCADE")
            conn.commit()


if __name__ == "__main__":
    main()
