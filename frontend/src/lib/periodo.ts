// Periodos de nómina más comunes (semana lunes-domingo, quincena y mes).

const iso = (d: Date) => d.toLocaleDateString("en-CA");

export function periodo(clave: string): { desde: string; hasta: string } {
  const hoy = new Date();
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  switch (clave) {
    case "semana_pasada": {
      const ini = new Date(lunes);
      ini.setDate(lunes.getDate() - 7);
      const fin = new Date(ini);
      fin.setDate(ini.getDate() + 6);
      return { desde: iso(ini), hasta: iso(fin) };
    }
    case "quincena": {
      const q1 = hoy.getDate() <= 15;
      const ini = new Date(hoy.getFullYear(), hoy.getMonth(), q1 ? 1 : 16);
      const fin = q1 ? new Date(hoy.getFullYear(), hoy.getMonth(), 15) : new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
      return { desde: iso(ini), hasta: iso(fin) };
    }
    case "quincena_pasada": {
      const q1 = hoy.getDate() <= 15;
      // Primera quincena → la segunda del mes anterior; segunda → la primera de este mes.
      const ini = q1 ? new Date(hoy.getFullYear(), hoy.getMonth() - 1, 16) : new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const fin = q1 ? new Date(hoy.getFullYear(), hoy.getMonth(), 0) : new Date(hoy.getFullYear(), hoy.getMonth(), 15);
      return { desde: iso(ini), hasta: iso(fin) };
    }
    case "mes_pasado":
      return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), hasta: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0)) };
    case "mes":
      return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: iso(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)) };
    default: {
      const fin = new Date(lunes);
      fin.setDate(lunes.getDate() + 6);
      return { desde: iso(lunes), hasta: iso(fin) };
    }
  }
}
