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
  ai_workflow_engine?: {
    version?: number;
    generated_at?: string;
    status?: string;
    current_state?: string;
    next_action?: string;
    states?: Record<
      string,
      {
        status?: string;
        reason?: string;
        next_if_pending?: string;
      }
    >;
    state_order?: string[];
    transitions?: Array<{
      from?: string;
      to?: string;
      condition?: string;
    }>;
    needs?: {
      enrichment?: boolean;
      website_analysis?: boolean;
      decision_maker?: boolean;
      ai_report?: boolean;
      email?: boolean;
      follow_up?: boolean;
      retry?: boolean;
      manual_review?: boolean;
    };
  } | null;
  deep_contact_search?: DeepContactSearch | null;
  intelligence_quality?: IntelligenceQuality | null;
  technologies?: string[];
  last_enriched_at?: string | null;
};

export type DeepContactCandidate = {
  name?: string;
  title?: string;
  linkedin?: string;
  email?: string;
  source?: string;
  confidence?: number;
  verification_status?: string;
  apollo_contact_id?: string;
  reason?: string;
};

export type DeepContactSearch = {
  status?: string;
  cached?: boolean;
  company_profile?: Record<string, unknown>;
  candidates?: DeepContactCandidate[];
  selected_decision_maker?: DeepContactCandidate | null;
  verified_email?: string;
  email_status?: string;
  confidence_score?: number;
  lead_score?: number;
  technologies?: string[];
  sources?: string[];
  errors?: Array<{ stage?: string; message?: string }>;
  stages?: Record<string, string>;
  last_enriched_at?: string;
};

export type IntelligenceQuality = {
  source?: string;
  used_sources?: string[];
  decision_basis?: string[];
  gaps?: string[];
  coverage_summary?: string;
  confidence_reason?: string;
  provider_improvements?: string[];
  confidence_score?: number;
};

export type CompanyIntelligenceField<T = unknown> = {
  value?: T | null;
  source?: string;
  confidence?: number;
};

export type CompanyIntelligence = {
  version?: number;
  generated_at?: string;
  cache_key?: string;
  sources?: string[];
  buying_intent?: {
    buying_signal_score?: number;
    urgency?: string;
    explanation?: string;
    evidence?: Array<{
      signal?: string;
      source_field?: string;
      value?: string;
      confidence?: number;
    }>;
    confidence?: number;
    recommended_outreach_timing?: string;
    signals?: Array<{
      signal?: string;
      detected?: boolean;
      weight?: number;
      score?: number;
      confidence?: number;
      evidence?: Array<{
        signal?: string;
        source_field?: string;
        value?: string;
        confidence?: number;
      }>;
    }>;
  };
  report?: {
    company_summary?: CompanyIntelligenceField<string>;
    products?: CompanyIntelligenceField<string[]>;
    icp?: CompanyIntelligenceField<string>;
    estimated_company_size?: CompanyIntelligenceField<string | number>;
    buying_signals?: CompanyIntelligenceField<string[]>;
    hiring_signals?: CompanyIntelligenceField<string[]>;
    technology_stack?: CompanyIntelligenceField<string[]>;
    competitors?: CompanyIntelligenceField<string[]>;
    possible_pain_points?: CompanyIntelligenceField<string[]>;
    best_outreach_angle?: CompanyIntelligenceField<string>;
    recommended_decision_maker?: CompanyIntelligenceField<string>;
    personalization_bullets?: CompanyIntelligenceField<string[]>;
    ai_confidence_score?: CompanyIntelligenceField<number>;
  };
  fields?: {
    official_website?: CompanyIntelligenceField<string>;
    business_description?: CompanyIntelligenceField<string>;
    industry?: CompanyIntelligenceField<string>;
    employee_count?: CompanyIntelligenceField<string | number>;
    technologies?: CompanyIntelligenceField<string[]>;
    company_linkedin?: CompanyIntelligenceField<string>;
    key_employee_linkedin?: CompanyIntelligenceField<string[]>;
    ceo_founder?: CompanyIntelligenceField<Record<string, unknown>>;
    verified_emails?: CompanyIntelligenceField<string[]>;
    phones?: CompanyIntelligenceField<string[]>;
    social_profiles?: CompanyIntelligenceField<string[]>;
    buying_signals?: CompanyIntelligenceField<string[]>;
    ai_summary?: CompanyIntelligenceField<string>;
    personalized_reason?: CompanyIntelligenceField<string>;
  };
  lead_score?: {
    value?: number;
    confidence?: number;
    reasons?: string[];
  };
  missing_fields?: string[];
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
  decision_maker_intelligence?: {
    contact_id?: string;
    name?: string;
    title?: string;
    is_verified_contact?: boolean;
    why_best_decision_maker?: string;
    estimated_responsibilities?: string[];
    probable_business_goals?: string[];
    likely_kpis?: string[];
    possible_pain_points?: string[];
    communication_style?: string;
    preferred_outreach_angle?: string;
    recommended_first_sentence?: string;
    estimated_authority_level?: string;
    confidence_score?: number;
    evidence_used?: Array<{ source_field?: string; value?: string; confidence?: number }>;
  };
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
  buying_signal_score?: number | null;
  buying_signal_urgency?: string | null;
  buying_signal_explanation?: string | null;
  buying_signal_evidence?: Array<Record<string, unknown>>;
  buying_signal_confidence?: number | null;
  recommended_outreach_timing?: string | null;
  overall_score?: number | null;
  reasoning?: string | null;
  top_positive_signals?: string[];
  top_negative_signals?: string[];
  recommended_next_action?: string | null;
  confidence?: number | null;
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
  deep_contact_search?: DeepContactSearch | null;
  decision_maker_intelligence?: {
    generated_at?: string;
    profiles?: Array<{
      contact_id?: string;
      name?: string;
      title?: string;
      is_verified_contact?: boolean;
      why_best_decision_maker?: string;
      estimated_responsibilities?: string[];
      probable_business_goals?: string[];
      likely_kpis?: string[];
      possible_pain_points?: string[];
      communication_style?: string;
      preferred_outreach_angle?: string;
      recommended_first_sentence?: string;
      estimated_authority_level?: string;
      confidence_score?: number;
      evidence_used?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    }>;
    top_contact_id?: string | null;
  } | null;
  opportunity_ranking?: {
    overall_score?: number;
    reasoning?: string;
    top_positive_signals?: string[];
    top_negative_signals?: string[];
    recommended_next_action?: string;
    confidence?: number;
    factors?: Record<string, number>;
  } | null;
  ai_outreach_strategy?: {
    why_contact_now?: string;
    why_contact_now_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    best_timing?: string;
    best_timing_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    best_communication_channel?: string;
    best_communication_channel_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    best_channel?: string;
    best_email_length?: string;
    best_email_length_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    best_subject_line?: string;
    best_subject_line_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    first_sentence?: string;
    first_sentence_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    strongest_value_proposition?: string;
    strongest_value_proposition_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    strongest_pain_point?: string;
    strongest_pain_point_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    expected_objections?: string[];
    expected_objections_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    follow_up_schedule?: string[];
    follow_up_schedule_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    objections?: string[];
    cta?: string;
    cta_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    estimated_reply_probability?: number;
    estimated_reply_probability_evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    probability_of_reply?: number;
    target_contact?: {
      name?: string;
      title?: string;
    };
    decision_maker_strategies?: Array<{
      contact_id?: string;
      name?: string;
      title?: string;
      best_subject_line?: string;
      first_sentence?: string;
      strongest_value_proposition?: string;
      strongest_pain_point?: string;
      expected_objections?: string[];
      cta?: string;
      estimated_reply_probability?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    }>;
  } | null;
  ai_competitor_intelligence?: {
    competitors?: string[];
    technologies?: string[];
    positioning?: string;
    strengths?: string[];
    weaknesses?: string[];
    market_gaps?: string[];
    opportunity_to_sell?: string;
  } | null;
  ai_company_timeline?: {
    generated_at?: string;
    funding_events?: Array<Record<string, unknown>>;
    hiring_events?: Array<Record<string, unknown>>;
    technology_changes?: Array<Record<string, unknown>>;
    website_changes?: Array<Record<string, unknown>>;
    leadership_changes?: Array<Record<string, unknown>>;
    new_locations?: Array<Record<string, unknown>>;
    product_launches?: Array<Record<string, unknown>>;
    partnerships?: Array<Record<string, unknown>>;
    events?: Array<{
      event_type?: string;
      event_date?: string;
      timestamp?: string;
      title?: string;
      details?: string;
      source?: string;
      evidence_snippet?: string;
      confidence?: number;
      provider?: string;
      enrichment_step?: string;
      model_version?: string;
      prompt_version?: string;
    }>;
  } | null;
  ai_company_predictions?: {
    generated_at?: string;
    estimated_arr?: {
      score?: number;
      reasoning?: string;
      confidence?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    };
    company_maturity?: {
      score?: number;
      reasoning?: string;
      confidence?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    };
    growth_probability?: {
      score?: number;
      reasoning?: string;
      confidence?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    };
    sales_readiness?: {
      score?: number;
      reasoning?: string;
      confidence?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    };
  } | null;
  ai_sales_timeline?: {
    today?: {
      step?: string;
      day_offset?: number;
      action?: string;
      email?: { subject?: string; body?: string };
      linkedin?: { message?: string; recommended?: boolean };
      phone?: { script?: string; recommended?: boolean };
      reminder?: string;
      success_probability?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    };
    plus_2_days?: {
      step?: string;
      day_offset?: number;
      action?: string;
      email?: { subject?: string; body?: string };
      linkedin?: { message?: string; recommended?: boolean };
      phone?: { script?: string; recommended?: boolean };
      reminder?: string;
      success_probability?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    };
    plus_5_days?: {
      step?: string;
      day_offset?: number;
      action?: string;
      email?: { subject?: string; body?: string };
      linkedin?: { message?: string; recommended?: boolean };
      phone?: { script?: string; recommended?: boolean };
      reminder?: string;
      success_probability?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    };
    plus_8_days?: {
      step?: string;
      day_offset?: number;
      action?: string;
      email?: { subject?: string; body?: string };
      linkedin?: { message?: string; recommended?: boolean };
      phone?: { script?: string; recommended?: boolean };
      reminder?: string;
      success_probability?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    };
    plus_14_days?: {
      step?: string;
      day_offset?: number;
      action?: string;
      email?: { subject?: string; body?: string };
      linkedin?: { message?: string; recommended?: boolean };
      phone?: { script?: string; recommended?: boolean };
      reminder?: string;
      success_probability?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    };
    steps?: Array<{
      step?: string;
      day_offset?: number;
      action?: string;
      email?: { subject?: string; body?: string };
      linkedin?: { message?: string; recommended?: boolean };
      phone?: { script?: string; recommended?: boolean };
      reminder?: string;
      success_probability?: number;
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    }>;
  } | null;
  ai_risk_analyzer?: {
    probability_company_will_ignore_outreach?: number;
    missing_data?: number;
    weak_personalization?: number;
    missing_decision_maker?: number;
    low_confidence?: number;
    stale_enrichment?: number;
    risk_score?: number;
    reasons?: string[];
    recommended_improvements?: string[];
    confidence?: number;
    factors?: {
      missing_data?: { risk?: number; evidence?: Array<{ source_field?: string; value?: string; confidence?: number }> };
      weak_personalization?: { risk?: number; evidence?: Array<{ source_field?: string; value?: string; confidence?: number }> };
      missing_decision_maker?: { risk?: number; evidence?: Array<{ source_field?: string; value?: string; confidence?: number }> };
      low_confidence?: { risk?: number; evidence?: Array<{ source_field?: string; value?: string; confidence?: number }> };
      stale_enrichment?: { risk?: number; age_days?: number; evidence?: Array<{ source_field?: string; value?: string; confidence?: number }> };
    };
  } | null;
  ai_sales_coach?: {
    why_this_company?: string;
    why_now?: string;
    why_this_decision_maker?: string;
    what_could_fail?: string[];
    how_to_increase_reply_rate?: string[];
    alternative_strategy?: string;
    target_contact?: {
      name?: string;
      title?: string;
    };
    evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    confidence?: number;
  } | null;
  ai_specialized_agents?: {
    company_analyst?: { agent?: string; status?: string; output?: Record<string, unknown>; confidence?: number };
    decision_maker_analyst?: { agent?: string; status?: string; output?: Record<string, unknown>; confidence?: number };
    buying_signal_analyst?: { agent?: string; status?: string; output?: Record<string, unknown>; confidence?: number };
    competitor_analyst?: { agent?: string; status?: string; output?: Record<string, unknown>; confidence?: number };
    email_writer?: { agent?: string; status?: string; output?: Record<string, unknown>; confidence?: number };
    sales_coach?: { agent?: string; status?: string; output?: Record<string, unknown>; confidence?: number };
  } | null;
  ai_agent_intermediate_reasoning?: Record<
    string,
    {
      reasoning?: string[];
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    }
  > | null;
  ai_final_orchestrator?: {
    agent?: string;
    status?: string;
    output?: Record<string, unknown>;
    confidence?: number;
  } | null;
  ai_executive_dashboard?: {
    generated_at?: string;
    source?: string;
    overall_opportunity_score?: { score?: number; reasoning?: string };
    buying_intent?: { score?: number; urgency?: string; reasoning?: string };
    decision_maker?: {
      contact_id?: string;
      name?: string;
      title?: string;
      authority_level?: string;
      is_verified_contact?: boolean;
    };
    top_risks?: string[];
    top_opportunities?: string[];
    recommended_next_action?: string;
    recommended_email?: { subject?: string; first_sentence?: string; cta?: string; channel?: string };
    recommended_follow_up?: string;
    competitor_summary?: { competitors?: string[]; market_gaps?: string[]; opportunity_to_sell?: string };
    evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    confidence?: number;
  } | null;
  ai_revenue_engine_report?: {
    generated_at?: string;
    source?: string;
    source_fingerprint?: string;
    executive_summary?: string;
    overall_opportunity_score?: { score?: number; reasoning?: string };
    buying_intent?: { score?: number; urgency?: string; reasoning?: string };
    decision_maker?: {
      contact_id?: string;
      name?: string;
      title?: string;
      authority_level?: string;
      is_verified_contact?: boolean;
    };
    best_contact_reason?: string;
    top_pain_points?: string[];
    top_opportunities?: string[];
    top_risks?: string[];
    competitor_position?: {
      positioning?: string;
      competitors?: string[];
      market_gaps?: string[];
      opportunity_to_sell?: string;
    };
    technology_summary?: {
      products?: string[];
      technology_stack?: string[];
    };
    recommended_outreach_strategy?: {
      why_contact_now?: string;
      best_timing?: string;
      best_channel?: string;
      strongest_value_proposition?: string;
    };
    recommended_first_email?: {
      subject?: string;
      first_sentence?: string;
      cta?: string;
    };
    recommended_follow_up_strategy?: {
      schedule?: string[];
      strategy?: string;
    };
    recommended_cta?: string;
    confidence?: number;
    evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
  } | null;
  ai_crm?: {
    generated_at?: string;
    auto_updated?: boolean;
    priority?: {
      tier?: string;
      score?: number;
      reasoning?: string;
    };
    health?: {
      status?: string;
      score?: number;
      reasoning?: string;
    };
    buying_intent?: {
      score?: number;
      urgency?: string;
      reasoning?: string;
    };
    risk?: {
      score?: number;
      level?: string;
      top_reasons?: string[];
    };
    relationship_status?: string;
    next_action?: string;
    last_ai_review?: string;
    upcoming_opportunity?: string;
  } | null;
  ai_ceo_dashboard?: {
    generated_at?: string;
    auto_updated?: boolean;
    todays_best_opportunities?: string[];
    new_buying_signals?: Array<{
      change_type?: string;
      added?: string[];
      detected_at?: string;
    }>;
    companies_at_risk?: Array<{
      company?: string;
      risk_score?: number;
      risk_level?: string;
      top_reasons?: string[];
    }>;
    competitors?: {
      companies?: string[];
      market_gaps?: string[];
      positioning?: string;
      opportunity_to_sell?: string;
    };
    sales_pipeline?: {
      crm_stage?: string;
      relationship_status?: string;
      next_action?: string;
    };
    expected_revenue?: {
      estimated_arr_score?: number;
      estimated_arr_reasoning?: string;
      opportunity_score?: number;
    };
    ai_recommendations?: string[];
    top_priorities?: string[];
    daily_summary?: string;
  } | null;
  ai_sales_os?: {
    generated_at?: string;
    autonomous?: boolean;
    safety?: {
      never_fabricate_facts?: boolean;
      policy?: string;
    };
    agents?: Record<
      string,
      {
        agent?: string;
        status?: string;
        output?: Record<string, unknown>;
        reasoning?: string[];
        evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
        confidence?: number;
        no_fabrication?: boolean;
      }
    >;
    intermediate_reasoning?: Record<
      string,
      {
        reasoning?: string[];
        evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
      }
    >;
    orchestrator?: {
      agent?: string;
      status?: string;
      autonomous?: boolean;
      execution_order?: string[];
      coordination_summary?: string;
      output?: Record<string, unknown>;
      confidence?: number;
    };
  } | null;
  ai_sales_workspace?: {
    generated_at?: string;
    provider?: string;
    model?: string;
    summary?: string;
    company_summary?: string;
    business_model?: string;
    what_company_sells?: string;
    target_customers?: string;
    company_stage?: string;
    pain_points?: string[];
    likely_business_pains?: string[];
    buying_signals?: string[];
    relevant_technologies?: string[];
    company_growth_indicators?: string[];
    why_fits_icp?: string[];
    why_may_not_fit?: string[];
    icp_fit_score?: number;
    ai_lead_score?: number;
    lead_priority_score?: number;
    lead_priority_tier?: string;
    buying_probability?: number;
    score_explanation?: string;
    estimated_reply_probability?: number;
    estimated_company_size?: string;
    estimated_revenue?: string;
    recommended_decision_maker_role?: string;
    decision_makers?: Array<{
      name?: string;
      title?: string;
      email?: string;
    }>;
    best_outreach_angle?: string;
    value_proposition?: string;
    best_communication_channel?: string;
    personalization_variables?: string[];
    predicted_objections?: string[];
    personalized_opening_line?: string;
    recommended_first_message?: string;
    personalized_follow_up_sequence?: string[];
    best_timing_to_contact?: string;
    strongest_sales_arguments?: string[];
    suggested_cta?: string;
    recommended_next_action?: string;
    opportunity_score?: number;
    buying_intent_score?: number;
    confidence_score?: number;
    decision_maker?: {
      name?: string;
      title?: string;
      email?: string;
    };
    outreach_angle?: string;
    best_subject_line?: string;
    best_cta?: string;
    risk_to_check?: string;
    next_action?: string;
    reasoning?: string[];
    missing_data?: string[];
    evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
    recommendation_actions?: Record<
      string,
      {
        label?: string;
        value?: unknown;
        approved?: boolean;
        edited?: boolean;
        regenerated?: boolean;
        confidence?: number;
        reasoning?: string;
        evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
        updated_at?: string;
      }
    >;
    ai_copilot_panel?: {
      generated_at?: string;
      summary?: string;
      confidence?: number;
      reasoning?: string[];
      evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
      policy?: string;
      recommendations?: Array<{
        key?: string;
        label?: string;
        confidence?: number;
        reasoning?: string;
        value?: unknown;
        evidence?: Array<{ source_field?: string; value?: string; confidence?: number }>;
      }>;
      last_action?: {
        key?: string;
        action?: string;
        at?: string;
        actor?: string;
      };
    };
    recommendation_audit_log?: Array<{
      event?: string;
      key?: string;
      actor?: string;
      at?: string;
      reason?: string;
      value_preview?: string;
    }>;
    version?: number;
  } | null;
  ai_sales_workspace_updated_at?: string | null;
  ai_live_buying_signals?: {
    generated_at?: string;
    latest_changes?: Array<{
      change_type?: string;
      added?: string[];
      previous?: string[];
      current?: string[];
      detected_at?: string;
    }>;
    change_timeline?: Array<{
      change_type?: string;
      added?: string[];
      detected_at?: string;
    }>;
    snapshot?: {
      new_hiring?: string[];
      technology_changes?: string[];
      website_changes?: string[];
      pricing_changes?: string[];
      new_products?: string[];
      leadership_changes?: string[];
      market_expansion?: string[];
      new_funding?: string[];
    };
  } | null;
  ai_lead_prioritization?: {
    generated_at?: string;
    tier?: "Hot" | "Warm" | "Cold" | "Needs More Data" | string;
    score?: number;
    reasoning?: string;
    confidence?: number;
    factors?: {
      buying_intent?: number;
      opportunity_score?: number;
      decision_maker_quality?: number;
      website_activity?: number;
      freshness?: number;
      ai_confidence?: number;
    };
  } | null;
  ai_sales_inbox_latest?: {
    at?: string;
    email_id?: string;
    provider_message_id?: string;
    classified_as?:
      | "Interested"
      | "Not Interested"
      | "Need Follow-up"
      | "Meeting Requested"
      | "Referral"
      | "Spam"
      | string;
    next_action?: string;
    recommended_reply?: string;
    reply_excerpt?: string;
    meeting_preparation?: {
      is_required?: boolean;
      agenda?: string[];
      materials?: string[];
    };
    crm_update?: {
      crm_stage?: string;
      email_status?: string;
      lead_status?: string;
    };
    task_creation?: {
      title?: string;
      description?: string;
      due_in_hours?: number;
    };
  } | null;
  ai_sales_inbox_history?: Array<{
    at?: string;
    email_id?: string;
    provider_message_id?: string;
    classified_as?: string;
    next_action?: string;
    recommended_reply?: string;
    reply_excerpt?: string;
    meeting_preparation?: {
      is_required?: boolean;
      agenda?: string[];
      materials?: string[];
    };
    crm_update?: {
      crm_stage?: string;
      email_status?: string;
      lead_status?: string;
    };
    task_creation?: {
      title?: string;
      description?: string;
      due_in_hours?: number;
    };
  }>;
  ai_evidence_engine?: {
    generated_at?: string;
    provider?: string;
    model_version?: string;
    prompt_version?: string;
    entries?: Array<{
      insight_key?: string;
      provider?: string;
      source?: string;
      raw_source?: string;
      evidence_snippet?: string;
      reasoning?: string;
      confidence?: number;
      timestamp?: string;
      enrichment_step?: string;
      model_version?: string;
      prompt_version?: string;
    }>;
    by_insight?: Record<
      string,
      Array<{
        source?: string;
        evidence?: string;
        reasoning?: string;
        confidence?: number;
        timestamp?: string;
        provider?: string;
      }>
    >;
  } | null;
  intelligence_quality?: IntelligenceQuality | null;
  company_intelligence?: CompanyIntelligence | null;
  technologies?: string[];
  last_enriched_at?: string | null;
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
  fit_reason?: string | null;
  risk_to_check?: string | null;
  next_best_action?: string | null;
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
  last_payment_error?: string;
  last_decline_code?: string;
  last_failure_message?: string;
  last_payment_failed_at?: string | null;
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
