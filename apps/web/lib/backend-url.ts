const PRODUCTION_BACKEND_URL = "https://outreachai-api-production.up.railway.app";

export function backendApiUrl() {
  return process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || PRODUCTION_BACKEND_URL;
}
