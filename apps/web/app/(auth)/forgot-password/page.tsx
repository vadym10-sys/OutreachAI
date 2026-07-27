import { PasswordResetClient } from "@/components/password-reset-client";
import { hasClerkPublishableKey } from "@/lib/env";

function MissingClerkConfig() {
  return (
    <div className="max-w-md rounded-[1.75rem] border border-[var(--ui-border)] bg-white p-6 text-center shadow-raised">
      <h1 className="text-xl font-bold text-ink">Password reset is temporarily unavailable</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--ui-text-soft)]">
        We could not load secure password recovery for this session. Please try again shortly.
      </p>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-[var(--ui-bg)] px-4 py-6 min-[360px]:px-5">
      {hasClerkPublishableKey ? <PasswordResetClient /> : <MissingClerkConfig />}
    </main>
  );
}
