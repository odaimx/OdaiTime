/**
 * Huella o rostro del teléfono (WebAuthn / passkeys) para checar sin PIN.
 * El servidor manda las opciones en JSON (binarios en base64url) y recibe la respuesta igual.
 */

const aBytes = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const aTexto = (buf: ArrayBuffer | null | undefined) =>
  buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : undefined;

type Descriptor = { id: string; type: "public-key"; transports?: AuthenticatorTransport[] };

/** ¿El teléfono tiene huella, rostro o bloqueo de pantalla que sirva como llave? */
export async function hayPasskey(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

function mensaje(e: unknown): Error {
  const n = (e as DOMException)?.name;
  if (n === "NotAllowedError") return new Error("Se canceló o no se reconoció tu huella o rostro.");
  if (n === "InvalidStateError") return new Error("Este celular ya tiene tu huella o rostro registrado.");
  if (n === "SecurityError") return new Error("Esta dirección no permite usar huella o rostro (se necesita https).");
  return new Error("No se pudo usar la huella o el rostro de este teléfono.");
}

/** Registra la huella o el rostro (opciones de /celular/passkey/opciones-registro). */
export async function crearPasskey(o: {
  challenge: string;
  rp: PublicKeyCredentialRpEntity;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: Descriptor[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
}): Promise<Record<string, unknown>> {
  let c: PublicKeyCredential;
  try {
    c = (await navigator.credentials.create({
      publicKey: {
        ...o,
        challenge: aBytes(o.challenge),
        user: { ...o.user, id: aBytes(o.user.id) },
        excludeCredentials: (o.excludeCredentials ?? []).map((d) => ({ ...d, id: aBytes(d.id) })),
      },
    })) as PublicKeyCredential;
  } catch (e) {
    throw mensaje(e);
  }
  const r = c.response as AuthenticatorAttestationResponse;
  return {
    id: c.id,
    rawId: aTexto(c.rawId),
    type: c.type,
    response: { clientDataJSON: aTexto(r.clientDataJSON), attestationObject: aTexto(r.attestationObject), transports: r.getTransports?.() ?? [] },
    clientExtensionResults: c.getClientExtensionResults?.() ?? {},
    authenticatorAttachment: c.authenticatorAttachment ?? undefined,
  };
}

/** Pide la huella o el rostro para checar (opciones de /celular/passkey/opciones). */
export async function usarPasskey(o: { challenge: string; rpId?: string; timeout?: number; allowCredentials?: Descriptor[]; userVerification?: UserVerificationRequirement }): Promise<string> {
  let c: PublicKeyCredential;
  try {
    c = (await navigator.credentials.get({
      publicKey: { ...o, challenge: aBytes(o.challenge), allowCredentials: (o.allowCredentials ?? []).map((d) => ({ ...d, id: aBytes(d.id) })) },
    })) as PublicKeyCredential;
  } catch (e) {
    throw mensaje(e);
  }
  const r = c.response as AuthenticatorAssertionResponse;
  return JSON.stringify({
    id: c.id,
    rawId: aTexto(c.rawId),
    type: c.type,
    response: { clientDataJSON: aTexto(r.clientDataJSON), authenticatorData: aTexto(r.authenticatorData), signature: aTexto(r.signature), userHandle: aTexto(r.userHandle) },
    clientExtensionResults: c.getClientExtensionResults?.() ?? {},
  });
}
