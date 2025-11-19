import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // =================================================================
  // 1. Frontend UI (Generator with Copy Buttons)
  // =================================================================
  if (path === "/" || path === "") {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Secure Link Generator</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #121212; color: #e0e0e0; margin: 0; }
          .card { background: #1e1e1e; padding: 30px; border-radius: 12px; width: 100%; max-width: 600px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #333; }
          h2 { color: #bb86fc; margin-top: 0; }
          p { color: #b0b0b0; font-size: 14px; margin-bottom: 25px; }
          
          input[type="url"] { width: 100%; padding: 14px; margin-bottom: 15px; background: #2c2c2c; border: 1px solid #444; color: white; border-radius: 6px; box-sizing: border-box; outline: none; }
          input[type="url"]:focus { border-color: #bb86fc; }
          
          button.generate-btn { width: 100%; padding: 14px; background: #bb86fc; color: black; border: none; border-radius: 6px; font-weight: bold; font-size: 16px; cursor: pointer; transition: 0.2s; }
          button.generate-btn:hover { background: #9955e8; }

          /* Result Section */
          #resultArea { display: none; margin-top: 30px; text-align: left; border-top: 1px solid #333; padding-top: 20px; }
          .label { font-size: 12px; color: #03dac6; margin-bottom: 5px; font-weight: bold; letter-spacing: 0.5px; }
          
          .copy-group { display: flex; gap: 10px; margin-bottom: 20px; }
          .result-input { flex-grow: 1; background: #121212; border: 1px solid #333; color: #aaa; padding: 10px; border-radius: 4px; font-size: 13px; }
          .copy-btn { background: #333; color: white; border: 1px solid #444; padding: 0 15px; border-radius: 4px; cursor: pointer; font-weight: bold; }
          .copy-btn:hover { background: #444; }
          .copy-btn:active { background: #03dac6; color: black; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🔒 Secure Link Generator</h2>
          <p>Obfuscate MediaFire Links for Streaming & Downloading</p>
          
          <form id="form">
            <input type="url" id="mfUrl" placeholder="https://www.mediafire.com/file/..." required />
            <button type="submit" class="generate-btn">Generate Secured Links</button>
          </form>

          <div id="resultArea">
            
            <div class="label">🎬 STREAMING LINK (For Player/APK)</div>
            <div class="copy-group">
              <input type="text" class="result-input" id="streamLink" readonly />
              <button class="copy-btn" onclick="copyToClipboard('streamLink')">Copy</button>
            </div>

            <div class="label">⬇️ DIRECT DOWNLOAD LINK (Auto-Download)</div>
            <div class="copy-group">
              <input type="text" class="result-input" id="dlLink" readonly />
              <button class="copy-btn" onclick="copyToClipboard('dlLink')">Copy</button>
            </div>

          </div>
        </div>

        <script>
          const form = document.getElementById('form');
          const resultArea = document.getElementById('resultArea');
          const streamInput = document.getElementById('streamLink');
          const dlInput = document.getElementById('dlLink');

          form.onsubmit = (e) => {
            e.preventDefault();
            const rawUrl = document.getElementById('mfUrl').value;
            
            // Encode URL to Base64 to hide it
            const encoded = btoa(rawUrl);
            const domain = window.location.origin;

            // Construct two different paths
            streamInput.value = domain + "/view/" + encoded;
            dlInput.value = domain + "/down/" + encoded;

            resultArea.style.display = 'block';
          }

          function copyToClipboard(elementId) {
            const copyText = document.getElementById(elementId);
            copyText.select();
            copyText.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(copyText.value);
          }
        </script>
      </body>
      </html>
    `;
    return new Response(html, { headers: { "content-type": "text/html" } });
  }

  // =================================================================
  // 2. Backend Logic (Handle /view/ and /down/)
  // =================================================================
  try {
    let mode = ""; // 'inline' or 'attachment'
    let encodedUrl = "";

    if (path.startsWith("/view/")) {
      mode = "inline"; // For Streaming
      encodedUrl = path.replace("/view/", "");
    } else if (path.startsWith("/down/")) {
      mode = "attachment"; // For Downloading
      encodedUrl = path.replace("/down/", "");
    } else {
      return new Response("Not Found", { status: 404 });
    }

    // Decode the Base64 URL
    const targetUrl = atob(encodedUrl);

    if (!targetUrl.startsWith("http")) {
      return new Response("Invalid URL", { status: 400 });
    }

    // Step A: Fetch MediaFire HTML
    const mfRes = await fetch(targetUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });

    if (!mfRes.ok) return new Response("Error fetching MediaFire", { status: 500 });

    const html = await mfRes.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const downloadButton = doc?.getElementById("downloadButton");
    const directLink = downloadButton?.getAttribute("href");

    if (!directLink) return new Response("Direct link not found. File deleted?", { status: 404 });

    // Step B: Handle Headers (Range & Disposition)
    const requestHeaders = new Headers();
    const range = req.headers.get("range");
    if (range) requestHeaders.set("Range", range);

    // Step C: Stream File
    const fileRes = await fetch(directLink, {
      headers: requestHeaders
    });

    // Step D: Set Response Headers
    const responseHeaders = new Headers(fileRes.headers);
    
    // Get Filename
    let filename = "file.bin";
    const disp = fileRes.headers.get("content-disposition");
    if (disp && disp.includes("filename=")) {
        filename = disp.split("filename=")[1].replace(/"/g, "");
    } else {
        filename = targetUrl.split('/').pop() || "video.mp4";
    }

    // Set Mode (Stream or Download) based on path
    responseHeaders.set("Content-Disposition", `${mode}; filename="${filename}"`);
    
    // CORS & Expose Headers (Critical for Player seeking)
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
