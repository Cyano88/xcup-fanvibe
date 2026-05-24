/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        emerald: { DEFAULT: '#10b981', 400: '#34d399', 500: '#10b981' },
        amber:   { DEFAULT: '#f59e0b', 400: '#fbbf24', 500: '#f59e0b' },
        crimson: { DEFAULT: '#ef4444', 400: '#f87171', 500: '#ef4444' },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in':   'slideIn 0.25s ease-out',
        'fade-in':    'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%':   { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',     opacity: '1' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
