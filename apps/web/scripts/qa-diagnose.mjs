import fs from "node:fs";
import path from "node:path";

const reportPath = path.resolve("test-artifacts/playwright-results.json");
const outputPath = path.resolve("test-artifacts/qa-diagnosis.md");

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function collectFailures(suite, parents = []) {
  const titlePath = [...parents, suite.title].filter(Boolean);
  const failures = [];
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      for (const result of test.results || []) {
        if (result.status !== "passed" && result.status !== "skipped") {
          failures.push({
            title: [...titlePath, spec.title].join(" > "),
            project: test.projectName,
            file: spec.file,
            line: spec.line,
            status: result.status,
            error: result.error?.message || result.errors?.[0]?.message || "Unknown failure"
          });
        }
      }
    }
  }
  for (const child of suite.suites || []) failures.push(...collectFailures(child, titlePath));
  return failures;
}

function suggestionFor(error) {
  if (/strict mode violation/i.test(error)) return "Use a more specific locator or assert within a scoped section.";
  if (/Timeout|timed out/i.test(error)) return "Check loading states, mocked API responses, and slow route dependencies.";
  if (/pageerror|Something went wrong|React/i.test(error)) return "Inspect the failing component and isolate widget-level failures from page-level boundaries.";
  if (/requestfailed|5\d\d|network/i.test(error)) return "Check failed API route, user-facing fallback, and retry behavior.";
  return "Open the Playwright trace and inspect console, network, and DOM state at the failing step.";
}

ensureDir(outputPath);

if (!fs.existsSync(reportPath)) {
  fs.writeFileSync(outputPath, "# QA Diagnosis\n\nNo Playwright JSON report was found.\n");
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const failures = (report.suites || []).flatMap((suite) => collectFailures(suite));

const lines = ["# QA Diagnosis", ""];
if (!failures.length) {
  lines.push("All Playwright tests passed. No failing browser flows were detected.");
} else {
  lines.push(`Detected ${failures.length} failing browser result(s).`, "");
  failures.forEach((failure, index) => {
    lines.push(`## ${index + 1}. ${failure.title}`);
    lines.push(`- Project: ${failure.project || "unknown"}`);
    lines.push(`- File: ${failure.file}:${failure.line || 1}`);
    lines.push(`- Status: ${failure.status}`);
    lines.push(`- Suggested next step: ${suggestionFor(failure.error)}`);
    lines.push("");
    lines.push("```");
    lines.push(failure.error.slice(0, 3000));
    lines.push("```");
    lines.push("");
  });
}

fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
