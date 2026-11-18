import { useEffect, useRef, useState } from "react";

/**
 * Toma una foto con la cámara frontal. Si el navegador no permite la cámara en vivo,
 * usa el selector nativo del teléfono (capture="user").
 */
export default function Camara({ onFoto, onCancelar, titulo = "Centra tu rostro en el óvalo" }: { onFoto: (b: Blob) => void; onCancelar: () => void; titulo?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError(true));
    if (!navigator.mediaDevices) setError(true);
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  function capturar() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0); // espejo, como se ve en pantalla
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    c.toBlob((b) => b && onFoto(b), "image/jpeg", 0.85);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-navy-900 text-white">
      <div className="flex items-center justify-between p-4">
        <button onClick={onCancelar} className="rounded-full bg-white/10 px-4 py-2 text-sm">
          Cancelar
        </button>
        <p className="text-sm font-medium">Foto de verificación</p>
        <span className="w-20" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        {!error ? (
          <div className="relative aspect-[3/4] w-full max-w-sm overflow-hidden rounded-3xl bg-navy-800">
            <video ref={video} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            <div className="pointer-events-none absolute inset-[12%_18%] rounded-[50%] border-[3px] border-dashed border-accent-500" />
          </div>
        ) : (
          <label className="flex w-full max-w-sm cursor-pointer flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-white/30 p-10 text-center">
            <span className="text-lg font-medium">Toca para abrir la cámara</span>
            <span className="text-sm text-slate-300">Tu navegador no permite la cámara en vivo.</span>
            <input type="file" accept="image/*" capture="user" className="sr-only" onChange={(e) => e.target.files?.[0] && onFoto(e.target.files[0])} />
          </label>
        )}
        <p className="text-center text-lg font-medium">{titulo}</p>
      </div>
      {!error && (
        <div className="flex justify-center p-8">
          <button onClick={capturar} aria-label="Tomar foto" className="h-20 w-20 rounded-full border-[5px] border-white bg-brand-500 transition active:scale-95" />
        </div>
      )}
    </div>
  );
}
