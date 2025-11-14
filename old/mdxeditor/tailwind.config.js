/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      scale: {
        '80': '.8',
      },
      keyframes: {
        'fade-in': {
          'from': { opacity: '0', transform: 'translateY(-10px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        'highlight-animation': {
          '0%': { backgroundColor: 'rgba(255, 220, 40, 0.7)', boxShadow: '0 0 0 4px rgba(255, 220, 40, 0.7)' },
          '80%': { backgroundColor: 'rgba(255, 220, 40, 0)', boxShadow: '0 0 0 0 rgba(255, 220, 40, 0)' },
          '100%': { backgroundColor: 'transparent', boxShadow: 'none' },
        },
        'cloze-highlight-animation': {
          '0%': { backgroundColor: 'rgba(255, 220, 40, 0.7)', boxShadow: '0 0 0 4px rgba(255, 220, 40, 0.7)' },
          '80%': { backgroundColor: 'rgba(255, 220, 40, 0)', boxShadow: '0 0 0 0 rgba(255, 220, 40, 0)' },
          '100%': { backgroundColor: 'transparent', boxShadow: 'none' },
        },
        'fade-in-label': {
          'from': { opacity: '0', transform: 'translateX(-10px)' },
          'to': { opacity: '1', transform: 'translateX(0)' },
        },
        'blink': {
          '50%': { opacity: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'highlight': 'highlight-animation 1.5s ease-out',
        'cloze-highlight': 'cloze-highlight-animation 1.5s ease-out',
        'fade-in-label': 'fade-in-label 0.3s ease-out forwards',
        'blink': 'blink 1s step-end infinite',
      },
      borderWidth: {
        'dotted': '2px dotted',
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
