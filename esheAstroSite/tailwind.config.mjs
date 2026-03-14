import { defineConfig } from 'tailwindcss';

export default defineConfig({
  content: [
    './src/**/*.{astro,html,js,jsx,ts,tsx,vue,svelte}',
  ],
  theme: {
    extend: {
      fontFamily: {
        title: ['Kalam', 'cursive'],
        subtitle: ['"Comic Neue"', 'cursive'],
        description: ['Iansui', 'sans-serif'],
      },    
    },
  },
  plugins: [],
});
