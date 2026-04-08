import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1.5rem",
        sm: "2rem",
        lg: "2rem",
      },
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        nanth: {
          background: "hsl(var(--nanth-background) / <alpha-value>)",
          foreground: "hsl(var(--nanth-foreground) / <alpha-value>)",
          primary: "hsl(var(--nanth-primary) / <alpha-value>)",
          secondary: "hsl(var(--nanth-secondary) / <alpha-value>)",
          muted: "hsl(var(--nanth-muted) / <alpha-value>)",
          accent: "hsl(var(--nanth-accent) / <alpha-value>)",
          input: "hsl(var(--nanth-input) / <alpha-value>)",
          code: "hsl(var(--nanth-code) / <alpha-value>)",
          border: "hsl(var(--nanth-border) / <alpha-value>)",
          ring: "hsl(var(--nanth-ring) / <alpha-value>)",
          destructive: "hsl(var(--nanth-destructive) / <alpha-value>)",
          success: "hsl(var(--nanth-success) / <alpha-value>)",
          warning: "hsl(var(--nanth-warning) / <alpha-value>)",
        },
        // Un-namespaced aliases — support opacity modifiers (bg-accent/10 etc.)
        // IMPORTANT: `text-muted` is overridden in index.css @layer utilities
        // to mean "foreground at 45% opacity" (dimmed label text), NOT the muted
        // background color. Never use `text-[hsl(var(--nanth-muted))]` for text —
        // that resolves to a near-black background color and is invisible in dark mode.
        background:  "hsl(var(--nanth-background) / <alpha-value>)",
        foreground:  "hsl(var(--nanth-foreground) / <alpha-value>)",
        accent:      "hsl(var(--nanth-accent) / <alpha-value>)",
        primary:     "hsl(var(--nanth-primary) / <alpha-value>)",
        "primary-foreground": "hsl(var(--nanth-primary-foreground) / <alpha-value>)",
        secondary:   "hsl(var(--nanth-secondary) / <alpha-value>)",
        muted:       "hsl(var(--nanth-muted) / <alpha-value>)",
        border:      "hsl(var(--nanth-border) / <alpha-value>)",
        input:       "hsl(var(--nanth-input) / <alpha-value>)",
        ring:        "hsl(var(--nanth-ring) / <alpha-value>)",
        destructive: "hsl(var(--nanth-destructive) / <alpha-value>)",
        success:     "hsl(var(--nanth-success) / <alpha-value>)",
        warning:     "hsl(var(--nanth-warning) / <alpha-value>)",
        "surface-1": "hsl(var(--nanth-surface-1) / <alpha-value>)",
        "surface-2": "hsl(var(--nanth-surface-2) / <alpha-value>)",
        "surface-3": "hsl(var(--nanth-surface-3) / <alpha-value>)",
      },
      borderRadius: {
        nanth: "var(--nanth-radius)",
      },
      spacing: {
        18: "4.5rem",
        sidebar: "var(--nanth-sidebar-width)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-in-right": "slideInRight 0.25s ease-out",
        "slide-in-left": "slideInLeft 0.25s ease-out",
        "scale-in": "scaleIn 0.2s ease-out",
        "pulse-slow": "pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [typography],
};
