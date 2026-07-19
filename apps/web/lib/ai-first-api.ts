"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";
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
  createCampaign(payload: Partial<Campaign>): Promise<Campaign>;
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

function useClerkTokenApi(clerkEnabled: boolean) {
  if (!clerkEnabled || isClerkE2EBypass) {
    return {
      getToken: async () => isClerkE2EBypass ? "dev" : null,
      isLoaded: !clerkEnabled || isClerkE2EBypass,
      isSignedIn: isClerkE2EBypass
    };
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

  return {
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
    approveEmail: (emailId) => request<WorkspaceAppActionResponse>(`/api/workspace-app/emails/${emailId}/approve`, { method: "POST" }),
    sendApprovedEmail: (emailId) => request<WorkspaceAppActionResponse>(`/api/workspace-app/emails/${emailId}/send`, { method: "POST" }),
    listEmails: () => request<Email[]>("/api/inbox"),
    getWorkspace: () => request<Workspace>("/api/workspace/me"),
    updateWorkspace: (payload) => request<Workspace>("/api/workspace", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
    integrations: () => request<WorkspaceIntegrationStatusResponse>("/api/workspace-app/integrations/status"),
    senderStatus: () => request<OutreachSenderStatus>("/api/outreach/sender/status"),
    createCampaign: (payload) => request<Campaign>("/api/campaigns", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
    campaignAction: (campaignId, action) => request<Campaign>(`/api/campaigns/${campaignId}/${action}`, { method: "POST" })
  };
}

export function latestDraftForResult(result: FirstCustomerResult) {
  return result.email_id || "";
}
