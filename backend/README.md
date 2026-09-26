# URL SHORTNER

## ENDPOINTS

### url:
- POST -> /api/v1/url (also accepts /api/v1/url/)
- GET -> /api/v1/url/{code} (resolves the link and counts a click)
- GET -> /api/v1/url/stats/{code} (read-only, doesn't count a click)
- DELETE -> /api/v1/url/{code}

### auth (planned, not yet implemented):
- POST -> /api/auth/signup
- POST -> /api/auth/signin
- GET -> /api/auth/me