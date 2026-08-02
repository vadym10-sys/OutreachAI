export const planNames = ["Starter", "Pro", "Agency"] as const;

export type PlanName = (typeof planNames)[number];

export type PublicPlan = {
  name: PlanName;
  monthlyPrice: number;
  currency: "EUR";
  trialDays: number;
  limits: {
    leads: number;
    aiGenerations: number;
    emailSends: number;
    salesEmployees: number;
    workspaces: number;
    teamMembers: number;
    campaigns: number;
  };
  features: {
    reviewMode: boolean;
    semiAutoMode: boolean;
    autonomousMode: boolean;
    advancedAnalytics: boolean;
    replyAi: boolean;
    apiAccess: boolean;
    webhooks: boolean;
    whiteLabel: boolean;
  };
};

export const publicPlans: PublicPlan[] = [
  {
    name: "Starter",
    monthlyPrice: 49,
    currency: "EUR",
    trialDays: 14,
    limits: {
      leads: 500,
      aiGenerations: 1000,
      emailSends: 1000,
      salesEmployees: 1,
      workspaces: 1,
      teamMembers: 1,
      campaigns: 3,
    },
    features: {
      reviewMode: true,
      semiAutoMode: false,
      autonomousMode: false,
      advancedAnalytics: false,
      replyAi: false,
      apiAccess: false,
      webhooks: false,
      whiteLabel: false,
    },
  },
  {
    name: "Pro",
    monthlyPrice: 149,
    currency: "EUR",
    trialDays: 14,
    limits: {
      leads: 5000,
      aiGenerations: 10000,
      emailSends: 10000,
      salesEmployees: 3,
      workspaces: 3,
      teamMembers: 10,
      campaigns: 25,
    },
    features: {
      reviewMode: true,
      semiAutoMode: true,
      autonomousMode: false,
      advancedAnalytics: true,
      replyAi: true,
      apiAccess: false,
      webhooks: false,
      whiteLabel: false,
    },
  },
  {
    name: "Agency",
    monthlyPrice: 499,
    currency: "EUR",
    trialDays: 14,
    limits: {
      leads: 50000,
      aiGenerations: 100000,
      emailSends: 100000,
      salesEmployees: 10,
      workspaces: 0,
      teamMembers: 0,
      campaigns: 0,
    },
    features: {
      reviewMode: true,
      semiAutoMode: true,
      autonomousMode: true,
      advancedAnalytics: true,
      replyAi: true,
      apiAccess: true,
      webhooks: true,
      whiteLabel: true,
    },
  },
];

export function isPlanName(value: string | null | undefined): value is PlanName {
  return Boolean(value && planNames.includes(value as PlanName));
}

export function planByName(name: PlanName): PublicPlan {
  return publicPlans.find((plan) => plan.name === name) ?? publicPlans[0];
}

export function selectedPlanFromQuery(value: string | null | undefined): PublicPlan | null {
  return isPlanName(value) ? planByName(value) : null;
}

