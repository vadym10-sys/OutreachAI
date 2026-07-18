'use client';

import { FormEvent, useState } from 'react';
import { useSignIn } from '@clerk/nextjs/legacy';
import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { CheckCircle2, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { useAuthRuntime } from '@/components/app-providers';
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
    <div className="w-full max-w-[min(100%,28rem)] rounded-lg border border-slate-200 bg-white p-5 shadow-soft min-[360px]:p-6">
      <div className="mb-6">
        <p className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-brand">Secure account recovery</p>
        <h1 className="mt-4 text-2xl font-bold text-ink">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Use the email connected to your OutreachAI account. We will send secure reset instructions.</p>
      </div>

      {message && <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-brand">{message}</div>}
      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {step === 'request' && (
        <form onSubmit={requestReset} className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
              placeholder="you@company.com"
            />
          </label>
          <button disabled={!isLoaded || busy} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white disabled:opacity-60">
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Mail size={18} />}
            Send reset instructions
          </button>
        </form>
      )}

      {step === 'reset' && (
        <form onSubmit={completeReset} className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Reset code</span>
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
              placeholder="Enter the code from your email"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">New password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
              placeholder="Create a new password"
            />
          </label>
          <button disabled={!isLoaded || busy} className="focus-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 font-semibold text-white disabled:opacity-60">
            {busy ? <Loader2 className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
            Update password
          </button>
          <button type="button" onClick={() => setStep('request')} className="focus-ring min-h-11 w-full rounded-md border border-slate-300 px-4 py-2 font-semibold text-ink">
            Request a new email
          </button>
        </form>
      )}

      {step === 'success' && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-center">
          <CheckCircle2 className="mx-auto text-brand" size={28} />
          <p className="mt-3 font-semibold text-ink">Password reset complete</p>
          <Link href="/dashboard" className="focus-ring mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 py-2 font-semibold text-white">
            Continue to dashboard
          </Link>
        </div>
      )}

      <div className="mt-6 text-center text-sm text-slate-600">
        Remembered your password? <Link href="/sign-in" className="font-semibold text-brand">Back to sign in</Link>
      </div>
    </div>
  );
}

function PasswordResetUnavailable() {
  return (
    <div className="w-full max-w-[min(100%,28rem)] rounded-lg border border-slate-200 bg-white p-5 shadow-soft min-[360px]:p-6">
      <div className="mb-6">
        <p className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-brand">Secure account recovery</p>
        <h1 className="mt-4 text-2xl font-bold text-ink">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Secure password recovery is temporarily unavailable in this environment.</p>
      </div>
      <Link href="/sign-in" className="focus-ring inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 py-2 font-semibold text-white">
        Back to sign in
      </Link>
    </div>
  );
}
