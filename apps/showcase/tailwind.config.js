/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        // Casper red brand scale
        brand: {
          50:  "#FFF1F2",
          100: "#FFE0E2",
          200: "#FFC4C8",
          300: "#FB97A0",
          400: "#F4505F",
          500: "#E11428",
          600: "#C00F20",
          700: "#9E0E1B",
          800: "#82111C",
          900: "#6E131C",
        },
        // Ink (neutral black) scale for text + dark surfaces
        ink: {
          50:  "#F6F6F7",
          100: "#ECECEE",
          200: "#D8D9DC",
          300: "#B9BBC0",
          400: "#8A8D94",
          500: "#62656C",
          600: "#43464C",
          700: "#2C2E33",
          800: "#1A1B1F",
          900: "#121315",
        },
        paper: "#FFFFFF",
        bone:  "#F6F6F7",
      },
      boxShadow: {
        card:  "0 1px 2px rgba(18,19,21,0.05), 0 4px 16px -4px rgba(18,19,21,0.06)",
        lift:  "0 2px 4px rgba(18,19,21,0.06), 0 16px 40px -12px rgba(18,19,21,0.14)",
        brand: "0 4px 14px -2px rgba(225,20,40,0.35)",
      },
      animation: {
        "spin-slow": "spin 3s linear infinite",
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        "shield-in": "shieldIn 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards",
        "fade-up": "fadeUp 0.4s ease forwards",
      },
      keyframes: {
        shieldIn: {
          "0%": { transform: "scale(0.5)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        fadeUp: {
          "0%": { transform: "translateY(12px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
