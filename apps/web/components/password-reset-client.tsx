'use client';

import { FormEvent, useState } from 'react';
import { useSignIn } from '@clerk/nextjs/legacy';
import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { CheckCircle2, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { useAuthRuntime } from '@/components/app-providers';
import { AppBadge, SurfaceCard } from '@/components/design-system';
import { captureLogRocketException } from '@/lib/logrocket';
import {
  clerkPasswordResetErrorCode,
  genericPasswordResetRequestMessage,
  passwordResetRejectedCodeMessage,
  passwordResetRequestMessage
} from '@/lib/password-reset-errors';
import { capturePostHogException } from '@/lib/posthog';

type Step = 'request' | 'reset' | 'success';

function reportPasswordResetError(stage: 'request' | 'complete', error: unknown) {
  const code = clerkPasswordResetErrorCode(error);
  Sentry.captureException(error, {
    tags: { area: 'password-reset', stage, clerk_error_code: code || 'unknown' }
  });
  captureLogRocketException(error, { area: 'password-reset', stage, clerk_error_code: code || 'unknown' });
  capturePostHogException(error, { area: 'password-reset', stage, clerk_error_code: code || 'unknown' });
}

export function PasswordResetClient() {
  const { clerkEnabled } = useAuthRuntime();

  if (!clerkEnabled) {
    return <PasswordResetUnavailable />;
  }

  return <LivePasswordResetClient />;
}

function LivePasswordResetClient() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !signIn) return;
    setBusy(true);
    setError('');
    try {
      await signIn.create({ strategy: 'reset_password_email_code', identifier: email });
      setMessage(genericPasswordResetRequestMessage);
      setStep('reset');
    } catch (error) {
      reportPasswordResetError('request', error);
      const userMessage = passwordResetRequestMessage(error);
      if (userMessage === genericPasswordResetRequestMessage) {
        setMessage(genericPasswordResetRequestMessage);
        setStep('reset');
      } else {
        setError(userMessage);
      }
    } finally {
      setBusy(false);
    }
  }

  async function completeReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !signIn) return;
    setBusy(true);
    setError('');
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code,
        password,
      });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        setStep('success');
        setMessage('Password updated successfully. You can continue to your dashboard.');
        return;
      }
      setError('Password reset needs one more verification step. Open the latest reset email and try again.');
    } catch (error) {
      reportPasswordResetError('complete', error);
      setError(passwordResetRejectedCodeMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SurfaceCard className="w-full max-w-[min(100%,28rem)] rounded-[1.75rem] p-5 shadow-raised min-[360px]:p-6">
      <div className="mb-6">
        <AppBadge tone="brand">Secure account recovery</AppBadge>
        <h1 className="mt-4 text-3xl font-black tracking-normal text-[var(--ui-text)]">Forgot password</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">Use the email connected to your OutreachAI account. We will send secure reset instructions.</p>
      </div>

      {message && <div className="mb-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-success)] px-4 py-3 text-sm font-semibold text-success">{message}</div>}
      {error && <div className="mb-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-danger)] px-4 py-3 text-sm font-semibold text-danger">{error}</div>}

      {step === 'request' && (
        <form onSubmit={requestReset} className="space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-[var(--ui-text)]">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-base outline-none transition focus:border-[var(--ui-brand)] focus:ring-2 focus:ring-[var(--ui-focus-ring)]"
              placeholder="you@company.com"
            />
          </label>
          <button disabled={!isLoaded || busy} className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--ui-brand)] px-4 py-2 text-sm font-black text-white shadow-soft disabled:opacity-60">
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Mail size={18} />}
            Send reset instructions
          </button>
        </form>
      )}

      {step === 'reset' && (
        <form onSubmit={completeReset} className="space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-[var(--ui-text)]">Reset code</span>
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-base outline-none transition focus:border-[var(--ui-brand)] focus:ring-2 focus:ring-[var(--ui-focus-ring)]"
              placeholder="Enter the code from your email"
            />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-[var(--ui-text)]">New password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-base outline-none transition focus:border-[var(--ui-brand)] focus:ring-2 focus:ring-[var(--ui-focus-ring)]"
              placeholder="Create a new password"
            />
          </label>
          <button disabled={!isLoaded || busy} className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--ui-brand)] px-4 py-2 text-sm font-black text-white shadow-soft disabled:opacity-60">
            {busy ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
            Update password
          </button>
          <button type="button" onClick={() => setStep('request')} className="focus-ring min-h-12 w-full rounded-full border border-[var(--ui-border)] bg-white px-4 py-2 text-sm font-black text-[var(--ui-text)] shadow-sm">
            Request a new email
          </button>
        </form>
      )}

      {step === 'success' && (
        <div className="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface-success)] p-4 text-center">
          <CheckCircle2 className="mx-auto text-brand" size={28} />
          <p className="mt-3 font-semibold text-[var(--ui-text)]">Password reset complete</p>
          <Link href="/dashboard" className="focus-ring mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--ui-brand)] px-4 py-2 text-sm font-black text-white">
            Continue to dashboard
          </Link>
        </div>
      )}

      <div className="mt-6 text-center text-sm text-[var(--ui-text-soft)]">
        Remembered your password? <Link href="/sign-in" className="font-semibold text-brand">Back to sign in</Link>
      </div>
    </SurfaceCard>
  );
}

function PasswordResetUnavailable() {
  return (
    <SurfaceCard className="w-full max-w-[min(100%,28rem)] rounded-[1.75rem] p-5 shadow-raised min-[360px]:p-6">
      <div className="mb-6">
        <AppBadge tone="brand">Secure account recovery</AppBadge>
        <h1 className="mt-4 text-3xl font-black text-[var(--ui-text)]">Forgot password</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ui-text-soft)]">Secure password recovery is temporarily unavailable in this environment.</p>
      </div>
      <Link href="/sign-in" className="focus-ring inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--ui-brand)] px-4 py-2 text-sm font-black text-white shadow-soft">
        Back to sign in
      </Link>
    </SurfaceCard>
  );
}
