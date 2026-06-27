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
  company: string;
  website?: string | null;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  contact?: string | null;
  email?: string | null;
  status: string;
  campaign_id?: string | null;
  sales_employee_id?: string | null;
  campaign?: string | null;
  notes?: string | null;
  revenue?: number;
};

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
  estimated_revenue: number;
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
