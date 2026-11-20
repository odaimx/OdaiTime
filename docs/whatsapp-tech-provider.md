# WhatsApp: registro integrado (Tech Provider de Meta)

Con el registro integrado ("Embedded Signup"), cada empresa conecta su número de WhatsApp Business
con un botón (**Mi empresa › Configuración › WhatsApp › Conectar con WhatsApp**). Ya no tiene que
copiar el token ni configurar el webhook. Meta le sigue cobrando a cada empresa.

## 1. Trámite en Meta (lo hace Odai una sola vez)

1. **Verificar el negocio de Odai** en Meta Business Suite (Configuración del negocio › Centro de seguridad).
2. **Crear la app** en developers.facebook.com, con el tipo *Empresa*, y agregarle el producto **WhatsApp**.
3. **Solicitar el acceso avanzado** a estos permisos (revisión de la app):
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - `business_management`
4. **Registrarse como Tech Provider:** WhatsApp › Introducción › *Convertirse en proveedor de tecnología*.
5. **Crear la configuración del registro:** **Facebook Login para empresas › Configuraciones › Crear**, con plantilla *WhatsApp Embedded Signup*. El identificador que genera es el **Configuration ID**.
6. **Agregar los dominios:** en **Configuración › Básica** y en **Facebook Login › Configuración**, agregar los dominios desde donde se abre el botón: `odai.lat` y los subdominios de los clientes, por ejemplo `dmtime.odai.lat`.
   - En **Dominios permitidos para el SDK de JavaScript** puede ser necesario listar cada subdominio.

## 2. Capturar los datos en ODAITIME (superadmin)

Ruta: **Empresa Odai › Configuración › WhatsApp (Meta)**. Ahí se capturan:

| Campo | Dónde está |
|---|---|
| App ID | Configuración › Básica |
| Configuration ID | Facebook Login para empresas › Configuraciones |
| App secret | Configuración › Básica (se guarda cifrado) |

Al guardar los tres, el botón aparece en todas las empresas.

## 3. Qué pasa al tocar «Conectar con WhatsApp»

1. Se abre el popup de Meta. El cliente inicia sesión con su Facebook y elige o crea su cuenta de WhatsApp Business y su número.
2. Meta entrega un **código de un solo uso**. El servidor de ODAITIME lo cambia por el token del cliente; el secreto de la app nunca llega al navegador.
3. Se suscribe la app a la cuenta del cliente con el **webhook propio de esa empresa** (`/api/whatsapp/webhook/{id}`, con su token de verificación).
4. Se registra el número en la Cloud API, con un PIN de verificación en dos pasos generado al azar. El cliente puede cambiarlo después desde su WhatsApp Manager.
5. Se guarda la configuración cifrada y se **activa** el checado por WhatsApp. Queda registrado en la bitácora.

La configuración manual (pegar token y secreto) sigue disponible en **Configurar a mano (avanzado)**.

La versión de Graph API sale de `WHATSAPP_GRAPH_URL` (`https://graph.facebook.com/v21.0` por defecto).
