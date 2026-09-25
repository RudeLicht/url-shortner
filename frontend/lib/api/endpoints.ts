export const urlEndpoints = {
  create: () => "/api/v1/url/",
  resolve: (code: string) => `/api/v1/url/${encodeURIComponent(code)}`,
  stats: (code: string) => `/api/v1/url/stats/${encodeURIComponent(code)}`,
  delete: (code: string) => `/api/v1/url/${encodeURIComponent(code)}`,
};
