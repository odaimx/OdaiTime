# Relojes ZKTeco en ODAITIME

Hay dos formas de conectar un reloj biométrico ZKTeco. En las dos, las marcas pasan por las mismas
reglas: el empleado se identifica por su **número de empleado**, que debe ser igual al **ID de usuario
del reloj**; se respetan los medios de checado y los festivos; se rechazan marcas de más de 31 días
o del futuro; y una marca repetida no se duplica.

## Opción A: envío directo a la nube (ADMS)

Es la opción recomendada: no requiere ninguna PC. La mayoría de los modelos recientes la traen
(SpeedFace, ProFace, MB, iFace, uFace, K40 Pro, etc.).

1. En **ODAITIME › Dispositivos**, da de alta el reloj:
   - **Tipo:** Reloj biométrico.
   - **Número de serie:** el que trae la etiqueta del reloj, o Menú › Información del sistema.
   - Marca **«Envío directo del reloj (ADMS)»**.
   - Opcional, pero recomendado: escribe la **IP pública** de la sucursal en *IPs permitidas*.
2. En el reloj, entra a **Menú › Comunicación › Configuración del servidor en la nube** (o *ADMS*). Hay dos variantes:
   - **Reloj con HTTPS:** activa HTTPS y usa `tuempresa.odai.lat`, puerto `443`.
   - **Reloj sin HTTPS:** usa `tuempresa.odai.lat`, puerto `8081`.
3. Al guardar, el reloj se conecta solo. En *Dispositivos*, «Última conexión» se actualiza y las marcas aparecen en *Asistencias* en unos segundos.

**Seguridad.** El protocolo ADMS no lleva contraseña: el reloj se identifica solo por su número de
serie. Por eso en ODAITIME:

- el envío directo se habilita a propósito en cada reloj;
- el número de serie no puede repetirse;
- se puede limitar a las IPs de la sucursal;
- hay límite de peticiones por minuto.

Si el reloj no soporta HTTPS, el puerto 8081 viaja **sin cifrar**: solo lleva números de empleado y
horas, nunca PIN, huellas ni fotos. Aun así, con IP fija conviene limitarlo con *IPs permitidas*.

En el servidor, el puerto 8081 debe estar abierto. Caddy solo atiende ahí la ruta `/iclock/`; todo lo
demás lo rechaza.

## Opción B: puente en una PC de la sucursal

Para relojes viejos sin ADMS (K14, K40, U160, etc.): una PC que esté en la misma red que el reloj
lee las marcas por el puerto 4370 y las sube por HTTPS con el token del dispositivo.

1. En **ODAITIME › Dispositivos**, da de alta el reloj (tipo Reloj biométrico, sin envío directo). Copia el **código de 6 dígitos**.
2. En la PC, instala Python 3.10 o superior y la librería del reloj:
   ```
   pip install pyzk
   ```
3. Copia `puente/zkteco_puente.py` y vincúlalo una sola vez:
   ```
   python zkteco_puente.py vincular --servidor https://tuempresa.odai.lat --codigo 123456 --reloj 192.168.1.201
   ```
   - Si el reloj tiene contraseña de comunicación (*Comm Key*), agrega `--clave 1234`.
4. Pruébalo con una sola revisión:
   ```
   python zkteco_puente.py --una-vez
   ```
5. Déjalo corriendo. En Windows, crea una tarea en el **Programador de tareas**, «Al iniciar el equipo», con la acción `python C:\ruta\zkteco_puente.py`. Revisa cada 60 segundos.

**Si se cae el internet o se apaga la PC:** el puente guarda en `puente.json` hasta qué marca subió
y continúa desde ahí. El reloj conserva las marcas en su memoria. El archivo `puente.json` contiene
el token del dispositivo: no lo compartas. Si se pierde la PC, genera un código nuevo en
*Dispositivos* y el token anterior deja de servir.

`pyzk` es software libre (GPL-2.0). Se instala aparte en la PC del puente; no forma parte del servidor.
