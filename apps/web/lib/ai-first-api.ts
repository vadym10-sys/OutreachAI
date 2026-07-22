"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";
import { useAuthRuntime } from "@/components/app-providers";
import { clientApi, type ClientApiInit } from "@/lib/client-api";
import { isClerkE2EBypass, isProductionRuntime } from "@/lib/env";
import type {
  FirstCustomerJob,
  FirstCustomerResult,
  FirstCustomerSaveResponse,
  OutreachSenderStatus,
  WorkspaceAppActionResponse,
  WorkspaceAppBootstrapResponse,
  WorkspaceIntegrationStatusResponse
} from "@/lib/customer-api-contracts";
import type { Campaign, CrmCompany, Email, Workspace } from "@/lib/types";

export type AiAssistantCommand = {
  command: string;
  companyWebsite: string;
  companyDescription: string;
  productOrService: string;
  desiredCustomers: string;
  targetCountry: string;
  targetIndustry: string;
  companySize: string;
  contactTitles: string[];
  keywords: string[];
  exclusions: string[];
  maxResults: number;
};

export type AiFirstApi = {
  ready: boolean;
  bootstrap(): Promise<WorkspaceAppBootstrapResponse>;
  listCompanies(): Promise<CrmCompany[]>;
  startCustomerFinder(command: AiAssistantCommand): Promise<FirstCustomerJob>;
  listCustomerFinderJobs(): Promise<FirstCustomerJob[]>;
  getCustomerFinderJob(jobId: string): Promise<FirstCustomerJob>;
  saveFinderResult(resultId: string): Promise<FirstCustomerSaveResponse>;
  approveEmail(emailId: string): Promise<WorkspaceAppActionResponse>;
  sendApprovedEmail(emailId: string): Promise<WorkspaceAppActionResponse>;
  listEmails(): Promise<Email[]>;
  getWorkspace(): Promise<Workspace>;
  updateWorkspace(payload: Partial<Workspace>): Promise<Workspace>;
  integrations(): Promise<WorkspaceIntegrationStatusResponse>;
  senderStatus(): Promise<OutreachSenderStatus>;
  startGmailOAuth(): Promise<{ auth_url: string }>;
  disconnectGmail(): Promise<OutreachSenderStatus>;
  syncGmailReplies(): Promise<{ synced: number; classified: Record<string, number> }>;
  createCampaign(payload: Partial<Campaign>): Promise<Campaign>;
  approveAutopilotCampaign(campaignId: string, jobId: string): Promise<Campaign>;
  campaignAction(campaignId: string, action: "launch" | "resume" | "pause" | "stop"): Promise<Campaign>;
};

function redirectToSignIn() {
  if (typeof window === "undefined" || isClerkE2EBypass) return;
  const redirectUrl = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.assign(`/sign-in?redirect_url=${redirectUrl}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function devRequest<T>(path: string, init: ClientApiInit = {}) {
  return clientApi<T>(path, "dev", init);
}

const e2eTokenApi = {
  getToken: async () => "dev",
  isLoaded: true,
  isSignedIn: true
};

const disabledTokenApi = {
  getToken: async () => null,
  isLoaded: true,
  isSignedIn: false
};

function useClerkTokenApi(clerkEnabled: boolean) {
  if (!clerkEnabled || isClerkE2EBypass) {
    return isClerkE2EBypass ? e2eTokenApi : disabledTokenApi;
  }
  // Clerk is only called when AppProviders mounted ClerkProvider.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAuth();
}

function finderPayload(command: AiAssistantCommand) {
  return {
    company_website: command.companyWebsite,
    company_description: command.companyDescription,
    product_or_service: command.productOrService,
    desired_customers: command.desiredCustomers || command.command,
    target_country: command.targetCountry || "Any",
    target_industry: command.targetIndustry || "B2B",
    company_size: command.companySize,
    contact_titles: command.contactTitles,
    max_results: command.maxResults,
    additional_criteria: command.command,
    keywords: command.keywords,
    exclusions: command.exclusions
  };
}

function requireSuccessfulAction(response: WorkspaceAppActionResponse) {
  if (response.status !== "success" && response.status !== "partial_success") {
    throw new Error(response.message || "This action could not be completed.");
  }
  return response;
}

export function useAiFirstApi(): AiFirstApi {
  const { clerkEnabled } = useAuthRuntime();
  const { getToken, isLoaded, isSignedIn } = useClerkTokenApi(clerkEnabled);

  const getFreshToken = useCallback(async () => {
    let token = await getToken({ skipCache: true });
    for (let attempt = 0; !token && attempt < 20; attempt += 1) {
      await delay(100);
      token = await getToken({ skipCache: true });
    }
    return token;
  }, [getToken]);

  const request = useCallback(async function request<T>(path: string, init: ClientApiInit = {}) {
    if ((!clerkEnabled && !isProductionRuntime) || isClerkE2EBypass) {
      return devRequest<T>(path, init);
    }
    if (!clerkEnabled || !isLoaded || !isSignedIn) {
      redirectToSignIn();
      throw new Error("Please sign in again before continuing.");
    }
    const token = await getFreshToken();
    if (!token) {
      redirectToSignIn();
      throw new Error("Please sign in again before continuing.");
    }
    return clientApi<T>(path, token, init);
  }, [clerkEnabled, getFreshToken, isLoaded, isSignedIn]);

  const ready = ((!clerkEnabled && !isProductionRuntime) || isClerkE2EBypass) || (clerkEnabled && isLoaded && Boolean(isSignedIn));

  return useMemo(() => ({
    ready,
    bootstrap: () => request<WorkspaceAppBootstrapResponse>("/api/workspace-app/bootstrap"),
    listCompanies: () => request<CrmCompany[]>("/api/workspace-app/companies"),
    startCustomerFinder: (command) => request<FirstCustomerJob>("/api/workspace-app/ai-customer-finder/searches", {
      method: "POST",
      body: JSON.stringify(finderPayload(command)),
      timeoutMs: 30000
    }),
    listCustomerFinderJobs: () => request<FirstCustomerJob[]>("/api/workspace-app/ai-customer-finder/searches"),
    getCustomerFinderJob: (jobId) => request<FirstCustomerJob>(`/api/workspace-app/ai-customer-finder/searches/${jobId}`),
    saveFinderResult: (resultId) => request<FirstCustomerSaveResponse>(`/api/workspace-app/leads/first-customers/results/${resultId}/save`, { method: "POST" }),
    approveEmail: async (emailId) => requireSuccessfulAction(await request<WorkspaceAppActionResponse>(`/api/workspace-app/emails/${emailId}/approve`, { method: "POST" })),
    sendApprovedEmail: async (emailId) => requireSuccessfulAction(await request<WorkspaceAppActionResponse>(`/api/workspace-app/emails/${emailId}/send`, { method: "POST" })),
    listEmails: () => request<Email[]>("/api/inbox"),
    getWorkspace: () => request<Workspace>("/api/workspace/me"),
    updateWorkspace: (payload) => request<Workspace>("/api/workspace", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
    integrations: () => request<WorkspaceIntegrationStatusResponse>("/api/workspace-app/integrations/status"),
    senderStatus: () => request<OutreachSenderStatus>("/api/outreach/sender/status"),
    startGmailOAuth: () => request<{ auth_url: string }>("/api/outreach/oauth/gmail/start"),
    disconnectGmail: () => request<OutreachSenderStatus>("/api/outreach/oauth/gmail", { method: "DELETE" }),
    syncGmailReplies: () => request<{ synced: number; classified: Record<string, number> }>("/api/outreach/oauth/gmail/sync", { method: "POST" }),
    createCampaign: (payload) => request<Campaign>("/api/campaigns", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
    approveAutopilotCampaign: (campaignId, jobId) => request<Campaign>(`/api/campaigns/${campaignId}/autopilot/approve`, {
      method: "POST",
      body: JSON.stringify({ job_id: jobId })
    }),
    campaignAction: (campaignId, action) => request<Campaign>(`/api/campaigns/${campaignId}/${action}`, { method: "POST" })
  }), [ready, request]);
}

export function latestDraftForResult(result: FirstCustomerResult) {
  return result.email_id || "";
}
