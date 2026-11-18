import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import paquete from "./package.json";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Versión del sistema que se muestra al pie de la pantalla.
  define: { __VERSION__: JSON.stringify(paquete.version) },
  server: {
    port: 5173,
    // En desarrollo, /api se redirige a la API local.
    proxy: { "/api": "http://localhost:8000" },
  },
});
