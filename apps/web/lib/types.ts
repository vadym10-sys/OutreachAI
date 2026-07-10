export type DashboardMetrics = {
  leads: number;
  campaigns: number;
  emails_sent: number;
  delivered: number;
  opened: number;
  replies: number;
  bounces: number;
  open_rate: number;
  reply_rate: number;
  ctr: number;
  conversion_rate: number;
  meetings: number;
  revenue: number;
  revenue_forecast: number;
  mrr: number;
  arr: number;
  revenue_series: Array<Record<string, number | string>>;
  funnel: Array<{ status: string; count: number }>;
  pipeline: Array<{ status: string; count: number; revenue: number }>;
  plan: string;
  usage: Record<string, unknown>;
};

export type CampaignSequence = {
  id?: string;
  step_order: number;
  name: string;
  subject: string;
  body: string;
  delay_days: number;
};

export type Campaign = {
  id: string;
  name: string;
  industry: string;
  countries: string[];
  cities: string[];
  company_size?: string | null;
  keywords: string[];
  website_filters: string[];
  language: string;
  offer: string;
  cta: string;
  email_tone: string;
  signature: string;
  status: string;
  follow_up_days: number;
  timezone: string;
  working_hours: string;
  daily_send_limit: number;
  sequence: CampaignSequence[];
  leads: number;
  sent: number;
  replies: number;
};

export type Lead = {
  id?: string;
  crm_company_id?: string | null;
  company: string;
  website?: string | null;
  domain?: string | null;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  niche?: string | null;
  status: string;
  campaign_id?: string | null;
  sales_employee_id?: string | null;
  campaign?: string | null;
  notes?: string | null;
  revenue?: number;
  employee_count?: number | null;
  revenue_range?: string | null;
  title?: string | null;
  confidence?: string | null;
  address?: string | null;
  google_rating?: number | null;
  business_category?: string | null;
  place_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  apollo_company_id?: string | null;
  apollo_contact_id?: string | null;
  hunter_contact_id?: string | null;
  hunter_verified?: boolean;
  hunter_status?: string | null;
  source?: string | null;
  ai_summary?: string | null;
  pain_points?: string[];
  services?: string[];
  weaknesses?: string[];
  icp_score?: number | null;
  value_proposition?: string | null;
  suggested_offer?: string | null;
  outreach_strategy?: string | null;
  sales_angle?: string | null;
  recommended_cta?: string | null;
  follow_up_strategy?: string | null;
  expected_reply_rate?: string | null;
  generated_emails?: Email[];
  created_at?: string | null;
  found_at?: string | null;
  saved_to_crm_at?: string | null;
  website_analyzed_at?: string | null;
  contact_found_at?: string | null;
  email_generated_at?: string | null;
  email_approved_at?: string | null;
  email_sent_at?: string | null;
  delivered_at?: string | null;
  opened_at?: string | null;
  replied_at?: string | null;
  last_activity_at?: string | null;
  stage_changed_at?: string | null;
  contact_search_checked_at?: string | null;
  contact_search_status?: string | null;
  contact_search_message?: string | null;
  decision_maker_roles_searched?: string[];
  workflow_stages?: Record<string, "waiting" | "running" | "completed" | "error" | string>;
  workflow_stage_messages?: Record<string, string>;
};

export type CrmContact = {
  id: string;
  company_id?: string | null;
  lead_id?: string | null;
  company: string;
  name: string;
  title: string;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  confidence: string;
  source: string;
  email_status: string;
  created_at: string;
};

export type CrmDeal = {
  id: string;
  company_id?: string | null;
  lead_id?: string | null;
  company: string;
  name: string;
  stage: string;
  value: number;
  probability: number;
  source: string;
  next_step: string;
  created_at: string;
};

export type CrmNote = {
  id: string;
  company_id?: string | null;
  lead_id?: string | null;
  body: string;
  kind: string;
  created_at: string;
};

export type CrmCompany = {
  id: string;
  lead_id?: string | null;
  name: string;
  website?: string | null;
  domain?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  industry?: string | null;
  google_rating?: number | null;
  place_id?: string | null;
  source: string;
  ai_summary: string;
  pain_points?: string[];
  services?: string[];
  weaknesses?: string[];
  icp_score?: number | null;
  value_proposition?: string | null;
  suggested_offer: string;
  outreach_strategy: string;
  sales_angle: string;
  recommended_cta?: string | null;
  follow_up_strategy?: string | null;
  expected_reply_rate: string;
  buying_signals?: string[];
  risks?: string[];
  opportunity_analysis?: string | null;
  partnership_fit?: string | null;
  priority_score?: number | null;
  confidence_score?: number | null;
  next_recommended_action?: string | null;
  email_status: string;
  crm_stage: string;
  contacts: CrmContact[];
  deals: CrmDeal[];
  notes: CrmNote[];
  activity: Activity[];
  generated_emails: Email[];
  created_at: string;
  updated_at: string;
  found_at?: string | null;
  saved_to_crm_at?: string | null;
  website_analyzed_at?: string | null;
  contact_found_at?: string | null;
  email_generated_at?: string | null;
  email_approved_at?: string | null;
  email_sent_at?: string | null;
  delivered_at?: string | null;
  opened_at?: string | null;
  replied_at?: string | null;
  last_activity_at?: string | null;
  stage_changed_at?: string | null;
  contact_search_checked_at?: string | null;
  contact_search_status?: string | null;
  contact_search_message?: string | null;
  decision_maker_roles_searched?: string[];
  workflow_stages?: Record<string, "waiting" | "running" | "completed" | "error" | string>;
  workflow_stage_messages?: Record<string, string>;
};

export type CrmPipeline = {
  stages: string[];
  companies: CrmCompany[];
  deals: CrmDeal[];
};

export type IntegrationConnectionStatus = {
  configured: boolean;
  connected: boolean;
  last_success_at?: string | null;
  last_error: string;
};

export type ApolloIntegrationStatus = IntegrationConnectionStatus;
export type HunterIntegrationStatus = IntegrationConnectionStatus;

export type AISalesEmployee = {
  id: string;
  name: string;
  role: string;
  product_service: string;
  target_customer: string;
  target_countries: string[];
  target_industries: string[];
  offer: string;
  cta: string;
  sending_mode: string;
  daily_limit: number;
  working_hours: string;
  tone: string;
  language: string;
  signature: string;
  status: string;
  strict_limits: Record<string, unknown>;
  leads: number;
  pending_approval: number;
  sent: number;
  replies: number;
  created_at: string;
};

export type SalesEmployeeLeadInsight = {
  id: string;
  lead_id: string;
  sales_employee_id: string;
  industry: string;
  services: string[];
  pain_points: string[];
  icp_score: number;
  purchase_probability: number;
  best_sales_angle: string;
  best_cta: string;
  recommended_plan: string;
  summary: string;
  created_at: string;
};

export type SalesEmployeeRun = {
  employee_id: string;
  mode: string;
  leads_qualified: number;
  emails_generated: number;
  emails_sent: number;
  blocked: string[];
};

export type SalesEmployeeTaskPlan = {
  id: string;
  employee_id: string;
  command: string;
  goal: string;
  intent: string;
  priority: string;
  required_tools: string[];
  estimated_execution_time: string;
  expected_result: string;
  steps: string[];
  requires_approval: boolean;
  external_actions: string[];
  safety_notes: string[];
  memory_updates: string[];
  status: string;
  progress: string[];
  created_at: string;
  approved_at?: string | null;
  finished_at?: string | null;
  result_preview?: {
    companies_found?: number;
    prepared_emails?: number;
    final_summary?: string;
    failure_reason?: string;
    next_recommended_action?: string;
  } | null;
};

export type SalesEmployeeTaskResult = {
  id: string;
  workspace_id: string;
  user_id: string;
  sales_employee_id: string;
  task_id: string;
  command: string;
  status: string;
  employee_name: string;
  execution_time_ms: number;
  created_at: string;
  completed_at?: string | null;
  result_json: {
    companies_found: Array<Record<string, unknown>>;
    prepared_emails: Array<Record<string, unknown>>;
    tools_used: Array<Record<string, unknown>>;
    ai_action_log: Array<Record<string, unknown>>;
    final_summary: string;
    failure_reason?: string;
    empty_result_details?: Record<string, unknown>;
    next_recommended_action: string;
    approval_required: boolean;
    external_actions_blocked: boolean;
  };
};

export type SalesEmployeeMemory = {
  previous_tasks: Record<string, unknown>[];
  campaigns: string[];
  industries: string[];
  countries: string[];
  preferred_tone: string;
  customer_preferences: string[];
};

export type SalesEmployeePerformance = {
  tasks_completed: number;
  success_rate: number;
  reply_rate: number;
  meeting_rate: number;
  revenue_influence: number;
  time_saved_hours: number;
};

export type TeamRouterSubtask = {
  id: string;
  employee: string;
  title: string;
  objective: string;
  required_tools: string[];
  expected_result: string;
  risk_level: string;
  required_approval: boolean;
  status: string;
  result: string;
};

export type TeamRouterPlan = {
  id: string;
  command: string;
  detected_intent: string;
  assigned_employees: string[];
  primary_employee: string;
  priority: string;
  risk_level: string;
  estimated_execution_time: string;
  required_approval: boolean;
  subtasks: TeamRouterSubtask[];
  safety_notes: string[];
  status: string;
  progress: string[];
  created_at: string;
  approved_at?: string | null;
  finished_at?: string | null;
};

export type TeamEmployeeDashboard = {
  employee: string;
  role: string;
  active_tasks: number;
  completed_tasks: number;
  last_activity: string;
  performance: number;
  status: string;
  tasks: TeamRouterSubtask[];
  activity: string[];
  results: string[];
  memory: Record<string, unknown>;
};

export type TeamRouterDashboard = {
  employees: TeamEmployeeDashboard[];
  current_plan?: TeamRouterPlan | null;
  history: TeamRouterPlan[];
};

export type SalesCopilot = {
  probability_to_reply: number;
  probability_to_buy: number;
  best_first_contact: string;
  best_subject_line: string;
  best_cta: string;
  estimated_revenue: number | null;
  estimated_revenue_reason?: string | null;
  reasoning: string[];
};

export type WebsiteAudit = {
  missing_cta: boolean;
  missing_contact_form: boolean;
  poor_seo: boolean;
  weak_trust_signals: boolean;
  missing_reviews: boolean;
  slow_website: boolean;
  outdated_design: boolean;
  improvement_report: string;
  priority_actions: string[];
};

export type MeetingPrep = {
  company_summary: string;
  decision_maker_profile: string;
  likely_objections: string[];
  suggested_questions: string[];
  sales_strategy: string;
};

export type FollowUpSequence = {
  no_open: string[];
  opened: string[];
  clicked: string[];
  replied: string[];
};

export type CampaignAnalytics = {
  campaign_id?: string | null;
  campaign_success: number;
  predicted_reply_rate: number;
  predicted_conversion_rate: number;
  suggested_improvements: string[];
};

export type Email = {
  id: string;
  campaign_id?: string | null;
  lead_id?: string | null;
  subject: string;
  preview: string;
  body: string;
  cta: string;
  follow_up_1: string;
  follow_up_2: string;
  follow_up_3?: string;
  delivery_status: string;
  sent_at?: string | null;
  delivered_at?: string | null;
  opened_at?: string | null;
  bounced_at?: string | null;
  replied_at?: string | null;
  tags?: Record<string, unknown>;
  reply_assistant?: Record<string, unknown>;
};

export type Activity = { id: string; action: string; metadata_json: Record<string, unknown>; created_at: string };
export type Notification = { id: string; kind: string; title: string; message: string; created_at: string };
export type GrowthGoal = {
  goal: string;
  target_meetings: number;
  meetings_booked: number;
  progress_percent: number;
  execution_plan: string[];
  next_action: string;
};
export type GrowthEngine = {
  briefing: {
    date: string;
    new_leads_found: number;
    best_opportunities: Array<Record<string, unknown>>;
    campaign_performance: Record<string, unknown>;
    reply_rate_change: number;
    meetings_booked: number;
    recommended_actions: Array<Record<string, unknown>>;
  };
  opportunity_feed: Array<Record<string, unknown>>;
  smart_recommendations: Array<Record<string, unknown>>;
  website_monitoring: Array<Record<string, unknown>>;
  campaign_optimizations: Array<Record<string, unknown>>;
  reply_assistant: Array<Record<string, unknown>>;
  revenue_dashboard: Record<string, unknown>;
  goal: GrowthGoal;
  proactive_mode: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  performance: Record<string, unknown>;
};

export type AICEOBriefing = {
  id: string;
  title: string;
  length: '30 sec' | '1 min' | '3 min' | '10 min';
  language: 'English' | 'Russian' | 'Spanish' | 'American English' | 'French' | 'Italian' | 'Polish' | 'Ukrainian';
  transcript: string;
  summary_json: Record<string, unknown>;
  created_at: string;
};

export type AICEOAnswer = {
  answer: string;
  related_metrics: Record<string, unknown>;
  safety_notice: string;
};

export type Profile = { workspace: string; company: string; avatar_url?: string | null; timezone: string; language: string };
export type Settings = Record<'general' | 'ai' | 'email' | 'billing' | 'security' | 'api', Record<string, unknown>>;

export type WorkspaceMember = { id: string; user_id: string; email: string; role: string; status: string; created_at: string };
export type Workspace = {
  id: string;
  name: string;
  company: string;
  industry: string;
  target_country: string;
  target_customer: string;
  timezone: string;
  language: string;
  onboarding_step: number;
  onboarding_completed: boolean;
  members: WorkspaceMember[];
};

export type PlanLimits = Record<string, number | boolean>;
export type BillingPlan = { name: string; price: number; limits: PlanLimits; current: boolean; active_subscription?: boolean };
export type BillingStatus = {
  plan: string;
  price: number;
  status: string;
  trial_end?: string | null;
  current_period_end?: string | null;
  trial_days_remaining: number;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  limits: PlanLimits;
  usage: Record<string, number>;
  sales_employees_used: number;
  workspaces_used: number;
};
export type Usage = { plan: string; period: string; limits: PlanLimits; usage: Record<string, number> };
export type AdminSummary = { users: number; workspaces: number; subscriptions: number; revenue: number; usage: Record<string, number>; system_health: Record<string, string> };

export type QualityCheck = {
  name: string;
  module: string;
  status: "healthy" | "degraded" | "broken" | "blocked" | string;
  severity: "critical" | "high" | "medium" | "low" | string;
  summary: string;
  evidence: Record<string, unknown>;
  suggested_fix: string;
};

export type QualityIssue = {
  id: string;
  fingerprint: string;
  title: string;
  module: string;
  severity: string;
  status: string;
  affected_area: string;
  root_cause: string;
  suggested_fix: string;
  evidence_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type QualityRepairTask = {
  id: string;
  issue_id?: string | null;
  title: string;
  priority: string;
  status: string;
  diagnosis: string;
  suggested_fix: string;
  required_tests: string[];
  approval_required: boolean;
  created_at: string;
};

export type QualityDashboard = {
  health_score: number;
  status: string;
  summary: string;
  deployment_gate: Record<string, unknown>;
  checks: QualityCheck[];
  open_bugs: QualityIssue[];
  repair_tasks: QualityRepairTask[];
  sentry_issues: Record<string, unknown>[];
  failed_integrations: QualityCheck[];
  failed_tests: QualityCheck[];
  broken_flows: QualityCheck[];
  suggested_fixes: string[];
  last_run_at?: string | null;
};
