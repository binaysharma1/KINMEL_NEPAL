/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        '4k': '2560px',   // Custom breakpoint for 2560px screens
      },
      colors: {
        dark: {
          bg: '#0f172a',
          panel: '#1e293b',
          border: '#334155',
          text: '#f8fafc',
          muted: '#94a3b8',
        },
        light: {
          bg: '#ffffff',
          panel: '#f8fafc',
          border: '#e2e8f0',
          text: '#0f172a',
          muted: '#64748b',
        },
      },
    },
  },
  plugins: [],
}