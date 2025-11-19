import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 1. Frontend UI
  if (url.pathname === "/" || url.pathname === "") {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Stream Proxy Generator</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #141414; color: white; margin: 0; }
          .card { background: #1f1f1f; padding: 30px; border-radius: 12px; width: 100%; max-width: 500px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          h2 { color: #e50914; margin-top: 0; }
          p { color: #b3b3b3; font-size: 14px; margin-bottom: 25px; }
          input { width: 100%; padding: 14px; margin-bottom: 15px; border: 1px solid #333; background: #333; color: white; border-radius: 4px; box-sizing: border-box; outline: none; }
          input:focus { border-color: #e50914; }
          button { width: 100%; padding: 14px; background: #e50914; color: white; border: none; border-radius: 4px; font-weight: bold; font-size: 16px; cursor: pointer; transition: 0.2s; }
          button:hover { background: #f40612; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🎬 Stream Link Generator</h2>
          <p>Generate streaming link for Movie APKs (VPN-Free)</p>
          <form id="form">
            <input type="url" id="mfUrl" placeholder="https://www.mediafire.com/file/..." required />
            <button type="submit">Get Stream URL</button>
          </form>
        </div>
        <script>
          document.getElementById('form').onsubmit = (e) => {
            e.preventDefault();
            const url = document.getElementById('mfUrl').value;
            window.location.href = "/" + url; 
          }
        </script>
      </body>
      </html>
    `;
    return new Response(html, { headers: { "content-type": "text/html" } });
  }

  try {
    // Extract URL from path
    const rawPath = decodeURIComponent(url.pathname + url.search).substring(1);
    
    if (!rawPath.startsWith("http")) {
        return new Response("Invalid URL. Please provide a valid HTTP/HTTPS URL.", { status: 400 });
    }

    // Step A: Fetch MediaFire HTML
    const mfRes = await fetch(rawPath, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    
    if (!mfRes.ok) return new Response("Failed to fetch external page", { status: 500 });
    
    const html = await mfRes.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const downloadButton = doc?.getElementById("downloadButton");
    const directLink = downloadButton?.getAttribute("href");

    if (!directLink) return new Response("Direct link not found. File might be deleted.", { status: 404 });

    // Step B: Handle Range Header (Critical for Video Streaming)
    const requestHeaders = new Headers();
    const range = req.headers.get("range");
    if (range) {
        requestHeaders.set("Range", range);
    }

    // Step C: Stream the File
    const fileRes = await fetch(directLink, {
        headers: requestHeaders 
    });

    // Step D: Prepare Response Headers
    const responseHeaders = new Headers(fileRes.headers);
    
    // Force inline display (plays video instead of download)
    responseHeaders.set("Content-Disposition", "inline");
    
    // Allow CORS for APKs/Players
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Headers", "Range");
    responseHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length");

    return new Response(fileRes.body, {
        status: fileRes.status, // Pass 206 or 200 correctly
        headers: responseHeaders
    });

  } catch (err) {
    return new Response("Stream Error: " + err.message, { status: 500 });
  }
});
