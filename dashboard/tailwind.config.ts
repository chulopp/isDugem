import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      boxShadow: {
        glass:
          "0 10px 30px -5px rgba(15, 23, 42, 0.05), 0 4px 12px -2px rgba(15, 23, 42, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.95)",
        "glass-hover":
          "0 16px 40px -8px rgba(15, 23, 42, 0.08), 0 6px 16px -3px rgba(15, 23, 42, 0.04), inset 0 1px 0 0 rgba(255, 255, 255, 1)",
        "glass-pill":
          "0 8px 24px -4px rgba(15, 23, 42, 0.08), inset 0 1px 0 0 rgba(255, 255, 255, 0.95)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
