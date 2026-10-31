import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Limit, Usage } from '../types'

const PANE = 'usage-band'
const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, null)

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

const pctOf = (u: Usage) =>
  u.percent ?? (u.tokens !== undefined && u.window ? (u.tokens / u.window) * 100 : undefined)

const resetIn = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 24) return ` (скид. ${Math.floor(h / 24)}д ${h % 24}г)`
  return h > 0 ? ` (скид. ${h}г ${m}хв)` : ` (скид. ${m}хв)`
}

const left = (l: Limit) => Math.max(0, Math.round((100 - l.percentUsed) * 10) / 10)

const limitText = (l: Limit, now: number) =>
  `${LABELS[l.kind] ?? l.kind}: залишилось ${left(l)}%${resetIn(l.resetsAt, now)}`

// Короткий рядок для статус-лінії під полем вводу.
const statusText = (u: Usage) => {
  const pct = pctOf(u)
  const parts = [pct === undefined ? 'ctx —' : `ctx ${Math.round(pct)}%`]
  for (const l of u.limits) parts.push(`${LABELS[l.kind] ?? l.kind} ${left(l)}% лишилось`)
  if (u.usd !== undefined) parts.push(`$${u.usd.toFixed(2)}`)
  return parts.join(' │ ')
}

async function refresh($: EngineInterface, u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) {
  const next = toUsage(u)
  await update($, usage, () => next)
  $.ui.status(statusText(next))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($, await $.session.usage())
    await $.command.register({ name: 'usage-band', description: 'Відкрити панель контексту та лімітів' })
    void $.ui.open({ id: PANE, title: 'Контекст і ліміти' })
    return result
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, e)
    return next(e)
  })

  on('command.run', { command: 'usage-band' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Контекст і ліміти' })
    return { text: 'Панель контексту та лімітів відкрито.' }
  })

  // Смуга над полем вводу (термінал) — одним рядком.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const u = await read($, usage)
    if (e.props.hasSurvey || u === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const pct = pctOf(u)

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

  // Панель збоку (застосунок, VS Code, термінал) — стовпчиком.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const u = await read($, usage)
    const { Box, Text } = $.ui.resolve(e)
    if (u === null) return <Text dimColor>Чекаю на перші дані…</Text>

    const now = await $.clock.now()
    const pct = pctOf(u)

    return (
      <Box flexDirection="column">
        <Text bold>Контекст</Text>
        {pct === undefined ? (
          <Text dimColor>— / {k(u.window)}</Text>
        ) : (
          <Text color={color(pct)}>
            {bar(pct, 16)} {Math.round(pct)}%
          </Text>
        )}
        {u.tokens !== undefined ? (
          <Text dimColor>
            {k(u.tokens)} з {k(u.window)} токенів
          </Text>
        ) : null}
        <Text bold>Ліміти</Text>
        {u.limits.length === 0 ? <Text dimColor>немає даних (з'являться після відповіді; лише Pro/Max)</Text> : null}
        {u.limits.map(l => (
          <Box key={l.kind} flexDirection="column">
            <Text color={color(l.percentUsed)}>
              {bar(l.percentUsed, 16)} {left(l)}% лишилось
            </Text>
            <Text dimColor>
              {LABELS[l.kind] ?? l.kind}
              {resetIn(l.resetsAt, now)}
            </Text>
          </Box>
        ))}
        {u.usd !== undefined ? <Text dimColor>{`Вартість сесії: $${u.usd.toFixed(2)}`}</Text> : null}
      </Box>
    )
  })
}
