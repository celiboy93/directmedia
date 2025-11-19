import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

Deno.serve(async (req) => {
  const currentUrl = new URL(req.url);

  if (currentUrl.pathname === "/" || currentUrl.pathname === "") {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MediaFire Proxy</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5; margin: 0; }
          .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.12); width: 100%; max-width: 500px; text-align: center; }
          h2 { color: #2c3e50; margin-top: 0; }
          p { color: #666; font-size: 14px; margin-bottom: 25px; }
          input { width: 100%; padding: 14px; margin-bottom: 20px; border: 1px solid #dfe6e9; border-radius: 8px; box-sizing: border-box; outline: none; transition: border 0.2s; }
          input:focus { border-color: #0984e3; }
          button { width: 100%; padding: 14px; background: #0984e3; color: white; border: none; border-radius: 8px; font-weight: 600; font-size: 16px; cursor: pointer; transition: background 0.2s; }
          button:hover { background: #74b9ff; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🔗 MediaFire Proxy</h2>
          <p>Enter URL to download without restrictions.</p>
          <form id="proxyForm">
            <input type="url" id="mfUrl" placeholder="https://www.mediafire.com/file/..." required />
            <button type="submit">Download via Proxy</button>
          </form>
        </div>
        <script>
          const form = document.getElementById('proxyForm');
          form.onsubmit = (e) => {
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
    const path = decodeURIComponent(currentUrl.pathname + currentUrl.search).substring(1);

    if (!path.startsWith("http")) {
        return new Response("Invalid URL. Usage: domain.com/https://mediafire.com/...", { status: 400 });
    }

    const mfRes = await fetch(path, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      }
    });

    if (!mfRes.ok) return new Response("Error fetching external page.", { status: 500 });
    const html = await mfRes.text();

    const doc = new DOMParser().parseFromString(html, "text/html");
    const downloadButton = doc?.getElementById("downloadButton");
    const directLink = downloadButton?.getAttribute("href");

    if (!directLink) {
        return new Response("Error: Could not extract download link. File might be deleted or protected.", { status: 404 });
    }

    const fileRes = await fetch(directLink);
    const headers = new Headers(fileRes.headers);
    
    let filename = "download.file";
    const contentDisposition = fileRes.headers.get("content-disposition");
    if (contentDisposition && contentDisposition.includes("filename=")) {
      filename = contentDisposition.split("filename=")[1].replace(/"/g, "");
    } else {
      filename = path.split('/').pop() || "file.bin";
    }
    
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);

    return new Response(fileRes.body, {
        status: fileRes.status,
        headers: headers
    });

  } catch (err) {
    return new Response("Internal Server Error: " + err.message, { status: 500 });
  }
});
