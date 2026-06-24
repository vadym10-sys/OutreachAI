# Project Structure

```text
.
|-- apps
|   |-- api
|   |   |-- app
|   |   |   |-- api          FastAPI routers and webhooks
|   |   |   |-- core         config, database, auth, rate limiting
|   |   |   |-- models       SQLAlchemy entities
|   |   |   |-- schemas      Pydantic DTOs
|   |   |   `-- services     OpenAI, Resend, Stripe, lead finder, audit
|   |   |-- tests           backend tests
|   |   `-- Dockerfile
|   `-- web
|       |-- app              Next.js App Router pages
|       |-- components       shared UI
|       |-- lib              API client and fixtures
|       |-- tests            frontend and E2E tests
|       `-- Dockerfile
|-- db
|   `-- schema.sql           PostgreSQL schema
|-- docs
|   |-- API.md
|   |-- DEPLOYMENT.md
|   `-- PROJECT_STRUCTURE.md
|-- docker-compose.yml
|-- .env.example
`-- README.md
```
