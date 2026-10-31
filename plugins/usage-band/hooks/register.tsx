import { atom, read, update } from 'claude-code'
import type { Register, SessionUsage } from 'claude-code'

import type { Limit, Usage } from '../types'

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, null)
const isHidden = atom({ plugin: 'usage-band', key: 'isHidden' } as const, false)

const LABELS: Record<string, string> = {
  five_hour: '5 год',
  seven_day: '7 днів',
  spend_limit: 'бюджет',
}

const toUsage = (u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): Usage => ({
  tokens: u.context.tokens,
  window: u.context.window,
  percent: u.context.percent,
  limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  usd: u.cost?.usd,
})

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

const bar = (percent: number, width = 10) => {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const color = (percent: number) => (percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : 'green')

const resetIn = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 24) return ` (скид. ${Math.floor(h / 24)}д ${h % 24}г)`
  return h > 0 ? ` (скид. ${h}г ${m}хв)` : ` (скид. ${m}хв)`
}

const limitText = (l: Limit, now: number) => {
  const left = Math.max(0, Math.round((100 - l.percentUsed) * 10) / 10)
  return `${LABELS[l.kind] ?? l.kind}: залишилось ${left}%${resetIn(l.resetsAt, now)}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await update($, usage, () => null)
    const u = await $.session.usage()
    await update($, usage, () => toUsage(u))
    $.command.register({ name: 'usage-band', description: 'Показати/сховати панель контексту та лімітів' })
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e))
    return next(e)
  })

  on('command.run', { command: 'usage-band' }, async $ => {
    const hidden = await update($, isHidden, v => !v)
    return { text: hidden ? 'Панель usage сховано' : 'Панель usage показано' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const u = await read($, usage)
    if (e.props.hasSurvey || u === null || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const pct = u.percent ?? (u.tokens !== undefined && u.window ? (u.tokens / u.window) * 100 : undefined)

    return (
      <Box flexDirection="row" flexWrap="wrap">
        <Text dimColor>Контекст: </Text>
        {pct === undefined ? (
          <Text dimColor>— / {k(u.window)}</Text>
        ) : (
          <Text color={color(pct)}>
            {bar(pct)} {Math.round(pct)}%{u.tokens !== undefined ? ` (${k(u.tokens)}/${k(u.window)})` : ''}
          </Text>
        )}
        {u.limits.map(l => (
          <Text key={l.kind} color={color(l.percentUsed)}>
            {'  │ '}
            {limitText(l, now)}
          </Text>
        ))}
        {u.limits.length === 0 ? <Text dimColor>{'  │ ліміти: немає даних'}</Text> : null}
        {u.usd !== undefined ? <Text dimColor>{`  │ $${u.usd.toFixed(2)}`}</Text> : null}
      </Box>
    )
  })
}
