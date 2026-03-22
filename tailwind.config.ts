import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        tx: {
          bg: "#030303",
          accent: "#bfff00",
          muted: "#888888",
          line: "rgba(255, 255, 255, 0.06)",
          "line-accent": "rgba(191, 255, 0, 0.2)",
          "accent-dim": "rgba(191, 255, 0, 0.05)",
          "accent-glow": "rgba(191, 255, 0, 0.3)",
          bloom: "#f8b4d9",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
