import { defineConfig } from 'vite';

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
});
