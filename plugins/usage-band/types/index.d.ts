export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Usage = {
  tokens?: number
  window: number
  percent?: number
  limits: Limit[]
  usd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { usage: Usage | null }
  }
}
