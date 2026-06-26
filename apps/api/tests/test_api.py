from pathlib import Path
from datetime import datetime
import hashlib
import hmac
import json
import tempfile
import os
import time

from fastapi.testclient import TestClient

db_path = Path(tempfile.gettempdir()) / "outreachai-api-tests.db"
if db_path.exists():
    db_path.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["AUTO_CREATE_TABLES"] = "true"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_test"
os.environ["AUTOMATION_SECRET"] = "automation_test"
os.environ["APOLLO_API_KEY"] = "apollo_test"
os.environ["OPENAI_API_KEY"] = "openai_test"
os.environ["RESEND_API_KEY"] = "resend_test"
os.environ["RESEND_FROM_EMAIL"] = "OutreachAI <hello@example.com>"

from app.core.database import Base, get_engine, get_sessionmaker  # noqa: E402
from app.models.entities import AppSettings, Campaign, EmailMessage, Lead, LeadStatus, Subscription  # noqa: E402
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


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


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
    assert usage.json()["plan"] == "Starter"

    admin = client.get("/api/admin/summary", headers=AUTH)
    assert admin.status_code == 200
    assert "system_health" in admin.json()


def test_stripe_webhook_activates_subscription() -> None:
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
        settings = db.query(AppSettings).filter(AppSettings.workspace_id == subscription.workspace_id).one()
        assert settings.billing["plan"] == "Pro"
        assert settings.billing["stripeCustomerId"] == "cus_live_test"
    finally:
        db.close()

    unsigned = client.post("/webhooks/stripe", json=payload)
    assert unsigned.status_code == 400


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
