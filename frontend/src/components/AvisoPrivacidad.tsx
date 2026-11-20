import { useState } from "react";
import Icono from "./Iconos";

/** Responsable y versión del aviso (los da el servidor con los datos de la empresa). */
export interface DatosAviso {
  version: string;
  responsable: string;
  domicilio: string | null;
}

/**
 * Aviso de privacidad del registro de asistencia (LFPDPPP, art. 16): responsable y domicilio,
 * datos que se recaban, finalidad, conservación y derechos ARCO. Se acepta una vez por versión;
 * el servidor guarda la constancia (quién, cuándo, por dónde).
 */
export default function AvisoPrivacidad({ datos, empresa, onAceptar, ocupado }: { datos: DatosAviso | null; empresa?: string; onAceptar: () => void; ocupado?: boolean }) {
  const [acepto, setAcepto] = useState(false);
  const responsable = datos?.responsable || empresa || "Tu empleador";
  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
          <Icono nombre="lock" className="h-5 w-5" />
        </span>
        <h2 className="text-lg font-semibold text-tinta-900">Aviso de privacidad</h2>
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto text-sm leading-relaxed text-slate-600">
        <p>
          <strong>{responsable}</strong>
          {datos?.domicilio ? `, con domicilio en ${datos.domicilio},` : ""} es responsable de los datos personales que se recaban al registrar tu asistencia, conforme a la Ley Federal de
          Protección de Datos Personales en Posesión de los Particulares.
        </p>
        <p>
          <strong>Datos que se recaban:</strong> tu número de empleado, una fotografía en el momento de checar y la ubicación de tu dispositivo únicamente en ese momento (no se te
          rastrea en otro momento). En el celular también se guarda un identificador del equipo vinculado.
        </p>
        <p>
          <strong>Finalidad:</strong> llevar el registro de tu jornada laboral (entradas, salidas y descansos) que exige la Ley Federal del Trabajo (arts. 132 y 804), y comprobar que la
          checada la hizo la persona correcta en el lugar de trabajo. Tus datos no se usan para otros fines ni se transfieren a terceros, salvo a las autoridades que lo requieran.
        </p>
        <p>
          <strong>Conservación:</strong> las checadas se conservan el tiempo que marca la ley; las fotografías se eliminan pasado el plazo que fije la empresa.
        </p>
        <p>
          <strong>Derechos ARCO:</strong> puedes pedir acceso, rectificación, cancelación u oposición al tratamiento de tus datos, o revocar tu consentimiento, con el área de Recursos
          Humanos de tu empresa.
        </p>
        {datos?.version && <p className="text-xs text-slate-400">Versión {datos.version}</p>}
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
        <span>He leído el aviso de privacidad y acepto el tratamiento de mis datos para el registro de asistencia.</span>
      </label>
      <button type="button" className="btn-primary w-full py-3" disabled={!acepto || ocupado} onClick={onAceptar}>
        Continuar
      </button>
    </div>
  );
}
