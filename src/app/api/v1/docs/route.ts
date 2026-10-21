// Swagger UI served from local assets (issue #298).
// The CSS and JS are bundled under public/swagger/ so the app never fetches
// from a third-party CDN at runtime — this eliminates the supply-chain risk
// of an uncontrolled CDN response replacing our JS.
import { NextResponse } from "next/server";

const SPEC_URL = "/api/v1/docs/spec";

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ajosave API v1 Docs</title>
  <link rel="stylesheet" href="/swagger/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/swagger/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "${SPEC_URL}",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout",
      deepLinking: true,
    });
  </script>
</body>
</html>`;

export function GET() {
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
