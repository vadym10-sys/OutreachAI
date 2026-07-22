from __future__ import annotations

import gzip
import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models.entities import BackupRun

logger = logging.getLogger("outreachai.backups")


@dataclass(frozen=True)
class BackupSummary:
    backups_enabled: bool
    provider: str
    last_backup_time: datetime | None
    last_backup_status: str
    next_backup_time: datetime | None
    restore_verified: bool
    message: str


def normalized_provider(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    provider = settings.backup_provider.strip().lower()
    if provider == "google_cloud_storage":
        return "gcs"
    return provider


def latest_backup_run(db: Session) -> BackupRun | None:
    return db.scalar(select(BackupRun).order_by(desc(BackupRun.started_at)).limit(1))


def next_backup_time(latest: BackupRun | None) -> datetime | None:
    if latest and latest.completed_at:
        return latest.completed_at + timedelta(days=1)
    return None


def backup_summary(db: Session, settings: Settings | None = None) -> BackupSummary:
    settings = settings or get_settings()
    provider = normalized_provider(settings)
    latest = latest_backup_run(db)
    enabled_flag = str(settings.database_backups_enabled).strip().lower() == "true"
    latest_success = bool(latest and latest.status == "success")
    restore_verified = bool(latest and latest.restore_verified)
    configured = enabled_flag and bool(provider) and latest_success and restore_verified
    if not provider:
        message = "Backup provider is not configured."
    elif not latest:
        message = "No successful backup has been recorded yet."
    elif latest.status != "success":
        message = latest.error_message or "Latest backup did not finish successfully."
    elif not latest.restore_verified:
        message = "Latest backup exists, but restore verification has not passed."
    elif not enabled_flag:
        message = "Backup works, but DATABASE_BACKUPS_ENABLED is not enabled."
    else:
        message = "Database backups are configured and restore verified."
    return BackupSummary(
        backups_enabled=configured,
        provider=provider or "not_configured",
        last_backup_time=latest.completed_at if latest else None,
        last_backup_status=latest.status if latest else "not_configured",
        next_backup_time=next_backup_time(latest),
        restore_verified=restore_verified,
        message=message,
    )


def database_backups_operational(db: Session, settings: Settings | None = None) -> bool:
    return backup_summary(db, settings).backups_enabled


def backup_archive_is_readable(path: Path) -> bool:
    try:
        with gzip.open(path, "rb") as handle:
            chunk = handle.read(1024)
        return bool(chunk)
    except OSError:
        return False


def _postgres_url_for_tools(settings: Settings) -> str:
    return settings.database_url.replace("postgresql+psycopg://", "postgresql://", 1)


def _same_database_url(left: str, right: str) -> bool:
    return left.replace("postgresql+psycopg://", "postgresql://", 1).rstrip("/") == right.replace("postgresql+psycopg://", "postgresql://", 1).rstrip("/")


def _require_configured(settings: Settings) -> str:
    provider = normalized_provider(settings)
    if provider not in {"aws_s3", "cloudflare_r2", "backblaze_b2", "gcs", "local"}:
        raise RuntimeError("Backup provider is not configured.")
    if provider != "local" and not settings.backup_bucket:
        raise RuntimeError("Backup bucket is not configured.")
    if provider in {"aws_s3", "cloudflare_r2", "backblaze_b2"}:
        if not settings.aws_access_key_id or not settings.aws_secret_access_key:
            raise RuntimeError("S3-compatible backup credentials are not configured.")
        if provider in {"cloudflare_r2", "backblaze_b2"} and not settings.s3_endpoint_url:
            raise RuntimeError("S3-compatible endpoint URL is not configured.")
    if provider == "gcs" and not settings.google_application_credentials:
        raise RuntimeError("Google Cloud Storage credentials are not configured.")
    return provider


def _compress(src: Path, dest: Path) -> None:
    with src.open("rb") as source, gzip.open(dest, "wb", compresslevel=9) as target:
        shutil.copyfileobj(source, target)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _object_key(settings: Settings, created_at: datetime) -> str:
    prefix = settings.backup_prefix.strip("/ ")
    timestamp = created_at.strftime("%Y%m%dT%H%M%SZ")
    return f"{prefix}/outreachai-postgres-{timestamp}.sql.gz" if prefix else f"outreachai-postgres-{timestamp}.sql.gz"


def _store_backup(settings: Settings, provider: str, archive: Path, object_key: str) -> str:
    if provider == "local":
        target = Path(settings.backup_local_dir) / object_key
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(archive, target)
        return str(target)
    if provider in {"aws_s3", "cloudflare_r2", "backblaze_b2"}:
        try:
            import boto3  # type: ignore
        except ImportError as exc:
            raise RuntimeError("boto3 is required for S3-compatible backups.") from exc
        client = boto3.client(
            "s3",
            region_name=settings.aws_region,
            endpoint_url=settings.s3_endpoint_url or None,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
        client.upload_file(str(archive), settings.backup_bucket, object_key)
        return f"s3://{settings.backup_bucket}/{object_key}"
    if provider == "gcs":
        try:
            from google.cloud import storage  # type: ignore
        except ImportError as exc:
            raise RuntimeError("google-cloud-storage is required for GCS backups.") from exc
        os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", settings.google_application_credentials)
        client = storage.Client()
        bucket = client.bucket(settings.backup_bucket)
        blob = bucket.blob(object_key)
        blob.upload_from_filename(str(archive))
        return f"gs://{settings.backup_bucket}/{object_key}"
    raise RuntimeError("Unsupported backup provider.")


def _verify_restore(settings: Settings, archive: Path) -> tuple[bool, dict[str, Any]]:
    if not backup_archive_is_readable(archive):
        return False, {"mode": "gzip", "result": "archive_unreadable"}
    if not settings.backup_restore_test_database_url:
        return False, {"mode": "gzip", "result": "archive_readable", "restore_database": "missing"}
    if not shutil.which("psql"):
        return False, {"mode": "postgres", "result": "psql_missing"}
    restore_url = settings.backup_restore_test_database_url.replace("postgresql+psycopg://", "postgresql://", 1)
    source_url = _postgres_url_for_tools(settings)
    if _same_database_url(source_url, restore_url):
        return False, {"mode": "postgres", "result": "restore_database_matches_source"}
    reset = subprocess.run(
        [
            "psql",
            restore_url,
            "--set",
            "ON_ERROR_STOP=1",
            "--command",
            "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
        ],
        text=True,
        capture_output=True,
        timeout=settings.backup_restore_timeout_seconds,
        check=False,
    )
    if reset.returncode != 0:
        return False, {"mode": "postgres", "result": "restore_reset_failed", "stderr": reset.stderr[-800:]}
    with tempfile.NamedTemporaryFile(suffix=".sql") as sql_file:
        with gzip.open(archive, "rb") as source:
            shutil.copyfileobj(source, sql_file)
        sql_file.flush()
        completed = subprocess.run(
            ["psql", restore_url, "--single-transaction", "--set", "ON_ERROR_STOP=1", "--file", sql_file.name],
            text=True,
            capture_output=True,
            timeout=settings.backup_restore_timeout_seconds,
            check=False,
        )
    if completed.returncode == 0:
        count = subprocess.run(
            [
                "psql",
                restore_url,
                "--tuples-only",
                "--no-align",
                "--set",
                "ON_ERROR_STOP=1",
                "--command",
                "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';",
            ],
            text=True,
            capture_output=True,
            timeout=settings.backup_restore_timeout_seconds,
            check=False,
        )
        table_count = int(count.stdout.strip() or "0") if count.returncode == 0 else 0
        return True, {"mode": "postgres", "result": "restore_succeeded", "table_count": table_count}
    return False, {"mode": "postgres", "result": "restore_failed", "stderr": completed.stderr[-800:]}


def prune_local_backups(settings: Settings) -> None:
    root = Path(settings.backup_local_dir)
    if not root.exists():
        return
    files = sorted(root.glob("**/*.sql.gz"), key=lambda item: item.stat().st_mtime, reverse=True)
    cutoff = datetime.utcnow() - timedelta(days=max(1, settings.backup_retention_days))
    for index, path in enumerate(files):
        too_many = index >= max(1, settings.backup_retention_count)
        too_old = datetime.utcfromtimestamp(path.stat().st_mtime) < cutoff
        if too_many or too_old:
            path.unlink(missing_ok=True)


def run_database_backup(db: Session, *, triggered_by: str = "system", settings: Settings | None = None) -> BackupRun:
    settings = settings or get_settings()
    provider = normalized_provider(settings)
    run = BackupRun(provider=provider or "not_configured", status="running", triggered_by=triggered_by, metadata_json={})
    db.add(run)
    db.commit()
    db.refresh(run)
    try:
        provider = _require_configured(settings)
        if not settings.database_url.startswith("postgresql"):
            raise RuntimeError("Production database backup requires PostgreSQL.")
        if not shutil.which("pg_dump"):
            raise RuntimeError("pg_dump is not installed in this runtime.")
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            sql_path = tmp_dir / "outreachai.sql"
            archive_path = tmp_dir / "outreachai.sql.gz"
            completed = subprocess.run(
                ["pg_dump", _postgres_url_for_tools(settings), "--no-owner", "--no-acl", "--format=plain", "--file", str(sql_path)],
                text=True,
                capture_output=True,
                timeout=settings.backup_restore_timeout_seconds,
                check=False,
            )
            if completed.returncode != 0:
                raise RuntimeError(f"pg_dump failed: {completed.stderr[-800:]}")
            _compress(sql_path, archive_path)
            checksum = _sha256(archive_path)
            object_key = _object_key(settings, run.started_at)
            location = _store_backup(settings, provider, archive_path, object_key)
            restore_verified, restore_metadata = _verify_restore(settings, archive_path)
            if provider == "local":
                prune_local_backups(settings)
            run.provider = provider
            run.status = "success"
            run.object_key = location
            run.size_bytes = archive_path.stat().st_size
            run.checksum_sha256 = checksum
            run.restore_verified = restore_verified
            run.restore_verified_at = datetime.utcnow() if restore_verified else None
            run.metadata_json = {"restore": restore_metadata}
    except Exception as exc:
        logger.exception("Database backup failed")
        run.status = "failed"
        run.error_message = str(exc)[:2000]
        run.metadata_json = {"error_type": exc.__class__.__name__}
    finally:
        run.completed_at = datetime.utcnow()
        db.add(run)
        db.commit()
        db.refresh(run)
    return run
