'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isLocale, localeLanguageNames, type Locale, translate, type TranslationKey } from '@/lib/i18n/translations';

const storageKey = 'outreachai.locale';
const cookieKey = 'outreachai_locale';

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey | string) => string;
  formatDate: (value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number) => string;
  formatCurrency: (value: number, currency?: string) => string;
  formatPercent: (value: number) => string;
  aiLanguage: string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (isLocale(stored)) return stored;
    const cookie = document.cookie.split('; ').find((item) => item.startsWith(`${cookieKey}=`))?.split('=')[1];
    if (isLocale(cookie)) return cookie;
    const browser = window.navigator.language;
    if (isLocale(browser)) return browser;
    const base = browser.split('-')[0];
    if (isLocale(base)) return base;
  } catch {
    // Some mobile in-app browsers and private sessions block storage access.
    // Falling back to English is expected and should not create customer-visible noise.
  }
  return 'en';
}

function persistLocale(locale: Locale) {
  try {
    window.localStorage.setItem(storageKey, locale);
    document.cookie = `${cookieKey}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
    document.documentElement.lang = locale;
  } catch {
    // Locale persistence is best-effort; blocked storage must never affect rendering.
  }
}

export function I18nProvider({ children, initialLocale: serverLocale = 'en' }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(serverLocale);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      const next = initialLocale();
      setLocaleState(next);
      persistLocale(next);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    persistLocale(locale);
  }, [loaded, locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const intlLocale = locale === 'en-US' ? 'en-US' : locale;
    return {
      locale,
      setLocale,
      t: (key) => translate(key, locale),
      formatDate: (value, options = { dateStyle: 'medium', timeStyle: 'short' }) => {
        if (!value) return translate('common.notScheduled', locale);
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return translate('common.notScheduled', locale);
        try {
          return new Intl.DateTimeFormat(intlLocale, options).format(date);
        } catch {
          return translate('common.notScheduled', locale);
        }
      },
      formatNumber: (value) => new Intl.NumberFormat(intlLocale).format(value),
      formatCurrency: (value, currency = 'EUR') => new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(value),
      formatPercent: (value) => new Intl.NumberFormat(intlLocale, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100),
      aiLanguage: localeLanguageNames[locale],
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    return {
      locale: 'en' as Locale,
      setLocale: () => undefined,
      t: (key: TranslationKey | string) => translate(key, 'en'),
      formatDate: (value: string | Date | null | undefined) => {
        if (!value) return translate('common.notScheduled', 'en');
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return translate('common.notScheduled', 'en');
        try {
          return new Intl.DateTimeFormat('en').format(date);
        } catch {
          return translate('common.notScheduled', 'en');
        }
      },
      formatNumber: (value: number) => new Intl.NumberFormat('en').format(value),
      formatCurrency: (value: number, currency = 'EUR') => new Intl.NumberFormat('en', { style: 'currency', currency }).format(value),
      formatPercent: (value: number) => new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(value / 100),
      aiLanguage: 'English',
    };
  }
  return context;
}
