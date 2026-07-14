import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./data/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: "#6259E8",
        canvas: "#EEF1F7",
        ink: "#24243A",
        muted: "#7D8295",
        line: "#E4E7F0",
        success: "#22c55e",
        warning: "#f59e0b",
        danger: "#ef4444",
      },
      boxShadow: {
        soft: "10px 10px 24px rgba(166,173,198,.20), -9px -9px 22px rgba(255,255,255,.90)",
        brand: "8px 8px 18px rgba(82,72,218,.30), -5px -5px 14px rgba(255,255,255,.75)",
      },
      borderRadius: {
        card: "1.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
