// Sharing a city by a link, pure side (docs/game-design-v1.md): the save's bytes are compressed with deflate-raw
// (CompressionStream), written in base64url and put in the address after «#ville=». Decoding is the same path backwards.
// No DOM and no global read except the default stream classes: node:test checks every function with fake streams.
// Every failure is a ShareError with a stable code and a French text; the city is never touched here.

export const MAX_SHARE_BYTES = 60000; // compressed bytes
export const MAX_DECODED_BYTES = 8 * 1024 * 1024; // a link that inflates beyond this is refused (decompression bomb)
export const MAX_CHUNKS = 65536; // most chunks read from a stream: a bounded loop whatever the stream does
export const HASH_PREFIX = "#ville=";
export const FORMAT = "deflate-raw";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const ERROR_TEXTS = Object.freeze({
  unsupported: "Ce navigateur ne sait pas compresser la ville : le partage par lien est indisponible.",
  "too-big": "La ville est trop grande pour un lien (limite : 60 000 octets compressés).",
  "bad-link": "Le lien de partage est illisible ou incomplet.",
  corrupt: "Le lien de partage ne contient pas une ville valide.",
  empty: "Il n'y a pas de ville à partager.",
});

export class ShareError extends Error {
  constructor(code) {
    super(`${code}: ${ERROR_TEXTS[code] ?? code}`);
    this.name = "ShareError";
    this.code = code;
  }
}

/** The French sentence for any error from this module (an unknown error gets the generic one). */
export function shareErrorText(error) {
  return ERROR_TEXTS[error?.code] ?? ERROR_TEXTS.corrupt;
}

// ---- base64url -------------------------------------------------------------------------------------------------

/** Bytes -> base64url text, without padding. */
export function toBase64Url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, bytes.length - i + 1);
    for (let k = 0; k < chars; k++) out += ALPHABET[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

/** base64url text -> bytes; null when a character is outside the alphabet or the length cannot be a base64 text. */
export function fromBase64Url(text) {
  if (typeof text !== "string" || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    const v = ALPHABET.indexOf(text[i]);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 255;
    }
  }
  return out;
}

// ---- compression -----------------------------------------------------------------------------------------------

/** The stream classes of the platform ({ Compression, Decompression }), or null when it has none. */
export function platformStreams(g = globalThis) {
  const ok = typeof g.CompressionStream === "function" && typeof g.DecompressionStream === "function";
  return ok ? { Compression: g.CompressionStream, Decompression: g.DecompressionStream } : null;
}

// Pushes `bytes` through a transform stream and gathers what comes out, at most `limit` bytes.
async function pump(bytes, transform, limit, tooBig) {
  const writer = transform.writable.getWriter();
  const written = writer.write(bytes).then(() => writer.close());
  written.catch(() => {}); // a failure is raised by the read below or by `await written`; never left unhandled
  const reader = transform.readable.getReader();
  const chunks = [];
  let total = 0;
  for (let n = 0; n < MAX_CHUNKS; n++) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      reader.cancel().catch(() => {});
      throw new ShareError(tooBig);
    }
    chunks.push(value);
  }
  await written;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * The save's bytes -> the text to put after «#ville=». Throws ShareError: "empty", "unsupported" (no streams),
 * "too-big" (more than MAX_SHARE_BYTES once compressed).
 */
export async function encode(bytes, streams = platformStreams()) {
  if (!bytes || bytes.length === 0) throw new ShareError("empty");
  if (!streams) throw new ShareError("unsupported");
  const packed = await pump(bytes, new streams.Compression(FORMAT), MAX_SHARE_BYTES, "too-big");
  return toBase64Url(packed);
}

/** The text of a link -> the save's bytes. Throws ShareError: "bad-link", "too-big", "unsupported", "corrupt". */
export async function decode(text, streams = platformStreams()) {
  const packed = fromBase64Url(text);
  if (!packed || packed.length === 0) throw new ShareError("bad-link");
  if (packed.length > MAX_SHARE_BYTES) throw new ShareError("too-big");
  if (!streams) throw new ShareError("unsupported");
  try {
    return await pump(packed, new streams.Decompression(FORMAT), MAX_DECODED_BYTES, "too-big");
  } catch (e) {
    throw e instanceof ShareError ? e : new ShareError("corrupt");
  }
}

// ---- the address -----------------------------------------------------------------------------------------------

/** The city text of an address hash («#ville=...»): null when the hash is not a city link, "" when it is empty. */
export function parseHash(hash) {
  if (typeof hash !== "string" || !hash.startsWith(HASH_PREFIX)) return null;
  return hash.slice(HASH_PREFIX.length);
}

/** The link to share: the page's address (without its own hash) and the city text. */
export function buildLink(location, text) {
  return `${location.origin}${location.pathname}${location.search ?? ""}${HASH_PREFIX}${text}`;
}
