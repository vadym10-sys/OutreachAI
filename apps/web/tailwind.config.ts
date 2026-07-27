import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ui-text)",
        muted: "var(--ui-text-soft)",
        surface: "var(--ui-surface)",
        "surface-subtle": "var(--ui-surface-subtle)",
        brand: "var(--ui-brand)",
        "brand-strong": "var(--ui-brand-strong)",
        "brand-soft": "var(--ui-brand-soft)",
        coral: "var(--ui-accent-2)",
        sky: "var(--ui-accent)",
        success: "var(--ui-success)",
        warning: "var(--ui-warning)",
        danger: "var(--ui-danger)"
      },
      boxShadow: {
        soft: "var(--ui-shadow)",
        raised: "var(--ui-shadow-raised)",
        glow: "var(--ui-shadow-glow)"
      },
      borderRadius: {
        ui: "var(--ui-radius-lg)",
        "ui-card": "var(--ui-radius-xl)",
        "ui-panel": "var(--ui-radius-2xl)"
      }
    }
  },
  plugins: []
};

export default config;
