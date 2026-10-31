// Tests of the pure share model (web/share-model.js): base64url, the round trip with the platform's CompressionStream and
// with a fake one, the size refusals (compressed and inflated), unsupported platforms, bad hashes and links.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SHARE_BYTES, MAX_DECODED_BYTES, MAX_CHUNKS, HASH_PREFIX, ShareError, toBase64Url, fromBase64Url, platformStreams,
  encode, decode, parseHash, buildLink, shareErrorText, ERROR_TEXTS,
} from "../share-model.js";

// A fake CompressionStream pair: the "compressed" bytes are the bytes themselves.
class IdentityStream extends TransformStream {
  constructor() {
    super({});
  }
}
const FAKE = { Compression: IdentityStream, Decompression: IdentityStream };

const sample = (n, f = (i) => (i * 7) % 13) => Uint8Array.from({ length: n }, (_, i) => f(i));

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (e) => e instanceof ShareError && e.code === code);
}

describe("base64url", () => {
  test("round trip for every length from 0 to 40", () => {
    for (let n = 0; n <= 40; n++) {
      const b = sample(n, (i) => (i * 37 + 5) & 255);
      assert.deepEqual(fromBase64Url(toBase64Url(b)), b, `length ${n}`);
    }
  });

  test("uses only the url-safe alphabet, no padding", () => {
    const text = toBase64Url(Uint8Array.from([251, 255, 254, 250, 63, 62]));
    assert.match(text, /^[A-Za-z0-9_-]+$/u);
    assert.equal(text, Buffer.from([251, 255, 254, 250, 63, 62]).toString("base64url"));
  });

  test("rejects foreign characters, padding and impossible lengths", () => {
    assert.equal(fromBase64Url("ab+/"), null);
    assert.equal(fromBase64Url("abcd="), null);
    assert.equal(fromBase64Url("abcde"), null);
    assert.equal(fromBase64Url("ab cd"), null);
    assert.equal(fromBase64Url(12), null);
    assert.deepEqual(fromBase64Url(""), new Uint8Array(0));
  });
});

describe("compression round trip", () => {
  test("with the platform's CompressionStream (deflate-raw)", async () => {
    assert.ok(platformStreams(), "node 22 has CompressionStream");
    const bytes = sample(30000);
    const text = await encode(bytes);
    assert.ok(text.length < 1000, "redundant bytes compress well");
    assert.deepEqual(await decode(text), bytes);
  });

  test("the text is a raw deflate stream readable by node:zlib", async () => {
    const { inflateRawSync } = await import("node:zlib");
    const bytes = sample(5000);
    const text = await encode(bytes);
    assert.deepEqual(new Uint8Array(inflateRawSync(Buffer.from(text, "base64url"))), bytes);
  });

  test("with a fake CompressionStream", async () => {
    const bytes = sample(1000);
    const text = await encode(bytes, FAKE);
    assert.equal(text, toBase64Url(bytes));
    assert.deepEqual(await decode(text, FAKE), bytes);
  });

  test("platformStreams is null without the classes", () => {
    assert.equal(platformStreams({}), null);
    assert.equal(platformStreams({ CompressionStream: class {} }), null);
    assert.notEqual(platformStreams({ CompressionStream: class {}, DecompressionStream: class {} }), null);
  });
});

describe("refusals", () => {
  test("empty save", async () => {
    await rejectsWith(encode(new Uint8Array(0), FAKE), "empty");
    await rejectsWith(encode(null, FAKE), "empty");
  });

  test("no streams: unsupported, both ways", async () => {
    await rejectsWith(encode(sample(10), null), "unsupported");
    await rejectsWith(decode("AAAA", null), "unsupported");
  });

  test("more than MAX_SHARE_BYTES once compressed is refused, exactly MAX_SHARE_BYTES passes", async () => {
    assert.equal(MAX_SHARE_BYTES, 60000);
    await rejectsWith(encode(sample(MAX_SHARE_BYTES + 1), FAKE), "too-big");
    assert.equal(fromBase64Url(await encode(sample(MAX_SHARE_BYTES), FAKE)).length, MAX_SHARE_BYTES);
    // incompressible bytes with the real stream
    let seed = 12345;
    const noise = sample(100000, () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24);
    await rejectsWith(encode(noise), "too-big");
  });

  test("a link longer than MAX_SHARE_BYTES of data is refused before decoding", async () => {
    await rejectsWith(decode(toBase64Url(sample(MAX_SHARE_BYTES + 1)), FAKE), "too-big");
  });

  test("a link that inflates beyond MAX_DECODED_BYTES is refused", async () => {
    const zeros = new Uint8Array(MAX_DECODED_BYTES + 1024);
    const text = await encode(zeros, { ...FAKE, Compression: CompressionStream });
    await rejectsWith(decode(text), "too-big");
  });

  test("bad links", async () => {
    await rejectsWith(decode("", FAKE), "bad-link");
    await rejectsWith(decode("a", FAKE), "bad-link");
    await rejectsWith(decode("ab+/", FAKE), "bad-link");
  });

  test("a link that is not deflate data is corrupt", async () => {
    await rejectsWith(decode(toBase64Url(Uint8Array.from([255, 255, 255, 255, 1, 2, 3]))), "corrupt");
  });

  test("a stream that never ends is read for at most MAX_CHUNKS chunks", async () => {
    let reads = 0;
    class Endless {
      constructor() {
        this.writable = new WritableStream({});
        this.readable = new ReadableStream({
          pull(controller) {
            reads++;
            controller.enqueue(new Uint8Array(0));
          },
        }, { highWaterMark: 0 });
      }
    }
    const out = await decode("AAAA", { Compression: Endless, Decompression: Endless });
    assert.equal(out.length, 0);
    assert.ok(reads <= MAX_CHUNKS + 2, `read ${reads}`);
  });
});

describe("the address", () => {
  test("parseHash", () => {
    assert.equal(parseHash(`${HASH_PREFIX}abcd`), "abcd");
    assert.equal(parseHash("#ville="), "");
    assert.equal(parseHash(""), null);
    assert.equal(parseHash("#autre=abcd"), null);
    assert.equal(parseHash("ville=abcd"), null);
    assert.equal(parseHash(undefined), null);
    assert.equal(parseHash(null), null);
  });

  test("buildLink keeps the page address and replaces its hash", () => {
    const loc = { origin: "https://ex.org", pathname: "/jeu/", search: "?mock=1" };
    assert.equal(buildLink(loc, "xyz"), "https://ex.org/jeu/?mock=1#ville=xyz");
    assert.equal(buildLink({ origin: "http://h:80", pathname: "/" }, "q"), "http://h:80/#ville=q");
  });

  test("a link built then parsed gives the text back, and the bytes after decode", async () => {
    const bytes = sample(2000);
    const link = buildLink({ origin: "http://h", pathname: "/", search: "" }, await encode(bytes));
    const hash = link.slice(link.indexOf("#"));
    assert.deepEqual(await decode(parseHash(hash)), bytes);
  });
});

describe("French messages", () => {
  test("every code has a text, an unknown error gets the generic one", () => {
    for (const code of ["unsupported", "too-big", "bad-link", "corrupt", "empty"]) {
      assert.equal(shareErrorText(new ShareError(code)), ERROR_TEXTS[code]);
      assert.ok(ERROR_TEXTS[code].endsWith("."));
    }
    assert.equal(shareErrorText(new Error("x")), ERROR_TEXTS.corrupt);
    assert.equal(shareErrorText(undefined), ERROR_TEXTS.corrupt);
  });
});
