export const urlEndpoints = {
  // No trailing slash: Next.js would 308-redirect "/api/v1/url/" before it
  // reached the proxy route. The backend itself redirects to its "/" form,
  // which the proxy's fetch follows internally.
  create: () => "/api/v1/url",
  resolve: (code: string) => `/api/v1/url/${encodeURIComponent(code)}`,
  stats: (code: string) => `/api/v1/url/stats/${encodeURIComponent(code)}`,
  delete: (code: string) => `/api/v1/url/${encodeURIComponent(code)}`,
};
