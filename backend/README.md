# URL SHORTNER: backend

See the [root README](../README.md) for setup and an overview.

## ENDPOINTS

### url:
- POST -> /api/v1/url (also accepts /api/v1/url/)
- GET -> /api/v1/url/{code} (resolves the link and counts a click)
- GET -> /api/v1/url/stats/{code} (read-only, doesn't count a click)
- PATCH -> /api/v1/url/{code} (edit `url` / `expiry`, requires `X-Delete-Token`)
- DELETE -> /api/v1/url/{code} (requires `X-Delete-Token`)
