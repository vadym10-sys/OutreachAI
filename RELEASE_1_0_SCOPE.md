# Release 1.0 Scope

Date: 2026-07-13
Status: Candidate Release (awaiting approval before deployment)

## Scope Rule

Release 1.0 includes only:

- production stability fixes
- billing hardening
- backend hardening
- queue reliability
- worker reliability
- customer activation
- onboarding improvements
- sender reliability
- first-email workflow
- production readiness fixes

No new product capabilities are included.

## Exact Commits Included in Release 1.0

1. a880c81 - feat(web): harden onboarding workspace setup flow
2. df357ba - fix(web): unblock first-send sender setup recovery
3. d38d3b5 - fix(web): prevent false sender setup success
4. 661cb59 - fix(web): clarify follow-up save step
5. 0a9ef32 - fix(web): clarify first-send success stage
6. 75d095d - fix(web): remove dead-end sender providers
7. 18503e7 - Harden billing lifecycle transitions
8. 605b6d3 - fix(api): harden startup readiness checks
9. 60d5100 - fix(api): harden queue and worker reliability
10. dc82918 - fix(api): finalize launch readiness gates

## Category Mapping

- Onboarding improvements: a880c81
- Customer activation and first-email workflow: df357ba, d38d3b5, 661cb59, 0a9ef32
- Sender reliability: 75d095d, d38d3b5, df357ba
- Billing hardening: 18503e7
- Backend hardening and production stability: 605b6d3
- Queue and worker reliability: 60d5100
- Production readiness fixes: dc82918

## Explicit Exclusions from Release 1.0

- 830c3c1 - Add localized sales copilot guidance (moved to Release 1.1 backlog)
- a03a7ef - feat(web): implement autonomous ai sales workspace
- 970e006 - feat(web): streamline AI outreach workspace
- d0dbe36 - feat(frontend): build outreachai design system
- d7abb79 - feat(frontend): embed AI sales workflow in leads workspace
- 422c68c - feat(frontend): redesign leads into AI sales workspace
- e37b0d8 - feat(frontend): AI-first dashboard redesign

## Deployment Gate

Do not deploy Release 1.0 until explicit approval is given.
