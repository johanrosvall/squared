import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Albert Sans"', "system-ui", "sans-serif"],
        mono: ['"DM Mono"', "monospace"],
      },
      colors: {
        sq: {
          black: "#0A0A0A",
          white: "#FFFFFF",
          gray: {
            100: "#F5F5F5",
            400: "#A3A3A3",
            600: "#525252",
          },
          red: "#E5003E",
          blue: "#0066FF",
          purple: "#8B5CF6",
          green: "#16A34A",
        },
      },
      tracking: {
        label: "0.15em",
      },
    },
  },
  plugins: [],
};
export default config;
