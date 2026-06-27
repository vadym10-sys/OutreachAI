'use client';

import { useAuth } from '@clerk/nextjs';
import { clientApi } from '@/lib/client-api';
import { hasClerkPublishableKey, isClerkE2EBypass } from '@/lib/env';
import { useI18n } from '@/lib/i18n/provider';
import { localeLanguageNames, localeNames, locales, type Locale } from '@/lib/i18n/translations';
import type { Profile } from '@/lib/types';

function useOptionalAuth() {
  if (!hasClerkPublishableKey || isClerkE2EBypass) {
    return { getToken: async () => isClerkE2EBypass ? 'dev' : null, ready: isClerkE2EBypass };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getToken, isLoaded, isSignedIn } = useAuth();
  return { getToken, ready: isLoaded && Boolean(isSignedIn) };
}

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const { getToken, ready } = useOptionalAuth();

  async function changeLocale(next: Locale) {
    setLocale(next);
    if (!ready) return;
    try {
      const token = await getToken();
      const profile = await clientApi<Profile>('/api/profile', token);
      await clientApi<Profile>('/api/profile', token, {
        method: 'PUT',
        body: JSON.stringify({ ...profile, language: localeLanguageNames[next] }),
      });
    } catch (error) {
      console.error('Profile locale sync failed', error);
    }
  }

  return (
    <label className={`block ${compact ? 'min-w-28' : 'w-full'}`}>
      <span className={compact ? 'sr-only' : 'mb-1 block text-sm font-semibold text-slate-700'}>{t('common.language')}</span>
      <select
        value={locale}
        onChange={(event) => void changeLocale(event.target.value as Locale)}
        className={`${compact ? 'h-10 rounded-md text-xs' : 'min-h-11 rounded-md text-sm'} w-full border border-slate-300 bg-white px-2 font-semibold text-slate-700`}
        aria-label={t('common.language')}
      >
        {locales.map((item) => <option key={item} value={item}>{localeNames[item]}</option>)}
      </select>
    </label>
  );
}
