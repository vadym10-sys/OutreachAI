'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Bot, ChevronDown, History, Loader2, Mic, Play, Send, Volume2, X } from 'lucide-react';
import { clientApi } from '@/lib/client-api';
import { hasClerkPublishableKey, isClerkE2EBypass } from '@/lib/env';
import type { AICEOAnswer, AICEOBriefing } from '@/lib/types';

const lengths = ['30 sec', '1 min', '3 min', '10 min'] as const;
const languages = ['English', 'Russian', 'Ukrainian', 'Polish'] as const;

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  onresult: ((event: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
  start: () => void;
};

function useCEOApi() {
  if (!hasClerkPublishableKey || isClerkE2EBypass) {
    return { ready: true, getToken: async () => isClerkE2EBypass ? 'dev' : null };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getToken, isLoaded, isSignedIn } = useAuth();
  return { ready: isLoaded && Boolean(isSignedIn), getToken };
}

function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function canListen() {
  if (typeof window === 'undefined') return false;
  const win = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

function speechLang(language: string) {
  if (language === 'Russian') return 'ru-RU';
  if (language === 'Ukrainian') return 'uk-UA';
  if (language === 'Polish') return 'pl-PL';
  return 'en-US';
}

export function AICEOVoiceBriefing() {
  const { ready, getToken } = useCEOApi();
  const [open, setOpen] = useState(false);
  const [length, setLength] = useState<typeof lengths[number]>('1 min');
  const [language, setLanguage] = useState<typeof languages[number]>('English');
  const [briefing, setBriefing] = useState<AICEOBriefing | null>(null);
  const [history, setHistory] = useState<AICEOBriefing[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceAvailable] = useState(() => canSpeak());
  const [micAvailable] = useState(() => canListen());

  const token = useCallback(async () => isClerkE2EBypass ? 'dev' : await getToken(), [getToken]);

  const speak = useCallback((text: string, selectedLanguage = language) => {
    if (!voiceAvailable || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang(selectedLanguage);
    utterance.rate = 0.92;
    utterance.pitch = 0.95;
    window.speechSynthesis.speak(utterance);
  }, [language, voiceAvailable]);

  const loadHistory = useCallback(async () => {
    if (!ready) return;
    try {
      const authToken = await token();
      const data = await clientApi<AICEOBriefing[]>('/api/ai-ceo/briefings', authToken);
      setHistory(data);
    } catch (nextError) {
      console.error('AI CEO history failed', nextError);
    }
  }, [ready, token]);

  async function listenReport() {
    setOpen(true);
    setBusy('briefing');
    setError('');
    try {
      const authToken = await token();
      void loadHistory();
      const data = await clientApi<AICEOBriefing>('/api/ai-ceo/briefings', authToken, {
        method: 'POST',
        body: JSON.stringify({ length, language })
      });
      setBriefing(data);
      setHistory((items) => [data, ...items.filter((item) => item.id !== data.id)].slice(0, 30));
      speak(data.transcript, data.language);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'AI CEO report could not be generated.');
    } finally {
      setBusy('');
    }
  }

  async function askQuestion() {
    if (!question.trim()) return;
    setBusy('question');
    setError('');
    try {
      const authToken = await token();
      const data = await clientApi<AICEOAnswer>('/api/ai-ceo/question', authToken, {
        method: 'POST',
        body: JSON.stringify({ question, language })
      });
      setAnswer(data.answer);
      speak(data.answer, language);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'AI CEO could not answer.');
    } finally {
      setBusy('');
    }
  }

  function startListening() {
    if (!micAvailable || typeof window === 'undefined') return;
    const win = window as Window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRecognitionConstructor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRecognitionConstructor) return;
    const recognition = new SpeechRecognitionConstructor();
    recognition.lang = speechLang(language);
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onerror = (event) => {
      console.error('AI CEO microphone failed', event);
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      setQuestion(transcript);
    };
    recognition.start();
  }

  return (
    <>
      <button
        type="button"
        onClick={listenReport}
        disabled={!ready || busy === 'briefing'}
        className="focus-ring fixed bottom-24 right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm font-bold text-white shadow-soft disabled:opacity-60 lg:bottom-6 lg:right-6"
      >
        {busy === 'briefing' ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
        Listen AI Report
      </button>

      {open && <section className="fixed inset-x-3 bottom-40 z-50 max-h-[min(78vh,44rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-soft min-[430px]:left-auto min-[430px]:right-4 min-[430px]:w-[25rem] lg:bottom-24 lg:right-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-brand"><Bot size={18} /> AI CEO</p>
            <h2 className="mt-1 text-lg font-bold text-ink">Executive voice briefing</h2>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="focus-ring grid size-10 place-items-center rounded-md border border-slate-300" aria-label="Close AI CEO report"><X size={18} /></button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="text-sm font-semibold text-slate-700">Length<select value={length} onChange={(event) => setLength(event.target.value as typeof lengths[number])} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal">{lengths.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="text-sm font-semibold text-slate-700">Language<select value={language} onChange={(event) => setLanguage(event.target.value as typeof languages[number])} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-normal">{languages.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={listenReport} disabled={busy === 'briefing'} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white"><Volume2 size={16} /> Generate & play</button>
          {briefing && <button type="button" onClick={() => speak(briefing.transcript, briefing.language)} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold"><Play size={16} /> Replay</button>}
        </div>

        {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!voiceAvailable && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">Voice playback is not available in this browser. The report is still shown below.</p>}

        <article className="mt-4 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">
          {briefing ? briefing.transcript : 'Press Listen AI Report to hear a calm executive summary of revenue, pipeline, AI employee work, risks, opportunities, and today’s priorities.'}
        </article>

        <div className="mt-4 rounded-md border border-slate-200 p-3">
          <p className="text-sm font-bold">Ask the AI CEO</p>
          <div className="mt-2 grid gap-2 min-[390px]:grid-cols-[1fr_auto]">
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should I do next?" className="min-h-11 rounded-md border border-slate-300 px-3 text-sm" />
            <div className="flex gap-2">
              <button type="button" onClick={startListening} disabled={!micAvailable || listening} className="focus-ring grid size-11 place-items-center rounded-md border border-slate-300" aria-label="Ask by voice"><Mic size={16} /></button>
              <button type="button" onClick={askQuestion} disabled={busy === 'question'} className="focus-ring grid size-11 place-items-center rounded-md bg-ink text-white" aria-label="Send question">{busy === 'question' ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}</button>
            </div>
          </div>
          {answer && <p className="mt-3 rounded-md bg-teal-50 p-3 text-sm text-brand">{answer}</p>}
        </div>

        <details className="mt-4 rounded-md border border-slate-200 p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold"><span className="inline-flex items-center gap-2"><History size={16} /> Briefing history</span><ChevronDown size={16} /></summary>
          <div className="mt-3 space-y-2">
            {history.length ? history.map((item) => <button key={item.id} type="button" onClick={() => { setBriefing(item); speak(item.transcript, item.language); }} className="w-full rounded-md bg-slate-50 p-3 text-left text-sm"><span className="font-semibold">{item.title}</span><span className="mt-1 block text-slate-500">{new Date(item.created_at).toLocaleString()} · {item.length} · {item.language}</span></button>) : <p className="text-sm text-slate-500">No saved briefings yet.</p>}
          </div>
        </details>
      </section>}
    </>
  );
}
