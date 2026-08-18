"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";
import { useAuthRuntime } from "@/components/app-providers";
import { authSessionPendingMessage, clientApi, type ClientApiInit } from "@/lib/client-api";
import { isClerkE2EBypass, isProductionRuntime } from "@/lib/env";
import {
  agentApprovalPageSchema,
  agentRunDetailSchema,
  agentRunPageSchema,
  agentRunTraceSchema,
  agentRuntimeStatusSchema,
  parseAgentRuntimeResponse,
  type AgentApprovalPage,
  type AgentApprovalState,
  type AgentRunDetail,
  type AgentRunPage,
  type AgentRunStatus,
  type AgentRunTrace,
  type AgentRuntimeStatus
} from "@/lib/agent-runtime-contracts";

export type AgentRunListFilters = {
  status?: AgentRunStatus;
  cursor?: string;
  limit?: number;
};

export type AgentApprovalListFilters = {
  status?: Extract<AgentApprovalState, "pending" | "approved" | "rejected">;
  cursor?: string;
  limit?: number;
};

export type AgentRunCreatePayload = {
  objective: string;
  dry_run: boolean;
  idempotency_key?: string;
};

export type AgentApprovalPayload = {
  approval_request_id: string;
  idempotency_key?: string;
  actor_type?: "user";
  manual_draft_approval?: boolean;
  final_send_confirmation?: boolean;
  reason?: string;
};

export type AgentRuntimeApi = {
  ready: boolean;
  status(): Promise<AgentRuntimeStatus>;
  listRuns(filters?: AgentRunListFilters): Promise<AgentRunPage>;
  listApprovals(filters?: AgentApprovalListFilters): Promise<AgentApprovalPage>;
  createRun(payload: AgentRunCreatePayload): Promise<AgentRunDetail>;
  getRun(runId: string): Promise<AgentRunDetail>;
  getTrace(runId: string): Promise<AgentRunTrace>;
  approve(runId: string, payload: AgentApprovalPayload): Promise<AgentRunDetail>;
  reject(runId: string, approvalRequestId: string, reason: string): Promise<AgentRunDetail>;
  resume(runId: string): Promise<AgentRunDetail>;
  cancel(runId: string, reason: string): Promise<AgentRunDetail>;
};

function redirectToSignIn() {
  if (typeof window === "undefined" || isClerkE2EBypass) return;
  const redirectUrl = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.assign(`/sign-in?redirect_url=${redirectUrl}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authSessionPendingError() {
  return new Error(authSessionPendingMessage);
}

function clampLimit(limit = 20) {
  return Math.max(1, Math.min(Math.floor(limit) || 20, 50));
}

export function buildAgentRunsPath(filters: AgentRunListFilters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.cursor) params.set("cursor", filters.cursor);
  params.set("limit", String(clampLimit(filters.limit)));
  const query = params.toString();
  return `/api/workspace-app/agent-runs${query ? `?${query}` : ""}`;
}

export function buildAgentApprovalsPath(filters: AgentApprovalListFilters = {}) {
  const params = new URLSearchParams();
  params.set("status", filters.status || "pending");
  if (filters.cursor) params.set("cursor", filters.cursor);
  params.set("limit", String(clampLimit(filters.limit)));
  return `/api/workspace-app/agent-runs/approvals?${params.toString()}`;
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

export function useAgentRuntimeApi(): AgentRuntimeApi {
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
    if (!clerkEnabled || (isLoaded && !isSignedIn)) {
      redirectToSignIn();
      throw new Error("Please sign in again before continuing.");
    }
    if (!isLoaded) throw authSessionPendingError();
    const token = await getFreshToken();
    if (!token) throw authSessionPendingError();
    return clientApi<T>(path, token, init);
  }, [clerkEnabled, getFreshToken, isLoaded, isSignedIn]);

  const ready = ((!clerkEnabled && !isProductionRuntime) || isClerkE2EBypass) || (clerkEnabled && isLoaded && Boolean(isSignedIn));

  return useMemo(() => ({
    ready,
    status: async () => parseAgentRuntimeResponse(agentRuntimeStatusSchema, await request("/api/workspace-app/agent-runs/status"), "AI Tasks status"),
    listRuns: async (filters = {}) => parseAgentRuntimeResponse(agentRunPageSchema, await request(buildAgentRunsPath(filters)), "AI Tasks list"),
    listApprovals: async (filters = {}) => parseAgentRuntimeResponse(agentApprovalPageSchema, await request(buildAgentApprovalsPath(filters)), "AI Tasks approvals"),
    createRun: async (payload) => parseAgentRuntimeResponse(agentRunDetailSchema, await request("/api/workspace-app/agent-runs", {
      method: "POST",
      body: JSON.stringify({
        objective: payload.objective,
        dry_run: payload.dry_run,
        idempotency_key: payload.idempotency_key || `ai-task-${Date.now()}`
      }),
      timeoutMs: 30000
    }), "AI Task"),
    getRun: async (runId) => parseAgentRuntimeResponse(agentRunDetailSchema, await request(`/api/workspace-app/agent-runs/${runId}`), "AI Task detail"),
    getTrace: async (runId) => parseAgentRuntimeResponse(agentRunTraceSchema, await request(`/api/workspace-app/agent-runs/${runId}/trace`), "AI Task trace"),
    approve: async (runId, payload) => {
      await request(`/api/workspace-app/agent-runs/${runId}/approve`, {
        method: "POST",
        body: JSON.stringify({ ...payload, actor_type: "user" })
      });
      return parseAgentRuntimeResponse(agentRunDetailSchema, await request(`/api/workspace-app/agent-runs/${runId}`, { cache: "no-store" }), "AI Task detail");
    },
    reject: async (runId, approvalRequestId, reason) => {
      await request(`/api/workspace-app/agent-runs/${runId}/reject`, {
        method: "POST",
        body: JSON.stringify({ approval_request_id: approvalRequestId, reason })
      });
      return parseAgentRuntimeResponse(agentRunDetailSchema, await request(`/api/workspace-app/agent-runs/${runId}`, { cache: "no-store" }), "AI Task detail");
    },
    resume: async (runId) => parseAgentRuntimeResponse(agentRunDetailSchema, await request(`/api/workspace-app/agent-runs/${runId}/resume`, {
      method: "POST"
    }), "AI Task resume"),
    cancel: async (runId, reason) => {
      await request(`/api/workspace-app/agent-runs/${runId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      return parseAgentRuntimeResponse(agentRunDetailSchema, await request(`/api/workspace-app/agent-runs/${runId}`, { cache: "no-store" }), "AI Task detail");
    }
  }), [ready, request]);
}
