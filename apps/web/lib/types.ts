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
  conversion_rate: number;
  meetings: number;
  revenue: number;
  mrr: number;
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
  campaign?: string | null;
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
  delivery_status: string;
  sent_at?: string | null;
  delivered_at?: string | null;
  opened_at?: string | null;
  bounced_at?: string | null;
  replied_at?: string | null;
};

export type Activity = { id: string; action: string; metadata_json: Record<string, unknown>; created_at: string };
export type Notification = { id: string; kind: string; title: string; message: string; created_at: string };
export type Profile = { workspace: string; company: string; avatar_url?: string | null; timezone: string; language: string };
export type Settings = Record<'general' | 'ai' | 'email' | 'billing' | 'security' | 'api', Record<string, unknown>>;
