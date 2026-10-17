# Roseglass experimental live relay (public edition)

**STATUS: source prototype only. NOT DEPLOYED / NOT VERIFIED WITH CHATGPT FREE.**

This optional, separately hosted service is a Cloudflare Worker + one SQLite-backed Durable Object per temporary reading session. It is intentionally independent of all private g-mind systems. The standalone Roseglass reading room works without it.

## What happens

1. A reader opens a PDF/PPTX **locally** and chooses **↗ / LIVE CO-READING**. They enter an HTTPS URL of a relay they trust and choose **开启临时共读**.
2. The relay creates a random room ID and **separate 256-bit read/write capabilities**. Only their browser has the write key. The browser keeps both keys *in memory*.
3. The reader copies **one pairing instruction** into their own ChatGPT conversation, if that account has access to the public Roseglass MCP tool. This instruction contains only the room ID and read key.
4. Clicking a slide updates the latest selected page, coordinates, local extracted page text, optional <= 360KiB PNG (the point is marked), and relevant notes. No file names, entire PDFs, whole chat histories, or g-mind data are sent.
5. The GPT can invoke the read-only `get_selected_slide` MCP tool using the room ID + read key. The same GPT conversation can ask "讲解我刚点的地方" on later turns, without manually pasting each page.
6. End the session from the reader to revoke it. Every session expires after **30 minutes** even if the user forgets.

### Critical limitations

- The **Free plan can access the plugin directory**, but the availability of custom/public plugin tools depends on the specific account. **Plugin extension UI is not yet generally on Free or Go web.** This prototype must pass a real Free-account install + tool-call test before any claim that it solves automatic co-reading.
- A model **does not get invoked on a slide click** just because the relay was updated. The user still speaks/types a brief request in their own GPT conversation; that prompts the tool read. This is not automatic GPT message injection.
- The MCP tool can include an actual PNG in its tool response, but **visual delivery/readback must be validated in the target ChatGPT client**. If only text arrives, GPT must say so; never infer a chart from a coordinate.
- A Worker *hosts a transient copy* of the current selected content once the user opts in. This is **not equivalent to the offline-only private reader**. Don't use the live relay for confidential documents unless you trust the operator and its storage/access controls. **30 minutes means the active room becomes inaccessible and is logically deleted; it does not guarantee instant physical erasure of provider backups.** Cloudflare SQLite-backed Durable Objects support point-in-time recovery over the past 30 days, so treat uploaded page text and PNGs as potentially retained in provider recovery history. When ChatGPT retrieves content, it also becomes part of that account's conversation subject to its own retention settings.
- Public deployment requires provider-side abuse controls/rate limiting, origin allowlisting, operational logging review and privacy policy. Access tokens are capabilities; anyone who gets a read key can access its room until expiry. Never publish pairing credentials.
- No storage charges were incurred here; nothing is deployed. Cloudflare's Free plan has quotas and can stop accepting requests at the free limit.
- Because the browser keeps credentials only in memory, reloading the page loses the ability to revoke early; the server expires the room anyway.

## Run/deploy (only after review)

Requires a Cloudflare account, Wrangler and a supported Node.js runtime.

1. Set `ALLOWED_ORIGINS` in `wrangler.jsonc` to the *exact* origin(s) of the trusted reader page. Multiple origins are comma-separated; **never use `*`**.
2. From `relay/`, log into Cloudflare and run `npx wrangler deploy`. Wrangler creates the SQLite Durable Object namespace using `new_sqlite_classes` migration.
3. Copy your Worker HTTPS URL into the reader's Live panel. Don't point a public reader at a private g-mind endpoint.
4. To test MCP transport, inspect `https://YOUR-WORKER/mcp` with MCP Inspector. It exposes only `get_selected_slide` (read-only), which requires the room-specific credentials. Ensure no room is readable without the exact read key.
5. Configure a **separate public/eligible** ChatGPT plugin with the Worker MCP URL (not the private plugin). Before sharing, validate Free account eligibility and actual image readback.

## Test/acceptance gates

- Unit/local emulator: create, write, get, wrong key rejection, old click replay, cross-room isolation, deletion, expiry, oversized images.
- Browser: select a visual PDF slide, verify marked image exactly matches what was clicked; upload consent is explicit.
- GPT: own account + own chat; tool gets exact page, and actually *sees* the visual image. Test Free account separately.
- Security: threat review, rate limiting, origin locks, retention/privacy review before publishing.

No live service URL is provided yet because no backend has been deployed.
