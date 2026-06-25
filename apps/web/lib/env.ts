export const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
export const clerkSecretKey = process.env.CLERK_SECRET_KEY;

export const hasClerkPublishableKey = Boolean(clerkPublishableKey);
export const hasClerkRuntimeConfig = Boolean(clerkPublishableKey && clerkSecretKey);
