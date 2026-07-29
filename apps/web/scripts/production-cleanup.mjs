const prefix = process.env.E2E_TEST_PREFIX || "E2E_TEST";
const runId = process.env.E2E_TEST_RUN_ID || "";
const endpoint = process.env.PRODUCTION_E2E_CLEANUP_URL || "";
const token = process.env.PRODUCTION_E2E_CLEANUP_TOKEN || "";

if (prefix !== "E2E_TEST") {
  console.error("Refusing cleanup because E2E_TEST_PREFIX is not exactly E2E_TEST.");
  process.exit(1);
}

if (!runId.startsWith("E2E_TEST")) {
  console.error("Refusing cleanup because E2E_TEST_RUN_ID does not start with E2E_TEST.");
  process.exit(1);
}

if (!endpoint || !token) {
  console.log(JSON.stringify({ status: "skipped", reason: "cleanup_endpoint_not_configured", run_id: runId }));
  process.exit(0);
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ prefix, run_id: runId })
});

console.log(JSON.stringify({ status: response.ok ? "ok" : "failed", http_status: response.status, run_id: runId }));
if (!response.ok) process.exit(1);
