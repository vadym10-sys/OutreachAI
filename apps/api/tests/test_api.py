from pathlib import Path
from datetime import datetime, timedelta
import base64
import hashlib
import hmac
import json
import logging
import tempfile
import os
import time
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt as jose_jwt
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql

db_path = Path(tempfile.gettempdir()) / "outreachai-api-tests.db"
if db_path.exists():
    db_path.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["AUTO_CREATE_TABLES"] = "true"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_test"
os.environ["STRIPE_STARTER_PRICE_ID"] = "price_starter_test"
os.environ["STRIPE_PRO_PRICE_ID"] = "price_pro_test"
os.environ["STRIPE_AGENCY_PRICE_ID"] = "price_agency_test"
os.environ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"] = "pk_test"
os.environ["AUTOMATION_SECRET"] = "automation_test"
os.environ["APOLLO_API_KEY"] = "apollo_test"
os.environ["HUNTER_API_KEY"] = "hunter_test"
os.environ["GOOGLE_MAPS_API_KEY"] = "google_maps_test"
os.environ["OPENAI_API_KEY"] = "openai_test"
os.environ["RESEND_API_KEY"] = "resend_test"
os.environ["RESEND_FROM_EMAIL"] = "OutreachAI <hello@example.com>"
os.environ["CLERK_SECRET_KEY"] = "clerk_test"
os.environ["CLERK_JWT_ISSUER"] = "https://example.clerk.accounts.dev"

from app.core.database import Base, get_engine, get_sessionmaker, initialize_database_schema  # noqa: E402
from app.core.config import Settings, get_settings  # noqa: E402
from app.core.reliability import database_backup_configured, validate_database_connectivity, validate_required_environment  # noqa: E402
from app.core import cache as cache_module  # noqa: E402
from app.core import security  # noqa: E402
from app.api.usage import _parse_lead_command  # noqa: E402
from app.api.routes import _audit_log_lead_id_clause, _lead_ai_payload, _require_active_subscription, _subscription_status_for_workspace  # noqa: E402
from app.models.entities import AISalesEmployee, AppSettings, AuditLog, BackupRun, Campaign, Company, Contact, EmailMessage, EnrichmentJob, Lead, LeadStatus, Note, Subscription, User, WebsiteAnalysis, Workspace, WorkspaceMember, WorkspaceRole  # noqa: E402
from app.schemas.dto import AnalysisOut, CampaignAnalyticsOut, EmailVariantOut, FollowUpSequenceOut, LeadFinderRequest, LeadOut, MeetingPrepOut, SalesCopilotOut, WebsiteAuditOut  # noqa: E402
from app.services.apollo import ApolloRequestError, ApolloSearchResult  # noqa: E402
from app.services.google_maps import GoogleMapsRequestError, GooglePlacesSearchResult, _text_query  # noqa: E402
from app.services.hunter import HunterRequestError  # noqa: E402
from app.services.ai import ProviderResponseValidationError, _parse_llm_number, sales_copilot  # noqa: E402
from app.services.backups import backup_archive_is_readable  # noqa: E402
from app.services.deep_contact_search import DeepContactCandidate, DeepContactSearchResult, deep_contact_cache_is_fresh, normalize_domain, select_best_decision_maker  # noqa: E402
from app.services.emailer import EmailProviderRequestError  # noqa: E402
from app.services.website import WEBSITE_UNREACHABLE_MESSAGE, WebsiteFetchError, WebsiteSnapshot, WebsiteValidationError, normalize_website_url  # noqa: E402
import app.serve as serve_module  # noqa: E402
from app.main import app  # noqa: E402

initialize_database_schema(get_engine())

client = TestClient(app)
AUTH = {"Authorization": "Bearer dev"}
USER_A_AUTH = {"Authorization": "Bearer dev", "X-Test-User-Email": "tenant-a@example.com"}
USER_B_AUTH = {"Authorization": "Bearer dev", "X-Test-User-Email": "tenant-b@example.com"}
OWNER_AUTH = {"Authorization": "Bearer dev", "X-Test-User-Email": "romaniukvadym10@gmail.com"}
NON_OWNER_AUTH = {"Authorization": "Bearer dev", "X-Test-User-Email": "not-owner@example.com"}
security.limiter.limit = 10000


def test_sentry_debug_endpoint_disabled_by_default() -> None:
    response = client.get("/api/debug/sentry-error")
    assert response.status_code == 404


def test_sentry_debug_endpoint_throws_only_when_debug_enabled(monkeypatch) -> None:
    import app.main as main_module

    monkeypatch.setattr(main_module.settings, "debug", True)
    with pytest.raises(RuntimeError, match="OutreachAI backend development Sentry test error"):
        client.get("/api/debug/sentry-error")


def test_website_url_normalization_adds_https_and_rejects_invalid_domains() -> None:
    assert normalize_website_url("example.com") == "https://example.com"
    assert normalize_website_url("https://Example.COM/path?q=1") == "https://example.com/path?q=1"

    with pytest.raises(WebsiteValidationError):
        normalize_website_url("not a website")

    with pytest.raises(WebsiteValidationError):
        normalize_website_url("localhost")


def test_deep_contact_normalizes_domains_and_rejects_invalid_values() -> None:
    assert normalize_domain("https://www.example.com/about") == "example.com"
    assert normalize_domain("Founder <person@example.com>") == "example.com"
    assert normalize_domain("not a domain") == ""


def test_deep_contact_selects_revenue_decision_maker() -> None:
    candidates = [
        DeepContactCandidate(name="Tech Lead", title="CTO", confidence=90, linkedin="https://linkedin.com/in/cto"),
        DeepContactCandidate(name="Sales Lead", title="Head of Sales", confidence=75, email="sales@example.com"),
        DeepContactCandidate(name="Admin", title="Office Manager", confidence=100, email="admin@example.com"),
    ]
    selected = select_best_decision_maker(candidates, company_profile={"industry": "SaaS"}, industry="SaaS", product_context="Outbound sales")
    assert selected is not None
    assert selected.name == "Sales Lead"
    assert "revenue" in selected.reason.lower()


def test_deep_contact_cache_is_fresh_for_recent_result() -> None:
    metadata = {"deep_contact_search": {"last_enriched_at": datetime.utcnow().isoformat(), "status": "partial_success"}}
    assert deep_contact_cache_is_fresh(metadata) is True


def test_deep_contact_search_endpoint_saves_verified_decision_maker(monkeypatch) -> None:
    import app.api.usage as usage_module

    response = client.post(
        "/api/workspace-app/companies",
        headers=USER_A_AUTH,
        json={"name": "Deep Contact Co", "website": "https://deepcontact.example", "industry": "SaaS", "country": "Germany"},
    )
    assert response.status_code == 200, response.text
    company_id = response.json()["company"]["id"]

    def fake_deep_search(**_: object) -> DeepContactSearchResult:
        return DeepContactSearchResult(
            status="success",
            company_profile={"domain": "deepcontact.example", "industry": "SaaS", "employee_count": 42},
            candidates=[
                DeepContactCandidate(
                    name="Jane Founder",
                    title="Founder",
                    email="jane@deepcontact.example",
                    linkedin="https://linkedin.com/in/jane-founder",
                    source="hunter",
                    confidence=97,
                    verification_status="verified",
                )
            ],
            selected_decision_maker=DeepContactCandidate(
                name="Jane Founder",
                title="Founder",
                email="jane@deepcontact.example",
                linkedin="https://linkedin.com/in/jane-founder",
                source="hunter",
                confidence=97,
                verification_status="verified",
            ),
            verified_email="jane@deepcontact.example",
            email_status="verified",
            confidence_score=95,
            lead_score=92,
            technologies=["Next.js", "HubSpot"],
            sources=["hunter_email_verifier", "builtwith"],
            stages={"email_finder": "completed", "technographics": "completed"},
            last_enriched_at=datetime.utcnow().isoformat(),
        )

    monkeypatch.setattr(usage_module, "run_deep_contact_search", fake_deep_search)
    enriched = client.post(f"/api/workspace-app/companies/{company_id}/deep-contact-search", headers=USER_A_AUTH, json={})
    assert enriched.status_code == 200, enriched.text
    payload = enriched.json()
    assert payload["status"] == "success"
    assert payload["company"]["email"] == "jane@deepcontact.example"
    assert payload["company"]["contacts"][0]["name"] == "Jane Founder"
    assert payload["company"]["deep_contact_search"]["verified_email"] == "jane@deepcontact.example"
    assert "Next.js" in payload["company"]["technologies"]

def test_website_analysis_passes_requested_language_to_ai(monkeypatch) -> None:
    from app.services import ai as ai_service

    captured_payload: dict[str, object] = {}

    def fake_completion(system: str, payload: dict[str, object]) -> dict[str, object]:
        captured_payload.update(payload)
        return {
            "company": "Example",
            "description": "Компания помогает B2B-командам.",
            "industry": "SaaS",
            "niche": "B2B",
            "services": ["Поиск клиентов"],
            "strengths": ["Понятное предложение"],
            "weaknesses": ["Мало доверия"],
            "icp_score": 80,
            "summary": "Русское резюме",
            "sales_angle": "Русский угол продаж",
            "suggested_offer": "Русское предложение",
            "expected_reply_rate": "6-10%",
        }

    monkeypatch.setattr(ai_service, "_json_completion", fake_completion)
    result = ai_service.analyze_company_website(
        company="Example",
        website="https://example.com",
        niche="SaaS",
        page_title="Example",
        meta_description="B2B SaaS",
        page_text="B2B sales workspace",
        technologies=[],
        language="Russian",
    )

    assert captured_payload["requested_language"] == "Russian"
    assert result.sales_angle == "Русский угол продаж"


def stripe_signature(payload: dict) -> tuple[str, str]:
    raw = json.dumps(payload, separators=(",", ":"))
    timestamp = str(int(time.time()))
    signed = f"{timestamp}.{raw}".encode()
    digest = hmac.new(os.environ["STRIPE_WEBHOOK_SECRET"].encode(), signed, hashlib.sha256).hexdigest()
    return raw, f"t={timestamp},v1={digest}"


def _b64url_int(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _auth_test_keypair() -> tuple[bytes, dict]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_numbers = private_key.public_key().public_numbers()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    jwk = {
        "kty": "RSA",
        "kid": "test-kid",
        "use": "sig",
        "alg": "RS256",
        "n": _b64url_int(public_numbers.n),
        "e": _b64url_int(public_numbers.e),
    }
    return private_pem, {"keys": [jwk]}


def test_initialize_database_schema_creates_tables_for_sqlite(tmp_path) -> None:
    from sqlalchemy import create_engine, inspect

    db_path = tmp_path / "migration-bootstrap.sqlite"
    engine = create_engine(f"sqlite:///{db_path}")
    initialize_database_schema(engine)

    inspector = inspect(engine)
    assert "users" in inspector.get_table_names()


def test_validate_required_environment_fails_fast_in_production(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("CLERK_SECRET_KEY", raising=False)

    settings = Settings(app_env="production", strict_startup_env_validation=False, required_runtime_envs="DATABASE_URL,CLERK_SECRET_KEY")

    with pytest.raises(RuntimeError, match="CLERK_SECRET_KEY"):
        validate_required_environment(settings)


def test_validate_required_environment_rejects_placeholder_values_in_production(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CLERK_SECRET_KEY", "dev")
    monkeypatch.setenv("CLERK_JWT_ISSUER", "https://example.clerk.accounts.dev")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///./outreachai.db")

    settings = Settings(app_env="production", strict_startup_env_validation=False, required_runtime_envs="DATABASE_URL,CLERK_SECRET_KEY,CLERK_JWT_ISSUER")

    with pytest.raises(RuntimeError, match="DATABASE_URL|CLERK_SECRET_KEY|CLERK_JWT_ISSUER"):
        validate_required_environment(settings)


def test_validate_database_connectivity_requires_postgresql_in_production(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")

    settings = Settings(app_env="production", strict_startup_env_validation=False, database_url="sqlite:///./outreachai.db")

    with pytest.raises(RuntimeError, match="PostgreSQL"):
        validate_database_connectivity(settings)


def test_serve_main_routes_worker_role_to_worker_entrypoint(monkeypatch) -> None:
    monkeypatch.setenv("OUTREACHAI_PROCESS_ROLE", "worker")

    called = {"worker": False, "uvicorn": False}

    def fake_worker_main() -> None:
        called["worker"] = True

    def fake_uvicorn_run(*args, **kwargs) -> None:
        called["uvicorn"] = True

    monkeypatch.setattr("app.jobs.worker.main", fake_worker_main)
    monkeypatch.setattr(serve_module.uvicorn, "run", fake_uvicorn_run)

    serve_module.main()

    assert called["worker"] is True
    assert called["uvicorn"] is False


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers.get("x-request-id")
    assert response.headers.get("x-response-time-ms")


def test_liveness_and_readiness_are_public() -> None:
    live = client.get("/api/live")
    ready = client.get("/api/ready")

    assert live.status_code == 200
    assert live.json()["status"] == "alive"
    assert ready.status_code == 200
    payload = ready.json()
    assert payload["database"] is True
    assert payload["required_environment"]["DATABASE_URL"] is True
    assert payload["database_backups_configured"] is False
    assert "database_backups_not_confirmed" in payload["warnings"]


def test_readiness_returns_503_when_postgresql_is_unavailable_in_production(monkeypatch) -> None:
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "settings",
        Settings(app_env="production", strict_startup_env_validation=False, database_url="sqlite:///./outreachai.db"),
    )

    response = client.get("/api/ready")

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["database"] is False
    assert any("PostgreSQL" in warning for warning in payload["warnings"])
    assert any("PostgreSQL" in failure for failure in payload["critical_failures"])


def test_readiness_returns_503_when_required_environment_is_missing_in_production(monkeypatch) -> None:
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "settings",
        Settings(app_env="production", strict_startup_env_validation=False, required_runtime_envs="DATABASE_URL,CLERK_SECRET_KEY", database_url="postgresql+psycopg://db.example/outreachai"),
    )
    monkeypatch.delenv("CLERK_SECRET_KEY", raising=False)
    monkeypatch.setattr(main_module, "validate_database_connectivity", lambda settings: None)

    response = client.get("/api/ready")

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["database"] is True
    assert payload["required_environment"]["CLERK_SECRET_KEY"] is False
    assert any("CLERK_SECRET_KEY" in warning for warning in payload["warnings"])
    assert any("CLERK_SECRET_KEY" in failure for failure in payload["critical_failures"])


def test_database_backup_readiness_requires_strict_true() -> None:
    assert database_backup_configured(Settings(database_backups_enabled="true")) is True
    assert database_backup_configured(Settings(database_backups_enabled="TRUE")) is True
    assert database_backup_configured(Settings(database_backups_enabled="1")) is False
    assert database_backup_configured(Settings(database_backups_enabled="yes")) is False
    assert database_backup_configured(Settings(database_backups_enabled="false")) is False


def test_backup_status_is_owner_only_and_reports_not_configured() -> None:
    forbidden = client.get("/api/backups/status", headers=NON_OWNER_AUTH)
    assert forbidden.status_code == 403

    response = client.get("/api/backups/status", headers=OWNER_AUTH)
    assert response.status_code == 200
    payload = response.json()
    assert payload["backups_enabled"] is False
    assert payload["provider"] == "not_configured"
    assert payload["restore_verified"] is False


def test_startup_logs_validation_steps_and_fails_fast_on_database_error(monkeypatch, caplog) -> None:
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "settings",
        Settings(app_env="production", strict_startup_env_validation=False, database_url="sqlite:///./outreachai.db"),
    )
    monkeypatch.setattr(main_module, "validate_required_environment", lambda settings: [])
    monkeypatch.setattr(main_module, "validate_database_connectivity", lambda settings: (_ for _ in ()).throw(RuntimeError("Production startup requires PostgreSQL")))
    monkeypatch.setattr(main_module, "ensure_runtime_schema", lambda engine: None)
    monkeypatch.setattr(main_module, "database_backups_operational", lambda db, settings: True)
    monkeypatch.setattr("app.jobs.worker.start_embedded_enrichment_worker", lambda: None)

    with caplog.at_level(logging.INFO, logger="outreachai.api"):
        with pytest.raises(RuntimeError, match="Startup initialization failed"):
            main_module.startup()

    assert "Starting OutreachAI API app_env=production" in caplog.text
    assert "Startup validation: required environment verified" in caplog.text
    assert "Startup initialization failed; aborting application startup" in caplog.text


def test_manual_backup_fails_safely_when_provider_is_missing() -> None:
    response = client.post("/api/backups/run", headers=OWNER_AUTH)
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "failed"
    assert "provider" in payload["error_message"].lower()
    with get_sessionmaker()() as db:
        stored = db.scalar(select(BackupRun).where(BackupRun.id == UUID(payload["id"])))
        assert stored is not None
        assert stored.status == "failed"


def test_backup_archive_integrity_check_accepts_readable_gzip(tmp_path: Path) -> None:
    archive = tmp_path / "backup.sql.gz"
    import gzip
    with gzip.open(archive, "wb") as handle:
        handle.write(b"CREATE TABLE restore_probe(id integer);\n")
    assert backup_archive_is_readable(archive) is True


def test_request_id_is_echoed_for_traceability() -> None:
    response = client.get("/api/health", headers={"X-Request-ID": "test-request-123"})
    assert response.status_code == 200
    assert response.headers["x-request-id"] == "test-request-123"
    assert response.headers.get("x-response-time-ms")


def test_mutating_api_requests_are_audited() -> None:
    before = client.get("/api/activity", headers=AUTH)
    assert before.status_code == 200

    response = client.put(
        "/api/profile",
        headers={**AUTH, "X-Request-ID": "audit-request-123"},
        json={
            "workspace": "Audit Workspace",
            "company": "Audit Co",
            "avatar_url": None,
            "timezone": "Europe/Warsaw",
            "language": "English",
        },
    )
    assert response.status_code == 200

    with get_sessionmaker()() as db:
        audits = db.scalars(select(AuditLog).where(AuditLog.action == "api.put").order_by(AuditLog.created_at.desc()).limit(20)).all()
        audit = next((item for item in audits if item.metadata_json.get("request_id") == "audit-request-123"), None)
    assert audit is not None
    assert audit.metadata_json["path"] == "/api/profile"
    assert audit.metadata_json["status"] == 200


def test_profile_language_updates_private_workspace_language() -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "profile-language@example.com"}
    profile = client.put(
        "/api/profile",
        headers=headers,
        json={
            "workspace": "Profile Language Workspace",
            "company": "Profile Language Co",
            "avatar_url": None,
            "timezone": "Europe/Warsaw",
            "language": "Russian",
        },
    )
    assert profile.status_code == 200
    assert profile.json()["language"] == "Russian"

    bootstrap = client.get("/api/workspace-app/bootstrap", headers=headers)
    assert bootstrap.status_code == 200
    assert bootstrap.json()["workspace"]["language"] == "Russian"


def test_redis_cache_unavailable_fails_open(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "upstash_redis_rest_url", "https://redis.example.com")
    monkeypatch.setattr(settings, "upstash_redis_rest_token", "token")

    def broken_post(*args, **kwargs):
        raise RuntimeError("redis offline")

    monkeypatch.setattr(cache_module.httpx, "post", broken_post)
    assert cache_module.get_json("outreachai:test") is None
    cache_module.set_json("outreachai:test", {"ok": True}, 10)


def test_owner_helper_matches_only_configured_owner_email() -> None:
    assert security.is_owner("romaniukvadym10@gmail.com")
    assert security.is_owner("  ROMANIUKVADYM10@GMAIL.COM ")
    assert not security.is_owner("not-owner@example.com")


def test_owner_console_requires_owner_email() -> None:
    denied = client.get("/api/owner/console", headers=NON_OWNER_AUTH)
    assert denied.status_code == 403
    assert denied.json()["detail"] == "Access denied."

    response = client.get("/api/owner/console", headers=OWNER_AUTH)
    assert response.status_code == 200
    data = response.json()
    assert data["executive_overview"]["owner"] == "romaniukvadym10@gmail.com"
    assert "feature_flags" in data
    assert "audit_logs" in data


def test_owner_can_update_feature_flags() -> None:
    denied = client.patch("/api/owner/feature-flags", headers=NON_OWNER_AUTH, json={"ai_ceo_voice": True})
    assert denied.status_code == 403

    response = client.patch("/api/owner/feature-flags", headers=OWNER_AUTH, json={"ai_ceo_voice": True, "analytics_nav": True})
    assert response.status_code == 200
    data = response.json()
    assert data["ai_ceo_voice"] is True
    assert data["analytics_nav"] is True


def test_admin_summary_and_logs_are_owner_only() -> None:
    denied_summary = client.get("/api/admin/summary", headers=NON_OWNER_AUTH)
    denied_logs = client.get("/api/admin/logs", headers=NON_OWNER_AUTH)
    assert denied_summary.status_code == 403
    assert denied_logs.status_code == 403

    summary = client.get("/api/admin/summary", headers=OWNER_AUTH)
    logs = client.get("/api/admin/logs", headers=OWNER_AUTH)
    assert summary.status_code == 200
    assert logs.status_code == 200


def test_admin_queue_health_is_owner_only_and_reports_metrics() -> None:
    denied = client.get("/api/admin/queue/health", headers=NON_OWNER_AUTH)
    assert denied.status_code == 403

    workspace = client.get("/api/workspace", headers=AUTH).json()
    workspace_id = UUID(workspace["id"])
    db = get_sessionmaker()()
    try:
        campaign = Campaign(user_id="dev_user", workspace_id=workspace_id, name="Queue Health Campaign", industry="Construction")
        db.add(campaign)
        db.flush()
        pending_lead = Lead(user_id="dev_user", workspace_id=workspace_id, campaign_id=campaign.id, company="Queue Pending Co")
        running_lead = Lead(user_id="dev_user", workspace_id=workspace_id, campaign_id=campaign.id, company="Queue Running Co")
        dead_lead = Lead(user_id="dev_user", workspace_id=workspace_id, campaign_id=campaign.id, company="Queue Dead Co")
        db.add_all([pending_lead, running_lead, dead_lead])
        db.flush()
        now = datetime.utcnow()
        db.add_all([
            EnrichmentJob(
                workspace_id=workspace_id,
                user_id="dev_user",
                lead_id=pending_lead.id,
                job_type="company_enrichment",
                status="pending",
                request_id="queue-health-pending",
                language="English",
                run_after=now,
            ),
            EnrichmentJob(
                workspace_id=workspace_id,
                user_id="dev_user",
                lead_id=running_lead.id,
                job_type="company_enrichment",
                status="running",
                request_id="queue-health-running",
                language="English",
                locked_by="worker-health",
                locked_at=now,
                started_at=now - timedelta(seconds=15),
                run_after=now,
            ),
            EnrichmentJob(
                workspace_id=workspace_id,
                user_id="dev_user",
                lead_id=dead_lead.id,
                job_type="company_enrichment",
                status="failed",
                request_id="queue-health-dead",
                language="English",
                started_at=now - timedelta(seconds=10),
                completed_at=now - timedelta(seconds=5),
                progress_json={"dead_lettered": True, "terminal_state": "failed"},
                run_after=now,
            ),
        ])
        db.commit()
    finally:
        db.close()

    response = client.get("/api/admin/queue/health", headers=OWNER_AUTH)
    assert response.status_code == 200
    payload = response.json()
    assert payload["queue_depth"] >= 1
    assert payload["active_jobs"] >= 1
    assert payload["retry_count"] >= 0
    assert payload["dead_letter_count"] >= 1
    assert payload["processing_latency_ms"]["average"] >= 0
    assert payload["processing_latency_ms"]["max"] >= 0
    assert payload["worker_claim_timeout_seconds"] > 0
    assert payload["terminal_states"] == ["completed", "failed", "cancelled"]



def test_workspace_data_is_private_between_users(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)

    before_user_a_dashboard = client.get("/api/dashboard", headers=USER_A_AUTH)
    before_user_b_dashboard = client.get("/api/dashboard", headers=USER_B_AUTH)
    assert before_user_a_dashboard.status_code == 200
    assert before_user_b_dashboard.status_code == 200
    before_user_a_leads_count = before_user_a_dashboard.json()["leads"]
    before_user_b_leads_count = before_user_b_dashboard.json()["leads"]

    lead_payload = {
        "company": "Tenant A Berlin Builders",
        "website": "https://tenant-a-builders.example",
        "country": "Germany",
        "city": "Berlin",
        "industry": "Construction",
    }
    lead_response = client.post("/api/leads", headers=USER_A_AUTH, json=lead_payload)
    assert lead_response.status_code == 200
    lead_id = lead_response.json()["id"]

    user_a_workspace = client.get("/api/workspace", headers=USER_A_AUTH)
    user_b_workspace = client.get("/api/workspace", headers=USER_B_AUTH)
    assert user_a_workspace.status_code == 200
    assert user_b_workspace.status_code == 200
    assert user_a_workspace.json()["id"] != user_b_workspace.json()["id"]

    user_a_leads = client.get("/api/leads?search=Tenant%20A%20Berlin%20Builders", headers=USER_A_AUTH)
    user_b_leads = client.get("/api/leads?search=Tenant%20A%20Berlin%20Builders", headers=USER_B_AUTH)
    assert user_a_leads.status_code == 200
    assert user_b_leads.status_code == 200
    assert user_a_leads.json()["total"] == 1
    assert user_b_leads.json()["total"] == 0

    user_a_dashboard = client.get("/api/dashboard", headers=USER_A_AUTH)
    user_b_dashboard = client.get("/api/dashboard", headers=USER_B_AUTH)
    assert user_a_dashboard.status_code == 200
    assert user_b_dashboard.status_code == 200
    assert user_a_dashboard.json()["leads"] == before_user_a_leads_count + 1
    assert user_b_dashboard.json()["leads"] == before_user_b_leads_count

    user_a_companies = client.get("/api/crm/companies?search=Tenant%20A%20Berlin%20Builders", headers=USER_A_AUTH)
    user_b_companies = client.get("/api/crm/companies?search=Tenant%20A%20Berlin%20Builders", headers=USER_B_AUTH)
    assert user_a_companies.status_code == 200
    assert user_b_companies.status_code == 200
    assert len(user_a_companies.json()) == 1
    assert user_b_companies.json() == []

    company_id = user_a_companies.json()[0]["id"]
    forbidden_stage_update = client.patch(f"/api/crm/companies/{company_id}/stage", headers=USER_B_AUTH, json={"stage": "Qualified"})
    assert forbidden_stage_update.status_code == 404

    campaign_payload = {
        "name": "Tenant A Construction Outreach",
        "industry": "Construction",
        "countries": ["Germany"],
        "cities": ["Berlin"],
        "offer": "More qualified construction leads",
    }
    campaign_response = client.post("/api/campaigns", headers=USER_A_AUTH, json=campaign_payload)
    assert campaign_response.status_code == 200
    campaign_id = campaign_response.json()["id"]

    user_b_campaigns = client.get("/api/campaigns", headers=USER_B_AUTH)
    assert user_b_campaigns.status_code == 200
    assert all(item["id"] != campaign_id for item in user_b_campaigns.json())

    forbidden_campaign_update = client.put(f"/api/campaigns/{campaign_id}", headers=USER_B_AUTH, json={**campaign_payload, "name": "Hijacked"})
    assert forbidden_campaign_update.status_code == 404

    signed_out = client.get("/api/leads")
    assert signed_out.status_code == 401
    assert lead_id


def test_workspace_me_creates_private_workspace_with_owner_email() -> None:
    response = client.get("/api/workspace/me", headers={"Authorization": "Bearer dev", "X-Test-User-Email": "new-owner@example.com"})
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "new-owner's workspace"
    assert data["name"] != "Outreach workspace"
    assert data["company"] == ""
    assert data["members"][0]["email"] == "new-owner@example.com"
    assert data["members"][0]["role"].lower() == "owner"

    second = client.get("/api/workspace/me", headers={"Authorization": "Bearer dev", "X-Test-User-Email": "new-owner@example.com"})
    assert second.status_code == 200
    assert second.json()["id"] == data["id"]


def test_new_private_workspace_gets_fourteen_day_trial_status() -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "trial-owner@example.com"}
    workspace_response = client.get("/api/workspace/me", headers=headers)
    assert workspace_response.status_code == 200

    status_response = client.get("/api/billing/status", headers=headers)
    assert status_response.status_code == 200
    status = status_response.json()
    assert status["plan"] == "Starter"
    assert status["status"] == "trialing"
    assert status["trial_end"] is not None
    assert status["trial_days_remaining"] >= 13


def test_existing_workspace_without_billing_status_gets_trial_before_production_ai_gate(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "legacy-trial-owner@example.com"}
    workspace_response = client.get("/api/workspace/me", headers=headers)
    assert workspace_response.status_code == 200
    workspace_id = workspace_response.json()["id"]

    SessionLocal = get_sessionmaker()
    with SessionLocal() as db:
        workspace = db.get(Workspace, UUID(workspace_id))
        assert workspace is not None
        settings = db.scalar(select(AppSettings).where(AppSettings.workspace_id == UUID(workspace_id)))
        if settings is None:
            settings = AppSettings(user_id="legacy-trial-owner@example.com", workspace_id=workspace.id)
        settings.billing = {"plan": "Starter", "renewal": "monthly"}
        db.add(settings)
        db.commit()

    app_settings = get_settings()
    original_env = app_settings.app_env
    monkeypatch.setattr(app_settings, "app_env", "production")
    try:
        with SessionLocal() as db:
            workspace = db.get(Workspace, UUID(workspace_id))
            assert workspace is not None
            assert _subscription_status_for_workspace(db, workspace) == "trialing"
            _require_active_subscription(db, workspace)
    finally:
        monkeypatch.setattr(app_settings, "app_env", original_env)


def test_workspace_trial_status_survives_legacy_inactive_subscription(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "legacy-inactive-subscription@example.com"}
    workspace_response = client.get("/api/workspace/me", headers=headers)
    assert workspace_response.status_code == 200
    workspace_id = UUID(workspace_response.json()["id"])

    SessionLocal = get_sessionmaker()
    with SessionLocal() as db:
        workspace = db.get(Workspace, workspace_id)
        assert workspace is not None
        settings = db.scalar(select(AppSettings).where(AppSettings.workspace_id == workspace_id))
        if settings is None:
            settings = AppSettings(user_id=workspace.owner_user_id, workspace_id=workspace.id)
        settings.billing = {"plan": "Starter", "renewal": "monthly"}
        user = User(clerk_user_id="legacy-inactive-subscription", email="legacy-inactive-subscription@example.com")
        db.add(user)
        db.flush()
        db.add(
            Subscription(
                user_id=user.id,
                workspace_id=workspace_id,
                plan="Starter",
                status="inactive",
                plan_limits={},
            )
        )
        db.add(settings)
        db.commit()

    app_settings = get_settings()
    original_env = app_settings.app_env
    monkeypatch.setattr(app_settings, "app_env", "production")
    try:
        with SessionLocal() as db:
            workspace = db.get(Workspace, workspace_id)
            assert workspace is not None
            assert _subscription_status_for_workspace(db, workspace) == "trialing"
            _require_active_subscription(db, workspace)
    finally:
        monkeypatch.setattr(app_settings, "app_env", original_env)


def test_workspace_trial_status_survives_inactive_stripe_metadata(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "legacy-inactive-stripe@example.com"}
    workspace_response = client.get("/api/workspace/me", headers=headers)
    assert workspace_response.status_code == 200
    workspace_id = UUID(workspace_response.json()["id"])

    SessionLocal = get_sessionmaker()
    with SessionLocal() as db:
        workspace = db.get(Workspace, workspace_id)
        assert workspace is not None
        settings = db.scalar(select(AppSettings).where(AppSettings.workspace_id == workspace_id))
        if settings is None:
            settings = AppSettings(user_id=workspace.owner_user_id, workspace_id=workspace.id)
        settings.billing = {
            "plan": "Starter",
            "renewal": "monthly",
            "status": "inactive",
            "stripeSubscriptionId": "sub_legacy_inactive",
        }
        user = User(clerk_user_id="legacy-inactive-stripe", email="legacy-inactive-stripe@example.com")
        db.add(user)
        db.flush()
        db.add(
            Subscription(
                user_id=user.id,
                workspace_id=workspace_id,
                stripe_subscription_id="sub_legacy_inactive",
                plan="Starter",
                status="inactive",
                plan_limits={},
            )
        )
        db.add(settings)
        db.commit()

    app_settings = get_settings()
    original_env = app_settings.app_env
    monkeypatch.setattr(app_settings, "app_env", "production")
    try:
        with SessionLocal() as db:
            workspace = db.get(Workspace, workspace_id)
            assert workspace is not None
            assert _subscription_status_for_workspace(db, workspace) == "trialing"
            _require_active_subscription(db, workspace)
    finally:
        monkeypatch.setattr(app_settings, "app_env", original_env)


def test_workspace_me_prefers_owned_private_workspace_over_old_membership() -> None:
    SessionLocal = get_sessionmaker()
    user_email = "workspace-owner@example.com"
    with SessionLocal() as db:
        shared = Workspace(owner_user_id="shared-owner", name="Shared AI Workspace")
        private = Workspace(owner_user_id=user_email, name="Outreach workspace")
        db.add_all([shared, private])
        db.flush()
        db.add(WorkspaceMember(workspace_id=shared.id, user_id=user_email, email=user_email, role=WorkspaceRole.member, status="active"))
        db.commit()
        shared_id = str(shared.id)
        private_id = str(private.id)

    response = client.get("/api/workspace/me", headers={"Authorization": "Bearer dev", "X-Test-User-Email": user_email})
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == private_id
    assert data["id"] != shared_id
    assert data["name"] == "workspace-owner's workspace"
    assert any(member["email"] == user_email and member["role"].lower() == "owner" for member in data["members"])


def test_workspace_me_ignores_shared_membership_without_owned_workspace() -> None:
    SessionLocal = get_sessionmaker()
    user_email = "isolated-member@example.com"
    with SessionLocal() as db:
        shared = Workspace(owner_user_id="another-owner", name="Shared Legacy Workspace")
        db.add(shared)
        db.flush()
        db.add(WorkspaceMember(workspace_id=shared.id, user_id=user_email, email=user_email, role=WorkspaceRole.member, status="active"))
        db.commit()
        shared_id = str(shared.id)

    response = client.get("/api/workspace/me", headers={"Authorization": "Bearer dev", "X-Test-User-Email": user_email})
    assert response.status_code == 200
    data = response.json()
    assert data["id"] != shared_id
    assert data["name"] == "isolated-member's workspace"
    assert len(data["members"]) == 1
    assert data["members"][0]["email"] == user_email
    assert data["members"][0]["role"].lower() == "owner"


def test_workspace_member_invites_are_disabled_for_private_accounts(monkeypatch) -> None:
    SessionLocal = get_sessionmaker()
    app_settings = get_settings()
    original_env = app_settings.app_env
    monkeypatch.setattr(app_settings, "app_env", "development")
    try:
        response = client.post(
            "/api/workspace/members",
            headers=OWNER_AUTH,
            json={"email": "teammate@example.com", "role": "Member"},
        )
    finally:
        monkeypatch.setattr(app_settings, "app_env", original_env)
    assert response.status_code == 403
    with SessionLocal() as db:
        member = db.scalar(select(WorkspaceMember).where(WorkspaceMember.email == "teammate@example.com"))
        assert member is None


def test_workspace_app_bootstrap_creates_private_workspace() -> None:
    response = client.get("/api/workspace-app/bootstrap", headers={"Authorization": "Bearer dev", "X-Test-User-Email": "usage-owner@example.com"})
    assert response.status_code == 200
    data = response.json()
    assert data["workspace"]["name"] == "usage-owner's workspace"
    assert data["workspace"]["members"][0]["role"] == "Owner"
    assert data["counts"]["companies"] == 0
    assert "Add your first company" in data["next_action"]


def test_customer_facing_workspace_hides_internal_qa_records() -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "qa-cleanup-owner@example.com"}
    workspace_response = client.get("/api/workspace/me", headers=headers)
    assert workspace_response.status_code == 200
    workspace_id = UUID(workspace_response.json()["id"])

    SessionLocal = get_sessionmaker()
    with SessionLocal() as db:
        real_company = Company(
            user_id="qa-cleanup-owner@example.com",
            workspace_id=workspace_id,
            name="Real Berlin Construction GmbH",
            website="https://real-berlin-builder.de",
            domain="real-berlin-builder.de",
            city="Berlin",
            country="Germany",
            industry="Construction",
        )
        db.add_all(
            [
                real_company,
                Company(
                    user_id="qa-cleanup-owner@example.com",
                    workspace_id=workspace_id,
                    name="Premium Test Construction Berlin",
                    website="https://example.com",
                    domain="example.com",
                    city="Berlin",
                    country="Germany",
                    industry="Construction",
                ),
                Campaign(
                    user_id="qa-cleanup-owner@example.com",
                    workspace_id=workspace_id,
                    name="QA Campaign 123",
                    industry="Construction",
                    countries=["Germany"],
                    cities=["Berlin"],
                ),
                Campaign(
                    user_id="qa-cleanup-owner@example.com",
                    workspace_id=workspace_id,
                    name="Berlin Construction Outreach",
                    industry="Construction",
                    countries=["Germany"],
                    cities=["Berlin"],
                ),
            ]
        )
        db.flush()
        db.add(
            Contact(
                user_id="qa-cleanup-owner@example.com",
                workspace_id=workspace_id,
                company_id=real_company.id,
                name="QA Contact",
                title="Tester",
                email="qa-contact@example.com",
                source="manual",
            )
        )
        db.commit()

    workspace_companies = client.get("/api/workspace-app/companies", headers=headers)
    assert workspace_companies.status_code == 200
    assert [item["name"] for item in workspace_companies.json()] == ["Real Berlin Construction GmbH"]
    assert workspace_companies.json()[0]["contacts"] == []

    pipeline = client.get("/api/crm/pipeline", headers=headers)
    assert pipeline.status_code == 200
    pipeline_names = [item["name"] for item in pipeline.json()["companies"]]
    assert "Real Berlin Construction GmbH" in pipeline_names
    assert "Premium Test Construction Berlin" not in pipeline_names

    contacts = client.get("/api/crm/contacts", headers=headers)
    assert contacts.status_code == 200
    assert contacts.json() == []

    campaigns = client.get("/api/campaigns", headers=headers)
    assert campaigns.status_code == 200
    campaign_names = [item["name"] for item in campaigns.json()]
    assert "Berlin Construction Outreach" in campaign_names
    assert "QA Campaign 123" not in campaign_names


def test_workspace_app_manual_company_save_persists_and_dedupes() -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-company@example.com"}
    payload = {
        "name": "Usage Berlin Builders",
        "website": "usage-berlin-builders.example",
        "country": "Germany",
        "city": "Berlin",
        "industry": "Construction",
        "contact": "Erika Owner",
        "phone": "+49 30 555 0101",
        "email": "hello@usage-berlin-builders.example",
        "address": "Friedrichstrasse 1, Berlin",
    }
    created = client.post("/api/workspace-app/companies", headers=headers, json=payload)
    assert created.status_code == 200
    assert created.json()["status"] == "created"
    company = created.json()["company"]
    assert company["name"] == "Usage Berlin Builders"
    assert company["website"] == "https://usage-berlin-builders.example"
    assert company["contacts"][0]["name"] == "Erika Owner"
    assert company["contacts"][0]["email"] == "hello@usage-berlin-builders.example"
    assert company["saved_to_crm_at"]

    reused = client.post("/api/workspace-app/companies", headers=headers, json=payload)
    assert reused.status_code == 200
    assert reused.json()["status"] == "reused"
    assert reused.json()["company"]["id"] == company["id"]

    refreshed = client.get("/api/workspace-app/companies?search=Usage%20Berlin", headers=headers)
    assert refreshed.status_code == 200
    assert len(refreshed.json()) == 1
    assert refreshed.json()[0]["id"] == company["id"]

    filtered = client.get("/api/workspace-app/companies?city=Berlin&industry=Construction&email_status=Found", headers=headers)
    assert filtered.status_code == 200
    assert filtered.json()[0]["id"] == company["id"]


def test_workspace_app_manual_company_save_survives_crm_sync_failure(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-degraded@example.com"}

    def broken_sync(*args, **kwargs):
        raise RuntimeError("simulated crm sync failure")

    monkeypatch.setattr("app.api.usage._sync_lead_to_crm", broken_sync)
    response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={
            "name": "Usage Degraded Builders",
            "website": "https://usage-degraded-builders.example",
            "country": "Germany",
            "city": "Berlin",
            "industry": "Construction",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "created"
    assert payload["company"]["name"] == "Usage Degraded Builders"
    assert payload["company"]["crm_stage"] == "New Lead"

    refreshed = client.get("/api/workspace-app/companies?search=Usage%20Degraded", headers=headers)
    assert refreshed.status_code == 200
    assert len(refreshed.json()) == 1
    assert refreshed.json()[0]["id"] == payload["company"]["id"]


def test_workspace_app_company_data_is_private_between_users() -> None:
    user_a = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-a@example.com"}
    user_b = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-b@example.com"}
    response = client.post(
        "/api/workspace-app/companies",
        headers=user_a,
        json={"name": "Private Usage Build", "website": "https://private-usage-build.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert response.status_code == 200
    company_id = response.json()["company"]["id"]

    user_a_company = client.get(f"/api/workspace-app/companies/{company_id}", headers=user_a)
    user_b_company = client.get(f"/api/workspace-app/companies/{company_id}", headers=user_b)
    assert user_a_company.status_code == 200
    assert user_b_company.status_code == 404

    user_b_list = client.get("/api/workspace-app/companies?search=Private%20Usage", headers=user_b)
    assert user_b_list.status_code == 200
    assert user_b_list.json() == []


def test_workspace_app_lead_search_success_saves_to_crm(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-search@example.com"}
    monkeypatch.setattr("app.api.usage._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    def fake_analyze(db, user_id, workspace, lead):
        metadata = json.loads((lead.notes or "{}").splitlines()[0])
        metadata.update(
            {
                "ai_summary": "Usage Search helps Berlin construction buyers evaluate new partners.",
                "services": ["B2B construction sourcing"],
                "weaknesses": ["Manual partner discovery"],
                "pain_points": ["Manual partner discovery"],
                "icp_score": 86,
                "value_proposition": "Reviewed local partner pipeline",
                "sales_angle": "Lead with faster partner sourcing for B2B construction projects.",
                "suggested_offer": "Offer a reviewed B2B partnership pipeline.",
                "outreach_strategy": "Reference their local construction focus and invite a short fit review.",
                "recommended_cta": "Book a fit review",
                "follow_up_strategy": "Follow up with one local proof point.",
                "expected_reply_rate": "8-12%",
                "website_analyzed_at": datetime.utcnow().isoformat(),
            }
        )
        lead.notes = json.dumps(metadata, sort_keys=True)

    monkeypatch.setattr("app.api.usage._analyze_lead_if_possible", fake_analyze)
    monkeypatch.setattr(
        "app.api.usage.personalize_email",
        lambda payload: EmailVariantOut(
            subject="B2B partnership idea for Usage Search",
            preview="Quick partnership idea",
            full_email="Hi, I found a relevant partnership opportunity for your team.",
            cta="Open to a quick review?",
            cold_email="Hi, I found a relevant partnership opportunity for your team.",
            follow_ups=["Worth a quick look?", "Should I send details?"],
        ),
    )
    monkeypatch.setattr(
        "app.api.usage.search_google_places",
        lambda payload: GooglePlacesSearchResult(
            leads=[
                LeadOut(
                    company="Usage Search GmbH",
                    website="https://usage-search.example",
                    industry="Construction",
                    country="Germany",
                    city="Berlin",
                    notes='{"source":"google_maps","domain":"usage-search.example","place_id":"usage-search-1"}',
                    domain="usage-search.example",
                    place_id="usage-search-1",
                    source="google_maps",
                )
            ],
            raw_count=1,
            duration_ms=8,
        ),
    )
    response = client.post("/api/workspace-app/leads/search", headers=headers, json={"industry": "Construction", "country": "Germany", "city": "Berlin", "limit": 10})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["companies_saved"] == 1
    assert data["companies"][0]["name"] == "Usage Search GmbH"
    assert data["companies"][0]["ai_summary"] == "Usage Search helps Berlin construction buyers evaluate new partners."
    assert data["companies"][0]["pain_points"] == ["Manual partner discovery"]
    assert data["companies"][0]["services"] == ["B2B construction sourcing"]
    assert data["companies"][0]["weaknesses"] == ["Manual partner discovery"]
    assert data["companies"][0]["icp_score"] == 86
    assert data["companies"][0]["value_proposition"] == "Reviewed local partner pipeline"
    assert data["companies"][0]["suggested_offer"] == "Offer a reviewed B2B partnership pipeline."
    assert data["companies"][0]["recommended_cta"] == "Book a fit review"
    assert data["companies"][0]["follow_up_strategy"] == "Follow up with one local proof point."
    assert data["companies"][0]["expected_reply_rate"] == "8-12%"
    assert data["companies"][0]["generated_emails"][0]["delivery_status"] == "draft"

    persisted = client.get("/api/workspace-app/companies?search=Usage%20Search", headers=headers)
    assert persisted.status_code == 200
    assert len(persisted.json()) == 1


def test_workspace_app_ai_lead_command_parses_sales_search() -> None:
    workspace = SimpleNamespace(target_country="")

    filters, missing = _parse_lead_command("Find 25 construction companies in Berlin with 20-100 employees", workspace)
    assert missing == []
    assert filters is not None
    assert filters.country == "Germany"
    assert filters.city == "Berlin"
    assert filters.industry == "Construction"
    assert filters.company_size == "20-100"
    assert filters.limit == 25

    ru_filters, ru_missing = _parse_lead_command("Найди 10 строительных компаний в Берлине", workspace)
    assert ru_missing == []
    assert ru_filters is not None
    assert ru_filters.country == "Germany"
    assert ru_filters.city == "Berlin"
    assert ru_filters.industry == "Construction"
    assert ru_filters.limit == 10

    beauty_workspace = SimpleNamespace(target_country="Europe", industry="")
    beauty_filters, beauty_missing = _parse_lead_command("Хочу найти клиентов для своей продукции по косметике", beauty_workspace)
    assert beauty_missing == []
    assert beauty_filters is not None
    assert beauty_filters.country == "Poland"
    assert beauty_filters.city == "Warsaw"
    assert beauty_filters.industry == "Beauty & cosmetics"
    assert "beauty" in beauty_filters.keyword


def test_workspace_app_ai_lead_command_uses_fast_search_path(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-command-fast@example.com"}

    monkeypatch.setattr("app.api.usage._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("AI command should not run full turnkey research before the response is saved")

    monkeypatch.setattr("app.api.usage._complete_turnkey_b2b_research", fail_if_called)
    queued: list[str] = []
    monkeypatch.setattr(
        "app.api.usage._enqueue_auto_enrichment",
        lambda db, request, user_id, workspace, leads, request_id, **kwargs: queued.extend([str(lead.id) for lead in leads]) or False,
    )
    monkeypatch.setattr(
        "app.api.usage.search_google_places",
        lambda payload: GooglePlacesSearchResult(
            leads=[
                LeadOut(
                    company="Usage Beauty Studio",
                    website="https://usage-beauty.example",
                    industry="Beauty & cosmetics",
                    country="Poland",
                    city="Warsaw",
                    notes='{"source":"google_maps","domain":"usage-beauty.example","place_id":"usage-beauty-1"}',
                    domain="usage-beauty.example",
                    place_id="usage-beauty-1",
                    source="google_maps",
                )
            ],
            raw_count=1,
            duration_ms=9,
        ),
    )
    monkeypatch.setattr(
        "app.api.usage.get_google_place_details",
        lambda place_id: {
            "place_id": place_id,
            "website": "https://usage-beauty.example",
            "domain": "usage-beauty.example",
            "phone": "+48 22 123 45 67",
            "address": "Warsaw, Poland",
            "business_category": "Beauty salon",
            "technologies": ["booking", "ecommerce"],
        },
    )

    response = client.post(
        "/api/workspace-app/leads/command",
        headers=headers,
        json={"command": "Хочу найти клиентов для своей продукции по косметике"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["companies_saved"] == 1
    assert len(queued) == 1
    assert data["companies"][0]["name"] == "Usage Beauty Studio"
    assert data["companies"][0]["workflow_stages"]["website_analysis"] == "running"
    assert data["filters"]["country"] == "Poland"
    assert data["filters"]["city"] == "Warsaw"
    assert data["filters"]["industry"] == "Beauty & cosmetics"
    assert "AI enrichment is now filling research" in data["message"]


def test_workspace_app_lead_search_reports_reused_duplicates(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-search-duplicates@example.com"}
    monkeypatch.setattr("app.api.usage._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    def fake_analyze(db, user_id, workspace, lead):
        metadata = json.loads((lead.notes or "{}").splitlines()[0])
        metadata.update(
            {
                "ai_summary": "Usage Duplicate is a reusable CRM opportunity.",
                "sales_angle": "Show duplicate-safe partner research.",
                "suggested_offer": "Offer a duplicate-safe B2B research workflow.",
                "outreach_strategy": "Keep one clean company workspace.",
                "expected_reply_rate": "6-10%",
                "website_analyzed_at": datetime.utcnow().isoformat(),
            }
        )
        lead.notes = json.dumps(metadata, sort_keys=True)

    monkeypatch.setattr("app.api.usage._analyze_lead_if_possible", fake_analyze)
    monkeypatch.setattr(
        "app.api.usage.personalize_email",
        lambda payload: EmailVariantOut(
            subject="Idea for Usage Duplicate",
            preview="Quick idea",
            full_email="Hi, one clean opportunity workspace could help.",
            cta="Open to a quick review?",
            cold_email="Hi, one clean opportunity workspace could help.",
            follow_ups=["Worth a quick look?", "Should I send details?"],
        ),
    )
    result = GooglePlacesSearchResult(
        leads=[
            LeadOut(
                company="Usage Duplicate GmbH",
                website="https://usage-duplicate.example",
                industry="Construction",
                country="Germany",
                city="Berlin",
                notes='{"source":"google_maps","domain":"usage-duplicate.example","place_id":"usage-duplicate-1"}',
                domain="usage-duplicate.example",
                place_id="usage-duplicate-1",
                source="google_maps",
            )
        ],
        raw_count=1,
        duration_ms=8,
    )
    monkeypatch.setattr("app.api.usage.search_google_places", lambda payload: result)

    first = client.post("/api/workspace-app/leads/search", headers=headers, json={"industry": "Construction", "country": "Germany", "city": "Berlin", "limit": 10})
    second = client.post("/api/workspace-app/leads/search", headers=headers, json={"industry": "Construction", "country": "Germany", "city": "Berlin", "limit": 10})

    assert first.status_code == 200
    assert second.status_code == 200
    first_data = first.json()
    second_data = second.json()
    assert first_data["companies_saved"] == 1
    assert first_data["duplicates_skipped"] == 0
    assert second_data["companies_saved"] == 0
    assert second_data["duplicates_skipped"] == 1
    assert "already in your CRM" in second_data["message"]


def test_workspace_app_turnkey_research_completes_public_details_before_ai_and_contacts(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-turnkey-details@example.com"}
    monkeypatch.setattr(
        "app.api.usage.search_google_places",
        lambda payload: GooglePlacesSearchResult(
            leads=[
                LeadOut(
                    company="Usage Details GmbH",
                    website=None,
                    industry="Construction",
                    country="Germany",
                    city="Berlin",
                    phone=None,
                    notes='{"source":"google_maps","place_id":"usage-details-place"}',
                    place_id="usage-details-place",
                    source="google_maps",
                )
            ],
            raw_count=1,
            duration_ms=7,
        ),
    )
    monkeypatch.setattr(
        "app.api.usage.get_google_place_details",
        lambda place_id: {
            "place_id": place_id,
            "website": "https://usage-details.example",
            "domain": "usage-details.example",
            "phone": "+49 30 123456",
            "address": "Alexanderplatz 1, Berlin",
            "google_rating": 4.6,
            "business_category": "Construction company",
        },
    )

    def fake_hunter(db, request, user_id, workspace, leads):
        assert leads[0].website == "https://usage-details.example"
        return [
            leads[0].model_copy(
                update={
                    "contact": "Anna Founder",
                    "email": "anna@usage-details.example",
                    "title": "Founder",
                    "hunter_verified": True,
                    "hunter_status": "verified",
                    "notes": '{"source":"hunter","domain":"usage-details.example","hunter_verified":true,"confidence":96,"title":"Founder"}',
                    "source": "hunter",
                }
            )
        ]

    def fake_analyze(db, user_id, workspace, lead):
        assert lead.website == "https://usage-details.example"
        metadata = json.loads((lead.notes or "{}").splitlines()[0])
        metadata.update(
            {
                "ai_summary": "Usage Details serves Berlin construction buyers with specialist services.",
                "suggested_offer": "Offer a qualified B2B partner shortlist.",
                "outreach_strategy": "Mention their Berlin market and construction specialization.",
                "sales_angle": "Reduce manual partner research.",
                "expected_reply_rate": "9-13%",
                "website_analyzed_at": datetime.utcnow().isoformat(),
            }
        )
        lead.notes = json.dumps(metadata, sort_keys=True)

    monkeypatch.setattr("app.api.usage._hunter_enriched_leads", fake_hunter)
    monkeypatch.setattr("app.api.usage._analyze_lead_if_possible", fake_analyze)
    monkeypatch.setattr(
        "app.api.usage.personalize_email",
        lambda payload: EmailVariantOut(
            subject="Berlin partnership idea",
            preview="A quick idea for your Berlin construction work",
            full_email="Hi Anna, I found a relevant B2B partnership angle for Usage Details.",
            cta="Open to a quick fit review?",
            cold_email="Hi Anna, I found a relevant B2B partnership angle for Usage Details.",
            follow_ups=["Worth a quick look?", "Should I send the details?"],
        ),
    )

    response = client.post("/api/workspace-app/leads/search", headers=headers, json={"industry": "Construction", "country": "Germany", "city": "Berlin", "limit": 10})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    company = data["companies"][0]
    assert company["website"] == "https://usage-details.example"
    assert company["phone"] == "+49 30 123456"
    assert company["address"] == "Alexanderplatz 1, Berlin"
    assert company["email"] == "anna@usage-details.example"
    assert company["ai_summary"] == "Usage Details serves Berlin construction buyers with specialist services."
    assert company["suggested_offer"] == "Offer a qualified B2B partner shortlist."
    assert company["expected_reply_rate"] == "9-13%"
    assert company["generated_emails"][0]["subject"] == "Berlin partnership idea"


def test_workspace_app_lead_search_provider_error_returns_structured_status(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-provider-error@example.com"}
    monkeypatch.setattr("app.api.usage.search_google_places", lambda payload: (_ for _ in ()).throw(GoogleMapsRequestError("provider outage")))
    response = client.post("/api/workspace-app/leads/search", headers=headers, json={"industry": "Construction", "country": "Germany", "city": "Berlin", "limit": 10})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "provider_unavailable"
    assert data["companies"] == []
    assert "temporarily unavailable" in data["message"]


def test_workspace_app_integration_status_is_private_and_actionable() -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-integrations@example.com"}
    response = client.get("/api/workspace-app/integrations/status", headers=headers)
    assert response.status_code == 200
    items = response.json()["integrations"]
    assert {item["key"] for item in items} == {"lead_search", "contact_discovery", "ai_research", "email_sending", "billing"}
    assert all(item["status"] in {"connected", "missing_key", "needs_setup", "error"} for item in items)
    assert all("API_KEY" not in item["message"] for item in items)


def test_workspace_app_contact_discovery_email_approval_and_send(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-email@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Email Build", "website": "https://usage-email.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200
    company_id = company_response.json()["company"]["id"]

    def fake_hunter_enrichment(db, request, user_id, workspace, leads):
        lead = leads[0].model_copy(update={
            "contact": "Dana Owner",
            "title": "Owner",
            "email": "dana@usage-email.example",
            "phone": "+49 30 000000",
            "hunter_verified": True,
            "hunter_status": "verified",
        })
        return [lead]

    monkeypatch.setattr("app.api.usage._hunter_enriched_leads", fake_hunter_enrichment)
    contacts = client.post(f"/api/workspace-app/companies/{company_id}/contacts", headers=headers)
    assert contacts.status_code == 200
    assert contacts.json()["status"] == "success"
    assert contacts.json()["company"]["email"] == "dana@usage-email.example"
    assert contacts.json()["company"]["crm_stage"] == "Contact Found"

    monkeypatch.setattr(
        "app.api.usage.personalize_email",
        lambda payload: EmailVariantOut(
            subject="Idea for Usage Email Build",
            preview="Quick idea",
            full_email="Hi, I found a relevant opportunity for your team.",
            cta="Book a quick call",
            cold_email="Hi, I found a relevant opportunity for your team.",
            follow_ups=["Following up once.", "Following up twice."],
        ),
    )
    draft = client.post(f"/api/workspace-app/companies/{company_id}/email-draft", headers=headers)
    assert draft.status_code == 200
    assert draft.json()["status"] == "success"
    email = draft.json()["email"]
    assert email["delivery_status"] == "draft"

    approved = client.post(f"/api/workspace-app/emails/{email['id']}/approve", headers=headers)
    assert approved.status_code == 200
    assert approved.json()["email"]["delivery_status"] == "approved"
    assert approved.json()["company"]["crm_stage"] == "Approved"

    sender_setup = client.put(
        "/api/outreach/sender",
        headers=headers,
        json={
            "provider": "resend",
            "sender_name": "Usage Sales",
            "sender_email": "sales@usage-email.example",
            "reply_to": "reply@usage-email.example",
            "daily_send_limit": 25,
            "enabled": True,
        },
    )
    assert sender_setup.status_code == 200

    sent_payload: dict[str, object] = {}

    def fake_send(**kwargs):
        sent_payload.update(kwargs)
        return {"id": "workspace-app-send-1"}

    monkeypatch.setattr("app.api.usage.send_email", fake_send)
    sent = client.post(f"/api/workspace-app/emails/{email['id']}/send", headers=headers)
    assert sent.status_code == 200
    assert sent.json()["status"] == "success"
    assert sent.json()["email"]["delivery_status"] == "sent"
    assert sent.json()["company"]["crm_stage"] == "Sent"
    assert sent_payload["from_email"] == "sales@usage-email.example"
    assert sent_payload["from_name"] == "Usage Sales"
    assert sent_payload["reply_to"] == "reply@usage-email.example"


def test_workspace_app_company_creation_queues_enrichment_job() -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-company-enrichment-queue@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Enrichment Queue", "website": "https://usage-enrichment-queue.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200

    db = get_sessionmaker()()
    try:
        lead = db.scalar(select(Lead).where(Lead.company == "Usage Enrichment Queue"))
        assert lead is not None
        job = db.scalar(select(EnrichmentJob).where(EnrichmentJob.workspace_id == lead.workspace_id, EnrichmentJob.lead_id == lead.id))
        assert job is not None
        assert job.status == "pending"
        assert job.job_type == "company_enrichment"
    finally:
        db.close()


def test_workspace_app_company_enrichment_restart_and_cancel(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-enrichment-controls@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Enrichment Control", "website": "https://usage-enrichment.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200
    company_id = company_response.json()["company"]["id"]
    queued: list[str] = []
    monkeypatch.setattr(
        "app.api.usage._enqueue_auto_enrichment",
        lambda db, request, user_id, workspace, leads, request_id, **kwargs: queued.extend([str(lead.id) for lead in leads]) or False,
    )

    restarted = client.post(f"/api/workspace-app/companies/{company_id}/enrichment/restart", headers=headers)
    assert restarted.status_code == 200
    restart_payload = restarted.json()
    assert restart_payload["status"] == "success"
    assert len(queued) == 1
    assert restart_payload["company"]["workflow_stages"]["website_analysis"] == "running"
    assert restart_payload["company"]["workflow_stages"]["decision_maker"] == "running"

    cancelled = client.post(f"/api/workspace-app/companies/{company_id}/enrichment/cancel", headers=headers)
    assert cancelled.status_code == 200
    cancel_payload = cancelled.json()
    assert cancel_payload["status"] == "success"
    assert cancel_payload["company"]["workflow_stages"]["website_analysis"] == "waiting"
    assert cancel_payload["company"]["workflow_stages"]["decision_maker"] == "waiting"


def test_workspace_app_company_enrichment_restart_handles_enqueue_failure(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-enrichment-restart-failure@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Enrichment Restart Failure", "website": "https://usage-enrichment-failure.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200
    company_id = company_response.json()["company"]["id"]

    def fail_enqueue(*args, **kwargs):
        raise RuntimeError("queue unavailable")

    monkeypatch.setattr("app.api.usage._enqueue_auto_enrichment", fail_enqueue)

    restarted = client.post(f"/api/workspace-app/companies/{company_id}/enrichment/restart", headers=headers)
    assert restarted.status_code == 200
    payload = restarted.json()
    assert payload["status"] == "partial_success"
    assert "temporarily unavailable" in payload["message"].lower()
    assert payload["warnings"]
    assert payload["company"]["workflow_stages"]["website_analysis"] == "running"


def test_workspace_app_monitoring_returns_only_changes_and_regenerates_report(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-monitoring@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Monitor Co", "website": "https://usage-monitor.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200
    company_id = UUID(company_response.json()["company"]["id"])

    db = get_sessionmaker()()
    try:
        company = db.get(Company, company_id)
        assert company is not None
        lead = db.get(Lead, company.lead_id)
        assert lead is not None
        company.metadata_json = {
            **(company.metadata_json or {}),
            "company_intelligence": {
                "report": {
                    "competitors": {"value": ["Legacy Competitor", "New Rival Inc"]},
                }
            },
            "ai_live_buying_signals": {
                "generated_at": datetime.utcnow().isoformat(),
                "latest_changes": [],
                "change_timeline": [],
                "snapshot": {
                    "new_competitors": ["Legacy Competitor"],
                },
            },
            "ai_revenue_engine_report": {"source_fingerprint": "old"},
        }
        db.commit()
    finally:
        db.close()

    called = {"count": 0}

    def fake_refresh(db, user_id, workspace, lead, company=None):
        called["count"] += 1
        target = company
        assert target is not None
        target.metadata_json = {
            **(target.metadata_json or {}),
            "ai_revenue_engine_report": {
                "source_fingerprint": "new",
                "generated_at": datetime.utcnow().isoformat(),
            },
        }
        return {}

    monkeypatch.setattr("app.api.usage._refresh_company_intelligence", fake_refresh)
    run_response = client.post("/api/workspace-app/monitoring/run", headers=headers)
    assert run_response.status_code == 200
    payload = run_response.json()
    assert payload["status"] == "success"
    assert payload["changed_companies"] >= 1
    assert payload["changes"]
    monitored = next(item for item in payload["changes"] if item["company_id"] == str(company_id))
    assert monitored["report_regenerated"] is True
    assert monitored["changes"]
    change = monitored["changes"][0]
    assert change["change_type"] == "new_competitors"
    assert change["added"] == ["New Rival Inc"]
    assert called["count"] >= 1


def test_workspace_app_enrichment_queue_persists_and_cancels_job() -> None:
    from app.services.enrichment_queue import cancel_jobs_for_lead, enqueue_company_enrichment_job

    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-enrichment-queue@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Durable Queue", "website": "https://usage-queue.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200

    db = get_sessionmaker()()
    try:
        lead = db.scalar(select(Lead).where(Lead.company == "Usage Durable Queue"))
        assert lead is not None
        workspace = db.get(Workspace, lead.workspace_id)
        assert workspace is not None
        job = enqueue_company_enrichment_job(
            db,
            user_id=lead.user_id,
            workspace_id=workspace.id,
            lead=lead,
            request_id="queue-test",
            language="Russian",
            max_attempts=3,
        )
        db.commit()
        assert job is not None
        stored = db.get(EnrichmentJob, job.id)
        assert stored is not None
        assert stored.status == "pending"
        assert stored.progress_json["stage"] == "queued"

        cancelled = cancel_jobs_for_lead(db, workspace_id=workspace.id, lead_id=lead.id, reason="Test cancellation.")
        assert cancelled == 1
        db.refresh(stored)
        assert stored.status == "cancelled"
        assert stored.cancel_requested is True
        assert stored.progress_json["stage"] == "cancelled"
    finally:
        db.close()


def test_enrichment_queue_reuses_active_job_for_duplicate_enqueue() -> None:
    from app.services.enrichment_queue import enqueue_company_enrichment_job

    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-enrichment-idempotency@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Queue Idempotency", "website": "https://usage-queue-idempotency.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200

    db = get_sessionmaker()()
    try:
        lead = db.scalar(select(Lead).where(Lead.company == "Usage Queue Idempotency"))
        assert lead is not None
        workspace = db.get(Workspace, lead.workspace_id)
        assert workspace is not None

        first = enqueue_company_enrichment_job(
            db,
            user_id=lead.user_id,
            workspace_id=workspace.id,
            lead=lead,
            request_id="queue-idempotency-1",
            language="English",
            max_attempts=3,
        )
        db.commit()
        assert first is not None

        second = enqueue_company_enrichment_job(
            db,
            user_id=lead.user_id,
            workspace_id=workspace.id,
            lead=lead,
            request_id="queue-idempotency-2",
            language="English",
            max_attempts=3,
        )
        db.commit()
        assert second is not None
        assert second.id == first.id

        jobs = db.scalars(select(EnrichmentJob).where(EnrichmentJob.lead_id == lead.id)).all()
        assert len(jobs) == 1
        assert jobs[0].status == "pending"
    finally:
        db.close()


def test_enrichment_queue_reclaims_stale_job_and_blocks_old_claim_completion() -> None:
    from app.services.enrichment_queue import claim_next_enrichment_job, complete_job, enqueue_company_enrichment_job, heartbeat_job_lock

    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-enrichment-reclaim@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Queue Reclaim", "website": "https://usage-queue-reclaim.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200

    db = get_sessionmaker()()
    try:
        lead = db.scalar(select(Lead).where(Lead.company == "Usage Queue Reclaim"))
        assert lead is not None
        workspace = db.get(Workspace, lead.workspace_id)
        assert workspace is not None

        queued = enqueue_company_enrichment_job(
            db,
            user_id=lead.user_id,
            workspace_id=workspace.id,
            lead=lead,
            request_id="queue-reclaim",
            language="English",
            max_attempts=3,
        )
        db.commit()
        assert queued is not None

        first_claim_token = "worker-a:claim-1"
        first_claim = claim_next_enrichment_job(db, worker_id=first_claim_token, stale_after_seconds=900)
        assert first_claim is not None
        assert first_claim.status == "running"

        first_claim.locked_at = datetime.utcnow() - timedelta(seconds=901)
        db.commit()

        second_claim_token = "worker-b:claim-2"
        reclaimed = claim_next_enrichment_job(db, worker_id=second_claim_token, stale_after_seconds=900)
        assert reclaimed is not None
        assert reclaimed.id == first_claim.id
        assert reclaimed.locked_by == second_claim_token

        assert complete_job(db, first_claim, claim_token=first_claim_token) is False
        db.refresh(reclaimed)
        assert reclaimed.status == "running"
        assert reclaimed.locked_by == second_claim_token

        assert heartbeat_job_lock(db, job_id=reclaimed.id, claim_token=second_claim_token) is True
        assert complete_job(db, reclaimed, claim_token=second_claim_token) is True
        db.refresh(reclaimed)
        assert reclaimed.status == "succeeded"
        assert reclaimed.progress_json["terminal_state"] == "completed"
    finally:
        db.close()


def test_enrichment_queue_retry_uses_exponential_backoff_and_dead_letters() -> None:
    from app.services.enrichment_queue import claim_next_enrichment_job, enqueue_company_enrichment_job, fail_or_retry_job

    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-enrichment-retry@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Queue Retry", "website": "https://usage-queue-retry.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200

    db = get_sessionmaker()()
    try:
        lead = db.scalar(select(Lead).where(Lead.company == "Usage Queue Retry"))
        assert lead is not None
        workspace = db.get(Workspace, lead.workspace_id)
        assert workspace is not None

        queued = enqueue_company_enrichment_job(
            db,
            user_id=lead.user_id,
            workspace_id=workspace.id,
            lead=lead,
            request_id="queue-retry",
            language="English",
            max_attempts=3,
        )
        db.commit()
        assert queued is not None

        first_claim_token = "worker-retry:claim-1"
        queued.status = "running"
        queued.locked_by = first_claim_token
        queued.locked_at = datetime.utcnow()
        queued.attempts = 1
        queued.updated_at = datetime.utcnow()
        db.commit()

        assert fail_or_retry_job(db, queued, RuntimeError("temporary failure"), retry_delay_seconds=60, claim_token=first_claim_token) is True
        db.refresh(queued)
        first_delay = (queued.run_after - queued.updated_at).total_seconds()
        assert queued.status == "retrying"
        assert 55 <= first_delay <= 65

        queued.run_after = datetime.utcnow() - timedelta(seconds=1)
        queued.status = "running"
        queued.locked_by = "worker-retry:claim-2"
        queued.locked_at = datetime.utcnow()
        queued.attempts = 2
        queued.updated_at = datetime.utcnow()
        db.commit()

        second_claim_token = "worker-retry:claim-2"
        assert fail_or_retry_job(db, queued, RuntimeError("temporary failure again"), retry_delay_seconds=60, claim_token=second_claim_token) is True
        db.refresh(queued)
        second_delay = (queued.run_after - queued.updated_at).total_seconds()
        assert queued.status == "retrying"
        assert 115 <= second_delay <= 125
        assert queued.progress_json["retry_delay_seconds"] == 120

        queued.run_after = datetime.utcnow() - timedelta(seconds=1)
        queued.status = "running"
        queued.locked_by = "worker-retry:claim-3"
        queued.locked_at = datetime.utcnow()
        queued.attempts = 3
        queued.updated_at = datetime.utcnow()
        db.commit()

        third_claim_token = "worker-retry:claim-3"
        assert fail_or_retry_job(db, queued, RuntimeError("poison job"), retry_delay_seconds=60, claim_token=third_claim_token) is True
        db.refresh(queued)
        assert queued.status == "failed"
        assert queued.completed_at is not None
        assert queued.progress_json["dead_lettered"] is True
        assert queued.progress_json["terminal_state"] == "failed"
    finally:
        db.close()


def test_worker_restart_recovers_stale_job_without_duplicate_execution(monkeypatch) -> None:
    import app.jobs.worker as worker_module
    from app.services.enrichment_queue import claim_next_enrichment_job, complete_job, enqueue_company_enrichment_job

    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-worker-restart@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Worker Restart", "website": "https://usage-worker-restart.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200

    db = get_sessionmaker()()
    try:
        lead = db.scalar(select(Lead).where(Lead.company == "Usage Worker Restart"))
        assert lead is not None
        workspace = db.get(Workspace, lead.workspace_id)
        assert workspace is not None

        queued = enqueue_company_enrichment_job(
            db,
            user_id=lead.user_id,
            workspace_id=workspace.id,
            lead=lead,
            request_id="worker-restart",
            language="English",
            max_attempts=2,
        )
        db.commit()
        assert queued is not None
        crashed_claim = claim_next_enrichment_job(db, worker_id="worker-crashed:claim-1", stale_after_seconds=900)
        assert crashed_claim is not None
        reclaimed_job_id = crashed_claim.id
        crashed_claim.locked_at = datetime.utcnow() - timedelta(seconds=901)
        db.commit()
    finally:
        db.close()

    processed: list[str] = []

    def fake_process(job_id: UUID, claim_token=None) -> bool:
        assert claim_token is not None
        processed.append(claim_token)
        inner = get_sessionmaker()()
        try:
            job = inner.get(EnrichmentJob, job_id)
            assert job is not None
            return complete_job(inner, job, claim_token=claim_token)
        finally:
            inner.close()

    monkeypatch.setattr(worker_module, "process_enrichment_job", fake_process)

    assert worker_module.run_enrichment_worker_once("restart-worker") is True
    assert len(processed) == 1
    assert processed[0].startswith("restart-worker:")

    db = get_sessionmaker()()
    try:
        recovered = db.get(EnrichmentJob, reclaimed_job_id)
        assert recovered is not None
        assert recovered.status == "succeeded"
        assert recovered.progress_json["terminal_state"] == "completed"
        assert complete_job(db, recovered, claim_token="worker-crashed:claim-1") is False
        db.refresh(recovered)
        assert recovered.status == "succeeded"
    finally:
        db.close()


def test_workspace_app_complete_opportunity_prepares_research_contact_and_review_draft(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-complete-opportunity@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Complete Build", "website": "https://usage-complete.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200
    company_id = company_response.json()["company"]["id"]

    def fake_analyze(db, user_id, workspace, lead, language="en"):
        metadata = json.loads((lead.notes or "{}").splitlines()[0])
        metadata.update(
            {
                "ai_summary": "Usage Complete builds construction services for Berlin B2B buyers.",
                "opportunity_analysis": "Strong fit because the company can benefit from partner discovery.",
                "products": ["Construction services", "B2B partnership sourcing"],
                "icp": "Construction firms needing partner discovery in Berlin.",
                "estimated_company_size": "50-100 employees",
                "buying_signals": ["Public B2B footprint", "Clear local market"],
                "hiring_signals": ["Hiring for sales roles"],
                "jobs_signal": "Hiring SDR and account executive roles in Berlin.",
                "funding_signal": "Raised a seed round in 2025.",
                "pricing_signals": ["Introduced new pricing plans for enterprise customers"],
                "blog_news_activity": ["Published product update blog posts this month"],
                "technologies": ["WordPress", "HubSpot"],
                "competitors": ["Local construction brokers"],
                "pain_points": ["Needs partner discovery"],
                "best_outreach_angle": "Offer qualified B2B partnership leads.",
                "recommended_decision_maker": "Founder or growth lead",
                "personalization_bullets": [
                    "Already has a public-facing site for outreach",
                    "Shows local market activity in Berlin",
                ],
                "risks": ["No reply history yet"],
                "suggested_offer": "Offer qualified B2B partnership leads.",
                "expected_reply_rate": "10-14%",
                "priority_score": 82,
                "confidence_score": 88,
                "website_analyzed_at": datetime.utcnow().isoformat(),
            }
        )
        lead.notes = json.dumps(metadata, sort_keys=True)

    def fake_hunter_enrichment(db, request, user_id, workspace, leads):
        lead = leads[0].model_copy(
            update={
                "contact": "Eva Founder",
                "title": "Founder",
                "email": "eva@usage-complete.example",
                "hunter_verified": True,
                "hunter_status": "verified",
                "notes": '{"source":"hunter","hunter_verified":true,"confidence":97,"title":"Founder"}',
            }
        )
        return [lead]

    monkeypatch.setattr("app.api.usage._analyze_lead_if_possible", fake_analyze)
    monkeypatch.setattr("app.api.usage._hunter_enriched_leads", fake_hunter_enrichment)
    monkeypatch.setattr(
        "app.api.usage.personalize_email",
        lambda payload: EmailVariantOut(
            subject="B2B partner idea for Usage Complete",
            preview="A quick partner angle",
            full_email="Hi Eva, I found a relevant B2B partner angle for Usage Complete.",
            cta="Open to a quick fit review?",
            cold_email="Hi Eva, I found a relevant B2B partner angle for Usage Complete.",
            follow_ups=["Worth a quick look?", "Should I send the details?"],
        ),
    )

    response = client.post(f"/api/workspace-app/companies/{company_id}/complete-opportunity", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["completed_steps"] == ["Company profile checked", "Website analysis checked", "Contact search checked", "Email draft checked"]
    assert data["company"]["email"] == "eva@usage-complete.example"
    assert data["company"]["ai_summary"] == "Usage Complete builds construction services for Berlin B2B buyers."
    assert data["company"]["opportunity_analysis"] == "Strong fit because the company can benefit from partner discovery."
    assert data["company"]["priority_score"] == 82
    intelligence = data["company"]["company_intelligence"]
    assert intelligence["report"]["company_summary"]["value"] == "Usage Complete builds construction services for Berlin B2B buyers."
    assert intelligence["report"]["products"]["value"] == ["Construction services", "B2B partnership sourcing"]
    assert intelligence["report"]["icp"]["value"] == "Construction firms needing partner discovery in Berlin."
    assert intelligence["report"]["estimated_company_size"]["value"] == "50-100 employees"
    assert intelligence["report"]["buying_signals"]["value"] == ["Public B2B footprint", "Clear local market"]
    assert intelligence["report"]["hiring_signals"]["value"] == ["Hiring for sales roles"]
    assert intelligence["report"]["technology_stack"]["value"] == ["WordPress", "HubSpot"]
    assert intelligence["report"]["competitors"]["value"] == ["Local construction brokers"]
    assert intelligence["report"]["possible_pain_points"]["value"] == ["Needs partner discovery"]
    assert intelligence["report"]["best_outreach_angle"]["value"] == "Offer qualified B2B partnership leads."
    assert intelligence["report"]["recommended_decision_maker"]["value"] == "Founder or growth lead"
    assert intelligence["report"]["personalization_bullets"]["value"] == [
        "Already has a public-facing site for outreach",
        "Shows local market activity in Berlin",
    ]
    assert intelligence["report"]["ai_confidence_score"]["value"] == 88
    assert intelligence["report"]["company_summary"]["sources"]
    buying_intent = intelligence["buying_intent"]
    assert buying_intent["buying_signal_score"] > 0
    assert buying_intent["urgency"] in {"watch", "low", "medium", "high"}
    assert buying_intent["explanation"]
    assert buying_intent["confidence"] > 0
    assert buying_intent["recommended_outreach_timing"]
    assert buying_intent["evidence"]
    assert all(item.get("source_field") and item.get("value") for item in buying_intent["evidence"])
    assert data["company"]["buying_signal_score"] == buying_intent["buying_signal_score"]
    assert data["company"]["buying_signal_urgency"] == buying_intent["urgency"]
    assert data["company"]["buying_signal_explanation"] == buying_intent["explanation"]
    assert data["company"]["buying_signal_confidence"] == buying_intent["confidence"]
    assert data["company"]["recommended_outreach_timing"] == buying_intent["recommended_outreach_timing"]
    assert data["company"]["buying_signal_evidence"] == buying_intent["evidence"]
    decision_intel = data["company"]["decision_maker_intelligence"]
    assert decision_intel["profiles"]
    top_profile = decision_intel["profiles"][0]
    assert top_profile["name"] == "Eva Founder"
    assert top_profile["title"] == "Founder"
    assert top_profile["is_verified_contact"] is True
    assert top_profile["why_best_decision_maker"]
    assert top_profile["estimated_responsibilities"]
    assert top_profile["probable_business_goals"]
    assert top_profile["likely_kpis"]
    assert top_profile["possible_pain_points"]
    assert top_profile["communication_style"]
    assert top_profile["preferred_outreach_angle"]
    assert top_profile["recommended_first_sentence"]
    assert top_profile["estimated_authority_level"] == "executive"
    assert top_profile["confidence_score"] > 0
    assert top_profile["evidence_used"]
    assert all(item.get("source_field") and item.get("value") for item in top_profile["evidence_used"])
    assert decision_intel["top_contact_id"] == top_profile["contact_id"]
    assert data["company"]["contacts"]
    matching_contact = next(item for item in data["company"]["contacts"] if item["name"] == "Eva Founder")
    assert matching_contact["decision_maker_intelligence"]["contact_id"] == top_profile["contact_id"]
    assert matching_contact["decision_maker_intelligence"]["confidence_score"] == top_profile["confidence_score"]
    ranking = data["company"]["opportunity_ranking"]
    assert isinstance(ranking, dict)
    assert 0 <= ranking["overall_score"] <= 100
    assert ranking["reasoning"]
    assert ranking["top_positive_signals"]
    assert ranking["recommended_next_action"]
    assert 0 <= ranking["confidence"] <= 100
    assert isinstance(ranking["factors"], dict)
    assert ranking["factors"]["Buying Intent"] >= 0
    assert ranking["factors"]["Decision Maker Quality"] >= 0
    assert ranking["factors"]["Verified Contacts"] >= 0
    assert data["company"]["overall_score"] == ranking["overall_score"]
    assert data["company"]["reasoning"] == ranking["reasoning"]
    assert data["company"]["top_positive_signals"] == ranking["top_positive_signals"]
    assert data["company"]["top_negative_signals"] == ranking["top_negative_signals"]
    assert data["company"]["recommended_next_action"] == ranking["recommended_next_action"]
    assert data["company"]["confidence"] == ranking["confidence"]
    outreach_strategy = data["company"]["ai_outreach_strategy"]
    assert isinstance(outreach_strategy, dict)
    assert outreach_strategy["why_contact_now"]
    assert outreach_strategy["why_contact_now_evidence"]
    assert outreach_strategy["best_timing"]
    assert outreach_strategy["best_timing_evidence"]
    assert outreach_strategy["best_communication_channel"] in {"Email", "LinkedIn", "Phone"}
    assert outreach_strategy["best_communication_channel_evidence"]
    assert outreach_strategy["best_email_length"]
    assert outreach_strategy["best_email_length_evidence"]
    assert outreach_strategy["best_subject_line"]
    assert outreach_strategy["best_subject_line_evidence"]
    assert outreach_strategy["first_sentence"]
    assert outreach_strategy["first_sentence_evidence"]
    assert outreach_strategy["strongest_value_proposition"]
    assert outreach_strategy["strongest_value_proposition_evidence"]
    assert outreach_strategy["strongest_pain_point"]
    assert outreach_strategy["strongest_pain_point_evidence"]
    assert outreach_strategy["expected_objections"]
    assert outreach_strategy["expected_objections_evidence"]
    assert outreach_strategy["cta"]
    assert outreach_strategy["cta_evidence"]
    assert outreach_strategy["follow_up_schedule"]
    assert outreach_strategy["follow_up_schedule_evidence"]
    assert 0 <= outreach_strategy["estimated_reply_probability"] <= 100
    assert outreach_strategy["estimated_reply_probability_evidence"]
    assert all(item.get("source_field") and item.get("value") for item in outreach_strategy["why_contact_now_evidence"])
    assert all(item.get("source_field") and item.get("value") for item in outreach_strategy["best_subject_line_evidence"])
    assert all(item.get("source_field") and item.get("value") for item in outreach_strategy["first_sentence_evidence"])
    assert all(item.get("source_field") and item.get("value") for item in outreach_strategy["strongest_value_proposition_evidence"])
    assert all(item.get("source_field") and item.get("value") for item in outreach_strategy["strongest_pain_point_evidence"])
    assert outreach_strategy["decision_maker_strategies"]
    dm_strategy = outreach_strategy["decision_maker_strategies"][0]
    assert dm_strategy["contact_id"] == top_profile["contact_id"]
    assert dm_strategy["best_subject_line"]
    assert dm_strategy["first_sentence"]
    assert dm_strategy["strongest_value_proposition"]
    assert dm_strategy["strongest_pain_point"]
    assert dm_strategy["expected_objections"]
    assert dm_strategy["cta"]
    assert 0 <= dm_strategy["estimated_reply_probability"] <= 100
    assert dm_strategy["evidence"]
    assert all(item.get("source_field") and item.get("value") for item in dm_strategy["evidence"])
    competitor_intelligence = data["company"]["ai_competitor_intelligence"]
    assert isinstance(competitor_intelligence, dict)
    assert competitor_intelligence["competitors"]
    assert competitor_intelligence["technologies"]
    assert competitor_intelligence["positioning"]
    assert competitor_intelligence["strengths"]
    assert competitor_intelligence["weaknesses"]
    assert competitor_intelligence["market_gaps"]
    assert competitor_intelligence["opportunity_to_sell"]
    company_timeline = data["company"]["ai_company_timeline"]
    assert isinstance(company_timeline, dict)
    assert isinstance(company_timeline.get("events"), list)
    timeline_categories = [
        "funding_events",
        "hiring_events",
        "technology_changes",
        "website_changes",
        "leadership_changes",
        "new_locations",
        "product_launches",
        "partnerships",
    ]
    for category in timeline_categories:
        assert category in company_timeline
        assert isinstance(company_timeline.get(category), list)
    timeline_events = company_timeline.get("events") or []
    timeline_timestamps = [str(item.get("timestamp")) for item in timeline_events if isinstance(item, dict) and item.get("timestamp")]
    assert timeline_timestamps == sorted(timeline_timestamps)
    company_predictions = data["company"]["ai_company_predictions"]
    assert isinstance(company_predictions, dict)
    for prediction_key in ["estimated_arr", "company_maturity", "growth_probability", "sales_readiness"]:
        prediction = company_predictions.get(prediction_key)
        assert isinstance(prediction, dict)
        assert 0 <= prediction["score"] <= 100
        assert prediction["reasoning"]
        assert 0 <= prediction["confidence"] <= 100
    specialized_agents = data["company"]["ai_specialized_agents"]
    assert isinstance(specialized_agents, dict)
    for agent_key in [
        "company_analyst",
        "decision_maker_analyst",
        "buying_signal_analyst",
        "competitor_analyst",
        "email_writer",
        "sales_coach",
    ]:
        agent_payload = specialized_agents.get(agent_key)
        assert isinstance(agent_payload, dict)
        assert agent_payload["agent"]
        assert isinstance(agent_payload.get("output"), dict)
        assert 0 <= agent_payload["confidence"] <= 100
    intermediate_reasoning = data["company"]["ai_agent_intermediate_reasoning"]
    assert isinstance(intermediate_reasoning, dict)
    assert "company_analyst" in intermediate_reasoning
    assert "final_orchestrator" in intermediate_reasoning
    assert isinstance(intermediate_reasoning["company_analyst"].get("reasoning"), list)
    assert isinstance(intermediate_reasoning["company_analyst"].get("evidence"), list)
    final_orchestrator = data["company"]["ai_final_orchestrator"]
    assert isinstance(final_orchestrator, dict)
    assert final_orchestrator["agent"] == "Final Orchestrator"
    assert isinstance(final_orchestrator.get("output"), dict)
    assert 0 <= final_orchestrator["confidence"] <= 100
    executive_dashboard = data["company"]["ai_executive_dashboard"]
    assert isinstance(executive_dashboard, dict)
    assert executive_dashboard["source"] == "cached_orchestrator"
    assert isinstance(executive_dashboard.get("overall_opportunity_score"), dict)
    assert isinstance(executive_dashboard.get("buying_intent"), dict)
    assert isinstance(executive_dashboard.get("decision_maker"), dict)
    assert isinstance(executive_dashboard.get("top_risks"), list)
    assert isinstance(executive_dashboard.get("top_opportunities"), list)
    assert executive_dashboard.get("recommended_next_action")
    assert isinstance(executive_dashboard.get("recommended_email"), dict)
    assert isinstance(executive_dashboard.get("recommended_follow_up"), str)
    assert isinstance(executive_dashboard.get("competitor_summary"), dict)
    assert isinstance(executive_dashboard.get("evidence"), list)
    assert 0 <= executive_dashboard["confidence"] <= 100
    revenue_report = data["company"]["ai_revenue_engine_report"]
    assert isinstance(revenue_report, dict)
    assert revenue_report.get("executive_summary")
    assert isinstance(revenue_report.get("overall_opportunity_score"), dict)
    assert isinstance(revenue_report.get("buying_intent"), dict)
    assert isinstance(revenue_report.get("decision_maker"), dict)
    assert isinstance(revenue_report.get("best_contact_reason"), str)
    assert isinstance(revenue_report.get("top_pain_points"), list)
    assert isinstance(revenue_report.get("top_opportunities"), list)
    assert isinstance(revenue_report.get("top_risks"), list)
    assert isinstance(revenue_report.get("competitor_position"), dict)
    assert isinstance(revenue_report.get("technology_summary"), dict)
    assert isinstance(revenue_report.get("recommended_outreach_strategy"), dict)
    assert isinstance(revenue_report.get("recommended_first_email"), dict)
    assert isinstance(revenue_report.get("recommended_follow_up_strategy"), dict)
    assert isinstance(revenue_report.get("recommended_cta"), str)
    assert 0 <= revenue_report.get("confidence", 0) <= 100
    assert isinstance(revenue_report.get("evidence"), list)
    assert all(item.get("source_field") and item.get("value") for item in revenue_report.get("evidence", []))
    assert revenue_report.get("source_fingerprint")
    ai_crm = data["company"]["ai_crm"]
    assert isinstance(ai_crm, dict)
    assert ai_crm.get("generated_at")
    assert ai_crm.get("auto_updated") is True
    assert isinstance(ai_crm.get("priority"), dict)
    assert ai_crm["priority"].get("tier") in {"Hot", "Warm", "Cold", "Needs More Data"}
    assert isinstance(ai_crm["priority"].get("score"), int)
    assert isinstance(ai_crm.get("health"), dict)
    assert ai_crm["health"].get("status") in {"Healthy", "Watch", "At Risk"}
    assert isinstance(ai_crm["health"].get("score"), int)
    assert isinstance(ai_crm.get("buying_intent"), dict)
    assert isinstance(ai_crm["buying_intent"].get("score"), int)
    assert isinstance(ai_crm.get("risk"), dict)
    assert ai_crm["risk"].get("level") in {"Low", "Medium", "High"}
    assert isinstance(ai_crm.get("relationship_status"), str)
    assert ai_crm.get("next_action")
    assert ai_crm.get("last_ai_review")
    assert isinstance(ai_crm.get("upcoming_opportunity"), str)
    ai_ceo_dashboard = data["company"].get("ai_ceo_dashboard")
    assert isinstance(ai_ceo_dashboard, dict)
    assert ai_ceo_dashboard.get("generated_at")
    assert ai_ceo_dashboard.get("auto_updated") is True
    assert isinstance(ai_ceo_dashboard.get("todays_best_opportunities"), list)
    assert isinstance(ai_ceo_dashboard.get("new_buying_signals"), list)
    assert isinstance(ai_ceo_dashboard.get("companies_at_risk"), list)
    assert isinstance(ai_ceo_dashboard.get("competitors"), dict)
    assert isinstance(ai_ceo_dashboard.get("sales_pipeline"), dict)
    assert isinstance(ai_ceo_dashboard.get("expected_revenue"), dict)
    assert isinstance(ai_ceo_dashboard.get("ai_recommendations"), list)
    assert isinstance(ai_ceo_dashboard.get("top_priorities"), list)
    assert len(ai_ceo_dashboard.get("top_priorities", [])) >= 3
    assert isinstance(ai_ceo_dashboard.get("daily_summary"), str)
    assert ai_ceo_dashboard.get("daily_summary")
    ai_sales_os = data["company"].get("ai_sales_os")
    assert isinstance(ai_sales_os, dict)
    assert ai_sales_os.get("autonomous") is True
    safety = ai_sales_os.get("safety")
    assert isinstance(safety, dict)
    assert safety.get("never_fabricate_facts") is True
    agents = ai_sales_os.get("agents")
    assert isinstance(agents, dict)
    required_agents = {
        "research_agent",
        "company_agent",
        "buying_agent",
        "decision_maker_agent",
        "competitor_agent",
        "email_agent",
        "follow_up_agent",
        "crm_agent",
        "analytics_agent",
        "ceo_agent",
    }
    assert required_agents.issubset(set(agents.keys()))
    for agent_key in required_agents:
        payload = agents[agent_key]
        assert isinstance(payload, dict)
        assert payload.get("agent")
        assert isinstance(payload.get("output"), dict)
        assert isinstance(payload.get("reasoning"), list)
        assert isinstance(payload.get("evidence"), list)
        assert payload.get("no_fabrication") is True
    intermediate_reasoning = ai_sales_os.get("intermediate_reasoning")
    assert isinstance(intermediate_reasoning, dict)
    assert "orchestrator" in intermediate_reasoning
    orchestrator = ai_sales_os.get("orchestrator")
    assert isinstance(orchestrator, dict)
    assert orchestrator.get("agent") == "The Orchestrator"
    assert orchestrator.get("autonomous") is True
    assert isinstance(orchestrator.get("execution_order"), list)
    assert isinstance(orchestrator.get("output"), dict)
    assert orchestrator.get("coordination_summary")

    cached_company = client.get("/api/crm/companies?search=Usage%20Complete", headers=headers).json()[0]
    cached_revenue_report = cached_company["ai_revenue_engine_report"]
    assert cached_revenue_report.get("source_fingerprint") == revenue_report.get("source_fingerprint")
    assert cached_revenue_report.get("generated_at") == revenue_report.get("generated_at")
    assert isinstance(cached_company.get("ai_crm"), dict)
    assert cached_company["ai_crm"].get("next_action")
    assert isinstance(cached_company.get("ai_ceo_dashboard"), dict)
    assert cached_company["ai_ceo_dashboard"].get("daily_summary")
    assert isinstance(cached_company.get("ai_sales_os"), dict)
    assert isinstance(cached_company["ai_sales_os"].get("orchestrator"), dict)
    assert isinstance(cached_company.get("ai_workflow_engine"), dict)
    assert cached_company["ai_workflow_engine"].get("current_state") in {"needs_manual_review", "workflow_completed"}
    assert cached_company["ai_workflow_engine"].get("states", {}).get("needs_email", {}).get("status") == "completed"
    live_buying_signals = data["company"]["ai_live_buying_signals"]
    assert isinstance(live_buying_signals, dict)
    assert isinstance(live_buying_signals.get("latest_changes"), list)
    assert isinstance(live_buying_signals.get("change_timeline"), list)
    assert isinstance(live_buying_signals.get("snapshot"), dict)
    allowed_change_types = {
        "new_hiring",
        "technology_changes",
        "website_changes",
        "pricing_changes",
        "new_products",
        "new_competitors",
        "leadership_changes",
        "market_expansion",
        "new_funding",
    }
    for change in live_buying_signals.get("latest_changes", []):
        assert change.get("change_type") in allowed_change_types
        assert change.get("added")
    for entry in live_buying_signals.get("change_timeline", []):
        assert entry.get("change_type") in allowed_change_types
        assert entry.get("detected_at")
    lead_prioritization = data["company"]["ai_lead_prioritization"]
    assert isinstance(lead_prioritization, dict)
    assert lead_prioritization.get("tier") in {"Hot", "Warm", "Cold", "Needs More Data"}
    assert 0 <= lead_prioritization.get("score", 0) <= 100
    assert lead_prioritization.get("reasoning")
    assert 0 <= lead_prioritization.get("confidence", 0) <= 100
    assert isinstance(lead_prioritization.get("factors"), dict)
    assert lead_prioritization["factors"].get("buying_intent") is not None
    assert lead_prioritization["factors"].get("opportunity_score") is not None
    assert lead_prioritization["factors"].get("decision_maker_quality") is not None
    assert lead_prioritization["factors"].get("website_activity") is not None
    assert lead_prioritization["factors"].get("freshness") is not None
    assert lead_prioritization["factors"].get("ai_confidence") is not None
    sales_timeline = data["company"]["ai_sales_timeline"]
    assert isinstance(sales_timeline, dict)
    assert sales_timeline["today"]["step"] == "Today"
    assert sales_timeline["plus_2_days"]["step"] == "+2 days"
    assert sales_timeline["plus_5_days"]["step"] == "+5 days"
    assert sales_timeline["plus_8_days"]["step"] == "+8 days"
    assert sales_timeline["plus_14_days"]["step"] == "+14 days"
    assert sales_timeline["steps"]
    assert len(sales_timeline["steps"]) == 5
    for step in sales_timeline["steps"]:
        assert step["action"]
        assert step["email"]["subject"]
        assert step["email"]["body"]
        assert step["linkedin"]["message"]
        assert isinstance(step["linkedin"]["recommended"], bool)
        assert step["phone"]["script"]
        assert isinstance(step["phone"]["recommended"], bool)
        assert step["reminder"]
        assert 0 <= step["success_probability"] <= 100
        assert step["evidence"]
        assert all(item.get("source_field") and item.get("value") for item in step["evidence"])
    risk_analyzer = data["company"]["ai_risk_analyzer"]
    assert isinstance(risk_analyzer, dict)
    assert 0 <= risk_analyzer["probability_company_will_ignore_outreach"] <= 100
    assert 0 <= risk_analyzer["missing_data"] <= 100
    assert 0 <= risk_analyzer["weak_personalization"] <= 100
    assert 0 <= risk_analyzer["missing_decision_maker"] <= 100
    assert 0 <= risk_analyzer["low_confidence"] <= 100
    assert 0 <= risk_analyzer["stale_enrichment"] <= 100
    assert 0 <= risk_analyzer["risk_score"] <= 100
    assert risk_analyzer["reasons"]
    assert risk_analyzer["recommended_improvements"]
    assert 0 <= risk_analyzer["confidence"] <= 100
    assert isinstance(risk_analyzer["factors"], dict)
    assert risk_analyzer["factors"]["missing_data"]["evidence"]
    assert risk_analyzer["factors"]["weak_personalization"]["evidence"]
    assert risk_analyzer["factors"]["missing_decision_maker"]["evidence"]
    assert risk_analyzer["factors"]["low_confidence"]["evidence"]
    assert risk_analyzer["factors"]["stale_enrichment"]["evidence"]
    assert all(item.get("source_field") and item.get("value") for item in risk_analyzer["factors"]["missing_data"]["evidence"])
    assert all(item.get("source_field") and item.get("value") for item in risk_analyzer["factors"]["weak_personalization"]["evidence"])
    assert all(item.get("source_field") and item.get("value") for item in risk_analyzer["factors"]["missing_decision_maker"]["evidence"])
    assert all(item.get("source_field") and item.get("value") for item in risk_analyzer["factors"]["low_confidence"]["evidence"])
    assert all(item.get("source_field") and item.get("value") for item in risk_analyzer["factors"]["stale_enrichment"]["evidence"])
    sales_coach = data["company"]["ai_sales_coach"]
    assert isinstance(sales_coach, dict)
    assert sales_coach["why_this_company"]
    assert sales_coach["why_now"]
    assert sales_coach["why_this_decision_maker"]
    assert sales_coach["what_could_fail"]
    assert sales_coach["how_to_increase_reply_rate"]
    assert sales_coach["alternative_strategy"]
    assert isinstance(sales_coach["target_contact"], dict)
    assert sales_coach["evidence"]
    assert all(item.get("source_field") and item.get("value") for item in sales_coach["evidence"])
    assert 0 <= sales_coach["confidence"] <= 100
    evidence_engine = data["company"]["ai_evidence_engine"]
    assert isinstance(evidence_engine, dict)
    assert evidence_engine["generated_at"]
    assert evidence_engine["provider"]
    assert evidence_engine["model_version"]
    assert evidence_engine["prompt_version"]
    assert evidence_engine["entries"]
    first_entry = evidence_engine["entries"][0]
    assert first_entry["provider"]
    assert first_entry["raw_source"]
    assert first_entry["evidence_snippet"]
    assert first_entry["confidence"] >= 0
    assert first_entry["timestamp"]
    assert first_entry["enrichment_step"]
    assert first_entry["model_version"]
    assert first_entry["prompt_version"]
    assert "prompt" not in first_entry.get("reasoning", "").lower()
    assert isinstance(evidence_engine["by_insight"], dict)
    assert evidence_engine["by_insight"]
    insight_items = next(iter(evidence_engine["by_insight"].values()))
    assert insight_items
    explain_item = insight_items[0]
    assert explain_item["source"]
    assert explain_item["evidence"]
    assert explain_item["reasoning"]
    assert 0 <= explain_item["confidence"] <= 100
    assert intelligence["lead_score"]["value"] == 82
    assert intelligence["fields"]["official_website"]["value"] == "https://usage-complete.example"
    assert intelligence["fields"]["verified_emails"]["value"] == ["eva@usage-complete.example"]
    assert intelligence["fields"]["business_description"]["confidence"] > 0
    assert "Website analysis" in intelligence["sources"]
    assert data["company"]["workflow_stages"]["company_profile"] == "completed"
    assert data["company"]["workflow_stages"]["website_analysis"] == "completed"
    assert data["company"]["workflow_stages"]["decision_maker"] == "completed"
    assert data["company"]["workflow_stages"]["verified_email"] == "completed"
    assert data["company"]["workflow_stages"]["ai_email"] == "completed"
    assert data["company"]["workflow_stages"]["approval"] == "waiting"
    workflow_engine = data["company"]["ai_workflow_engine"]
    assert isinstance(workflow_engine, dict)
    assert workflow_engine["version"] == 1
    assert workflow_engine["current_state"] == "needs_manual_review"
    assert workflow_engine["needs"]["manual_review"] is True
    assert workflow_engine["needs"]["email"] is False
    assert workflow_engine["states"]["needs_ai_report"]["status"] == "completed"
    assert workflow_engine["states"]["needs_email"]["status"] == "completed"
    assert workflow_engine["states"]["needs_manual_review"]["status"] == "pending"
    assert workflow_engine["next_action"]
    assert data["workflow_stages"]["ai_email"] == "completed"
    assert isinstance(data["workflow_state"], dict)
    assert data["workflow_state"]["current_state"] == "needs_manual_review"
    assert data["missing_fields"] == ["Approval"]
    assert data["recommended_actions"] == ["Review and approve the draft before anything is sent."]
    assert data["next_action"] == "Review and approve the draft before anything is sent."
    assert data["email"]["subject"] == "B2B partner idea for Usage Complete"
    assert data["email"]["delivery_status"] == "draft"
    assert data["company"]["crm_stage"] == "Email Draft Ready"
    assert data["company"]["email_status"] == "Draft Ready"


def test_workspace_app_email_draft_uses_current_ui_locale(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-locale@example.com", "X-OutreachAI-Locale": "ru"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Locale Build", "website": "https://usage-locale.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200
    company_id = company_response.json()["company"]["id"]
    captured: dict[str, str] = {}

    def fake_personalize(payload):
        captured["language"] = payload.language
        return EmailVariantOut(
            subject="Идея для Usage Locale Build",
            preview="Короткая идея",
            full_email="Здравствуйте, у меня есть релевантная идея для вашей команды.",
            cta="Обсудить на коротком звонке",
            cold_email="Здравствуйте, у меня есть релевантная идея для вашей команды.",
            follow_ups=["Напоминаю о письме.", "Повторно возвращаюсь к идее."],
        )

    monkeypatch.setattr("app.api.usage.personalize_email", fake_personalize)
    draft = client.post(f"/api/workspace-app/companies/{company_id}/email-draft", headers=headers)
    assert draft.status_code == 200
    assert draft.json()["status"] == "success"
    assert captured["language"] == "Russian"
    assert "Здравствуйте" in draft.json()["email"]["body"]


def test_workspace_app_manual_company_gets_fallback_intelligence_and_review_draft(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-fallback-intelligence@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Fallback Partner Build", "country": "Poland", "city": "Warsaw", "industry": "B2B partnerships"},
    )
    assert company_response.status_code == 200
    company = company_response.json()["company"]
    assert company["ai_summary"]
    assert company["suggested_offer"]
    assert company["sales_angle"]
    assert company["expected_reply_rate"] == "4-8% until contact is verified"

    captured: dict[str, str] = {}

    def fake_personalize(payload):
        captured["summary"] = payload.website_summary
        captured["offer"] = payload.offer
        return EmailVariantOut(
            subject="Partnership idea for Fallback Partner Build",
            preview="Prepared for review",
            full_email="Hi, I prepared this partnership idea for review.",
            cta="Book a quick call",
            cold_email="Hi, I prepared this partnership idea for review.",
            follow_ups=["Following up once.", "Following up twice."],
        )

    monkeypatch.setattr("app.api.usage.personalize_email", fake_personalize)
    draft = client.post(f"/api/workspace-app/companies/{company['id']}/email-draft", headers=headers)
    assert draft.status_code == 200
    data = draft.json()
    assert data["status"] == "success"
    assert data["email"]["delivery_status"] == "draft"
    assert "Fallback Partner Build" in captured["summary"]
    assert captured["offer"]


def test_workspace_app_manual_company_fallback_uses_requested_locale() -> None:
    headers = {
        "Authorization": "Bearer dev",
        "X-Test-User-Email": "usage-russian-fallback@example.com",
        "x-outreachai-locale": "ru",
    }
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Русский Партнер", "country": "Poland", "city": "Warsaw", "industry": "B2B партнерства"},
    )
    assert company_response.status_code == 200
    company = company_response.json()["company"]
    assert "Публичный профиль" in company["ai_summary"] or "Проверенные публичные сигналы" in company["ai_summary"]
    assert "Предложите" in company["suggested_offer"]
    assert "пока контакт не проверен" in company["expected_reply_rate"]
    assert "Ручное исследование" in company["pain_points"][0]
    quality_text = " ".join(
        [
            *company["intelligence_quality"].get("used_sources", []),
            *company["intelligence_quality"].get("gaps", []),
            *company["intelligence_quality"].get("provider_improvements", []),
            company["intelligence_quality"].get("coverage_summary", ""),
            company["intelligence_quality"].get("confidence_reason", ""),
        ]
    )
    assert "Technology stack is unavailable" not in quality_text
    assert "Decision maker is not verified" not in quality_text
    assert "Connect contact verification" not in quality_text
    assert "Технологический стек" in quality_text
    assert "Лицо, принимающее решение" in quality_text


def test_workspace_app_relocalizes_previous_generic_sales_fallback() -> None:
    base_headers = {
        "Authorization": "Bearer dev",
        "X-Test-User-Email": "usage-relocalized-fallback@example.com",
    }
    first_response = client.post(
        "/api/workspace-app/companies",
        headers=base_headers,
        json={"name": "Localized Repeat Partner", "country": "Poland", "city": "Warsaw", "industry": "Partnerships"},
    )
    assert first_response.status_code == 200
    first_company = first_response.json()["company"]
    assert "Verified public signals" in first_company["ai_summary"] or "Public profile is saved" in first_company["ai_summary"]

    russian_response = client.post(
        "/api/workspace-app/companies",
        headers={**base_headers, "x-outreachai-locale": "ru"},
        json={"name": "Localized Repeat Partner", "country": "Poland", "city": "Warsaw", "industry": "Partnerships"},
    )
    assert russian_response.status_code == 200
    russian_company = russian_response.json()["company"]
    assert "Публичный профиль" in russian_company["ai_summary"] or "Проверенные публичные сигналы" in russian_company["ai_summary"]
    assert "Verified public signals" not in russian_company["ai_summary"]
    assert "пока контакт не проверен" in russian_company["expected_reply_rate"]


def test_workspace_app_locale_cookie_controls_sales_fallback_language() -> None:
    headers = {
        "Authorization": "Bearer dev",
        "X-Test-User-Email": "usage-cookie-locale@example.com",
        "Cookie": "outreachai_locale=ru",
    }
    response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Cookie Locale Partner", "country": "Poland", "city": "Warsaw", "industry": "B2B"},
    )
    assert response.status_code == 200
    company = response.json()["company"]
    assert "Публичный профиль" in company["ai_summary"] or "Проверенные публичные сигналы" in company["ai_summary"]
    assert "пока контакт не проверен" in company["expected_reply_rate"]


def test_workspace_app_contact_discovery_empty_persists_search_state(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-contact-empty@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Usage Contact Empty", "website": "https://usage-contact-empty.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200
    company_id = company_response.json()["company"]["id"]

    def fake_hunter_empty(db, request, user_id, workspace, leads):
        return [leads[0].model_copy(update={"hunter_verified": False, "hunter_status": "no_verified_email", "notes": '{"hunter_status":"no_verified_email"}'})]

    monkeypatch.setattr("app.api.usage._hunter_enriched_leads", fake_hunter_empty)
    response = client.post(f"/api/workspace-app/companies/{company_id}/contacts", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "empty"
    assert data["company"]["email"] is None
    assert data["company"]["email_status"] == "No verified email"
    assert data["company"]["contact_search_status"] == "no_verified_email"
    assert data["company"]["contact_search_checked_at"]
    assert "CEO" in data["company"]["decision_maker_roles_searched"]

    refreshed = client.get(f"/api/workspace-app/companies/{company_id}", headers=headers)
    assert refreshed.status_code == 200
    assert refreshed.json()["contact_search_status"] == "no_verified_email"


def test_workspace_app_blocks_placeholder_recipient_before_send(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "usage-placeholder-send@example.com"}
    company_response = client.post(
        "/api/workspace-app/companies",
        headers=headers,
        json={"name": "Placeholder Send Build", "website": "https://placeholder-send.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert company_response.status_code == 200
    company_id = company_response.json()["company"]["id"]

    contact = client.post(
        f"/api/workspace-app/companies/{company_id}/contacts/manual",
        headers=headers,
        json={"name": "QA Contact", "title": "Owner", "email": "qa@example.com"},
    )
    assert contact.status_code == 200
    assert contact.json()["company"]["email"] is None
    assert contact.json()["company"]["contacts"] == []

    monkeypatch.setattr(
        "app.api.usage.personalize_email",
        lambda payload: EmailVariantOut(
            subject="Idea for Placeholder Send Build",
            preview="Quick idea",
            full_email="Hi, I found a relevant opportunity for your team.",
            cta="Book a quick call",
            cold_email="Hi, I found a relevant opportunity for your team.",
            follow_ups=["Following up once.", "Following up twice."],
        ),
    )
    draft = client.post(f"/api/workspace-app/companies/{company_id}/email-draft", headers=headers)
    assert draft.status_code == 200
    email = draft.json()["email"]

    approved = client.post(f"/api/workspace-app/emails/{email['id']}/approve", headers=headers)
    assert approved.status_code == 200

    def fail_send(**kwargs):
        raise AssertionError("Placeholder recipient should not reach the email provider")

    monkeypatch.setattr("app.api.usage.send_email", fail_send)
    sent = client.post(f"/api/workspace-app/emails/{email['id']}/send", headers=headers)
    assert sent.status_code == 200
    assert sent.json()["status"] == "error"
    assert sent.json()["message"] == "Use a real recipient email before sending."
    assert sent.json()["email"]["delivery_status"] == "approved"


def test_legacy_null_workspace_records_are_not_returned_to_authenticated_workspace() -> None:
    SessionLocal = get_sessionmaker()
    with SessionLocal() as db:
        legacy = Lead(
            user_id="tenant-a@example.com",
            workspace_id=None,
            company="Legacy Shared Lead",
            website="https://legacy-shared.example",
            status=LeadStatus.new,
        )
        db.add(legacy)
        db.commit()

    response = client.get("/api/leads?search=Legacy%20Shared%20Lead", headers=USER_A_AUTH)
    assert response.status_code == 200
    assert response.json()["total"] == 0


def test_quality_console_requires_owner_and_creates_repair_tasks() -> None:
    denied = client.get("/api/admin/quality", headers=NON_OWNER_AUTH)
    assert denied.status_code == 403

    response = client.post("/api/admin/quality/run", headers=OWNER_AUTH)
    assert response.status_code == 200
    data = response.json()
    assert "health_score" in data
    assert data["deployment_gate"]["backend_tests"] == "required"
    assert any(check["module"] == "AI Data Consistency Checker" for check in data["checks"])

    open_bugs = data["open_bugs"]
    assert open_bugs
    task = client.post("/api/admin/quality/tasks", headers=OWNER_AUTH, json={"fingerprint": open_bugs[0]["fingerprint"]})
    assert task.status_code == 200
    task_data = task.json()
    assert task_data["approval_required"] is True
    assert task_data["status"] == "needs_approval"
    assert any("Playwright" in item for item in task_data["required_tests"])


def test_production_auth_rejects_unsigned_clerk_token(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CLERK_JWT_ISSUER", "https://clerk.test")
    monkeypatch.setenv("JWT_AUDIENCE", "outreachai-api")
    get_settings.cache_clear()
    security._fetch_clerk_jwks.cache_clear()

    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({"iss": "https://clerk.test", "sub": "forged"}).encode()).rstrip(b"=").decode()

    try:
        security.get_current_user(f"Bearer {header}.{payload}.")
    except HTTPException as exc:
        assert exc.status_code == 401
    else:
        raise AssertionError("Unsigned token was accepted")
    finally:
        get_settings.cache_clear()
        security._fetch_clerk_jwks.cache_clear()


def test_production_auth_accepts_verified_clerk_jwt(monkeypatch) -> None:
    issuer = "https://clerk.test"
    audience = "outreachai-api"
    private_pem, jwks = _auth_test_keypair()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CLERK_JWT_ISSUER", issuer)
    monkeypatch.setenv("JWT_AUDIENCE", audience)
    monkeypatch.setattr(security, "_fetch_clerk_jwks", lambda _: jwks)
    get_settings.cache_clear()

    token = jose_jwt.encode(
        {"iss": issuer, "sub": "user_verified", "aud": audience, "iat": int(time.time()), "exp": int(time.time()) + 300},
        private_pem,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )

    assert security.get_current_user(f"Bearer {token}") == "user_verified"
    get_settings.cache_clear()


def test_production_auth_accepts_standard_clerk_session_jwt_without_audience_when_not_configured(monkeypatch) -> None:
    issuer = "https://clerk.test"
    private_pem, jwks = _auth_test_keypair()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CLERK_JWT_ISSUER", issuer)
    monkeypatch.setenv("JWT_AUDIENCE", "")
    monkeypatch.setattr(security, "_fetch_clerk_jwks", lambda _: jwks)
    get_settings.cache_clear()

    token = jose_jwt.encode(
        {"iss": issuer, "sub": "user_standard_session", "iat": int(time.time()), "exp": int(time.time()) + 300},
        private_pem,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )

    assert security.get_current_user(f"Bearer {token}") == "user_standard_session"
    get_settings.cache_clear()


def test_production_owner_context_uses_verified_clerk_user_email(monkeypatch) -> None:
    issuer = "https://clerk.test"
    audience = "outreachai-api"
    private_pem, jwks = _auth_test_keypair()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CLERK_JWT_ISSUER", issuer)
    monkeypatch.setenv("JWT_AUDIENCE", audience)
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_owner")
    monkeypatch.setattr(security, "_fetch_clerk_jwks", lambda _: jwks)
    monkeypatch.setattr(security, "_fetch_clerk_user_email", lambda user_id: "romaniukvadym10@gmail.com")
    get_settings.cache_clear()

    token = jose_jwt.encode(
        {"iss": issuer, "sub": "user_owner", "aud": audience, "iat": int(time.time()), "exp": int(time.time()) + 300},
        private_pem,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )

    user = security.get_current_user_context(f"Bearer {token}")
    assert user.user_id == "user_owner"
    assert user.email == "romaniukvadym10@gmail.com"
    assert security.require_owner(user) == user
    get_settings.cache_clear()


def test_production_auth_rejects_expired_clerk_jwt(monkeypatch) -> None:
    issuer = "https://clerk.test"
    audience = "outreachai-api"
    private_pem, jwks = _auth_test_keypair()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CLERK_JWT_ISSUER", issuer)
    monkeypatch.setenv("JWT_AUDIENCE", audience)
    monkeypatch.setattr(security, "_fetch_clerk_jwks", lambda _: jwks)
    get_settings.cache_clear()

    token = jose_jwt.encode(
        {"iss": issuer, "sub": "user_expired", "aud": audience, "iat": int(time.time()) - 600, "exp": int(time.time()) - 300},
        private_pem,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )

    try:
        security.get_current_user(f"Bearer {token}")
    except HTTPException as exc:
        assert exc.status_code == 401
    else:
        raise AssertionError("Expired token was accepted")
    finally:
        get_settings.cache_clear()


def test_find_leads_imports_real_provider_results(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: leads)
    monkeypatch.setattr(
        "app.api.routes.search_google_places",
        lambda payload: GooglePlacesSearchResult(
            leads=[LeadOut(
                company="Austin Commercial Build",
                website="https://example.com",
                industry=payload.industry or payload.niche,
                country=payload.country,
                city=payload.city,
                phone="+1 512 555 0101",
                notes='{"source":"google_maps","domain":"example.com","place_id":"places/austin_1","address":"1 Congress Ave, Austin, TX","google_rating":4.7,"business_category":"Construction company"}',
                domain="example.com",
                source="google_maps",
                place_id="places/austin_1",
                address="1 Congress Ave, Austin, TX",
                google_rating=4.7,
                business_category="Construction company",
                latitude=30.2672,
                longitude=-97.7431,
            )],
            raw_count=1,
            duration_ms=10,
        ),
    )
    response = client.post(
        "/api/leads/find",
        headers=AUTH,
        json={
            "industry": "Construction",
            "country": "United States",
            "city": "Austin",
            "employee_count": "11-50",
            "revenue": "1M-10M",
            "technologies": ["WordPress"],
            "keywords": ["commercial renovation"],
            "limit": 5,
        },
    )
    assert response.status_code == 200
    lead = response.json()[0]
    assert lead["company"] == "Austin Commercial Build"
    assert lead["status"] == "New"
    assert lead["source"] == "google_maps"
    assert lead["place_id"] == "places/austin_1"
    assert lead["address"] == "1 Congress Ave, Austin, TX"
    assert lead["google_rating"] == 4.7
    assert lead["business_category"] == "Construction company"


def test_lead_finder_returns_before_inline_website_analysis(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("inline analysis should not run")))
    monkeypatch.setattr(
        "app.api.routes.search_google_places",
        lambda payload: GooglePlacesSearchResult(
            leads=[
                LeadOut(
                    company="Intelligence Build GmbH",
                    website="https://intelligence-build.example",
                    industry="Construction",
                    country="Germany",
                    city="Berlin",
                    email="owner@intelligence-build.example",
                    notes='{"source":"google_maps","domain":"intelligence-build.example","place_id":"google_intelligence_1","business_category":"Construction company"}',
                    domain="intelligence-build.example",
                    place_id="google_intelligence_1",
                    business_category="Construction company",
                    source="google_maps",
                )
            ],
            raw_count=1,
            duration_ms=9,
        ),
    )
    response = client.post("/api/leads/find", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 200
    lead = response.json()[0]
    assert lead["company"] == "Intelligence Build GmbH"
    assert lead["ai_summary"] is None


def test_google_maps_missing_key_blocks_lead_finder(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "")
    get_settings.cache_clear()
    response = client.post("/api/leads/find", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 503
    assert response.json()["detail"] == "This connection is not ready. Please contact the workspace owner."
    get_settings.cache_clear()


def test_google_maps_key_alias_enables_lead_search(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "")
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "places_alias_test")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.google_maps_api_key == "places_alias_test"
    response = client.get("/api/workspace-app/integrations/status", headers=AUTH)
    assert response.status_code == 200
    lead_search = next(item for item in response.json()["integrations"] if item["key"] == "lead_search")
    assert lead_search["status"] == "connected"
    get_settings.cache_clear()


def test_google_maps_timeout_returns_user_safe_error(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.search_google_places", lambda payload: (_ for _ in ()).throw(GoogleMapsRequestError("Google Maps is temporarily unavailable after retries.")))
    monkeypatch.setattr("app.api.routes.apollo_key_loaded", lambda: False)
    response = client.post("/api/leads/find", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 502
    assert response.json()["detail"] == "This connection is temporarily unavailable. Please try again later."


def test_lead_finder_uses_apollo_fallback_when_google_request_fails(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: leads)
    monkeypatch.setattr("app.api.routes.search_google_places", lambda payload: (_ for _ in ()).throw(GoogleMapsRequestError("Google Maps timed out.")))
    fallback_lead = LeadOut(
        company="Fallback Build GmbH",
        website="https://fallback-build.example",
        industry="Construction",
        country="Germany",
        city="Munich",
        notes='{"source":"apollo","domain":"fallback-build.example","apollo_company_id":"apollo_fallback_1"}',
        domain="fallback-build.example",
        apollo_company_id="apollo_fallback_1",
        source="apollo",
    )
    monkeypatch.setattr("app.api.routes.search_apollo_companies", lambda payload: ApolloSearchResult(leads=[fallback_lead], raw_count=1, duration_ms=7))
    response = client.post("/api/leads/find", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Munich"})
    assert response.status_code == 200
    assert response.json()[0]["company"] == "Fallback Build GmbH"
    with get_sessionmaker()() as db:
        lead = db.scalar(select(Lead).where(Lead.company == "Fallback Build GmbH"))
    assert lead is not None


def test_lead_finder_returns_partial_results_when_hunter_times_out(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.LEAD_PROVIDER_TIMEOUT_SECONDS", 1)
    lead = LeadOut(
        company="Partial Hunter Timeout GmbH",
        website="https://partial-hunter-timeout.example",
        industry="Construction",
        country="Germany",
        city="Hamburg",
        notes='{"source":"google_maps","domain":"partial-hunter-timeout.example","place_id":"google_partial_hunter_timeout"}',
        domain="partial-hunter-timeout.example",
        place_id="google_partial_hunter_timeout",
        source="google_maps",
    )
    monkeypatch.setattr("app.api.routes.search_google_places", lambda payload: GooglePlacesSearchResult(leads=[lead], raw_count=1, duration_ms=5))

    def slow_hunter(leads: list[LeadOut]) -> list[LeadOut]:
        time.sleep(2)
        return leads

    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", slow_hunter)
    response = client.post("/api/leads/find", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Hamburg"})
    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["company"] == "Partial Hunter Timeout GmbH"
    assert payload[0]["email"] is None
    with get_sessionmaker()() as db:
        lead_record = db.scalar(select(Lead).where(Lead.company == "Partial Hunter Timeout GmbH"))
    assert lead_record is not None


def test_lead_finder_does_not_run_inline_website_analysis_before_response(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: leads)
    lead = LeadOut(
        company="Response First Build GmbH",
        website="https://response-first-build.example",
        industry="Construction",
        country="Germany",
        city="Cologne",
        notes='{"source":"google_maps","domain":"response-first-build.example","place_id":"google_response_first"}',
        domain="response-first-build.example",
        place_id="google_response_first",
        source="google_maps",
    )
    monkeypatch.setattr("app.api.routes.search_google_places", lambda payload: GooglePlacesSearchResult(leads=[lead], raw_count=1, duration_ms=5))
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("inline analysis should not run")))
    response = client.post("/api/leads/find", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Cologne"})
    assert response.status_code == 200
    assert response.json()[0]["company"] == "Response First Build GmbH"


def test_google_maps_text_query_keeps_radius_out_of_search_phrase() -> None:
    payload = LeadFinderRequest(
        industry="Construction",
        country="Germany",
        city="Berlin",
        keyword="construction",
        category="Construction company",
        company_size="11-50",
        radius=50000,
    )
    query = _text_query(payload)
    assert query.endswith("in Berlin, Germany")
    assert "within" not in query
    assert "50000" not in query


def test_google_maps_duplicate_prevention_by_place_id(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: leads)
    lead = LeadOut(
        company="Duplicate Google Maps GmbH",
        website="https://duplicate-google-maps.example",
        industry="Construction",
        country="Germany",
        city="Berlin",
        phone="+49 30 555 0101",
        notes='{"source":"google_maps","domain":"duplicate-google-maps.example","place_id":"google_duplicate_place"}',
        domain="duplicate-google-maps.example",
        place_id="google_duplicate_place",
        source="google_maps",
    )
    monkeypatch.setattr("app.api.routes.search_google_places", lambda payload: GooglePlacesSearchResult(leads=[lead], raw_count=1, duration_ms=5))
    payload = {"industry": "Construction", "country": "Germany", "city": "Berlin"}
    first = client.post("/api/leads/find", headers=AUTH, json=payload)
    second = client.post("/api/leads/find", headers=AUTH, json=payload)
    assert first.status_code == 200
    assert len(first.json()) == 1
    assert second.status_code == 200
    assert len(second.json()) == 1
    with get_sessionmaker()() as db:
        count = db.scalar(select(func.count()).select_from(Lead).where(Lead.company == "Duplicate Google Maps GmbH"))
    assert count == 1


def test_crm_company_exposes_persistent_activity_dates(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: leads)
    monkeypatch.setattr(
        "app.api.routes.search_google_places",
        lambda payload: GooglePlacesSearchResult(
            leads=[
                LeadOut(
                    company="Timeline Build GmbH",
                    website="https://timeline-build.example",
                    industry="Construction",
                    country="Germany",
                    city="Berlin",
                    email="owner@timeline-build.example",
                    notes='{"source":"google_maps","domain":"timeline-build.example","place_id":"google_timeline_place","hunter_verified":true}',
                    domain="timeline-build.example",
                    place_id="google_timeline_place",
                    hunter_verified=True,
                    source="google_maps",
                )
            ],
            raw_count=1,
            duration_ms=5,
        ),
    )
    response = client.post("/api/leads/find", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 200

    companies = client.get("/api/crm/companies", headers=AUTH).json()
    company = next(item for item in companies if item["name"] == "Timeline Build GmbH")
    assert company["found_at"]
    assert company["contact_found_at"]
    assert company["last_activity_at"]
    assert company["stage_changed_at"]
    assert any(item["action"] == "lead.saved_to_crm" for item in company["activity"])


def test_apollo_status_and_missing_key(monkeypatch) -> None:
    monkeypatch.setenv("APOLLO_API_KEY", "")
    get_settings.cache_clear()
    status = client.get("/api/integrations/apollo/status", headers=AUTH)
    assert status.status_code == 200
    assert status.json()["configured"] is False

    test = client.post("/api/integrations/apollo/test", headers=AUTH)
    assert test.status_code == 200
    assert test.json()["configured"] is False
    assert test.json()["connected"] is False
    get_settings.cache_clear()


def test_apollo_invalid_key_reports_safe_error(monkeypatch) -> None:
    monkeypatch.setenv("APOLLO_API_KEY", "invalid")
    get_settings.cache_clear()
    monkeypatch.setattr("app.api.routes.test_apollo_connection", lambda: (_ for _ in ()).throw(ApolloRequestError("Apollo rejected the backend API key. Verify the live Apollo key and account access.")))
    response = client.post("/api/integrations/apollo/test", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["connected"] is False
    assert response.json()["last_error"] == "This connection is temporarily unavailable. Please try again later."
    get_settings.cache_clear()


def test_hunter_status_and_missing_key(monkeypatch) -> None:
    monkeypatch.setenv("HUNTER_API_KEY", "")
    get_settings.cache_clear()
    status = client.get("/api/integrations/hunter/status", headers=AUTH)
    assert status.status_code == 200
    assert status.json()["configured"] is False

    test = client.post("/api/integrations/hunter/test", headers=AUTH)
    assert test.status_code == 200
    assert test.json()["configured"] is False
    assert test.json()["connected"] is False
    get_settings.cache_clear()


def test_hunter_invalid_key_reports_safe_error(monkeypatch) -> None:
    monkeypatch.setenv("HUNTER_API_KEY", "invalid")
    get_settings.cache_clear()
    monkeypatch.setattr("app.api.routes.test_hunter_connection", lambda: (_ for _ in ()).throw(HunterRequestError("Hunter rejected the backend API key. Verify the live Hunter key and account access.")))
    response = client.post("/api/integrations/hunter/test", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["connected"] is False
    assert response.json()["last_error"] == "This connection is temporarily unavailable. Please try again later."
    get_settings.cache_clear()


def test_apollo_company_search_enriches_with_hunter(monkeypatch) -> None:
    apollo_lead = LeadOut(
        company="Hunter Verified Build GmbH",
        website="https://hunter-verified.example",
        industry="Construction",
        country="Germany",
        city="Berlin",
        notes='{"source":"apollo","domain":"hunter-verified.example","apollo_company_id":"apollo_hunter_1"}',
        domain="hunter-verified.example",
        apollo_company_id="apollo_hunter_1",
        source="apollo",
    )
    hunter_lead = apollo_lead.model_copy(
        update={
            "contact": "Ada Founder",
            "email": "ada@hunter-verified.example",
            "title": "Founder",
            "confidence": "98",
            "hunter_contact_id": "ada@hunter-verified.example",
            "hunter_verified": True,
            "hunter_status": "verified",
            "source": "hunter",
            "notes": '{"source":"hunter","domain":"hunter-verified.example","apollo_company_id":"apollo_hunter_1","hunter_contact_id":"ada@hunter-verified.example","hunter_verified":true,"hunter_status":"verified","confidence":98,"title":"Founder"}',
        }
    )
    monkeypatch.setattr("app.api.routes.search_apollo_companies", lambda payload: ApolloSearchResult(leads=[apollo_lead], raw_count=1, duration_ms=5))
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: [hunter_lead])
    response = client.post("/api/apollo/search-companies", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 200
    saved = response.json()[0]
    assert saved["source"] == "hunter"
    assert saved["hunter_verified"] is True
    assert saved["hunter_status"] == "verified"
    assert saved["email"] == "ada@hunter-verified.example"
    assert saved["confidence"] == "98"


def test_hunter_no_verified_email_is_friendly(monkeypatch) -> None:
    apollo_lead = LeadOut(
        company="No Email Build GmbH",
        website="https://no-email-build.example",
        industry="Construction",
        country="Germany",
        city="Berlin",
        notes='{"source":"apollo","domain":"no-email-build.example","apollo_company_id":"apollo_no_email"}',
        domain="no-email-build.example",
        apollo_company_id="apollo_no_email",
        source="apollo",
    )
    enriched = apollo_lead.model_copy(
        update={
            "hunter_verified": False,
            "hunter_status": "no_verified_email",
            "notes": '{"source":"apollo","domain":"no-email-build.example","apollo_company_id":"apollo_no_email","hunter_status":"no_verified_email"}',
        }
    )
    monkeypatch.setattr("app.api.routes.search_apollo_companies", lambda payload: ApolloSearchResult(leads=[apollo_lead], raw_count=1, duration_ms=5))
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: [enriched])
    response = client.post("/api/apollo/search-companies", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 200
    saved = response.json()[0]
    assert saved["hunter_verified"] is False
    assert saved["hunter_status"] == "no_verified_email"
    assert saved["email"] is None


def test_apollo_timeout_returns_user_safe_error(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.search_apollo_companies", lambda payload: (_ for _ in ()).throw(ApolloRequestError("Apollo is temporarily unavailable. Please try again in a few minutes.")))
    response = client.post("/api/apollo/search-companies", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 502
    assert response.json()["detail"] == "This connection is temporarily unavailable. Please try again later."


def test_apollo_empty_results_are_safe(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.search_apollo_companies", lambda payload: ApolloSearchResult(leads=[], raw_count=0, duration_ms=5))
    response = client.post("/api/apollo/search-companies", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 200
    assert response.json() == []


def test_apollo_duplicate_prevention(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: leads)
    lead = LeadOut(
        company="Duplicate Apollo GmbH",
        website="https://duplicate-apollo.example",
        industry="Construction",
        country="Germany",
        city="Berlin",
        email="duplicate-apollo@example.com",
        notes='{"source":"apollo","domain":"duplicate-apollo.example","apollo_company_id":"apollo_duplicate"}',
        domain="duplicate-apollo.example",
        apollo_company_id="apollo_duplicate",
        source="apollo",
    )
    monkeypatch.setattr("app.api.routes.search_apollo_companies", lambda payload: ApolloSearchResult(leads=[lead], raw_count=1, duration_ms=5))
    payload = {"industry": "Construction", "country": "Germany", "city": "Berlin"}
    first = client.post("/api/apollo/search-companies", headers=AUTH, json=payload)
    second = client.post("/api/apollo/search-companies", headers=AUTH, json=payload)
    assert first.status_code == 200
    assert len(first.json()) == 1
    assert second.status_code == 200
    assert len(second.json()) == 1
    with get_sessionmaker()() as db:
        count = db.scalar(select(func.count()).select_from(Lead).where(Lead.company == "Duplicate Apollo GmbH"))
    assert count == 1


def test_apollo_contact_search_saves_to_db(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: leads)
    monkeypatch.setattr(
        "app.api.routes.search_apollo_contacts",
        lambda payload: ApolloSearchResult(
            leads=[LeadOut(
                company="Berlin Contact Build",
                website="https://berlin-contact.example",
                industry="Construction",
                country="Germany",
                city="Berlin",
                contact="Jane Builder",
                email="jane.builder@example.com",
                title="Founder",
                confidence="high",
                notes='{"source":"apollo","domain":"berlin-contact.example","apollo_company_id":"apollo_org_contact","apollo_contact_id":"apollo_person_1","title":"Founder","confidence":"high"}',
                apollo_company_id="apollo_org_contact",
                apollo_contact_id="apollo_person_1",
                source="apollo",
            )],
            raw_count=1,
            duration_ms=8,
        ),
    )
    response = client.post("/api/apollo/search-contacts", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 200
    saved = response.json()[0]
    assert saved["contact"] == "Jane Builder"
    assert saved["apollo_contact_id"] == "apollo_person_1"


def test_campaign_lead_email_and_dashboard_flow(monkeypatch) -> None:
    def generated_email(_payload):
        return EmailVariantOut(
            subject="Quick idea for Hill Country Build Co",
            preview="A short growth idea",
            full_email="Hi Jane, I found a clear outbound opportunity.",
            cta="Book a growth audit",
            follow_ups=["Following up with one idea.", "Worth a quick look?"],
            ab_tests=[],
        )

    monkeypatch.setattr("app.api.routes.personalize_email", generated_email)

    campaign_response = client.post(
        "/api/campaigns",
        headers=AUTH,
        json={
            "name": "Austin Builders Outreach",
            "industry": "Construction",
            "countries": ["United States"],
            "cities": ["Austin"],
            "company_size": "11-50",
            "keywords": ["commercial renovation"],
            "website_filters": ["has contact page"],
            "language": "English",
            "offer": "book qualified renovation leads",
            "cta": "Book a 15 minute growth audit",
            "email_tone": "consultative",
            "signature": "Vadym, OutreachAI",
        },
    )
    assert campaign_response.status_code == 200
    campaign = campaign_response.json()
    assert campaign["industry"] == "Construction"

    lead_response = client.post(
        "/api/leads",
        headers=AUTH,
        json={
            "company": "Hill Country Build Co",
            "website": "https://hill-country-build-flow.example",
            "industry": "Construction",
            "country": "United States",
            "city": "Austin",
            "contact": "Jane Doe",
            "email": "jane@example.com",
            "status": "Qualified",
            "campaign_id": campaign["id"],
        },
    )
    assert lead_response.status_code == 200
    lead = lead_response.json()
    assert lead["status"] == "Qualified"

    email_response = client.post(
        "/api/emails/generate",
        headers=AUTH,
        json={"campaign_id": campaign["id"], "lead_id": lead["id"]},
    )
    assert email_response.status_code == 200
    email = email_response.json()
    assert email["subject"]
    assert email["body"]
    assert email["follow_up_1"]

    list_response = client.get("/api/leads?search=Hill&status=Qualified", headers=AUTH)
    assert list_response.status_code == 200
    assert list_response.json()["total"] >= 1

    dashboard_response = client.get("/api/dashboard", headers=AUTH)
    assert dashboard_response.status_code == 200
    metrics = dashboard_response.json()
    assert metrics["leads"] >= 1
    assert metrics["campaigns"] >= 1


def test_manual_lead_creation_enriches_with_hunter_and_ai(monkeypatch) -> None:
    def enriched(leads):
        lead = leads[0]
        return [
            lead.model_copy(
                update={
                    "contact": "Ada Founder",
                    "email": "ada@manual-build.example",
                    "hunter_verified": True,
                    "hunter_status": "verified",
                    "source": "hunter",
                    "notes": '{"source":"hunter","domain":"manual-build.example","hunter_verified":true,"hunter_status":"verified","confidence":97,"title":"Founder"}',
                }
            )
        ]

    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: enriched(leads))
    monkeypatch.setattr(
        "app.api.routes.collect_website",
        lambda website: type("Snapshot", (), {"url": website, "title": "Manual Build", "meta_description": "Construction company", "text": "Construction services contact us case studies", "technologies": ["Next.js"]})(),
    )
    monkeypatch.setattr(
        "app.api.routes.analyze_company_website",
        lambda **kwargs: AnalysisOut(
            company="Manual Build GmbH",
            website=kwargs["website"],
            niche="Construction",
            industry="Construction",
            services=["Commercial construction"],
            strengths=["Clear services"],
            weaknesses=["Weak CTA"],
            summary="Manual Build is a Berlin construction company.",
            company_summary="Manual Build serves commercial construction buyers in Berlin.",
            icp="German construction firms",
            icp_score=82,
            value_proposition="Reliable commercial builds",
            detected_language="German",
            target_geography="Germany",
            sales_angle="Turn website traffic into project calls.",
            suggested_offer="Offer a reviewed outreach campaign for project leads.",
            outreach_strategy="Lead with the weak CTA and offer a short growth review.",
            recommended_tone="Professional",
            recommended_cta="Open to a 10 minute review?",
            follow_up_strategy="Two helpful follow-ups",
            expected_reply_rate="8-12%",
            buying_signals=["Clear service positioning", "Local construction market focus"],
            risks=["No pricing page visible"],
            opportunity_analysis="Strong B2B partnership opportunity for project lead generation.",
            partnership_fit="Good fit for reviewed outbound partnerships.",
            priority_score=84,
            confidence_score=79,
            next_recommended_action="Review and approve the first outreach draft.",
        ),
    )

    response = client.post(
        "/api/leads",
        headers=AUTH,
        json={"company": "Manual Build GmbH", "website": "https://manual-build.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )

    assert response.status_code == 200
    lead = response.json()
    assert lead["email"] == "ada@manual-build.example"
    assert lead["hunter_verified"] is True
    assert lead["source"] == "hunter"
    assert lead["ai_summary"] == "Manual Build serves commercial construction buyers in Berlin."
    assert lead["suggested_offer"] == "Offer a reviewed outreach campaign for project leads."
    assert lead["expected_reply_rate"] == "8-12%"
    assert lead["priority_score"] == 84
    assert lead["confidence_score"] == 79

    crm_response = client.get("/api/crm/companies?search=Manual%20Build", headers=AUTH)
    assert crm_response.status_code == 200
    companies = crm_response.json()
    assert len(companies) == 1
    company = companies[0]
    assert company["name"] == "Manual Build GmbH"
    assert company["email"] == "ada@manual-build.example"
    assert company["crm_stage"] in {"Contact Found", "Website Analyzed"}
    assert company["contacts"][0]["email_status"] == "Verified"
    assert company["deals"][0]["stage"] == company["crm_stage"]
    assert "Clear service positioning" in company["buying_signals"]
    assert "No pricing page visible" in company["risks"]
    assert company["opportunity_analysis"] == "Strong B2B partnership opportunity for project lead generation."
    assert company["partnership_fit"] == "Good fit for reviewed outbound partnerships."
    assert company["priority_score"] == 84
    assert company["confidence_score"] == 79
    assert company["next_recommended_action"] == "Review and approve the first outreach draft."


def test_manual_lead_creation_survives_hunter_no_email(monkeypatch) -> None:
    def no_email(db, request, user_id, workspace, leads):
        lead = leads[0]
        return [lead.model_copy(update={"hunter_status": "no_verified_email", "source": "manual", "notes": '{"source":"manual","hunter_status":"no_verified_email"}'})]

    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", no_email)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)

    response = client.post(
        "/api/leads",
        headers=AUTH,
        json={"company": "Manual No Email Build", "website": "https://manual-no-email-build.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )

    assert response.status_code == 200
    lead = response.json()
    assert lead["email"] is None
    assert lead["hunter_verified"] is False
    assert lead["hunter_status"] == "no_verified_email"
    assert lead["source"] == "manual"


def test_ai_analyze_skips_unreachable_website_without_failing_saved_lead(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)

    lead_response = client.post(
        "/api/leads",
        headers=AUTH,
        json={"company": "Unreachable Build", "website": "unreachable-build.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert lead_response.status_code == 200
    lead = lead_response.json()

    def fail_fetch(url: str):
        raise WebsiteFetchError(WEBSITE_UNREACHABLE_MESSAGE)

    monkeypatch.setattr("app.api.routes.collect_website", fail_fetch)
    response = client.post(
        "/api/ai/analyze",
        headers=AUTH,
        json={"lead_id": lead["id"], "company": "Unreachable Build", "website": "unreachable-build.example", "niche": "Construction"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == WEBSITE_UNREACHABLE_MESSAGE
    assert body["website"] == "unreachable-build.example"

    crm_response = client.get("/api/crm/companies?search=Unreachable%20Build", headers=AUTH)
    assert crm_response.status_code == 200
    company = crm_response.json()[0]
    assert company["ai_summary"] == WEBSITE_UNREACHABLE_MESSAGE
    assert company["crm_stage"] != "Website Analyzed"


def test_ai_analyze_truncates_long_ai_fields_before_database_save(monkeypatch) -> None:
    long_niche = "Construction and real estate business development support for international buyers in Berlin and Germany with project management and renovation services"

    monkeypatch.setattr(
        "app.api.routes.collect_website",
        lambda url: WebsiteSnapshot(
            url="https://long-ai-fields.example",
            title="Long AI Fields",
            meta_description="Construction services",
            text="Construction project management in Berlin.",
            technologies=["Next.js"],
        ),
    )
    monkeypatch.setattr(
        "app.api.routes.analyze_company_website",
        lambda **kwargs: AnalysisOut(
            company="Long AI Fields GmbH",
            website="https://long-ai-fields.example",
            description="Reliable construction project support.",
            industry="Construction, Real Estate, Project Management",
            location="Berlin, Germany",
            niche=long_niche,
            products_services=["Renovation", "Project management"],
            services=["Website analysis"],
            technologies=["Next.js"],
            strengths=["Clear positioning"],
            weaknesses=["Long niche text"],
            icp_score=78,
            summary="Useful prospect for outbound.",
        ),
    )

    response = client.post(
        "/api/ai/analyze",
        headers=AUTH,
        json={"company": "Long AI Fields GmbH", "website": "https://long-ai-fields.example", "niche": "Construction"},
    )

    assert response.status_code == 200
    assert response.json()["niche"] == long_niche

    SessionLocal = get_sessionmaker()
    with SessionLocal() as db:
        analysis = db.scalar(select(WebsiteAnalysis).where(WebsiteAnalysis.company == "Long AI Fields GmbH"))
        assert analysis is not None
        assert analysis.niche is not None
        assert len(analysis.niche) <= 120


def test_manual_lead_draft_email_does_not_send(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)
    monkeypatch.setattr(
        "app.api.routes.personalize_email",
        lambda payload: EmailVariantOut(
            subject="Idea for Manual Draft Build",
            preview="A short reviewed idea",
            full_email="Hi, I prepared a reviewed outreach idea.",
            cta="Open to a quick review?",
            follow_ups=["Following up with one idea.", "Worth reviewing?"],
            ab_tests=[],
        ),
    )
    lead_response = client.post(
        "/api/leads",
        headers=AUTH,
        json={"company": "Manual Draft Build", "website": "https://manual-draft.example", "industry": "Construction", "email": "founder@manual-draft.example"},
    )
    assert lead_response.status_code == 200
    lead = lead_response.json()

    draft_response = client.post(f"/api/leads/{lead['id']}/draft-email", headers=AUTH)

    assert draft_response.status_code == 200
    draft = draft_response.json()
    assert draft["subject"] == "Idea for Manual Draft Build"
    assert draft["delivery_status"] == "draft"
    assert draft["sent_at"] is None
    assert draft["tags"]["requires_approval"] is True

    crm_response = client.get("/api/crm/companies?search=Manual%20Draft", headers=AUTH)
    assert crm_response.status_code == 200
    company = crm_response.json()[0]
    assert company["crm_stage"] == "Email Draft Ready"
    assert company["email_status"] == "Draft Ready"
    assert company["generated_emails"][0]["delivery_status"] == "draft"
    assert company["email_generated_at"]
    assert company["saved_to_crm_at"]

    send_before_approval = client.post(f"/api/emails/{draft['id']}/send", headers=AUTH)
    assert send_before_approval.status_code == 400
    assert "Approve the email" in send_before_approval.json()["detail"]

    approved_response = client.post(f"/api/emails/{draft['id']}/approve", headers=AUTH)
    assert approved_response.status_code == 200
    approved = approved_response.json()
    assert approved["delivery_status"] == "approved"

    crm_after_approval = client.get("/api/crm/companies?search=Manual%20Draft", headers=AUTH).json()[0]
    assert crm_after_approval["crm_stage"] == "Approved"
    assert crm_after_approval["email_status"] == "Approved"
    assert crm_after_approval["email_approved_at"]
    assert any(item["action"] == "email.approved" for item in crm_after_approval["activity"])

    monkeypatch.setattr("app.api.routes.send_email", lambda **kwargs: {"id": "resend-approved-manual-draft"})
    sent_response = client.post(f"/api/emails/{draft['id']}/send", headers=AUTH)
    assert sent_response.status_code == 200
    assert sent_response.json()["delivery_status"] == "sent"

    crm_after_send = client.get("/api/crm/companies?search=Manual%20Draft", headers=AUTH).json()[0]
    assert crm_after_send["crm_stage"] == "Sent"
    assert crm_after_send["email_status"] == "Sent"
    assert crm_after_send["email_sent_at"]
    assert any(item["action"] == "email.sent" for item in crm_after_send["activity"])


def test_outreach_sender_status_and_update() -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "sender-settings@example.com"}

    status = client.get("/api/outreach/sender/status", headers=headers)
    assert status.status_code == 200
    assert status.json()["provider"] == "resend"
    assert status.json()["sender_email"] == "hello@example.com"
    assert status.json()["connected"] is True

    updated = client.put(
        "/api/outreach/sender",
        headers=headers,
        json={
            "provider": "gmail",
            "sender_name": "Founder",
            "sender_email": "founder@example.com",
            "reply_to": "reply@example.com",
            "daily_send_limit": 15,
            "enabled": True,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["connected"] is False
    assert updated.json()["status"] == "needs_setup"
    assert "OAuth" in updated.json()["reason"]


def test_approved_email_uses_workspace_sender(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "sender-send@example.com"}
    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)
    monkeypatch.setattr(
        "app.api.routes.personalize_email",
        lambda payload: EmailVariantOut(
            subject="Personal idea",
            preview="Short idea",
            full_email="Hi, this is a reviewed idea.",
            cta="Open to a short call?",
            follow_ups=[],
            ab_tests=[],
        ),
    )
    setup = client.put(
        "/api/outreach/sender",
        headers=headers,
        json={
            "provider": "resend",
            "sender_name": "Sales Team",
            "sender_email": "sales@example.com",
            "reply_to": "reply@example.com",
            "daily_send_limit": 25,
            "enabled": True,
        },
    )
    assert setup.status_code == 200

    sent_payload: dict[str, str] = {}

    def fake_send(**kwargs):
        sent_payload.update(kwargs)
        return {"id": "workspace-sender-send"}

    monkeypatch.setattr("app.api.routes.send_email", fake_send)
    lead = client.post(
        "/api/leads",
        headers=headers,
        json={"company": "Sender Send Co", "website": "https://sender-send.example", "industry": "Construction", "email": "buyer@sender-send.example"},
    ).json()
    draft = client.post(f"/api/leads/{lead['id']}/draft-email", headers=headers).json()
    approved = client.post(f"/api/emails/{draft['id']}/approve", headers=headers)
    assert approved.status_code == 200

    sent = client.post(f"/api/emails/{draft['id']}/send", headers=headers)
    assert sent.status_code == 200
    assert sent_payload["from_email"] == "sales@example.com"
    assert sent_payload["from_name"] == "Sales Team"
    assert sent_payload["reply_to"] == "reply@example.com"
    assert sent.json()["tags"]["sender_provider"] == "resend"


def test_smtp_sender_requires_custom_encryption_key() -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "smtp-no-key@example.com"}

    response = client.put(
        "/api/outreach/sender",
        headers=headers,
        json={
            "provider": "smtp",
            "sender_name": "Sales Team",
            "sender_email": "sales@example.com",
            "reply_to": "reply@example.com",
            "daily_send_limit": 25,
            "enabled": True,
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "smtp_username": "sales@example.com",
            "smtp_password": "secret",
            "smtp_use_tls": True,
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Connect email sending or adjust the daily sending limit before sending."


def test_smtp_sender_send_uses_decrypted_workspace_config(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "smtp-send@example.com"}
    monkeypatch.setenv("ENCRYPTION_KEY", "test-custom-encryption-key")
    get_settings.cache_clear()
    monkeypatch.setattr("app.api.routes.verify_smtp_connection", lambda **kwargs: None)
    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)
    monkeypatch.setattr(
        "app.api.routes.personalize_email",
        lambda payload: EmailVariantOut(
            subject="SMTP sender idea",
            preview="Short idea",
            full_email="Hi, this is a reviewed SMTP idea.",
            cta="Open to a short call?",
            follow_ups=[],
            ab_tests=[],
        ),
    )
    try:
        setup = client.put(
            "/api/outreach/sender",
            headers=headers,
            json={
                "provider": "smtp",
                "sender_name": "SMTP Team",
                "sender_email": "sales@example.com",
                "reply_to": "reply@example.com",
                "daily_send_limit": 25,
                "enabled": True,
                "smtp_host": "smtp.example.com",
                "smtp_port": 587,
                "smtp_username": "sales@example.com",
                "smtp_password": "smtp-secret",
                "smtp_use_tls": True,
            },
        )
        assert setup.status_code == 200
        assert setup.json()["connected"] is True
        assert setup.json()["smtp_configured"] is True
        assert setup.json()["smtp_verified_at"]
        assert "smtp-secret" not in json.dumps(setup.json())

        sent_payload: dict[str, object] = {}

        def fake_send(**kwargs):
            sent_payload.update(kwargs)
            return {"id": "smtp-message-id"}

        monkeypatch.setattr("app.api.routes.send_email", fake_send)
        lead = client.post(
            "/api/leads",
            headers=headers,
            json={"company": "SMTP Send Co", "website": "https://smtp-send.example", "industry": "Construction", "email": "buyer@smtp-send.example"},
        ).json()
        draft = client.post(f"/api/leads/{lead['id']}/draft-email", headers=headers).json()
        approved = client.post(f"/api/emails/{draft['id']}/approve", headers=headers)
        assert approved.status_code == 200

        sent = client.post(f"/api/emails/{draft['id']}/send", headers=headers)
        assert sent.status_code == 200
        assert sent_payload["provider"] == "smtp"
        assert sent_payload["from_email"] == "sales@example.com"
        assert sent_payload["from_name"] == "SMTP Team"
        assert sent_payload["reply_to"] == "reply@example.com"
        assert sent_payload["smtp_config"]["host"] == "smtp.example.com"  # type: ignore[index]
        assert sent_payload["smtp_config"]["password"] == "smtp-secret"  # type: ignore[index]
        assert sent.json()["tags"]["sender_provider"] == "smtp"
    finally:
        get_settings.cache_clear()


def test_smtp_sender_save_rejects_unverified_mailbox(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "smtp-unverified@example.com"}
    monkeypatch.setenv("ENCRYPTION_KEY", "test-custom-encryption-key")
    get_settings.cache_clear()

    def fail_verify(**kwargs):
        raise EmailProviderRequestError("SMTP connection could not be verified. Check host, port, username and app password.")

    monkeypatch.setattr("app.api.routes.verify_smtp_connection", fail_verify)
    try:
        response = client.put(
            "/api/outreach/sender",
            headers=headers,
            json={
                "provider": "smtp",
                "sender_name": "SMTP Team",
                "sender_email": "sales@example.com",
                "reply_to": "reply@example.com",
                "daily_send_limit": 25,
                "enabled": True,
                "smtp_host": "smtp.example.com",
                "smtp_port": 587,
                "smtp_username": "sales@example.com",
                "smtp_password": "wrong-password",
                "smtp_use_tls": True,
            },
        )
        assert response.status_code == 409
        assert "temporarily unavailable" in response.json()["detail"]

        status = client.get("/api/outreach/sender/status", headers=headers)
        assert status.status_code == 200
        assert status.json()["connected"] is True
        assert status.json()["provider"] == "resend"
        assert status.json()["smtp_verified_at"] == ""
    finally:
        get_settings.cache_clear()


def test_disabled_outreach_sender_blocks_send(monkeypatch) -> None:
    headers = {"Authorization": "Bearer dev", "X-Test-User-Email": "sender-disabled@example.com"}
    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)
    monkeypatch.setattr(
        "app.api.routes.personalize_email",
        lambda payload: EmailVariantOut(
            subject="Disabled sender idea",
            preview="Short idea",
            full_email="Hi, this is a reviewed idea.",
            cta="Open to a short call?",
            follow_ups=[],
            ab_tests=[],
        ),
    )
    disabled = client.put(
        "/api/outreach/sender",
        headers=headers,
        json={
            "provider": "resend",
            "sender_name": "Sales Team",
            "sender_email": "sales@example.com",
            "reply_to": "reply@example.com",
            "daily_send_limit": 25,
            "enabled": False,
        },
    )
    assert disabled.status_code == 200
    assert disabled.json()["connected"] is False

    lead = client.post(
        "/api/leads",
        headers=headers,
        json={"company": "Sender Disabled Co", "website": "https://sender-disabled.example", "industry": "Construction", "email": "buyer@sender-disabled.example"},
    ).json()
    draft = client.post(f"/api/leads/{lead['id']}/draft-email", headers=headers).json()
    approved = client.post(f"/api/emails/{draft['id']}/approve", headers=headers)
    assert approved.status_code == 200

    sent = client.post(f"/api/emails/{draft['id']}/send", headers=headers)
    assert sent.status_code == 409
    assert "connect email sending" in sent.json()["detail"].lower()


def test_crm_duplicate_prevention_reuses_manual_company(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)
    payload = {"company": "CRM Duplicate Build", "website": "https://crm-duplicate.example", "country": "Germany", "city": "Berlin", "industry": "Construction"}

    first = client.post("/api/leads", headers=AUTH, json=payload)
    second = client.post("/api/leads", headers=AUTH, json=payload)
    assert first.status_code == 200
    assert second.status_code == 200

    crm_response = client.get("/api/crm/companies?search=CRM%20Duplicate", headers=AUTH)
    assert crm_response.status_code == 200
    companies = crm_response.json()
    assert len(companies) == 1
    assert companies[0]["website"] == "https://crm-duplicate.example"


def test_crm_stage_move_and_note_are_persisted(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)
    lead_response = client.post(
        "/api/leads",
        headers=AUTH,
        json={"company": "CRM Action Build", "website": "https://crm-action.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert lead_response.status_code == 200
    company = client.get("/api/crm/companies?search=CRM%20Action", headers=AUTH).json()[0]

    moved = client.patch(f"/api/crm/companies/{company['id']}/stage", headers=AUTH, json={"stage": "Meeting Scheduled"})
    assert moved.status_code == 200
    assert moved.json()["crm_stage"] == "Meeting Scheduled"
    assert moved.json()["stage_changed_at"]

    note = client.post(f"/api/crm/companies/{company['id']}/notes", headers=AUTH, json={"body": "Customer asked to review next week."})
    assert note.status_code == 200
    assert note.json()["body"] == "Customer asked to review next week."

    refreshed = client.get("/api/crm/companies?search=CRM%20Action", headers=AUTH).json()[0]
    assert refreshed["crm_stage"] == "Meeting Scheduled"
    assert refreshed["notes"][0]["body"] == "Customer asked to review next week."
    assert any(item["action"] == "crm.stage_changed" for item in refreshed["activity"])
    assert any(item["action"] == "note.added" for item in refreshed["activity"])
    workspace = client.get("/api/workspace", headers=AUTH).json()
    db = get_sessionmaker()()
    try:
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == UUID(workspace["id"])).first()
        assert settings is not None
        ai = settings.ai if isinstance(settings.ai, dict) else {}
        continuous_learning = ai.get("continuous_learning") if isinstance(ai.get("continuous_learning"), dict) else {}
        outcomes = continuous_learning.get("outcomes") if isinstance(continuous_learning.get("outcomes"), dict) else {}
        assert outcomes.get("meeting", 0) >= 1
    finally:
        db.close()


def test_crm_pipeline_activity_query_uses_postgres_json_key_extraction() -> None:
    compiled = str(select(AuditLog.id).where(_audit_log_lead_id_clause(UUID("00000000-0000-0000-0000-000000000001"))).compile(dialect=postgresql.dialect()))

    assert "LIKE" not in compiled.upper()
    assert "->>" in compiled


def test_crm_pipeline_returns_company_cards_with_activity_timeline(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)
    lead_response = client.post(
        "/api/leads",
        headers=AUTH,
        json={"company": "Pipeline Activity Build", "website": "https://pipeline-activity.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert lead_response.status_code == 200
    lead = lead_response.json()
    workspace = client.get("/api/workspace", headers=AUTH).json()

    db = get_sessionmaker()()
    try:
        db.add(AuditLog(user_id="dev_user", workspace_id=UUID(workspace["id"]), action="lead.pipeline_activity_test", metadata_json={"lead_id": lead["id"], "source": "test"}))
        db.commit()
    finally:
        db.close()

    response = client.get("/api/crm/pipeline", headers=AUTH)

    assert response.status_code == 200
    company = next(item for item in response.json()["companies"] if item["lead_id"] == lead["id"])
    assert company["name"] == "Pipeline Activity Build"
    assert any(item["action"] == "lead.pipeline_activity_test" for item in company["activity"])


def test_crm_company_and_pipeline_default_sort_by_overall_score(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes._hunter_enriched_leads", lambda db, request, user_id, workspace, leads: leads)
    monkeypatch.setattr("app.api.routes._analyze_lead_if_possible", lambda db, user_id, workspace, lead: None)

    first = client.post(
        "/api/leads",
        headers=AUTH,
        json={"company": "Ranking Lower", "website": "https://ranking-lower.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    second = client.post(
        "/api/leads",
        headers=AUTH,
        json={"company": "Ranking Higher", "website": "https://ranking-higher.example", "country": "Germany", "city": "Berlin", "industry": "Construction"},
    )
    assert first.status_code == 200
    assert second.status_code == 200

    db = get_sessionmaker()()
    try:
        low = db.scalar(select(Company).where(Company.name == "Ranking Lower"))
        high = db.scalar(select(Company).where(Company.name == "Ranking Higher"))
        assert low is not None
        assert high is not None
        low.metadata_json = {
            **(low.metadata_json or {}),
            "overall_score": 32,
            "reasoning": "Low readiness",
            "top_positive_signals": ["Basic profile"],
            "top_negative_signals": ["No verified contact"],
            "recommended_next_action": "Enrich contact",
            "confidence": 40,
            "opportunity_ranking": {
                "overall_score": 32,
                "reasoning": "Low readiness",
                "top_positive_signals": ["Basic profile"],
                "top_negative_signals": ["No verified contact"],
                "recommended_next_action": "Enrich contact",
                "confidence": 40,
                "factors": {"Verified Contacts": 20},
            },
        }
        high.metadata_json = {
            **(high.metadata_json or {}),
            "overall_score": 91,
            "reasoning": "Strong fit and verified decision maker",
            "top_positive_signals": ["Buying Intent: 90", "Verified Contacts: 100"],
            "top_negative_signals": [],
            "recommended_next_action": "Send outreach now",
            "confidence": 89,
            "opportunity_ranking": {
                "overall_score": 91,
                "reasoning": "Strong fit and verified decision maker",
                "top_positive_signals": ["Buying Intent: 90", "Verified Contacts: 100"],
                "top_negative_signals": [],
                "recommended_next_action": "Send outreach now",
                "confidence": 89,
                "factors": {"Verified Contacts": 100},
            },
        }
        db.commit()
    finally:
        db.close()

    companies_response = client.get("/api/crm/companies?search=Ranking%20", headers=AUTH)
    assert companies_response.status_code == 200
    companies = [item for item in companies_response.json() if item["name"] in {"Ranking Lower", "Ranking Higher"}]
    assert len(companies) == 2
    assert companies[0]["name"] == "Ranking Higher"
    assert companies[0]["overall_score"] == 91
    assert companies[1]["name"] == "Ranking Lower"
    assert companies[1]["overall_score"] == 32

    pipeline_response = client.get("/api/crm/pipeline", headers=AUTH)
    assert pipeline_response.status_code == 200
    ranked = [item for item in pipeline_response.json()["companies"] if item["name"] in {"Ranking Lower", "Ranking Higher"}]
    assert len(ranked) == 2
    assert ranked[0]["name"] == "Ranking Higher"
    assert ranked[0]["overall_score"] == 91
    assert ranked[1]["name"] == "Ranking Lower"
    assert ranked[1]["overall_score"] == 32


def test_ai_sales_copilot_endpoints(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.sales_copilot",
        lambda payload: SalesCopilotOut(
            probability_to_reply=72,
            probability_to_buy=31,
            best_first_contact="Personalized email",
            best_subject_line="Idea for your website conversion",
            best_cta="Book a 15 minute call",
            estimated_revenue=12000,
            reasoning=["Strong fit", "Visible conversion gaps"],
        ),
    )
    monkeypatch.setattr(
        "app.api.routes.website_audit",
        lambda payload: WebsiteAuditOut(
            missing_cta=True,
            missing_contact_form=True,
            poor_seo=False,
            weak_trust_signals=True,
            missing_reviews=True,
            slow_website=False,
            outdated_design=False,
            improvement_report="Add a primary CTA, contact form, and proof points.",
            priority_actions=["Add CTA", "Add contact form"],
        ),
    )
    monkeypatch.setattr("app.api.routes.collect_website", lambda url: type("Snapshot", (), {"text": "Contact us for services", "technologies": ["Next.js"]})())
    monkeypatch.setattr(
        "app.api.routes.meeting_preparation",
        lambda payload: MeetingPrepOut(company_summary="Commercial builder", decision_maker_profile="Owner-led team", likely_objections=["Timing"], suggested_questions=["What is your lead target?"], sales_strategy="Lead with booked meetings."),
    )
    monkeypatch.setattr(
        "app.api.routes.adaptive_follow_ups",
        lambda payload: FollowUpSequenceOut(no_open=["Bump"], opened=["Saw you had a look"], clicked=["Worth discussing?"], replied=["Thanks for the reply"]),
    )
    monkeypatch.setattr(
        "app.api.routes.campaign_analytics",
        lambda payload: CampaignAnalyticsOut(campaign_id=payload["campaign_id"], campaign_success=68, predicted_reply_rate=12.5, predicted_conversion_rate=3.2, suggested_improvements=["Tighten ICP"]),
    )

    campaign = client.post("/api/campaigns", headers=AUTH, json={"name": "Copilot Campaign", "industry": "Construction"}).json()
    lead = client.post(
        "/api/leads",
        headers=AUTH,
        json={"company": "Copilot Build Co", "website": "https://example.com", "industry": "Construction", "email": "copilot@example.com", "campaign_id": campaign["id"]},
    ).json()

    copilot = client.post(f"/api/leads/{lead['id']}/copilot", headers=AUTH)
    assert copilot.status_code == 200
    assert copilot.json()["probability_to_reply"] == 72
    audit = client.post(f"/api/leads/{lead['id']}/website-audit", headers=AUTH)
    assert audit.status_code == 200
    assert audit.json()["missing_cta"] is True
    meeting = client.post(f"/api/leads/{lead['id']}/meeting-prep", headers=AUTH)
    assert meeting.status_code == 200
    assert meeting.json()["sales_strategy"]
    followups = client.post(f"/api/leads/{lead['id']}/follow-ups", headers=AUTH)
    assert followups.status_code == 200
    assert followups.json()["opened"]
    workspace = client.get("/api/workspace", headers=AUTH).json()
    db = get_sessionmaker()()
    try:
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == UUID(workspace["id"])).one()
        settings.billing = {**(settings.billing or {}), "plan": "Pro", "status": "active"}
        db.commit()
    finally:
        db.close()
    analytics = client.post(f"/api/campaigns/{campaign['id']}/ai-analytics", headers=AUTH)
    assert analytics.status_code == 200
    assert analytics.json()["campaign_success"] == 68


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (10000, 10000.0),
        (10000.5, 10000.5),
        ("10000", 10000.0),
        ("10 000", 10000.0),
        ("€10,000", 10000.0),
        (None, None),
        ("", None),
        ("unknown", None),
        ("неизвестно", None),
        ("Revenue depends on contract size and cannot be estimated from the current data.", None),
    ],
)
def test_llm_number_parser_handles_sales_copilot_revenue_shapes(value, expected) -> None:
    assert _parse_llm_number(value) == expected


def test_sales_copilot_moves_textual_revenue_into_reason(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_completion(system, payload):
        captured["system"] = system
        captured["payload"] = payload
        return {
            "probability_to_reply": "66",
            "probability_to_buy": "41",
            "best_first_contact": "Personalized email",
            "best_subject_line": "Quick idea",
            "best_cta": "Book a call",
            "fit_reason": "The company matches the target segment and has visible conversion gaps.",
            "risk_to_check": "No verified decision maker is available yet.",
            "next_best_action": "Find a verified decision maker before sending.",
            "estimated_revenue": "Revenue depends on contract size and cannot be estimated from the current data.",
            "reasoning": ["Good fit"],
        }

    monkeypatch.setattr(
        "app.services.ai._json_completion",
        fake_completion,
    )

    result = sales_copilot({"response_language": "Russian", "lead": {"company": "Safe Revenue Co"}})

    assert result.estimated_revenue is None
    assert "Revenue depends on contract size" in (result.estimated_revenue_reason or "")
    assert result.probability_to_reply == 66
    assert result.fit_reason == "The company matches the target segment and has visible conversion gaps."
    assert result.risk_to_check == "No verified decision maker is available yet."
    assert result.next_best_action == "Find a verified decision maker before sending."
    assert "payload.response_language" in str(captured["system"])
    assert captured["payload"] == {"response_language": "Russian", "lead": {"company": "Safe Revenue Co"}}


def test_lead_ai_payload_carries_workspace_language() -> None:
    lead = Lead(company="Language Fit Co", website="https://example.com", industry="SaaS", country="Poland", city="Warsaw")

    payload = _lead_ai_payload(lead, None, None, [], "French")

    assert payload["response_language"] == "French"
    assert payload["lead"]["company"] == "Language Fit Co"


@pytest.mark.parametrize(
    ("workspace_language", "expected"),
    [
        ("Russian", "Russian"),
        ("Klingon", "English"),
        (None, "English"),
        ("", "English"),
    ],
)
def test_lead_ai_payload_normalizes_language_fallback(workspace_language, expected) -> None:
    lead = Lead(company="Language Fallback Co", website="https://example.com", industry="SaaS", country="Poland", city="Warsaw")

    payload = _lead_ai_payload(lead, None, None, [], workspace_language)

    assert payload["response_language"] == expected


def test_sales_copilot_invalid_ai_response_returns_safe_defaults(monkeypatch) -> None:
    def invalid_response(system, payload):
        raise ProviderResponseValidationError("invalid json")

    monkeypatch.setattr("app.services.ai._json_completion", invalid_response)

    result = sales_copilot({"lead": {"company": "Invalid Json Co"}})

    assert result.estimated_revenue is None
    assert result.probability_to_reply == 0
    assert result.probability_to_buy == 0
    assert result.best_first_contact == "Personalized email"
    assert result.fit_reason is None
    assert result.risk_to_check is None
    assert result.next_best_action is None


def test_resend_webhook_updates_delivery_metrics() -> None:
    workspace = client.get("/api/workspace", headers=AUTH).json()
    workspace_id = UUID(workspace["id"])
    db = get_sessionmaker()()
    try:
        campaign = Campaign(user_id="dev_user", workspace_id=workspace_id, name="Webhook Campaign", industry="Construction")
        db.add(campaign)
        db.flush()
        lead = Lead(
            user_id="dev_user",
            workspace_id=workspace_id,
            campaign_id=campaign.id,
            company="Webhook Build Co",
            email="webhook@example.com",
            status=LeadStatus.sent,
        )
        db.add(lead)
        db.flush()
        message = EmailMessage(
            user_id="dev_user",
            workspace_id=workspace_id,
            campaign_id=campaign.id,
            lead_id=lead.id,
            direction="outbound",
            subject="Webhook test",
            body="Hello",
            provider_message_id="resend-msg-1",
            delivery_status="sent",
            sent_at=datetime.utcnow(),
        )
        db.add(message)
        db.commit()
    finally:
        db.close()

    delivered = client.post("/webhooks/resend", json={"type": "email.delivered", "data": {"email_id": "resend-msg-1"}})
    assert delivered.status_code == 200
    assert delivered.json()["matched"] is True

    opened = client.post("/webhooks/resend", json={"type": "email.opened", "data": {"email_id": "resend-msg-1"}})
    assert opened.status_code == 200

    metrics = client.get("/api/dashboard", headers=AUTH).json()
    assert metrics["delivered"] >= 1
    assert metrics["opened"] >= 1
    assert metrics["open_rate"] > 0
    activity = client.get("/api/activity", headers=AUTH).json()
    assert any(item["action"] == "resend.email.delivered" for item in activity)

    lead_page = client.get("/api/leads?search=Webhook", headers=AUTH).json()
    assert lead_page["items"][0]["status"] == "Contacted"
    db = get_sessionmaker()()
    try:
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == workspace_id).first()
        assert settings is not None
        ai = settings.ai if isinstance(settings.ai, dict) else {}
        continuous_learning = ai.get("continuous_learning") if isinstance(ai.get("continuous_learning"), dict) else {}
        outcomes = continuous_learning.get("outcomes") if isinstance(continuous_learning.get("outcomes"), dict) else {}
        assert outcomes.get("sent", 0) >= 1
    finally:
        db.close()


def test_resend_webhook_handles_bounce_complaint_and_reply(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.webhooks.suggest_reply",
        lambda payload: type("Assistant", (), {"model_dump": lambda self: {"next_step": "Book meeting", "suggested_response": "Let's lock in a time", "qualification_score": 80}})(),
    )
    db = get_sessionmaker()()
    try:
        campaign = Campaign(user_id="dev_user", name="Reply Campaign", industry="Construction")
        db.add(campaign)
        db.flush()
        lead = Lead(user_id="dev_user", campaign_id=campaign.id, company="Reply Build Co", email="reply@example.com", status=LeadStatus.sent)
        db.add(lead)
        db.flush()
        company = Company(user_id="dev_user", lead_id=lead.id, name="Reply Build Co", source="crm")
        db.add(company)
        db.flush()
        message = EmailMessage(
            user_id="dev_user",
            campaign_id=campaign.id,
            lead_id=lead.id,
            direction="outbound",
            subject="Reply test",
            body="Hello",
            provider_message_id="resend-msg-2",
            delivery_status="sent",
            sent_at=datetime.utcnow(),
        )
        db.add(message)
        db.commit()
    finally:
        db.close()

    bounced = client.post("/webhooks/resend", json={"type": "email.bounced", "data": {"email_id": "resend-msg-2"}})
    assert bounced.status_code == 200
    complained = client.post("/webhooks/resend", json={"type": "email.complained", "data": {"email_id": "resend-msg-2"}})
    assert complained.status_code == 200
    replied = client.post("/webhooks/resend", json={"type": "email.received", "data": {"email_id": "resend-msg-2", "text": "Interested."}})
    assert replied.status_code == 200

    db = get_sessionmaker()()
    try:
        saved = db.query(EmailMessage).filter(EmailMessage.provider_message_id == "resend-msg-2").one()
        assert saved.delivery_status == "replied"
        assert saved.bounced_at is not None
        assert saved.replied_at is not None
        assert saved.reply_body == "Interested."
        sales_inbox = saved.reply_assistant.get("sales_inbox") if isinstance(saved.reply_assistant, dict) else None
        assert isinstance(sales_inbox, dict)
        assert sales_inbox.get("classified_as") == "Meeting Requested"
        assert sales_inbox.get("next_action")
        assert sales_inbox.get("recommended_reply")
        assert isinstance(sales_inbox.get("meeting_preparation"), dict)
        assert isinstance(sales_inbox.get("crm_update"), dict)
        assert isinstance(sales_inbox.get("task_creation"), dict)
        lead = db.get(Lead, saved.lead_id)
        assert lead and lead.status == LeadStatus.meeting
        inbound = db.query(EmailMessage).filter(EmailMessage.provider_message_id == "reply:resend-msg-2").one()
        assert inbound.direction == "inbound"
        assert inbound.tags["category"] == "Meeting Requested"
        company = db.query(Company).filter(Company.lead_id == saved.lead_id).order_by(Company.updated_at.desc()).first()
        assert company is not None
        metadata = company.metadata_json or {}
        assert isinstance(metadata.get("ai_sales_inbox_latest"), dict)
        assert isinstance(metadata.get("ai_sales_inbox_history"), list)
        assert metadata["ai_sales_inbox_latest"].get("classified_as") == "Meeting Requested"
        assert metadata["ai_sales_inbox_history"]
        task_note = (
            db.query(Note)
            .filter(Note.lead_id == saved.lead_id)
            .filter(Note.kind == "sales_inbox_task")
            .order_by(Note.created_at.desc())
            .first()
        )
        assert task_note is not None
        assert "Sales Inbox" in (task_note.body or "")
        settings = db.query(AppSettings).filter(AppSettings.user_id == "dev_user").first()
        assert settings is not None
        ai = settings.ai if isinstance(settings.ai, dict) else {}
        continuous_learning = ai.get("continuous_learning") if isinstance(ai.get("continuous_learning"), dict) else {}
        outcomes = continuous_learning.get("outcomes") if isinstance(continuous_learning.get("outcomes"), dict) else {}
        assert outcomes.get("reply", 0) >= 1
        assert outcomes.get("meeting", 0) >= 1
    finally:
        db.close()


def test_workspace_onboarding_usage_and_campaign_duplicate() -> None:
    workspace_response = client.get("/api/workspace", headers=AUTH)
    assert workspace_response.status_code == 200
    workspace = workspace_response.json()
    assert workspace["members"][0]["role"] == "Owner"

    onboarding = client.put(
        "/api/onboarding",
        headers=AUTH,
        json={
            "company": "OutreachAI",
            "industry": "B2B SaaS",
            "target_country": "United States",
            "target_customer": "real estate agencies",
            "connect_openai": True,
            "launch_first_campaign": True,
            "step": 6,
        },
    )
    assert onboarding.status_code == 200
    assert onboarding.json()["onboarding_completed"] is True

    campaign = client.post(
        "/api/campaigns",
        headers=AUTH,
        json={
            "name": "Commercial Sequence",
            "industry": "Real estate",
            "countries": ["United States"],
            "cities": ["Miami"],
            "offer": "book more seller appointments",
            "cta": "Book a call",
            "timezone": "America/New_York",
            "working_hours": "08:00-16:00",
            "daily_send_limit": 75,
            "sequence": [
                {"step_order": 1, "name": "Email #1", "subject": "Seller appointment idea", "body": "Intro", "delay_days": 0},
                {"step_order": 2, "name": "Follow-up #1", "subject": "Following up", "body": "Follow", "delay_days": 3},
                {"step_order": 3, "name": "Follow-up #2", "subject": "Second follow up", "body": "Follow 2", "delay_days": 7},
                {"step_order": 4, "name": "Follow-up #3", "subject": "Final follow up", "body": "Follow 3", "delay_days": 12},
            ],
        },
    ).json()
    assert campaign["sequence"][0]["name"] == "Email #1"
    assert campaign["working_hours"] == "08:00-16:00"
    assert campaign["daily_send_limit"] == 75

    duplicate = client.post(f"/api/campaigns/{campaign['id']}/duplicate", headers=AUTH)
    assert duplicate.status_code == 200
    assert duplicate.json()["name"].endswith("copy")

    usage = client.get("/api/billing/usage", headers=AUTH)
    assert usage.status_code == 200
    assert usage.json()["plan"] in {"Starter", "Pro"}

    admin = client.get("/api/admin/summary", headers=OWNER_AUTH)
    assert admin.status_code == 200
    assert "system_health" in admin.json()


def test_stripe_webhook_activates_subscription() -> None:
    future = int(time.time()) + 14 * 24 * 60 * 60
    workspace = client.get("/api/workspace", headers=AUTH).json()
    payload = {
        "id": "evt_test_checkout",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_live_test",
                "customer": "cus_live_test",
                "subscription": "sub_live_test",
                "metadata": {"user_id": "dev_user", "workspace_id": workspace["id"], "plan": "Pro"},
            }
        },
    }
    raw, signature = stripe_signature(payload)
    response = client.post("/webhooks/stripe", content=raw, headers={"stripe-signature": signature, "content-type": "application/json"})
    assert response.status_code == 200
    assert response.json()["type"] == "checkout.session.completed"

    db = get_sessionmaker()()
    try:
        subscription = db.query(Subscription).filter(Subscription.stripe_subscription_id == "sub_live_test").one()
        assert subscription.plan == "Pro"
        assert subscription.status == "active"
        assert subscription.plan_limits["leads"] == 5000
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == subscription.workspace_id).one()
        assert settings.billing["plan"] == "Pro"
        assert settings.billing["stripeCustomerId"] == "cus_live_test"
    finally:
        db.close()

    unsigned = client.post("/webhooks/stripe", json=payload)
    assert unsigned.status_code == 400

    update_payload = {
        "id": "evt_test_subscription",
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "id": "sub_live_test",
                "customer": "cus_live_test",
                "status": "trialing",
                "trial_end": future,
                "current_period_end": future,
                "metadata": {"user_id": "dev_user", "workspace_id": workspace["id"], "plan": "Agency"},
                "items": {"data": [{"price": {"id": "price_agency_test"}}]},
            }
        },
    }
    raw, signature = stripe_signature(update_payload)
    updated = client.post("/webhooks/stripe", content=raw, headers={"stripe-signature": signature, "content-type": "application/json"})
    assert updated.status_code == 200
    status = client.get("/api/billing/status", headers=AUTH)
    assert status.status_code == 200
    assert status.json()["plan"] == "Agency"
    assert status.json()["trial_days_remaining"] >= 13


def test_billing_checkout_creates_pending_subscription_session(monkeypatch) -> None:
    captured = {}

    def fake_checkout(user_id: str, workspace_id: str, plan: str, customer_id: str = "") -> dict:
        captured.update({"user_id": user_id, "workspace_id": workspace_id, "plan": plan, "customer_id": customer_id})
        return {"url": "https://checkout.stripe.test/session", "id": "cs_test_pending", "customer_id": customer_id or "cus_pending"}

    monkeypatch.setattr("app.api.routes.create_checkout_session", fake_checkout)
    response = client.post("/api/billing/checkout", headers=AUTH, json={"plan": "Starter"})
    assert response.status_code == 200
    assert response.json()["url"].startswith("https://checkout.stripe.test")
    assert captured["plan"] == "Starter"

    workspace = client.get("/api/workspace", headers=AUTH).json()
    db = get_sessionmaker()()
    try:
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == UUID(workspace["id"])).one()
        assert settings.billing["pendingPlan"] == "Starter"
        assert settings.billing["status"] in {"inactive", "active", "trialing"}
        assert settings.billing["checkoutSessionId"] == "cs_test_pending"
        assert settings.billing["stripeCustomerId"] in {"cus_pending", "cus_live_test"}
    finally:
        db.close()

    diagnostics = client.get("/api/billing/diagnostics", headers=AUTH)
    assert diagnostics.status_code == 200
    assert diagnostics.json()["starter_price_id_loaded"] is True
    assert "checkout_session_creation_works" in diagnostics.json()
    assert "subscription_sync_healthy" in diagnostics.json()


def test_stripe_invoice_payment_failed_records_reason_and_keeps_access_inactive() -> None:
    workspace = client.get("/api/workspace", headers={"Authorization": "Bearer dev", "X-Test-User-Email": "payment-failure@example.com"}).json()
    subscription_payload = {
        "id": "evt_test_payment_failure_subscription",
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "id": "sub_payment_failure_test",
                "customer": "cus_payment_failure_test",
                "status": "incomplete",
                "metadata": {"user_id": "payment-failure", "workspace_id": workspace["id"], "plan": "Pro"},
                "items": {"data": [{"price": {"id": "price_pro_test"}}]},
            }
        },
    }
    raw, signature = stripe_signature(subscription_payload)
    created = client.post("/webhooks/stripe", content=raw, headers={"stripe-signature": signature, "content-type": "application/json"})
    assert created.status_code == 200

    failed_payload = {
        "id": "evt_test_invoice_failed",
        "type": "invoice.payment_failed",
        "data": {
            "object": {
                "id": "in_payment_failure_test",
                "customer": "cus_payment_failure_test",
                "subscription": "sub_payment_failure_test",
                "status": "open",
                "payment_intent": {
                    "id": "pi_payment_failure_test",
                    "status": "requires_payment_method",
                    "last_payment_error": {
                        "type": "card_error",
                        "decline_code": "insufficient_funds",
                        "message": "Your card has insufficient funds.",
                    },
                },
            }
        },
    }
    raw, signature = stripe_signature(failed_payload)
    failed = client.post("/webhooks/stripe", content=raw, headers={"stripe-signature": signature, "content-type": "application/json"})
    assert failed.status_code == 200

    db = get_sessionmaker()()
    try:
        subscription = db.query(Subscription).filter(Subscription.stripe_subscription_id == "sub_payment_failure_test").one()
        assert subscription.status == "past_due"
        assert subscription.last_decline_code == "insufficient_funds"
        assert subscription.last_failure_message == "Your card has insufficient funds."
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == subscription.workspace_id).one()
        assert settings.billing["status"] == "past_due"
        assert settings.billing["lastDeclineCode"] == "insufficient_funds"
    finally:
        db.close()

    status = client.get("/api/billing/status", headers={"Authorization": "Bearer dev", "X-Test-User-Email": "payment-failure@example.com"})
    assert status.status_code == 200
    data = status.json()
    assert data["status"] == "past_due"
    assert data["last_decline_code"] == "insufficient_funds"
    assert data["last_failure_message"] == "Your card has insufficient funds."


def test_starter_plan_blocks_sales_employee_limits_and_semi_auto_mode() -> None:
    workspace = client.get("/api/workspace", headers=AUTH).json()
    db = get_sessionmaker()()
    try:
        db.query(AISalesEmployee).filter(AISalesEmployee.workspace_id == UUID(workspace["id"])).delete()
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == UUID(workspace["id"])).one()
        settings.billing = {**(settings.billing or {}), "plan": "Starter", "status": "active"}
        db.commit()
    finally:
        db.close()

    payload = {
        "name": "Starter Ava",
        "role": "AI Sales Employee",
        "product_service": "AI outbound",
        "target_customer": "Small businesses",
        "target_countries": ["Germany"],
        "target_industries": ["B2B SaaS"],
        "offer": "book qualified calls",
        "cta": "Book a call",
        "sending_mode": "Review Mode",
        "daily_limit": 10,
        "working_hours": "09:00-17:00",
        "tone": "Professional",
        "language": "English",
        "signature": "Ava",
    }
    first = client.post("/api/sales-employees", headers=AUTH, json=payload)
    assert first.status_code == 200
    second = client.post("/api/sales-employees", headers=AUTH, json={**payload, "name": "Second Ava"})
    assert second.status_code == 402
    assert "Upgrade in Billing" in second.json()["detail"]
    semi_auto = client.put(f"/api/sales-employees/{first.json()['id']}", headers=AUTH, json={**payload, "sending_mode": "Semi-Auto Mode"})
    assert semi_auto.status_code == 402
    assert "Semi-Automatic Campaigns" in semi_auto.json()["detail"]


def test_billing_sync_latest_subscription_repairs_paid_workspace(monkeypatch) -> None:
    future = int(time.time()) + 14 * 24 * 60 * 60
    workspace = client.get("/api/workspace", headers=AUTH).json()
    stripe_subscription = {
        "id": "sub_sync_live",
        "customer": "cus_sync_live",
        "status": "trialing",
        "trial_end": future,
        "current_period_end": future,
        "metadata": {"user_id": "dev_user", "workspace_id": workspace["id"], "plan": "Pro"},
        "items": {"data": [{"price": {"id": "price_pro_test"}}]},
        "created": future - 60,
    }
    customer = type("StripeCustomer", (), {"id": "cus_sync_live"})()
    calls = []

    def fake_latest_subscription(customer_id: str = "", customer_email: str = "") -> tuple[object, dict]:
        calls.append({"customer_id": customer_id, "customer_email": customer_email})
        return customer, stripe_subscription

    monkeypatch.setattr("app.api.routes.latest_subscription_for_customer", fake_latest_subscription)

    response = client.post("/api/billing/sync-latest-subscription", headers=AUTH, json={"customer_email": "buyer@example.com"})
    assert response.status_code == 200
    data = response.json()
    assert data["synced"] is True
    assert data["plan"] == "Pro"
    assert data["status"] == "trialing"
    assert data["stripe_customer_id"] == "cus_sync_live"
    assert data["stripe_subscription_id"] == "sub_sync_live"
    assert data["price_id_loaded"] is True
    assert calls[-1]["customer_email"] == "buyer@example.com"

    db = get_sessionmaker()()
    try:
        subscription = db.query(Subscription).filter(Subscription.stripe_subscription_id == "sub_sync_live").one()
        assert subscription.workspace_id == UUID(workspace["id"])
        assert subscription.plan == "Pro"
        assert subscription.status == "trialing"
        assert subscription.plan_limits["leads"] == 5000
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == UUID(workspace["id"])).one()
        assert settings.billing["plan"] == "Pro"
        assert settings.billing["status"] == "trialing"
        assert settings.billing["stripeCustomerId"] == "cus_sync_live"
        assert settings.billing["stripeSubscriptionId"] == "sub_sync_live"
        assert settings.billing["stripePriceId"] == "price_pro_test"
        before_count = db.query(Subscription).filter(Subscription.stripe_subscription_id == "sub_sync_live").count()
    finally:
        db.close()

    second = client.post("/api/billing/sync-latest-subscription", headers=AUTH, json={"stripe_customer_id": "cus_sync_live"})
    assert second.status_code == 200
    assert calls[-1]["customer_id"] == "cus_sync_live"

    db = get_sessionmaker()()
    try:
        after_count = db.query(Subscription).filter(Subscription.stripe_subscription_id == "sub_sync_live").count()
        assert after_count == before_count
    finally:
        db.close()

    status = client.get("/api/billing/status", headers=AUTH)
    assert status.status_code == 200
    assert status.json()["plan"] == "Pro"
    assert status.json()["limits"]["leads"] == 5000
    assert status.json()["stripe_customer_id"] == "cus_sync_live"
    assert status.json()["stripe_subscription_id"] == "sub_sync_live"


def test_growth_engine_returns_briefing_and_persists_goal() -> None:
    briefing = client.get("/api/growth-engine", headers=AUTH)
    assert briefing.status_code == 200
    data = briefing.json()
    assert data["briefing"]["date"]
    assert data["opportunity_feed"]
    assert data["smart_recommendations"]
    assert data["proactive_mode"][0]["approval_required"] is True
    assert data["goal"]["target_meetings"] >= 1

    goal = client.post("/api/growth-engine/goal", headers=AUTH, json={"goal": "I want 12 meetings this month."})
    assert goal.status_code == 200
    assert goal.json()["target_meetings"] == 12

    refreshed = client.get("/api/growth-engine", headers=AUTH)
    assert refreshed.status_code == 200
    assert refreshed.json()["goal"]["goal"] == "I want 12 meetings this month."


def test_autonomous_acquisition_run_imports_qualifies_sends_and_logs(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.acquisition.find_leads",
        lambda payload: [
            LeadOut(
                company="Autonomous Revenue Co",
                website="https://autonomous-revenue.example",
                industry=payload.industry,
                country=payload.country,
                city="Berlin",
                contact="Ava Buyer",
                email="ava.autonomous@example.com",
                notes="source: Apollo",
            )
        ],
    )
    monkeypatch.setattr(
        "app.services.acquisition.sales_copilot",
        lambda payload: SalesCopilotOut(
            probability_to_reply=81,
            probability_to_buy=43,
            best_first_contact="Founder email",
            best_subject_line="Pipeline idea",
            best_cta="Book a meeting",
            estimated_revenue=18000,
            reasoning=["High fit"],
        ),
    )
    monkeypatch.setattr(
        "app.services.acquisition.personalize_email",
        lambda payload: EmailVariantOut(
            subject="Pipeline idea for Autonomous Revenue Co",
            preview="A short idea",
            full_email="Hi Ava, I found a specific growth opportunity.",
            cta="Book a meeting",
            follow_ups=["Worth a quick look?", "Should I send details?"],
            ab_tests=[],
        ),
    )
    monkeypatch.setattr("app.services.acquisition.collect_website", lambda url: type("Snapshot", (), {"url": url, "title": "Autonomous Revenue", "meta_description": "Revenue team", "text": "Book a demo Contact us", "technologies": ["Next.js"]})())
    monkeypatch.setattr(
        "app.services.acquisition.analyze_company_website",
        lambda **kwargs: type(
            "Analysis",
            (),
            {
                "company": kwargs["company"],
                "website": kwargs["website"],
                "description": "Revenue operations",
                "industry": "B2B SaaS",
                "location": "Germany",
                "niche": "B2B SaaS",
                "products_services": ["Revenue ops"],
                "services": ["Revenue ops"],
                "technologies": ["Next.js"],
                "strengths": ["Clear offer"],
                "weaknesses": ["Weak proof"],
                "icp_score": 82,
                "summary": "Strong ICP fit.",
            },
        )(),
    )
    monkeypatch.setattr("app.services.acquisition.send_email", lambda **kwargs: {"id": "auto-email-1"})

    workspace = client.get("/api/workspace", headers=AUTH).json()
    client.put(
        "/api/workspace",
        headers=AUTH,
        json={
            "name": "Autonomous Workspace",
            "company": "OutreachAI",
            "industry": "B2B SaaS",
            "target_country": "Germany",
            "target_customer": "SaaS founders",
            "timezone": "Europe/Berlin",
            "language": "English",
        },
    )
    response = client.post(
        f"/api/automation/run?workspace_id={workspace['id']}",
        headers={"X-Automation-Secret": "automation_test"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["workspaces_processed"] == 1
    assert data["leads_imported"] == 1
    assert data["leads_qualified"] == 1
    assert data["emails_generated"] == 1
    assert data["emails_sent"] == 1

    lead_page = client.get("/api/leads?search=Autonomous", headers=AUTH).json()
    assert lead_page["items"][0]["status"] == "Contacted"
    dashboard = client.get("/api/dashboard", headers=AUTH).json()
    assert dashboard["emails_sent"] >= 1
    activity = client.get("/api/activity", headers=AUTH).json()
    assert any(item["action"] == "automation.email_sent" for item in activity)

    unauthorized = client.post("/api/automation/run", headers={"X-Automation-Secret": "wrong"})
    assert unauthorized.status_code == 401


def test_ai_employee_task_results_persist_csv_and_block_external_send(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.plan_sales_employee_task",
        lambda payload: {
            "goal": payload["command"],
            "intent": "lead_discovery",
            "priority": "High",
            "required_tools": ["Lead Importer", "Outreach Draft Builder"],
            "estimated_execution_time": "2 minutes",
            "expected_result": "A reviewed list of rental companies with outreach drafts.",
            "steps": ["Search companies", "Store result report", "Prepare drafts", "Wait for approval"],
            "external_actions": ["send_email_after_approval"],
            "safety_notes": ["No email is sent automatically."],
            "memory_updates": ["Rental companies in Monaco"],
        },
    )
    workspace = client.get("/api/workspace", headers=AUTH).json()
    db = get_sessionmaker()()
    try:
        db.query(AISalesEmployee).filter(AISalesEmployee.workspace_id == UUID(workspace["id"])).delete()
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == UUID(workspace["id"])).one()
        settings.billing = {**(settings.billing or {}), "plan": "Pro", "status": "active"}
        db.commit()
    finally:
        db.close()

    employee = client.post(
        "/api/sales-employees",
        headers=AUTH,
        json={
            "name": "Monaco Ava",
            "role": "AI Sales Employee",
            "product_service": "Outbound for service businesses",
            "target_customer": "Rental companies",
            "target_countries": ["Monaco"],
            "target_industries": ["Rental"],
            "offer": "book more qualified local customers",
            "cta": "Book a growth review",
            "sending_mode": "Review Mode",
            "daily_limit": 10,
            "working_hours": "09:00-17:00",
            "tone": "Professional",
            "language": "English",
            "signature": "Ava",
        },
    )
    assert employee.status_code == 200
    employee_id = employee.json()["id"]

    plan = client.post(f"/api/sales-employees/{employee_id}/plan", headers=AUTH, json={"command": "Find 3 rental companies in Monaco", "transcript_source": "text"})
    assert plan.status_code == 200
    approved = client.post(f"/api/sales-employees/{employee_id}/approve-plan", headers=AUTH, json={"plan_id": plan.json()["id"], "action": "approve"})
    assert approved.status_code == 200
    executed = client.post(f"/api/sales-employees/{employee_id}/execute-plan", headers=AUTH, json={"plan_id": plan.json()["id"], "action": "approve"})
    assert executed.status_code == 200
    task = executed.json()
    assert task["status"] == "finished"
    assert task["result_preview"]["companies_found"] == 3
    assert task["result_preview"]["prepared_emails"] == 3

    details = client.get(f"/api/sales-employees/tasks/{task['id']}", headers=AUTH)
    assert details.status_code == 200
    report = details.json()["result_json"]
    assert len(report["companies_found"]) == 3
    assert report["companies_found"][0]["email"] == "Not found"
    assert report["companies_found"][0]["phone"] == "Not found"
    assert report["prepared_emails"]
    assert report["external_actions_blocked"] is True
    assert report["failure_reason"] == ""

    csv_response = client.get(f"/api/sales-employees/tasks/{task['id']}/csv", headers=AUTH)
    assert csv_response.status_code == 200
    assert "company_name,website,country,city,industry,phone,email,source,confidence_score,short_description,why_matched" in csv_response.text
    assert "Rental Prospect 1" in csv_response.text

    send_approval = client.post(f"/api/sales-employees/tasks/{task['id']}/approve-send", headers=AUTH)
    assert send_approval.status_code == 200
    assert "remain blocked" in send_approval.json()["message"]

    empty_plan = client.post(f"/api/sales-employees/{employee_id}/plan", headers=AUTH, json={"command": "Analyse my last campaign", "transcript_source": "text"})
    assert empty_plan.status_code == 200
    empty_approved = client.post(f"/api/sales-employees/{employee_id}/approve-plan", headers=AUTH, json={"plan_id": empty_plan.json()["id"], "action": "approve"})
    assert empty_approved.status_code == 200
    empty_executed = client.post(f"/api/sales-employees/{employee_id}/execute-plan", headers=AUTH, json={"plan_id": empty_plan.json()["id"], "action": "approve"})
    assert empty_executed.status_code == 200
    empty_details = client.get(f"/api/sales-employees/tasks/{empty_executed.json()['id']}", headers=AUTH)
    assert empty_details.status_code == 200
    empty_report = empty_details.json()["result_json"]
    assert empty_report["companies_found"] == []
    assert empty_report["failure_reason"]
    assert empty_report["empty_result_details"]["searched"]["country"] == "Monaco"

    db = get_sessionmaker()()
    try:
        sent = db.query(EmailMessage).filter(EmailMessage.tags["task_id"].as_string() == task["id"], EmailMessage.sent_at.is_not(None)).count()
        assert sent == 0
    finally:
        db.close()


def test_ai_ceo_voice_briefing_persists_history_and_stays_read_only() -> None:
    for length in ["30 sec", "1 min", "3 min", "10 min"]:
        for language in ["English", "Russian", "Spanish", "French", "Italian", "Polish"]:
            briefing = client.post("/api/ai-ceo/briefings", headers=AUTH, json={"length": length, "language": language})
            assert briefing.status_code == 200
            data = briefing.json()
            assert data["transcript"]
            assert data["length"] == length
            assert data["language"] == language
            assert data["title"].startswith("AI CEO")
            assert data["summary_json"]["safety"] == "report_only"
            assert len(data["summary_json"]["top_priorities"]) == 3
            if language == "English":
                assert "will not launch campaigns" in data["transcript"]

    history = client.get("/api/ai-ceo/briefings", headers=AUTH)
    assert history.status_code == 200
    assert len(history.json()) >= 24

    answer = client.post("/api/ai-ceo/question", headers=AUTH, json={"question": "How much revenue did we create?", "language": "English"})
    assert answer.status_code == 200
    assert "Revenue" in answer.json()["answer"]
    assert "cannot launch campaigns" in answer.json()["safety_notice"]


def test_ai_sales_employee_review_mode_imports_qualifies_drafts_and_approves(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.qualify_for_sales_employee",
        lambda payload: {
            "industry": "B2B SaaS",
            "services": ["Revenue automation"],
            "pain_points": ["Manual prospecting", "Slow follow-up"],
            "icp_score": 84,
            "purchase_probability": 47,
            "best_sales_angle": "Position automated lead qualification as pipeline leverage.",
            "best_cta": "Book a pipeline review",
            "recommended_plan": "Pro",
            "summary": "Strong ICP fit for an AI sales employee.",
        },
    )
    monkeypatch.setattr(
        "app.api.routes.personalize_email",
        lambda payload: EmailVariantOut(
            subject="Pipeline review for Review Mode Co",
            preview="A safe AI sales employee idea",
            full_email="Hi Riley, I found a way to remove manual prospecting from your week.",
            cta="Book a pipeline review",
            follow_ups=["Worth reviewing?", "Should I send the workflow?"],
            ab_tests=[],
        ),
    )
    workspace = client.get("/api/workspace", headers=AUTH).json()
    db = get_sessionmaker()()
    try:
        db.query(AISalesEmployee).filter(AISalesEmployee.workspace_id == UUID(workspace["id"])).delete()
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == UUID(workspace["id"])).one()
        settings.billing = {**(settings.billing or {}), "plan": "Pro", "status": "active"}
        db.commit()
    finally:
        db.close()

    employee_response = client.post(
        "/api/sales-employees",
        headers=AUTH,
        json={
            "name": "Ava",
            "role": "AI Sales Employee",
            "product_service": "AI sales automation for B2B SaaS",
            "target_customer": "SaaS founders",
            "target_countries": ["Germany"],
            "target_industries": ["B2B SaaS"],
            "offer": "automate qualified sales conversations",
            "cta": "Book a pipeline review",
            "sending_mode": "Review Mode",
            "daily_limit": 10,
            "working_hours": "09:00-17:00",
            "tone": "Consultative",
            "language": "English",
            "signature": "Ava at OutreachAI",
        },
    )
    assert employee_response.status_code == 200
    employee = employee_response.json()
    assert employee["sending_mode"] == "Review Mode"

    leads_response = client.post(
        f"/api/sales-employees/{employee['id']}/leads/manual",
        headers=AUTH,
        json={
            "companies": [
                {
                    "company": "Review Mode Co",
                    "website": "https://review-mode.example",
                    "industry": "B2B SaaS",
                    "country": "Germany",
                    "contact": "Riley",
                    "email": "riley@review-mode.example",
                    "status": "New",
                }
            ]
        },
    )
    assert leads_response.status_code == 200
    lead = leads_response.json()[0]
    assert lead["sales_employee_id"] == employee["id"]

    insight_response = client.post(f"/api/sales-employees/{employee['id']}/leads/{lead['id']}/qualify", headers=AUTH)
    assert insight_response.status_code == 200
    insight = insight_response.json()
    assert insight["icp_score"] == 84
    assert insight["recommended_plan"] == "Pro"

    draft_response = client.post(f"/api/sales-employees/{employee['id']}/leads/{lead['id']}/draft-email", headers=AUTH)
    assert draft_response.status_code == 200
    draft = draft_response.json()
    assert draft["delivery_status"] == "pending_approval"
    assert draft["tags"]["requires_approval"] is True

    approve_response = client.post(f"/api/sales-employees/{employee['id']}/emails/{draft['id']}/approve", headers=AUTH)
    assert approve_response.status_code == 200
    assert approve_response.json()["delivery_status"] == "approved"

    run_response = client.post(f"/api/sales-employees/{employee['id']}/run", headers=AUTH)
    assert run_response.status_code == 200
    assert run_response.json()["mode"] == "Review Mode"


def test_ai_sales_employee_voice_task_plans_requires_approval_and_executes(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.plan_sales_employee_task",
        lambda payload: {
            "goal": "Find 5 German construction companies.",
            "intent": "lead_discovery",
            "priority": "High",
            "required_tools": ["Lead Finder", "Website Analyzer", "AI Email Generator"],
            "estimated_execution_time": "3 minutes",
            "expected_result": "Five qualified leads ready for review.",
            "steps": ["Search companies", "Filter ICP", "Analyze websites", "Wait for approval"],
            "requires_approval": True,
            "external_actions": ["modify_crm_after_approval"],
            "safety_notes": ["No email will be sent without approval."],
            "memory_updates": ["construction", "Germany"],
        },
    )
    workspace = client.get("/api/workspace", headers=AUTH).json()
    db = get_sessionmaker()()
    try:
        db.query(AISalesEmployee).filter(AISalesEmployee.workspace_id == UUID(workspace["id"])).delete()
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == UUID(workspace["id"])).one()
        settings.billing = {**(settings.billing or {}), "plan": "Pro", "status": "active"}
        db.commit()
    finally:
        db.close()

    employee_response = client.post(
        "/api/sales-employees",
        headers=AUTH,
        json={
            "name": "Mila",
            "role": "AI Sales Employee",
            "product_service": "AI outbound for construction suppliers",
            "target_customer": "Construction companies",
            "target_countries": ["Germany"],
            "target_industries": ["Construction"],
            "offer": "book qualified calls",
            "cta": "Book a pipeline review",
            "sending_mode": "Review Mode",
            "daily_limit": 10,
            "working_hours": "09:00-17:00",
            "tone": "Professional",
            "language": "English",
            "signature": "Mila",
        },
    )
    assert employee_response.status_code == 200
    employee = employee_response.json()

    plan_response = client.post(
        f"/api/sales-employees/{employee['id']}/plan",
        headers=AUTH,
        json={"command": "Find 5 construction companies in Germany.", "transcript_source": "voice"},
    )
    assert plan_response.status_code == 200
    plan = plan_response.json()
    assert plan["requires_approval"] is True
    assert plan["status"] == "waiting_approval"
    assert "Lead Finder" in plan["required_tools"]

    blocked = client.post(
        f"/api/sales-employees/{employee['id']}/execute-plan",
        headers=AUTH,
        json={"plan_id": plan["id"], "action": "approve"},
    )
    assert blocked.status_code == 409

    approved = client.post(
        f"/api/sales-employees/{employee['id']}/approve-plan",
        headers=AUTH,
        json={"plan_id": plan["id"], "action": "approve"},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    executed = client.post(
        f"/api/sales-employees/{employee['id']}/execute-plan",
        headers=AUTH,
        json={"plan_id": plan["id"], "action": "approve"},
    )
    assert executed.status_code == 200
    assert executed.json()["status"] == "finished"
    assert "Finished" in executed.json()["progress"]

    leads = client.get(f"/api/sales-employees/{employee['id']}/leads", headers=AUTH)
    assert leads.status_code == 200
    assert len(leads.json()) == 5
    memory = client.get(f"/api/sales-employees/{employee['id']}/memory", headers=AUTH)
    assert memory.status_code == 200
    assert "Germany" in memory.json()["countries"]


def test_ai_team_router_splits_multi_employee_task_and_requires_approval(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.routes.route_ai_team_task",
        lambda payload: {
            "detected_intent": "lead_discovery_and_marketing_content",
            "primary_employee": "Sales",
            "assigned_employees": ["Sales", "Marketing"],
            "priority": "High",
            "risk_level": "Medium",
            "estimated_execution_time": "6 minutes",
            "subtasks": [
                {
                    "id": "1",
                    "employee": "Sales",
                    "title": "Find qualified clients",
                    "objective": "Find construction companies in Germany and prepare outreach.",
                    "required_tools": ["Lead Finder", "Website Analyzer"],
                    "expected_result": "Prospects ready for review.",
                    "risk_level": "Medium",
                    "required_approval": True,
                    "status": "waiting_approval",
                    "result": "",
                },
                {
                    "id": "2",
                    "employee": "Marketing",
                    "title": "Create posts",
                    "objective": "Create LinkedIn posts for the same SaaS offer.",
                    "required_tools": ["Content Planner"],
                    "expected_result": "LinkedIn post angles ready for review.",
                    "risk_level": "Low",
                    "required_approval": True,
                    "status": "waiting_approval",
                    "result": "",
                },
            ],
            "safety_notes": ["No external action without approval."],
        },
    )

    response = client.post(
        "/api/team-router/route",
        headers=AUTH,
        json={"command": "Find clients and create marketing posts", "transcript_source": "text"},
    )
    assert response.status_code == 200
    plan = response.json()
    assert plan["required_approval"] is True
    assert plan["assigned_employees"] == ["Sales", "Marketing"]
    assert len(plan["subtasks"]) == 2

    blocked = client.post("/api/team-router/execute", headers=AUTH, json={"plan_id": plan["id"], "action": "approve"})
    assert blocked.status_code == 409

    approved = client.post("/api/team-router/approve", headers=AUTH, json={"plan_id": plan["id"], "action": "approve"})
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    executed = client.post("/api/team-router/execute", headers=AUTH, json={"plan_id": plan["id"], "action": "approve"})
    assert executed.status_code == 200
    executed_plan = executed.json()
    assert executed_plan["status"] == "finished"
    assert all(subtask["result"] for subtask in executed_plan["subtasks"])

    dashboard = client.get("/api/team-router", headers=AUTH)
    assert dashboard.status_code == 200
    employees = {item["employee"]: item for item in dashboard.json()["employees"]}
    assert {"Sales", "Marketing", "Support", "Operations"}.issubset(employees)
    assert employees["Sales"]["completed_tasks"] >= 1
    assert employees["Marketing"]["completed_tasks"] >= 1
