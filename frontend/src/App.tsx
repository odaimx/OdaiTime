import { useEffect, useState } from "react";

type Ready = { status: string; checks: Record<string, string> };

export default function App() {
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/health/ready")
      .then((r) => r.json())
      .then(setReady)
      .catch(() => setError(true));
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">ODAITIME</h1>
        <p className="mt-1 text-sm text-slate-500">Control de asistencia</p>

        <h2 className="mt-6 text-sm font-medium text-slate-700">Estado del sistema</h2>
        {error && <p className="mt-2 text-sm text-red-600">No se pudo contactar la API.</p>}
        {!ready && !error && <p className="mt-2 text-sm text-slate-500">Verificando…</p>}
        {ready && (
          <ul className="mt-2 space-y-1 text-sm">
            {Object.entries(ready.checks).map(([name, value]) => (
              <li key={name} className="flex justify-between">
                <span className="text-slate-600">{name}</span>
                <span className={value === "ok" ? "text-emerald-600" : "text-red-600"}>
                  {value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
