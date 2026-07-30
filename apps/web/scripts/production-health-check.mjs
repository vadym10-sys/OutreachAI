const webUrl = normalizeUrl(process.env.PRODUCTION_WEB_URL || "https://outreachaiaiai.com");
const apiUrl = normalizeUrl(process.env.PRODUCTION_API_URL || "");
const queueHealthToken = process.env.PRODUCTION_QUEUE_HEALTH_BEARER || "";
const timeoutMs = Number(process.env.PRODUCTION_HEALTH_TIMEOUT_MS || 15000);

const checks = [
  { name: "web /api/health", url: `${webUrl}/api/health`, expectedStatuses: [200], expectJsonStatus: "ok" },
  { name: "web sign-in page", url: `${webUrl}/sign-in`, expectedStatuses: [200] },
  { name: "web sign-up page", url: `${webUrl}/sign-up`, expectedStatuses: [200] },
  { name: "web dashboard protected route", url: `${webUrl}/dashboard`, expectedStatuses: [200, 204, 307, 308] }
];

if (apiUrl) {
  checks.push(
    { name: "api root", url: `${apiUrl}/`, expectedStatuses: [200], expectJsonStatus: "ok" },
    { name: "api /api/health", url: `${apiUrl}/api/health`, expectedStatuses: [200], expectJsonStatus: "ok" },
    { name: "api /api/live", url: `${apiUrl}/api/live`, expectedStatuses: [200], expectJsonStatus: "alive" },
    { name: "api /api/ready", url: `${apiUrl}/api/ready`, expectedStatuses: [200], expectJsonStatus: "ready" }
  );
  if (queueHealthToken) {
    checks.push({
      name: "api worker queue health",
      url: `${apiUrl}/api/admin/queue/health`,
      expectedStatuses: [200],
      headers: { Authorization: `Bearer ${queueHealthToken}` }
    });
  }
}

const results = [];
for (const check of checks) {
  results.push(await runCheck(check));
}

const skipped = [];
if (!apiUrl) skipped.push("PRODUCTION_API_URL not configured; API, readiness and worker checks skipped.");
if (apiUrl && !queueHealthToken) skipped.push("PRODUCTION_QUEUE_HEALTH_BEARER not configured; worker queue check skipped.");

const failed = results.filter((result) => result.status !== "pass");
const report = {
  generated_at: new Date().toISOString(),
  mode: "read_only",
  target: { web: webUrl, api_configured: Boolean(apiUrl), worker_check_configured: Boolean(queueHealthToken) },
  results,
  skipped
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

async function runCheck(check) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(check.url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: check.headers || {}
    });
    const body = await safeJson(response);
    const statusOk = check.expectedStatuses.includes(response.status);
    const jsonOk = !check.expectJsonStatus || body?.status === check.expectJsonStatus;
    return {
      name: check.name,
      status: statusOk && jsonOk ? "pass" : "fail",
      http_status: response.status,
      duration_ms: Date.now() - started,
      response_status: typeof body?.status === "string" ? body.status : undefined,
      database_ready: typeof body?.database === "boolean" ? body.database : undefined,
      warnings_count: Array.isArray(body?.warnings) ? body.warnings.length : undefined
    };
  } catch (error) {
    return {
      name: check.name,
      status: "fail",
      duration_ms: Date.now() - started,
      error: error instanceof Error && error.name === "AbortError" ? "timeout" : "request_failed"
    };
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}
