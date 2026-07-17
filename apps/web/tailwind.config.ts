import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ui-text)",
        muted: "var(--ui-text-soft)",
        brand: "var(--ui-brand)",
        coral: "var(--ui-accent-2)",
        sky: "var(--ui-accent)"
      },
      boxShadow: {
        soft: "var(--ui-shadow)",
        glow: "var(--ui-shadow-glow)"
      }
    }
  },
  plugins: []
};

export default config;
