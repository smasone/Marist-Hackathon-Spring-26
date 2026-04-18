import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Syne", "sans-serif"],
        body: ["Instrument Sans", "sans-serif"],
        mono: ["DM Mono", "monospace"],
      },
      colors: {
        surface: {
          900: "#0a0c0f",
          800: "#111318",
          700: "#181c23",
          600: "#1f242e",
          500: "#262d39",
          400: "#2e3644",
        },
        accent: {
          cyan: "#22d3ee",
          green: "#4ade80",
          amber: "#fbbf24",
          red: "#f87171",
          purple: "#a78bfa",
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-up": "fadeUp 0.4s ease forwards",
        scan: "scan 2s linear infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(400%)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
