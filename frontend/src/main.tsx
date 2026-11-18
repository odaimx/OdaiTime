import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { cargarTema } from "./lib/tema";
import { BrowserRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import "./index.css";

// Colores del tema definidos por Odai (si falla, se quedan los de index.css).
cargarTema().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
