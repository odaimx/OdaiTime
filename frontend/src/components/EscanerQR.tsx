import { useEffect, useRef, useState } from "react";

/** Lector del QR del kiosco con la cámara (en navegadores con BarcodeDetector, como Chrome en Android). */
export default function EscanerQR({ onLeido }: { onLeido: (valor: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problema, setProblema] = useState<"soporte" | "camara" | null>(null);
  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setProblema("soporte");
      return;
    }
    const detector = new Detector({ formats: ["qr_code"] });
    let flujo: MediaStream | null = null;
    let vivo = true;
    let t = 0;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        flujo = s;
        if (!vivo || !video.current) return s.getTracks().forEach((x) => x.stop());
        video.current.srcObject = s;
        void video.current.play();
        const leer = async () => {
          if (!vivo || !video.current) return;
          try {
            const r = await detector.detect(video.current);
            if (r[0]?.rawValue) return onLeido(r[0].rawValue);
          } catch {
            /* sigue intentando */
          }
          t = window.setTimeout(leer, 300);
        };
        void leer();
      })
      .catch(() => setProblema("camara"));
    return () => {
      vivo = false;
      clearTimeout(t);
      flujo?.getTracks().forEach((x) => x.stop());
    };
  }, [onLeido]);

  if (problema)
    return (
      <div className="card space-y-2 p-6 text-center">
        <p className="text-lg font-semibold text-tinta-900">Escanea el QR del kiosco</p>
        <p className="text-sm text-slate-600">
          {problema === "camara" ? "Permite el acceso a la cámara para leer el código, o " : ""}
          Abre la cámara de tu teléfono y apunta al código de la tablet de tu sucursal; se abrirá esta app lista para checar.
        </p>
      </div>
    );
  return (
    <div className="space-y-2 text-center">
      <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-3xl bg-black">
        <video ref={video} className="h-full w-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-8 rounded-2xl border-4 border-white/80" />
      </div>
      <p className="text-sm text-slate-600">Apunta al QR de la tablet de tu sucursal.</p>
    </div>
  );
}
