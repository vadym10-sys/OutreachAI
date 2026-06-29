'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isLocale, localeLanguageNames, type Locale, translate, translateVisibleText, type TranslationKey } from '@/lib/i18n/translations';

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
  } catch (error) {
    console.error('Locale read failed', error);
  }
  return 'en';
}

function persistLocale(locale: Locale) {
  try {
    window.localStorage.setItem(storageKey, locale);
    document.cookie = `${cookieKey}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
    document.documentElement.lang = locale;
  } catch (error) {
    console.error('Locale persistence failed', error);
  }
}

const textNodeOriginals = new WeakMap<Text, string>();
const attrOriginals = new WeakMap<Element, Map<string, string>>();

function translateDom(locale: Locale) {
  if (typeof document === 'undefined') return;
  const blocked = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || blocked.has(parent.tagName) || parent.closest('[data-i18n-skip="true"]')) return NodeFilter.FILTER_REJECT;
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const current = node.textContent || '';
    const cachedOriginal = textNodeOriginals.get(node);
    const cachedTranslated = cachedOriginal ? translateVisibleText(cachedOriginal, locale) : '';
    const original = cachedOriginal && (current === cachedOriginal || current === cachedTranslated) ? cachedOriginal : current;
    textNodeOriginals.set(node, original);
    node.textContent = translateVisibleText(original, locale);
  }

  const attrNames = ['placeholder', 'aria-label', 'title'] as const;
  for (const attr of attrNames) {
    document.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((element) => {
      let originals = attrOriginals.get(element);
      if (!originals) {
        originals = new Map<string, string>();
        attrOriginals.set(element, originals);
      }
      const current = element.getAttribute(attr) || '';
      const cachedOriginal = originals.get(attr);
      const cachedTranslated = cachedOriginal ? translateVisibleText(cachedOriginal, locale) : '';
      const original = cachedOriginal && (current === cachedOriginal || current === cachedTranslated) ? cachedOriginal : current;
      originals.set(attr, original);
      element.setAttribute(attr, translateVisibleText(original, locale));
    });
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = initialLocale();
      setLocaleState(next);
      persistLocale(next);
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    persistLocale(locale);
  }, [loaded, locale]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    let id: number | null = null;
    const schedule = () => {
      if (id) window.clearTimeout(id);
      id = window.setTimeout(() => {
        translateDom(locale);
        id = null;
      }, 0);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (id) window.clearTimeout(id);
      observer.disconnect();
    };
  }, [locale]);

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
        return new Intl.DateTimeFormat(intlLocale, options).format(new Date(value));
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
      formatDate: (value: string | Date | null | undefined) => value ? new Intl.DateTimeFormat('en').format(new Date(value)) : translate('common.notScheduled', 'en'),
      formatNumber: (value: number) => new Intl.NumberFormat('en').format(value),
      formatCurrency: (value: number, currency = 'EUR') => new Intl.NumberFormat('en', { style: 'currency', currency }).format(value),
      formatPercent: (value: number) => new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(value / 100),
      aiLanguage: 'English',
    };
  }
  return context;
}
