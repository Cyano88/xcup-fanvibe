import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const prodHttp = 'https://xcup-fanvibe-production.up.railway.app';
  const prodWs = 'wss://xcup-fanvibe-production.up.railway.app';
  const fallbackHttp = mode === 'production' ? prodHttp : 'http://localhost:3001';
  const fallbackWs = mode === 'production' ? prodWs : 'ws://localhost:3001';

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_BACKEND_WS': JSON.stringify(process.env.VITE_BACKEND_WS ?? fallbackWs),
      'import.meta.env.VITE_BACKEND_HTTP': JSON.stringify(process.env.VITE_BACKEND_HTTP ?? fallbackHttp),
      'import.meta.env.VITE_REFEREE_ADDRESS': JSON.stringify(process.env.VITE_REFEREE_ADDRESS ?? ''),
    },
  };
});
