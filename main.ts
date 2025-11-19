import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

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
        <title>Turbo Link Gen</title>
        <style>
          body { font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f0f0f; color: #f0f0f0; margin: 0; }
          .card { background: #1a1a1a; padding: 30px; border-radius: 16px; width: 100%; max-width: 550px; text-align: center; box-shadow: 0 15px 40px rgba(0,0,0,0.6); border: 1px solid #333; }
          h2 { color: #e056fd; margin-top: 0; font-weight: 800; }
          p { color: #888; font-size: 14px; margin-bottom: 25px; }
          
          input { width: 100%; padding: 14px; margin-bottom: 10px; background: #2a2a2a; border: 1px solid #444; color: white; border-radius: 8px; box-sizing: border-box; outline: none; transition: 0.3s; }
          input:focus { border-color: #e056fd; background: #333; }
          
          button.gen-btn { width: 100%; padding: 14px; background: #e056fd; color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 16px; cursor: pointer; transition: 0.2s; margin-top: 10px; }
          button.gen-btn:hover { background: #be2edd; }
          
          #resultArea { display: none; margin-top: 30px; text-align: left; border-top: 1px solid #333; padding-top: 20px; }
          .label { font-size: 11px; color: #e056fd; margin-bottom: 6px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
          .copy-group { display: flex; gap: 10px; margin-bottom: 20px; }
          .res-input { flex-grow: 1; background: #000; border: 1px solid #333; color: #ccc; padding: 10px; border-radius: 6px; font-size: 12px; font-family: monospace; }
          .copy-btn { background: #333; color: white; border: 1px solid #444; padding: 0 18px; border-radius: 6px; cursor: pointer; font-weight: bold; }
          .copy-btn:hover { background: #555; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🦄 Turbo Generator</h2>
          <p>Fast Stream + Custom Filename</p>
          <form id="form">
            <input type="url" id="mfUrl" placeholder="Paste MediaFire Link..." required />
            <input type="text" id="customName" placeholder="Custom Filename (e.g. Movie.mp4) - Optional" />
            <button type="submit" class="gen-btn">Generate Links</button>
          </form>
          <div id="resultArea">
            <div class="label">Stream Link</div>
            <div class="copy-group">
              <input type="text" class="res-input" id="streamLink" readonly />
              <button class="copy-btn" onclick="copy('streamLink')">Copy</button>
            </div>
            <div class="label">Download Link</div>
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
            const cName = document.getElementById('customName').value.trim();
            
            const encoded = btoa(rawUrl);
            const domain = window.location.origin;
            
            // Append custom name as query param if exists
            let suffix = "";
            if (cName) suffix = "?name=" + encodeURIComponent(cName);

            sInput.value = domain + "/view/" + encoded + suffix;
            dInput.value = domain + "/down/" + encoded + suffix;
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

  // 2. Backend Logic
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

    // Check KV Cache
    let directLink = null;
    const cacheKey = ["mf_link", targetMediaFireUrl];
    const cachedEntry = await kv.get(cacheKey);

    if (cachedEntry.value) {
        directLink = cachedEntry.value;
    } else {
        const mfRes = await fetch(targetMediaFireUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!mfRes.ok) return new Response("MediaFire Error", { status: 500 });

        const html = await mfRes.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        directLink = doc?.getElementById("downloadButton")?.getAttribute("href");

        if (!directLink) return new Response("File missing", { status: 404 });

        await kv.set(cacheKey, directLink, { expireIn: 3600 * 1000 });
    }

    // Stream Request
    const requestHeaders = new Headers();
    const range = req.headers.get("range");
    if (range) requestHeaders.set("Range", range);

    let fileRes = await fetch(directLink, { headers: requestHeaders });

    // Retry on Expired Link
    if (fileRes.status >= 400) {
        const mfResRetry = await fetch(targetMediaFireUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        const htmlRetry = await mfResRetry.text();
        const docRetry = new DOMParser().parseFromString(htmlRetry, "text/html");
        directLink = docRetry?.getElementById("downloadButton")?.getAttribute("href");
        
        if (directLink) {
            await kv.set(cacheKey, directLink, { expireIn: 3600 * 1000 });
            fileRes = await fetch(directLink, { headers: requestHeaders });
        } else {
             return new Response("Link expired", { status: 410 });
        }
    }

    const responseHeaders = new Headers(fileRes.headers);
    
    // --- CUSTOM FILENAME LOGIC ---
    let filename = "video.mp4";
    const customNameParam = url.searchParams.get("name");

    if (customNameParam) {
        // Use user provided name
        filename = customNameParam;
    } else {
        // Use original name
        const disp = fileRes.headers.get("content-disposition");
        if (disp && disp.includes("filename=")) {
            filename = disp.split("filename=")[1].replace(/"/g, "");
        } else {
            filename = targetMediaFireUrl.split('/').pop() || "video.mp4";
        }
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
    return new Response("Error: " + err.message, { status: 500 });
  }
});
