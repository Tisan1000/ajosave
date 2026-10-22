# SRI Policy — Subresource Integrity (issue #298)

## What is SRI?

[Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) lets browsers verify that files they fetch from third-party origins (CDNs) have not been tampered with. If the fetched asset doesn't match the hash in the `integrity=` attribute, the browser refuses to load it.

## Our Approach

**All Swagger/API-doc assets are served locally** from `public/swagger/` rather than from a CDN. This means:

- No SRI hash maintenance is needed for those files.
- CDN availability is not a dependency at runtime.
- A compromised CDN cannot inject malicious JavaScript.

If any future page needs to reference an external asset (e.g. a third-party font or analytics snippet), SRI is **required**. See the workflow below.

## Automated CI Check

A GitHub Actions step runs `node scripts/sri-audit.js` on every PR. It scans all `.ts`, `.tsx`, `.js`, `.jsx`, and `.html` files for `src="https://..."` or `href="https://..."` attributes that lack an `integrity=` attribute. Any finding fails CI.

## Updating Local Swagger Assets

When upgrading `swagger-ui-dist`, re-download the assets:

```bash
# 1. Find the new version on npm
npm view swagger-ui-dist version

# 2. Download the new assets (replace X.Y.Z with the new version)
VERSION=X.Y.Z
curl -sL "https://unpkg.com/swagger-ui-dist@${VERSION}/swagger-ui.css" \
     -o public/swagger/swagger-ui.css
curl -sL "https://unpkg.com/swagger-ui-dist@${VERSION}/swagger-ui-bundle.js" \
     -o public/swagger/swagger-ui-bundle.js

# 3. Commit the updated files
git add public/swagger/
git commit -m "chore: upgrade swagger-ui-dist to v${VERSION}"
```

## If You Must Use a CDN Reference

In rare cases where a local copy is impractical, compute the SRI hash and add it:

```bash
# Generate sha384 hash for a CDN file
curl -sL "https://cdn.example.com/lib.js" | \
  openssl dgst -sha384 -binary | \
  openssl base64 -A
```

Then use it in HTML:

```html
<!-- Always add crossorigin="anonymous" alongside integrity= -->
<script
  src="https://cdn.example.com/lib.js"
  integrity="sha384-<paste-hash-here>"
  crossorigin="anonymous"
></script>
```

For `<link>` elements:

```html
<link
  rel="stylesheet"
  href="https://cdn.example.com/style.css"
  integrity="sha384-<paste-hash-here>"
  crossorigin="anonymous"
/>
```

## References

- [MDN: Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
- [SRI Hash Generator](https://www.srihash.org/)
- [OWASP: Third-party JavaScript Management](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html)
