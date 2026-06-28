const ignoredMessages = [
  /extension context invalidated/i,
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /safari-web-extension:\/\//i,
  /adblock/i,
  /ad blocker/i,
  /network request failed/i,
  /networkerror/i,
  /failed to fetch/i,
  /load failed/i,
  /the internet connection appears to be offline/i,
  /cancelled/i,
  /aborterror/i
];

const ignoredSources = [
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
  "extensions/"
];

export function shouldDropSentryEvent(event: { message?: string; exception?: { values?: Array<{ value?: string; stacktrace?: { frames?: Array<{ filename?: string }> } }> }; request?: { url?: string } }) {
  const message = [
    event.message,
    ...(event.exception?.values || []).map((exception) => exception.value)
  ].filter(Boolean).join(" ");

  if (ignoredMessages.some((pattern) => pattern.test(message))) {
    return true;
  }

  const frameSources = (event.exception?.values || [])
    .flatMap((exception) => exception.stacktrace?.frames || [])
    .map((frame) => frame.filename || "");
  const sources = [event.request?.url || "", ...frameSources];

  return sources.some((source) => ignoredSources.some((ignoredSource) => source.includes(ignoredSource)));
}

export function sentryEnvironment() {
  return process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development";
}
