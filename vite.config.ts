import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Относительные пути, чтобы сборку можно было открыть из любой подпапки (GitHub Pages и т. п.)
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Движок — отдельным чанком: он большой и меняется реже кода игры
        manualChunks: { babylon: ['@babylonjs/core', '@babylonjs/loaders'] },
      },
    },
    // Babylon импортируется целиком (~6 МБ, ~1.4 МБ gzip); предупреждение о размере тут ожидаемо
    chunkSizeWarningLimit: 7000,
  },
  plugins: [
    // Офлайн и установка на экран: service worker заранее кэширует всю сборку.
    // Обновление не ставится само — меню предлагает перезапустить игру (src/pwa.ts)
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Тихая поляна',
        short_name: 'Поляна',
        description: 'Прогулка по лесным полянам от третьего лица',
        lang: 'ru',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        background_color: '#1b2b33',
        theme_color: '#1b2b33',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Модели героев и шрифты (только woff2 — woff браузер не запросит) тоже нужны без сети
        globPatterns: ['**/*.{js,css,html,svg,png,ico,glb,woff2}'],
        // Чанк Babylon весит ~6 МБ — без этого Workbox молча пропустит его
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
