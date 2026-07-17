import { z } from "zod";
import type { Activity, AISalesEmployee, BillingPlan, Campaign, CrmCompany, CrmPipeline, DashboardMetrics, Email, Lead, Profile, Usage, Workspace } from "@/lib/types";

const objectLike = (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value));

const crmCompanySchema = z.custom<CrmCompany>(objectLike, "Expected a CRM company object");
const leadSchema = z.custom<Lead>(objectLike, "Expected a lead object");
const campaignSchema = z.custom<Campaign>(objectLike, "Expected a campaign object");
const emailSchema = z.custom<Email>(objectLike, "Expected an inbox email object");
const dashboardMetricsSchema = z.custom<DashboardMetrics>(objectLike, "Expected dashboard metrics");
const usageSchema = z.custom<Usage>(objectLike, "Expected billing usage");
const workspaceSchema = z.custom<Workspace>(objectLike, "Expected workspace");
const aiSalesEmployeeSchema = z.custom<AISalesEmployee>(objectLike, "Expected AI employee");
const activitySchema = z.custom<Activity>(objectLike, "Expected activity");
const crmPipelineSchema = z.custom<CrmPipeline>(objectLike, "Expected CRM pipeline");

export const customerApiStatusSchema = z.enum(["success", "partial_success", "empty", "provider_unavailable", "timeout", "error"]);
export type CustomerApiStatus = z.infer<typeof customerApiStatusSchema>;

export const leadSearchPayloadSchema = z.object({
  country: z.string(),
  city: z.string(),
  industry: z.string(),
  category: z.string(),
  keyword: z.string(),
  company_size: z.string(),
  keywords: z.array(z.string()),
  technologies: z.array(z.string()),
  radius: z.number(),
  limit: z.number()
}).passthrough();
export type LeadSearchPayload = z.infer<typeof leadSearchPayloadSchema>;

export const paginatedLeadsSchema = z.object({
  items: z.array(leadSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number()
}).passthrough();
export type PaginatedLeads = { items: Lead[]; total: number; page: number; page_size: number };

export const aiWebsiteAnalysisSchema = z.object({
  company: z.string(),
  website: z.string(),
  description: z.string(),
  industry: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  niche: z.string(),
  products_services: z.array(z.string()),
  services: z.array(z.string()),
  technologies: z.array(z.string()),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  icp_score: z.number(),
  summary: z.string(),
  company_summary: z.string(),
  suggested_offer: z.string(),
  outreach_strategy: z.string(),
  sales_angle: z.string(),
  expected_reply_rate: z.string(),
  recommended_cta: z.string()
}).passthrough();
export type AnalysisResult = z.infer<typeof aiWebsiteAnalysisSchema>;

export const workspaceAppLeadSearchResponseSchema = z.object({
  status: customerApiStatusSchema,
  request_id: z.string(),
  message: z.string(),
  companies_saved: z.number(),
  saved_count: z.number().optional(),
  duplicates_skipped: z.number(),
  companies: z.array(crmCompanySchema),
  warnings: z.array(z.string())
}).passthrough();
export type WorkspaceAppLeadSearchResponse = z.infer<typeof workspaceAppLeadSearchResponseSchema>;

export const workspaceAppLeadCommandResponseSchema = workspaceAppLeadSearchResponseSchema.extend({
  filters: leadSearchPayloadSchema.partial().nullable().optional(),
  interpreted_query: z.string().optional()
}).passthrough();
export type WorkspaceAppLeadCommandResponse = z.infer<typeof workspaceAppLeadCommandResponseSchema>;

export const workspaceAppCompanyCreateResponseSchema = z.object({
  status: z.enum(["created", "reused"]),
  message: z.string(),
  company: crmCompanySchema
}).passthrough();
export type WorkspaceAppCompanyCreateResponse = z.infer<typeof workspaceAppCompanyCreateResponseSchema>;

export const workspaceAppActionResponseSchema = z.object({
  status: customerApiStatusSchema,
  message: z.string(),
  company: crmCompanySchema.nullable().optional(),
  email: emailSchema.nullable().optional(),
  warnings: z.array(z.string()).optional(),
  completed_steps: z.array(z.string()).optional(),
  workflow_stages: z.record(z.string()).optional(),
  missing_fields: z.array(z.string()).optional(),
  recommended_actions: z.array(z.string()).optional(),
  next_action: z.string().optional(),
  job_id: z.string().optional(),
  job_status: z.string().optional()
}).passthrough();
export type WorkspaceAppActionResponse = z.infer<typeof workspaceAppActionResponseSchema>;

export const workspaceDeepContactJobStatusResponseSchema = z.object({
  job_id: z.string(),
  job_type: z.string(),
  status: z.string(),
  progress: z.object({
    stage: z.string().optional(),
    message: z.string().optional(),
    percent: z.number().optional()
  }).passthrough().optional(),
  company: crmCompanySchema.nullable().optional()
}).passthrough();
export type WorkspaceDeepContactJobStatusResponse = z.infer<typeof workspaceDeepContactJobStatusResponseSchema>;

export type WorkspaceAiSalesAnalysis = NonNullable<CrmCompany["ai_sales_workspace"]>;

export const workspaceAiSalesAnalysisSchema = z.custom<WorkspaceAiSalesAnalysis>(objectLike, "Expected AI sales analysis");

export const workspaceAiSalesAnalysisVersionSchema = z.object({
  version: z.number(),
  generated_at: z.string().nullable().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  status: z.string().optional()
}).passthrough();
export type WorkspaceAiSalesAnalysisVersion = z.infer<typeof workspaceAiSalesAnalysisVersionSchema>;

export const workspaceAiSalesAnalysisResponseSchema = z.object({
  status: customerApiStatusSchema,
  message: z.string(),
  company_id: z.string(),
  analysis: z.union([workspaceAiSalesAnalysisSchema, z.record(z.never())]),
  generated_at: z.string().nullable().optional(),
  cached: z.boolean(),
  requested_version: z.number().nullable().optional(),
  latest_version: z.number().nullable().optional(),
  available_versions: z.array(workspaceAiSalesAnalysisVersionSchema).optional()
}).passthrough();
export type WorkspaceAiSalesAnalysisResponse = z.infer<typeof workspaceAiSalesAnalysisResponseSchema>;

export const workspaceAiSalesRecommendationActionSchema = z.object({
  key: z.enum(["decision_maker", "first_message", "follow_up_sequence", "best_channel", "reply_probability", "deal_success_probability", "priority_score", "next_best_action"]),
  action: z.enum(["approve", "edit", "regenerate"]),
  value: z.unknown().optional(),
  reason: z.string().optional()
}).passthrough();
export type WorkspaceAiSalesRecommendationActionIn = z.infer<typeof workspaceAiSalesRecommendationActionSchema>;

export const workspaceIntegrationStatusSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["connected", "missing_key", "needs_setup", "error"]),
  message: z.string()
}).passthrough();
export type WorkspaceIntegrationStatus = z.infer<typeof workspaceIntegrationStatusSchema>;

export const workspaceIntegrationStatusResponseSchema = z.object({
  integrations: z.array(workspaceIntegrationStatusSchema)
}).passthrough();
export type WorkspaceIntegrationStatusResponse = z.infer<typeof workspaceIntegrationStatusResponseSchema>;

export const outreachSenderStatusSchema = z.object({
  provider: z.string(),
  connected: z.boolean(),
  status: z.enum(["connected", "missing_key", "needs_setup", "error"]),
  sender_name: z.string(),
  sender_email: z.string().nullable().optional(),
  reply_to: z.string().nullable().optional(),
  daily_send_limit: z.number(),
  sent_today: z.number(),
  remaining_today: z.number(),
  spf_status: z.string(),
  dkim_status: z.string(),
  dmarc_status: z.string(),
  next_action: z.string(),
  reason: z.string().optional(),
  smtp_host: z.string(),
  smtp_port: z.number(),
  smtp_username: z.string(),
  smtp_configured: z.boolean(),
  smtp_verified_at: z.string().optional()
}).passthrough();
export type OutreachSenderStatus = z.infer<typeof outreachSenderStatusSchema>;

export const workspaceAppBootstrapResponseSchema = z.object({
  workspace: z.object({
    id: z.string(),
    name: z.string(),
    company: z.string().nullable().optional(),
    industry: z.string().nullable().optional(),
    target_country: z.string().nullable().optional(),
    target_customer: z.string().nullable().optional()
  }).passthrough(),
  counts: z.object({
    leads: z.number(),
    companies: z.number(),
    campaigns: z.number(),
    emails: z.number(),
    deals: z.number()
  }).passthrough(),
  metrics: z.object({
    leads: z.number().optional(),
    companies: z.number().optional(),
    contacts: z.number().optional(),
    campaigns: z.number().optional(),
    emails: z.number().optional(),
    deals: z.number().optional()
  }).passthrough().optional(),
  next_action: z.string(),
  recent_companies: z.array(crmCompanySchema),
  recent_activity: z.array(z.object({
    action: z.string(),
    created_at: z.string(),
    company: z.string().optional(),
    message: z.string().optional()
  }).passthrough())
}).passthrough();
export type WorkspaceAppBootstrapResponse = z.infer<typeof workspaceAppBootstrapResponseSchema>;

export const dashboardResponseSchema = dashboardMetricsSchema;
export type DashboardResponse = DashboardMetrics;

export const companiesResponseSchema = z.array(crmCompanySchema);
export type CompaniesResponse = CrmCompany[];

export const companyWorkspaceResponseSchema = crmCompanySchema;
export type CompanyWorkspaceResponse = CrmCompany;

export const campaignsResponseSchema = z.array(campaignSchema);
export type CampaignsResponse = Campaign[];

export const inboxResponseSchema = z.array(emailSchema);
export type InboxResponse = Email[];

export const billingPlanSchema = z.custom<BillingPlan>(objectLike, "Expected billing plan");
export const billingPlansResponseSchema = z.array(billingPlanSchema);
export type BillingPlansResponse = BillingPlan[];

export const billingStatusSchema = z.object({
  plan: z.string(),
  price: z.number(),
  status: z.string(),
  trial_end: z.string().nullable().optional(),
  current_period_end: z.string().nullable().optional(),
  trial_days_remaining: z.number(),
  stripe_customer_id: z.string(),
  stripe_subscription_id: z.string(),
  last_payment_error: z.string().optional(),
  last_decline_code: z.string().optional(),
  last_failure_message: z.string().optional(),
  last_payment_failed_at: z.string().nullable().optional(),
  limits: z.record(z.union([z.number(), z.boolean()])),
  usage: z.record(z.number()),
  sales_employees_used: z.number(),
  workspaces_used: z.number()
}).passthrough();
export type BillingStatusResponse = z.infer<typeof billingStatusSchema>;

export const billingUsageResponseSchema = usageSchema;
export type BillingUsageResponse = Usage;

export const billingInvoiceSchema = z.record(z.unknown());
export const billingInvoicesResponseSchema = z.array(billingInvoiceSchema);
export type BillingInvoicesResponse = z.infer<typeof billingInvoicesResponseSchema>;

export const billingDiagnosticsSchema = z.object({
  stripe_secret_loaded: z.boolean(),
  webhook_secret_loaded: z.boolean(),
  publishable_key_loaded: z.boolean(),
  starter_price_id_loaded: z.boolean(),
  pro_price_id_loaded: z.boolean(),
  agency_price_id_loaded: z.boolean(),
  checkout_session_creation_works: z.boolean(),
  webhook_receives_signed_events: z.boolean(),
  subscription_sync_healthy: z.boolean()
}).passthrough();
export type BillingDiagnostics = z.infer<typeof billingDiagnosticsSchema>;

export const runtimeDiagnosticsSchema = z.object({
  stripe_publishable_key_loaded: z.boolean(),
  stripe_publishable_key_live: z.boolean()
}).passthrough();
export type RuntimeDiagnostics = z.infer<typeof runtimeDiagnosticsSchema>;

export const billingCheckoutSessionSchema = z.object({
  url: z.string()
}).passthrough();
export type BillingCheckoutSession = z.infer<typeof billingCheckoutSessionSchema>;

export const profileResponseSchema = z.object({
  workspace: z.string(),
  company: z.string(),
  avatar_url: z.string().nullable().optional(),
  timezone: z.string(),
  language: z.string()
}).passthrough();
export type ProfileResponse = Profile;

export const workspaceResponseSchema = workspaceSchema;
export type WorkspaceResponse = Workspace;

export const aiSalesEmployeesResponseSchema = z.array(aiSalesEmployeeSchema);
export type AiSalesEmployeesResponse = AISalesEmployee[];

export const activityResponseSchema = z.array(activitySchema);
export type ActivityResponse = Activity[];

export const crmPipelineResponseSchema = crmPipelineSchema;
export type CrmPipelineResponse = CrmPipeline;

export function parseCustomerApiResponse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ");
  throw new Error(`Incompatible ${label} response: ${issues}`);
}
