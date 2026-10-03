import type { Config } from "tailwindcss";

// "Vessel" — multi-branch water & eggs ERP.
//
// DESIGN SYSTEM v2 — "Copper & Cream".
// Re-skinned to the reference art direction: a warm off-white/cream canvas
// (sand.*) paired with a deep charcoal (depth.900/950), and a single
// signature copper->warm-brown gradient as the primary action accent
// (flow.*). High-contrast, soft, premium "fintech" feel: generous rounded
// corners (12-20px), pill buttons, subtle glassmorphism on dark panels.
//
// Token NAMES are intentionally unchanged (depth/flow/cash/confirm/alert/
// sand) so every existing component's className strings keep working —
// only the underlying hex values were restyled.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm charcoal neutral ramp — doubles as light-admin-page text/
        // borders (100-500) and as the dark login/terminal backgrounds
        // (700-950, anchored on the #0C0C0C charcoal from the reference).
        depth: {
          100: "#F0ECE7",
          200: "#E2DAD1",
          300: "#CFC4B8",
          400: "#A89A8B",
          500: "#837567",
          600: "#5C5248",
          700: "#3A332D",
          800: "#1A1715",
          900: "#0F0E0D",
          950: "#0C0C0C",
        },
        // Primary interactive accent — copper -> warm brown.
        flow: {
          400: "#E7A684",
          500: "#D47854", // primary interactive accent (copper)
          600: "#BE6646",
          700: "#A3644F", // warm brown (gradient end)
          violet: "#B86B4E", // (kept name) paired with flow.500 for gradients/glows
          violetDeep: "#8A4A38",
        },
        cash: { 400: "#FCD34D", 500: "#F59E0B", 600: "#B45309", 700: "#92400E" },
        confirm: { 400: "#34D399", 500: "#10B981", 600: "#047857" },
        alert: { 400: "#FB7185", 500: "#F43F5E", 600: "#BE123C", 700: "#9F1239" },
        // Cream canvas family from the reference image.
        sand: { 50: "#F5F2EF", 100: "#EFEAE4", 200: "#E4DCD3" },
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        xl2: "1.25rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        soft: "0 4px 20px -4px rgba(12,12,12,0.12)",
        glow: "0 0 40px -8px rgba(212,120,84,0.40), 0 0 24px -8px rgba(163,100,79,0.28)",
      },
      keyframes: {
        ripple: {
          "0%": { transform: "scale(0.8)", opacity: "0.6" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        drift: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(3%, -4%) scale(1.05)" },
          "66%": { transform: "translate(-2%, 3%) scale(0.97)" },
        },
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        ripple: "ripple 1.6s ease-out infinite",
        "fade-up": "fade-up 0.35s ease-out",
        drift: "drift 14s ease-in-out infinite",
        "drift-slow": "drift 22s ease-in-out infinite reverse",
        "spin-slow": "spin-slow 20s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
