const DEFAULT_PORTS: Record<string, number> = {
  'http:': 80,
  'https:': 443,
  'ws:': 80,
  'wss:': 443
}

const withDefaultScheme = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Server URL is empty')
  }
  return /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

const parseServerUrl = (value: string): URL => {
  const parsed = new URL(withDefaultScheme(value))

  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported server URL protocol: ${parsed.protocol}`)
  }

  parsed.port = parsed.port || String(DEFAULT_PORTS[parsed.protocol])
  parsed.pathname = '/'
  parsed.search = ''
  parsed.hash = ''
  return parsed
}

export const normalizeServerUrl = (value: string): string => parseServerUrl(value).toString().replace(/\/$/, '')

export const toHealthUrl = (value: string): string => {
  const parsed = parseServerUrl(value)
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : parsed.protocol === 'ws:' ? 'http:' : parsed.protocol
  parsed.port = parsed.port || String(DEFAULT_PORTS[parsed.protocol])
  parsed.pathname = '/health'
  return parsed.toString()
}

export const toWebSocketUrl = (value: string): string => {
  const parsed = parseServerUrl(value)
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : parsed.protocol === 'http:' ? 'ws:' : parsed.protocol
  parsed.port = parsed.port || String(DEFAULT_PORTS[parsed.protocol])
  parsed.pathname = '/ws'
  return parsed.toString()
}
