"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Work around occasional Windows Node 20 internal undici bootstrap failures
 * by installing globals before Next touches Request.
 */
const assignIfPresent = (name, value) => {
  if (typeof value !== "undefined") {
    globalThis[name] = value;
  }
};

const installFetchPrimitives = (source, label) => {
  try {
    const mod = require(source);
    assignIfPresent("fetch", mod.fetch);
    assignIfPresent("Headers", mod.Headers);
    assignIfPresent("Request", mod.Request);
    assignIfPresent("Response", mod.Response);
    assignIfPresent("FormData", mod.FormData);
    assignIfPresent("File", mod.File);
    assignIfPresent("Blob", mod.Blob);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[next-launcher] ${label} global shim unavailable: ${message}`);
    return false;
  }
};

if (!installFetchPrimitives("next/dist/compiled/@edge-runtime/primitives/fetch", "next-fetch")) {
  installFetchPrimitives("undici", "undici");
}
