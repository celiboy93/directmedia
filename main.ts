import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

// Initialize Deno KV Database for Caching
const kv = await Deno.openKv();

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // 1. Frontend UI
  if (path === "/" || path === "") {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Turbo Link Generator</title>
        <style>
          body { font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f0f0f; color: #f0f0f0; margin: 0; }
          .card { background: #1a1a1a; padding: 30px; border-radius: 16px; width: 100%; max-width: 550px; text-align: center; box-shadow: 0 15px 40px rgba(0,0,0,0.6); border: 1px solid #333; }
          h2 { color: #00d2d3; margin-top: 0; font-weight: 800; }
          p { color: #888; font-size: 14px; margin-bottom: 25px; }
          input[type="url"] { width: 100%; padding: 14px; margin-bottom: 15px; background: #2a2a2a; border: 1px solid #444; color: white; border-radius: 8px; box-sizing: border-box; outline: none; transition: 0.3s; }
          input[type="url"]:focus { border-color: #00d2d3; background: #333; }
          button.gen-btn { width: 100%; padding: 14px; background: #00d2d3; color: black; border: none; border-radius: 8px; font-weight: bold; font-size: 16px; cursor: pointer; transition: 0.2s; }
          button.gen-btn:hover { background: #01a3a4; }
          
          #resultArea { display: none; margin-top: 30px; text-align: left; border-top: 1px solid #333; padding-top: 20px; }
          .label { font-size: 11px; color: #00d2d3; margin-bottom: 6px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
          .copy-group { display: flex; gap: 10px; margin-bottom: 20px; }
          .res-input { flex-grow: 1; background: #000; border: 1px solid #333; color: #ccc; padding: 10px; border-radius: 6px; font-size: 12px; font-family: monospace; }
          .copy-btn { background: #333; color: white; border: 1px solid #444; padding: 0 18px; border-radius: 6px; cursor: pointer; font-weight: bold; }
          .copy-btn:hover { background: #555; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>⚡ Turbo Generator</h2>
          <p>Fast Streaming with Smart Caching</p>
          <form id="form">
            <input type="url" id="mfUrl" placeholder="https://www.mediafire.com/file/..." required />
            <button type="submit" class="gen-btn">Generate Links</button>
          </form>
          <div id="resultArea">
            <div class="label">Video Stream Link (Player)</div>
            <div class="copy-group">
              <input type="text" class="res-input" id="streamLink" readonly />
              <button class="copy-btn" onclick="copy('streamLink')">Copy</button>
            </div>
            <div class="label">Direct Download Link</div>
            <div class="copy-group">
              <input type="text" class="res-input" id="dlLink" readonly />
              <button class="copy-btn" onclick="copy('dlLink')">Copy</button>
            </div>
          </div>
        </div>
        <script>
          const form = document.getElementById('form');
          const resultArea = document.getElementById('resultArea');
          const sInput = document.getElementById('streamLink');
          const dInput = document.getElementById('dlLink');

          form.onsubmit = (e) => {
            e.preventDefault();
            const rawUrl = document.getElementById('mfUrl').value;
            const encoded = btoa(rawUrl);
            const domain = window.location.origin;
            sInput.value = domain + "/view/" + encoded;
            dInput.value = domain + "/down/" + encoded;
            resultArea.style.display = 'block';
          }

          function copy(id) {
            const el = document.getElementById(id);
            el.select();
            el.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(el.value);
          }
        </script>
      </body>
      </html>
    `;
    return new Response(html, { headers: { "content-type": "text/html" } });
  }

  // 2. Backend Logic with Caching
  try {
    let mode = ""; 
    let encodedUrl = "";

    if (path.startsWith("/view/")) {
      mode = "inline"; 
      encodedUrl = path.replace("/view/", "");
    } else if (path.startsWith("/down/")) {
      mode = "attachment"; 
      encodedUrl = path.replace("/down/", "");
    } else {
      return new Response("Not Found", { status: 404 });
    }

    const targetMediaFireUrl = atob(encodedUrl);
    if (!targetMediaFireUrl.startsWith("http")) return new Response("Invalid URL", { status: 400 });

    // --- CACHING STRATEGY ---
    // Step A: Check KV Database for existing Direct Link
    let directLink = null;
    const cacheKey = ["mf_link", targetMediaFireUrl];
    const cachedEntry = await kv.get(cacheKey);

    if (cachedEntry.value) {
        // Cache Hit! Use the stored link.
        directLink = cachedEntry.value;
    } else {
        // Cache Miss! Need to scrape MediaFire.
        const mfRes = await fetch(targetMediaFireUrl, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        if (!mfRes.ok) return new Response("MediaFire Error", { status: 500 });

        const html = await mfRes.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const downloadButton = doc?.getElementById("downloadButton");
        directLink = downloadButton?.getAttribute("href");

        if (!directLink) return new Response("File missing or deleted", { status: 404 });

        // Store in KV Cache (Expire in 1 hour to ensure freshness)
        await kv.set(cacheKey, directLink, { expireIn: 3600 * 1000 });
    }

    // --- STREAMING ---
    const requestHeaders = new Headers();
    const range = req.headers.get("range");
    if (range) requestHeaders.set("Range", range);

    // Fetch the actual file
    let fileRes = await fetch(directLink, { headers: requestHeaders });

    // Retry Logic: If link expired (403/404), Scrape again instantly
    if (fileRes.status >= 400) {
        const mfResRetry = await fetch(targetMediaFireUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        const htmlRetry = await mfResRetry.text();
        const docRetry = new DOMParser().parseFromString(htmlRetry, "text/html");
        directLink = docRetry?.getElementById("downloadButton")?.getAttribute("href");
        
        if (directLink) {
            await kv.set(cacheKey, directLink, { expireIn: 3600 * 1000 });
            fileRes = await fetch(directLink, { headers: requestHeaders });
        } else {
             return new Response("Link expired and cannot refresh", { status: 410 });
        }
    }

    // Prepare Headers
    const responseHeaders = new Headers(fileRes.headers);
    
    // Get Filename
    let filename = "video.mp4";
    const disp = fileRes.headers.get("content-disposition");
    if (disp && disp.includes("filename=")) {
        filename = disp.split("filename=")[1].replace(/"/g, "");
    } else {
        filename = targetMediaFireUrl.split('/').pop() || "video.mp4";
    }

    responseHeaders.set("Content-Disposition", `${mode}; filename="${filename}"`);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Headers", "Range");
    responseHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length");

    return new Response(fileRes.body, {
      status: fileRes.status,
      headers: responseHeaders
    });

  } catch (err) {
    return new Response("Server Error: " + err.message, { status: 500 });
  }
});
