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

import pytest
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
os.environ["HUNTER_API_KEY"] = "hunter_test"
os.environ["GOOGLE_MAPS_API_KEY"] = "google_maps_test"
os.environ["OPENAI_API_KEY"] = "openai_test"
os.environ["RESEND_API_KEY"] = "resend_test"
os.environ["RESEND_FROM_EMAIL"] = "OutreachAI <hello@example.com>"

from app.core.database import Base, get_engine, get_sessionmaker  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core import security  # noqa: E402
from app.models.entities import AISalesEmployee, AppSettings, Campaign, EmailMessage, Lead, LeadStatus, Subscription  # noqa: E402
from app.schemas.dto import AnalysisOut, CampaignAnalyticsOut, EmailVariantOut, FollowUpSequenceOut, LeadOut, MeetingPrepOut, SalesCopilotOut, WebsiteAuditOut  # noqa: E402
from app.services.apollo import ApolloRequestError, ApolloSearchResult  # noqa: E402
from app.services.google_maps import GoogleMapsRequestError, GooglePlacesSearchResult  # noqa: E402
from app.services.hunter import HunterRequestError  # noqa: E402
from app.main import app  # noqa: E402

Base.metadata.create_all(bind=get_engine())

client = TestClient(app)
AUTH = {"Authorization": "Bearer dev"}
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


def test_lead_finder_persists_ai_intelligence_from_website_analysis(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.enrich_leads_with_hunter", lambda leads: leads)
    monkeypatch.setattr(
        "app.api.routes.collect_website",
        lambda url: type(
            "Snapshot",
            (),
            {
                "url": "https://intelligence-build.example",
                "title": "Intelligence Build",
                "meta_description": "Commercial construction services",
                "text": "Commercial construction, renovation, project management, contact us",
                "technologies": ["WordPress"],
            },
        )(),
    )
    monkeypatch.setattr(
        "app.api.routes.analyze_company_website",
        lambda **kwargs: AnalysisOut(
            company="Intelligence Build GmbH",
            website="https://intelligence-build.example",
            description="Commercial construction services",
            industry="Construction",
            location="Berlin, Germany",
            niche="Commercial construction",
            products_services=["Renovation", "Project management"],
            services=["Renovation", "Project management"],
            technologies=["WordPress"],
            strengths=["Clear services"],
            weaknesses=["Weak CTA"],
            icp_score=82,
            summary="A Berlin construction firm with a clear commercial services offer.",
            icp="Owner-led commercial construction companies",
            value_proposition="Reliable commercial renovation delivery",
            detected_language="English",
            target_geography="Germany",
            sales_angle="Turn website traffic into qualified project calls.",
            company_summary="Intelligence Build serves commercial renovation buyers in Germany.",
            suggested_offer="Offer a booked-project consultation system.",
            outreach_strategy="Lead with the weak CTA and propose a short growth audit.",
            recommended_tone="Consultative",
            recommended_cta="Book a 15 minute growth audit",
            follow_up_strategy="Follow up with one website-specific improvement.",
            expected_reply_rate="8-12%",
        ),
    )
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
    assert lead["ai_summary"] == "Intelligence Build serves commercial renovation buyers in Germany."
    assert lead["suggested_offer"] == "Offer a booked-project consultation system."
    assert lead["outreach_strategy"] == "Lead with the weak CTA and propose a short growth audit."
    assert lead["sales_angle"] == "Turn website traffic into qualified project calls."
    assert lead["expected_reply_rate"] == "8-12%"


def test_google_maps_missing_key_blocks_lead_finder(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "")
    get_settings.cache_clear()
    response = client.post("/api/leads/find", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 503
    assert "Google Maps is not connected" in response.json()["detail"]
    get_settings.cache_clear()


def test_google_maps_timeout_returns_user_safe_error(monkeypatch) -> None:
    monkeypatch.setattr("app.api.routes.search_google_places", lambda payload: (_ for _ in ()).throw(GoogleMapsRequestError("Google Maps is temporarily unavailable after retries.")))
    response = client.post("/api/leads/find", headers=AUTH, json={"industry": "Construction", "country": "Germany", "city": "Berlin"})
    assert response.status_code == 502
    assert "Google Maps is temporarily unavailable" in response.json()["detail"]


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
    assert second.json() == []


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
    assert "Apollo rejected" in response.json()["last_error"]
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
    assert "Hunter rejected" in response.json()["last_error"]
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
    assert "temporarily unavailable" in response.json()["detail"]


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
    assert second.json() == []


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
        json={"company": "Manual Draft Build", "website": "https://manual-draft.example", "industry": "Construction"},
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
