import readerWorker from "../mcp-reader/dist/server/index.js";

// Public, unauthenticated MCP transport. The original Worker maintains its
// own restricted owner-only management handlers. This adapter never forwards
// an identity header supplied by the internet to that Worker.
const MAX_JSON_BYTES = 1024 * 1024;
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    return res.end("POST required");
  }
  if (!/^application\/json(?:;|$)/i.test(String(req.headers["content-type"] || ""))) {
    res.statusCode = 415;
    return res.end("application/json required");
  }

  try {
    const body = typeof req.body === "string"
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : JSON.stringify(req.body ?? null);
    if (Buffer.byteLength(body, "utf8") > MAX_JSON_BYTES) {
      res.statusCode = 413;
      return res.end("MCP request too large");
    }
    const forwarded = new Request("https://roseglass-public.invalid/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    // Do not pass untrusted request headers or a project-owner identity.
    const response = await readerWorker.fetch(forwarded, {});
    res.statusCode = response.status;
    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    // Streaming is essential for the embedded PDF/OCR UI resource, which may
    // exceed the 4.5 MB buffered response limit of Vercel Functions.
    if (response.body) {
      for await (const chunk of response.body) {
        if (!res.write(Buffer.from(chunk))) {
          await new Promise((resolve, reject) => {
            res.once("drain", resolve);
            res.once("error", reject);
          });
        }
      }
    }
    return res.end();
  } catch (error) {
    // Do not reflect stack traces, user PDF text, or signed image URLs.
    console.error(JSON.stringify({ event: "roseglass-mcp-transport-error", code: "transport-failed" }));
    if (!res.headersSent) res.statusCode = 500;
    return res.end();
  }
}
