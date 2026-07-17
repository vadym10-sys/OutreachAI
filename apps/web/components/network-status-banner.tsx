"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

export function NetworkStatusBanner() {
  const { t } = useI18n();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div role="status" aria-live="polite" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
      <div className="mx-auto flex max-w-7xl items-start gap-3 text-sm font-semibold leading-6">
        <WifiOff className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
        <p>{t("You are offline. OutreachAI will keep this page open; reconnect and retry the last action.")}</p>
      </div>
    </div>
  );
}
