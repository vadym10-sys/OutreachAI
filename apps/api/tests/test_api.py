from pathlib import Path
from datetime import datetime
import base64
import hashlib
import hmac
import json
import tempfile
import os
import time
from uuid import UUID

from fastapi.testclient import TestClient
from fastapi import HTTPException
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt as jose_jwt

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
os.environ["OPENAI_API_KEY"] = "openai_test"
os.environ["RESEND_API_KEY"] = "resend_test"
os.environ["RESEND_FROM_EMAIL"] = "OutreachAI <hello@example.com>"

from app.core.database import Base, get_engine, get_sessionmaker  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core import security  # noqa: E402
from app.models.entities import AISalesEmployee, AppSettings, Campaign, EmailMessage, Lead, LeadStatus, Subscription  # noqa: E402
from app.schemas.dto import CampaignAnalyticsOut, EmailVariantOut, FollowUpSequenceOut, LeadOut, MeetingPrepOut, SalesCopilotOut, WebsiteAuditOut  # noqa: E402
from app.main import app  # noqa: E402

Base.metadata.create_all(bind=get_engine())

client = TestClient(app)
AUTH = {"Authorization": "Bearer dev"}


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


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


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
    monkeypatch.setattr(
        "app.api.routes.find_leads",
        lambda payload: [
            LeadOut(
                company="Austin Commercial Build",
                website="https://example.com",
                industry=payload.industry or payload.niche,
                country=payload.country,
                city=payload.city,
                email="hello@example.com",
                notes="source: deterministic provider test",
            )
        ],
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
            "website": "https://example.com",
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
    assert list_response.json()["total"] == 1

    dashboard_response = client.get("/api/dashboard", headers=AUTH)
    assert dashboard_response.status_code == 200
    metrics = dashboard_response.json()
    assert metrics["leads"] >= 1
    assert metrics["campaigns"] >= 1


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


def test_resend_webhook_updates_delivery_metrics() -> None:
    db = get_sessionmaker()()
    try:
        campaign = Campaign(user_id="dev_user", name="Webhook Campaign", industry="Construction")
        db.add(campaign)
        db.flush()
        lead = Lead(
            user_id="dev_user",
            campaign_id=campaign.id,
            company="Webhook Build Co",
            email="webhook@example.com",
            status=LeadStatus.sent,
        )
        db.add(lead)
        db.flush()
        message = EmailMessage(
            user_id="dev_user",
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


def test_resend_webhook_handles_bounce_complaint_and_reply(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.api.webhooks.suggest_reply",
        lambda payload: type("Assistant", (), {"model_dump": lambda self: {"next_step": "Book meeting", "qualification_score": 80}})(),
    )
    db = get_sessionmaker()()
    try:
        campaign = Campaign(user_id="dev_user", name="Reply Campaign", industry="Construction")
        db.add(campaign)
        db.flush()
        lead = Lead(user_id="dev_user", campaign_id=campaign.id, company="Reply Build Co", email="reply@example.com", status=LeadStatus.sent)
        db.add(lead)
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
        lead = db.get(Lead, saved.lead_id)
        assert lead and lead.status == LeadStatus.meeting
        inbound = db.query(EmailMessage).filter(EmailMessage.provider_message_id == "reply:resend-msg-2").one()
        assert inbound.direction == "inbound"
        assert inbound.tags["category"] == "Meeting"
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

    admin = client.get("/api/admin/summary", headers=AUTH)
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
