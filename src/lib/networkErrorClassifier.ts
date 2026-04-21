// Recognises log lines / error messages that indicate a network reachability
// problem (DNS, routing, connection refused, etc.) rather than an authenticated
// failure (401/403) or a bad URL. Used to classify engine-startup failures so
// we can suggest Offline Mode to users who have what they need already cached.
const NETWORK_PATTERNS = [
  /Network is unreachable/i,
  /tcp connect error/i,
  /error sending request for url/i,
  /Failed to fetch/i,
  /Could not resolve host/i,
  /Temporary failure in name resolution/i,
  /getaddrinfo .*(ENOTFOUND|EAI_AGAIN)/i,
  /Max retries exceeded/i,
  /Connection refused/i
]

export const isNetworkError = (text: string): boolean => NETWORK_PATTERNS.some((r) => r.test(text))
