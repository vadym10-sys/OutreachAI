# OutreachAI API

Base URL: `http://localhost:8000/api`

Authentication: send a Clerk JWT in `Authorization: Bearer <token>`. In local development, `Bearer dev` is accepted.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Health check |
| GET | `/dashboard` | Lead, email, open, reply, conversion, and ROI metrics |
| POST | `/leads/find` | Find and persist leads by niche, country, and city |
| GET | `/leads` | List user-owned leads |
| POST | `/ai/analyze` | Analyze a prospect website |
| POST | `/ai/personalize` | Generate cold email, follow-ups, and A/B variants |
| POST | `/campaigns` | Create campaign |
| GET | `/campaigns` | List campaigns |
| POST | `/campaigns/{id}/{launch\|pause\|stop}` | Change campaign state |
| GET | `/inbox` | Read unified inbound replies |
| POST | `/billing/checkout` | Create Stripe subscription checkout |
| POST | `/webhooks/stripe` | Receive Stripe subscription events |

Interactive OpenAPI docs are available at `/docs`.
