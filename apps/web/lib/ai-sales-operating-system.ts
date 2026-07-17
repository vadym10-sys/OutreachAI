import type { CrmCompany, Email } from "@/lib/types";

export type BuyingSignalV2 = {
  label: string;
  category: string;
  evidence: string;
  weight: number;
};

export type LeadScoreV2Summary = {
  score: number;
  replyProbability: number;
  signals: BuyingSignalV2[];
  reasons: string[];
  improvements: string[];
};

export type NextBestActionV2 = {
  action: string;
  channel: string;
  reason: string;
  href: string;
};

export type ResearchInputV2 = {
  label: string;
  value: string;
};

export type OutreachCopilotAssetV2 = {
  label: string;
  value: string;
  action: string;
};

export type ExecutiveTimelineItemV2 = {
  label: string;
  detail: string;
  status: string;
};

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.map((item) => String(item || "").trim()).find(Boolean);
      if (first) return first;
    }
  }
  return "";
}

function timelineItemText(item: unknown) {
  if (!item || typeof item !== "object") return String(item || "");
  const record = item as { title?: string; details?: string; event_type?: string; evidence_snippet?: string; source?: string };
  return record.title || record.details || record.evidence_snippet || record.event_type || record.source || "";
}

function cleanGeneratedText(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return cleanGeneratedText(parsed[0]);
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        return cleanGeneratedText(String(record.email || record.body || record.text || record.message || record.subject || ""));
      }
    } catch {
      const emailMatch = raw.match(/['"]email['"]\s*:\s*['"]([\s\S]*?)['"]\s*(?:,\s*['"]|})/);
      if (emailMatch?.[1]) return cleanGeneratedText(emailMatch[1].replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"'));
      const bodyMatch = raw.match(/['"](?:body|text|message)['"]\s*:\s*['"]([\s\S]*?)['"]\s*(?:,\s*['"]|})/);
      if (bodyMatch?.[1]) return cleanGeneratedText(bodyMatch[1].replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"'));
    }
  }
  return raw.replace(/\\n/g, "\n").trim();
}

function currentEmailSentAt(company: CrmCompany) {
  const latest = safeArray(company.generated_emails)[0];
  if (latest) return latest.delivery_status === "sent" ? (latest.sent_at || company.email_sent_at) : null;
  return company.email_sent_at;
}

export function companyGrowthSignals(company: CrmCompany) {
  return uniqueStrings([
    ...safeArray(company.top_positive_signals).map(String),
    ...safeArray(company.buying_signals).map(String),
    ...safeArray(company.ai_live_buying_signals?.snapshot?.market_expansion).map(String),
    ...safeArray(company.ai_live_buying_signals?.snapshot?.new_funding).map(String),
    ...safeArray(company.ai_company_timeline?.new_locations).map((item) => String((item as { title?: string; details?: string }).title || (item as { details?: string }).details || "")),
    company.buying_signal_explanation || ""
  ].filter(Boolean)).slice(0, 5);
}

export function companyHiringSignals(company: CrmCompany) {
  return uniqueStrings([
    ...safeArray(company.ai_live_buying_signals?.snapshot?.new_hiring).map(String),
    ...safeArray(company.company_intelligence?.report?.hiring_signals?.value).map(String),
    ...safeArray(company.company_intelligence?.fields?.buying_signals?.value).map(String).filter((item) => /hiring|role|recruit|team/i.test(item))
  ].filter(Boolean)).slice(0, 5);
}

export function companyNewsSignals(company: CrmCompany) {
  return uniqueStrings([
    ...safeArray(company.ai_live_buying_signals?.latest_changes).map((item) => {
      const added = safeArray(item.added).map(String).filter(Boolean).slice(0, 2).join(", ");
      return String(added ? `${item.change_type}: ${added}` : item.change_type || "");
    }),
    ...safeArray(company.ai_company_timeline?.website_changes).map((item) => String((item as { title?: string; details?: string }).title || (item as { details?: string }).details || "")),
    ...safeArray(company.ai_company_timeline?.technology_changes).map((item) => String((item as { title?: string; details?: string }).title || (item as { details?: string }).details || ""))
  ].filter(Boolean)).slice(0, 5);
}

export function buyingSignalsV2(company: CrmCompany): BuyingSignalV2[] {
  const snapshot = company.ai_live_buying_signals?.snapshot || {};
  const timeline = company.ai_company_timeline || {};
  const report = company.ai_revenue_engine_report || {};
  const predictions = company.ai_company_predictions || {};
  const workspace = company.ai_sales_workspace || {};
  const genericSignals = uniqueStrings([
    ...safeArray(company.top_positive_signals).map(String),
    ...safeArray(company.buying_signals).map(String),
    ...safeArray(company.company_intelligence?.report?.buying_signals?.value).map(String),
    ...safeArray(workspace.buying_signals).map(String)
  ]).filter(Boolean);

  const candidates: Array<BuyingSignalV2 | null> = [
    safeArray(snapshot.new_funding).length || safeArray(timeline.funding_events).length
      ? { label: "Funding event", category: "Capital", evidence: firstText(snapshot.new_funding, safeArray(timeline.funding_events).map(timelineItemText), "Funding signal detected"), weight: 14 }
      : null,
    genericSignals.some((signal) => /series\s?[abc]|seed|investment|funding/i.test(signal))
      ? { label: "Series or investment signal", category: "Capital", evidence: genericSignals.find((signal) => /series\s?[abc]|seed|investment|funding/i.test(signal)) || "Investment signal detected", weight: 14 }
      : null,
    safeArray(snapshot.new_hiring).length || safeArray(timeline.hiring_events).length || safeArray(company.company_intelligence?.report?.hiring_signals?.value).length
      ? { label: "New vacancies", category: "Hiring", evidence: firstText(snapshot.new_hiring, safeArray(timeline.hiring_events).map(timelineItemText), company.company_intelligence?.report?.hiring_signals?.value, "Hiring activity detected"), weight: 11 }
      : null,
    Number(predictions.growth_probability?.score || 0) >= 65 || safeArray(workspace.company_growth_indicators).length || genericSignals.some((signal) => /growth|hiring|expansion|scale/i.test(signal))
      ? { label: "Growth momentum", category: "Growth", evidence: firstText(predictions.growth_probability?.reasoning, workspace.company_growth_indicators, genericSignals.find((signal) => /growth|hiring|expansion|scale/i.test(signal)), "Growth signal detected"), weight: 10 }
      : null,
    safeArray(snapshot.new_products).length || safeArray(timeline.product_launches).length
      ? { label: "Product launch", category: "Product", evidence: firstText(snapshot.new_products, safeArray(timeline.product_launches).map(timelineItemText), "Product launch signal detected"), weight: 10 }
      : null,
    safeArray(snapshot.market_expansion).length || safeArray(timeline.new_locations).length
      ? { label: "New market expansion", category: "Expansion", evidence: firstText(snapshot.market_expansion, safeArray(timeline.new_locations).map(timelineItemText), "Expansion signal detected"), weight: 10 }
      : null,
    safeArray(snapshot.leadership_changes).length || safeArray(timeline.leadership_changes).length
      ? { label: "Leadership change", category: "Leadership", evidence: firstText(snapshot.leadership_changes, safeArray(timeline.leadership_changes).map(timelineItemText), "Leadership signal detected"), weight: 8 }
      : null,
    safeArray(snapshot.technology_changes).length || safeArray(timeline.technology_changes).length || safeArray(company.technologies).length
      ? { label: "Technology signal", category: "Technology", evidence: firstText(snapshot.technology_changes, safeArray(timeline.technology_changes).map(timelineItemText), company.technologies, "Technology profile available"), weight: 7 }
      : null,
    safeArray(snapshot.pricing_changes).length || safeArray(snapshot.website_changes).length || safeArray(timeline.website_changes).length
      ? { label: "Website or pricing change", category: "Website", evidence: firstText(snapshot.pricing_changes, snapshot.website_changes, safeArray(timeline.website_changes).map(timelineItemText), "Website change detected"), weight: 7 }
      : null,
    company.google_rating && company.google_rating >= 4.5
      ? { label: "Strong public reputation", category: "Trust", evidence: `${company.google_rating}/5 rating`, weight: 4 }
      : null,
    company.contacts.some((contact) => contact.email) || company.email
      ? { label: "Reachable decision maker", category: "Contact", evidence: company.contacts[0]?.title || company.contacts[0]?.name || company.email || "Contact path available", weight: 8 }
      : null,
    report.recommended_outreach_strategy?.why_contact_now
      ? { label: "Reason to contact now", category: "Timing", evidence: report.recommended_outreach_strategy.why_contact_now, weight: 12 }
      : null
  ];

  return uniqueStrings(candidates.filter(Boolean).map((item) => JSON.stringify(item)))
    .map((item) => JSON.parse(item) as BuyingSignalV2)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 8);
}

export function leadScoreV2(company: CrmCompany, baseScore: number): LeadScoreV2Summary {
  const signals = buyingSignalsV2(company);
  const signalImpact = Math.min(36, signals.reduce((sum, signal) => sum + signal.weight, 0));
  const replyProbability = Number(
    company.ai_sales_workspace?.estimated_reply_probability
    ?? company.ai_outreach_strategy?.estimated_reply_probability
    ?? company.ai_outreach_strategy?.probability_of_reply
    ?? parseInt(String(company.expected_reply_rate || "").replace(/[^\d]/g, ""), 10)
    ?? 0
  );
  const riskPenalty = Math.min(24, Number(company.ai_risk_analyzer?.risk_score || 0) * 0.22);
  const contactBonus = company.email || company.contacts.some((contact) => contact.email) ? 8 : -8;
  const researchBonus = company.ai_summary || company.ai_revenue_engine_report?.executive_summary || company.company_intelligence?.report?.company_summary?.value ? 8 : -6;
  const score = Math.max(0, Math.min(100, Math.round(baseScore * 0.48 + signalImpact + contactBonus + researchBonus - riskPenalty)));
  const reasons = uniqueStrings([
    signals[0] ? `${signals[0].label}: ${signals[0].evidence}` : "",
    signals[1] ? `${signals[1].label}: ${signals[1].evidence}` : "",
    company.email || company.contacts.some((contact) => contact.email) ? "A reachable contact path is available." : "Reachable decision maker is still missing.",
    company.ai_summary || company.company_intelligence ? "Company research is available." : "Company research needs to be completed.",
    replyProbability ? `Estimated reply probability is ${Math.max(1, Math.min(100, Math.round(replyProbability)))}%.` : ""
  ].filter(Boolean)).slice(0, 5);
  const improvements = uniqueStrings([
    company.ai_summary ? "" : "Run AI research to create the executive summary.",
    company.email || company.contacts.some((contact) => contact.email) ? "" : "Find or add a verified decision maker.",
    company.generated_emails.length ? "" : "Generate outreach assets before launching a campaign.",
    signals.length >= 2 ? "" : "Collect stronger buying signals before prioritizing this account.",
    company.ai_risk_analyzer?.recommended_improvements?.[0] || ""
  ].filter(Boolean)).slice(0, 4);

  return {
    score,
    replyProbability: replyProbability ? Math.max(1, Math.min(100, Math.round(replyProbability))) : Math.max(8, Math.min(85, Math.round(score * 0.66))),
    signals,
    reasons,
    improvements
  };
}

export function nextBestActionV2(company: CrmCompany, score: number): NextBestActionV2 {
  const hasContact = Boolean(company.email || company.contacts.some((contact) => contact.email));
  const hasResearch = Boolean(company.ai_summary || company.company_intelligence || company.ai_revenue_engine_report?.executive_summary);
  const hasDraft = Boolean(company.generated_emails.length);
  const hasApproved = Boolean(company.email_approved_at || company.generated_emails.some((email) => email.delivery_status === "approved" || email.delivery_status === "sent"));
  const hasSent = Boolean(currentEmailSentAt(company));
  const bestChannel = String(company.ai_sales_workspace?.best_communication_channel || company.ai_outreach_strategy?.best_communication_channel || company.ai_outreach_strategy?.best_channel || "");
  if (!hasResearch) return { action: "Research more", channel: "AI Research", reason: "The company needs a complete executive summary before outreach.", href: `#insights-${company.id}` };
  if (!hasContact) return { action: "Find another decision maker", channel: "Contact discovery", reason: "AI has context, but outreach quality depends on a reachable decision maker.", href: `#contacts-${company.id}` };
  if (!hasDraft) return { action: bestChannel.toLowerCase().includes("linkedin") ? "LinkedIn" : "Email", channel: bestChannel || "Email", reason: "Research and contact data are ready; generate the first personalized outreach asset.", href: `#outreach-${company.id}` };
  if (!hasApproved) return { action: "Email", channel: "Review", reason: "A draft exists but still needs human approval before anything is sent.", href: `#outreach-${company.id}` };
  if (!hasSent && score >= 65) return { action: "Email", channel: "Send approved email", reason: "The account has enough score and an approved message is ready.", href: `#outreach-${company.id}` };
  if (!hasSent) return { action: "Wait", channel: "Quality control", reason: "The message is approved, but the score suggests one more review before sending.", href: `#outreach-${company.id}` };
  if (!company.replied_at) return { action: "Follow up", channel: "Email", reason: "The first touch was sent; continue with the recommended follow-up window.", href: `#notes-${company.id}` };
  return { action: "Call", channel: "Meeting prep", reason: "A reply exists. Move from outreach to a human conversation.", href: `#contacts-${company.id}` };
}

export function researchInputsV2(company: CrmCompany): ResearchInputV2[] {
  const intelligence = company.company_intelligence || null;
  return [
    { label: "Website", value: company.website || company.domain },
    { label: "Business description", value: intelligence?.fields?.business_description?.value || company.ai_summary },
    { label: "ICP", value: intelligence?.report?.icp?.value || company.ai_sales_workspace?.target_customers || company.partnership_fit },
    { label: "Industry", value: company.industry },
    { label: "Technologies", value: uniqueStrings([...safeArray(company.technologies).map(String), ...safeArray(intelligence?.report?.technology_stack?.value).map(String), ...safeArray(company.ai_sales_workspace?.relevant_technologies).map(String)]).join(", ") },
    { label: "Vacancies", value: firstText(company.ai_live_buying_signals?.snapshot?.new_hiring, company.company_intelligence?.report?.hiring_signals?.value) },
    { label: "News", value: firstText(companyNewsSignals(company)) },
    { label: "Team size", value: company.ai_sales_workspace?.estimated_company_size || intelligence?.fields?.employee_count?.value },
    { label: "Growth signals", value: firstText(companyGrowthSignals(company), company.ai_sales_workspace?.company_growth_indicators) },
    { label: "Funding", value: firstText(company.ai_live_buying_signals?.snapshot?.new_funding, safeArray(company.ai_company_timeline?.funding_events).map(timelineItemText)) },
    { label: "Company LinkedIn", value: intelligence?.fields?.company_linkedin?.value },
    { label: "Similar companies", value: firstText(company.ai_competitor_intelligence?.competitors, company.ai_revenue_engine_report?.competitor_position?.competitors) },
    { label: "Why now", value: company.ai_revenue_engine_report?.recommended_outreach_strategy?.why_contact_now || company.ai_outreach_strategy?.why_contact_now || company.buying_signal_explanation }
  ].map((item) => ({ ...item, value: String(item.value || "").trim() }));
}

export function outreachCopilotAssetsV2(company: CrmCompany, draft?: Email | null): OutreachCopilotAssetV2[] {
  const workspace = company.ai_sales_workspace || {};
  const strategy = company.ai_outreach_strategy || {};
  const firstMessage = cleanGeneratedText(draft?.body || workspace.recommended_first_message || company.ai_revenue_engine_report?.recommended_first_email?.first_sentence || "");
  const followUps = safeArray(workspace.personalized_follow_up_sequence).map(String);
  const opener = workspace.personalized_opening_line || strategy.first_sentence || company.ai_revenue_engine_report?.recommended_first_email?.first_sentence || "";
  return [
    { label: "Email", value: firstMessage || "Generate the first email from AI research.", action: "Generate Email" },
    { label: "LinkedIn", value: String((workspace.recommendation_actions?.best_channel?.value === "LinkedIn" ? opener : "") || opener || "Use the same research angle in a shorter social note."), action: "Generate LinkedIn" },
    { label: "Follow-up #1", value: cleanGeneratedText(draft?.follow_up_1 || followUps[0] || strategy.follow_up_schedule?.[0] || ""), action: "Generate Follow-up #1" },
    { label: "Follow-up #2", value: cleanGeneratedText(draft?.follow_up_2 || followUps[1] || strategy.follow_up_schedule?.[1] || ""), action: "Generate Follow-up #2" },
    { label: "Subject Line", value: draft?.subject || workspace.best_subject_line || strategy.best_subject_line || company.ai_revenue_engine_report?.recommended_first_email?.subject || "", action: "Generate Subject" },
    { label: "Call opener", value: workspace.personalized_opening_line || strategy.first_sentence || company.sales_angle || "", action: "Generate Call Opener" },
    { label: "Meeting opener", value: company.ai_sales_coach?.why_this_company || company.ai_sales_workspace?.best_outreach_angle || company.suggested_offer || "", action: "Generate Meeting Opener" }
  ].map((item) => ({ ...item, value: item.value || "Run AI research to unlock this asset." }));
}

export function executiveTimelineV2(
  company: CrmCompany,
  nextAction: string,
  formatDateTime: (value?: string | null) => string
): ExecutiveTimelineItemV2[] {
  const signalEvents = buyingSignalsV2(company).slice(0, 4).map((signal) => ({
    label: signal.label,
    detail: signal.evidence,
    status: "Discovered"
  }));
  const workflowEvents = [
    company.found_at ? { label: "Company found", detail: formatDateTime(company.found_at), status: "Done" } : null,
    company.website_analyzed_at ? { label: "AI research completed", detail: formatDateTime(company.website_analyzed_at), status: "Done" } : null,
    company.contact_found_at ? { label: "Decision maker found", detail: formatDateTime(company.contact_found_at), status: "Done" } : null,
    company.email_generated_at ? { label: "Outreach generated", detail: formatDateTime(company.email_generated_at), status: "Done" } : null,
    company.email_sent_at ? { label: "Email sent", detail: formatDateTime(company.email_sent_at), status: "Done" } : null,
    company.replied_at ? { label: "Reply received", detail: formatDateTime(company.replied_at), status: "Done" } : null
  ].filter(Boolean) as Array<{ label: string; detail: string; status: string }>;
  return [
    ...workflowEvents,
    ...signalEvents,
    { label: "Recommended now", detail: nextAction, status: "Next" }
  ].slice(0, 9);
}
