import type { Theme, ThemeTokens } from '../types'

// The eleven colours a theme sets per mode. Dim backgrounds are derived.
export const TOKEN_KEYS = [
  'bg', 'surface', 'surface2', 'border', 'text', 'text2', 'text3',
  'done', 'active', 'warn', 'danger',
] as const

export const PRESETS: Record<string, Theme> = {
  graphite: {
    name: 'graphite',
    dark: {
      bg: '#0d0f12', surface: '#14171c', surface2: '#1c2027', border: '#2a2f38',
      text: '#e6e8eb', text2: '#a0a6b0', text3: '#6b7280',
      done: '#34d399', active: '#818cf8', warn: '#fbbf24', danger: '#f87171',
    },
    light: {
      bg: '#f8f9fb', surface: '#ffffff', surface2: '#f0f2f5', border: '#e3e6ea',
      text: '#111418', text2: '#3d434c', text3: '#6b7280',
      done: '#047857', active: '#4f46e5', warn: '#b45309', danger: '#b91c1c',
    },
  },
  telborg: {
    name: 'telborg',
    dark: {
      bg: '#0a0a0a', surface: '#121212', surface2: '#1f1f1f', border: '#292929',
      text: '#e2e8f0', text2: '#9d9d9d', text3: '#5d5d5d',
      done: '#c3f73a', active: '#af74fb', warn: '#f5a623', danger: '#f45286',
    },
    light: {
      bg: '#fafaf7', surface: '#ffffff', surface2: '#f1f1ec', border: '#e2e2dc',
      text: '#111111', text2: '#3f3f3f', text3: '#6a6a6a',
      done: '#4a6b08', active: '#6b21d4', warn: '#a16207', danger: '#c81e5b',
    },
  },
  paper: {
    name: 'paper',
    dark: {
      bg: '#1b1a17', surface: '#22211d', surface2: '#2c2a25', border: '#3a3731',
      text: '#ece6d8', text2: '#b3ab98', text3: '#7d7666',
      done: '#9fbf6b', active: '#d9a35b', warn: '#e0b453', danger: '#e07a5f',
    },
    light: {
      bg: '#faf7f0', surface: '#fffdf8', surface2: '#f2ede2', border: '#e4ddcd',
      text: '#2b2720', text2: '#57503f', text3: '#857c69',
      done: '#4d6b1f', active: '#9a5b13', warn: '#8a6100', danger: '#a23b22',
    },
  },
}

export const DEFAULT_THEME = PRESETS.graphite as Theme

export type Tone = 'done' | 'active' | 'warn' | 'danger' | 'muted'

export type Palette = ThemeTokens & {
  doneDim: string
  activeDim: string
  warnDim: string
  dangerDim: string
  mutedDim: string
}

const HEX = /^#[0-9a-f]{6}$/i

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

export function mix(fg: string, bg: string, amount: number): string {
  const a = rgb(fg)
  const b = rgb(bg)
  return `#${a.map((c, i) => Math.round((b[i] ?? 0) + (c - (b[i] ?? 0)) * amount).toString(16).padStart(2, '0')).join('')}`
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// Fills gaps from the default and replaces any colour too faint to read on its background.
export function normalizeTokens(raw: Partial<Record<string, unknown>> | undefined, mode: 'dark' | 'light'): ThemeTokens {
  const fallback = DEFAULT_THEME[mode]
  const out = { ...fallback }
  for (const key of TOKEN_KEYS) {
    const v = raw?.[key]
    if (typeof v === 'string' && HEX.test(v.trim())) out[key] = v.trim().toLowerCase()
  }
  const needs: [keyof ThemeTokens, number][] = [
    ['text', 4.5], ['text2', 3], ['text3', 2], ['done', 3], ['active', 3], ['warn', 3], ['danger', 3],
  ]
  for (const [key, min] of needs) {
    if (contrast(out[key], out.bg) < min) out[key] = fallback[key]
  }
  return out
}

export function normalizeTheme(raw: unknown, name = 'custom'): Theme {
  const r = (raw ?? {}) as { name?: unknown; dark?: Record<string, unknown>; light?: Record<string, unknown> }
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : name,
    dark: normalizeTokens(r.dark, 'dark'),
    light: normalizeTokens(r.light, 'light'),
  }
}

export function palette(theme: Theme, dark: boolean): Palette {
  const t = dark ? theme.dark : theme.light
  return {
    ...t,
    doneDim: mix(t.done, t.surface, 0.14),
    activeDim: mix(t.active, t.surface, 0.14),
    warnDim: mix(t.warn, t.surface, 0.14),
    dangerDim: mix(t.danger, t.surface, 0.14),
    mutedDim: t.surface2,
  }
}

export const toneFg = (p: Palette, t: Tone) => (t === 'muted' ? p.text3 : p[t])
export const toneBg = (p: Palette, t: Tone) => p[`${t}Dim` as const]

// ---------- importing a theme ----------

const MAX_SOURCE = 24_000

// Colour-bearing lines only, so a big stylesheet still fits in a small prompt.
export function colourLines(source: string): string {
  const keep = source
    .split(/[\n;{}]/)
    .map(l => l.trim())
    .filter(l => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|--[\w-]+\s*:|colors?\s*[:=]|theme|primary|accent|brand|background|foreground/i.test(l))
  return [...new Set(keep)].join('\n').slice(0, MAX_SOURCE)
}

// Pulls what carries colour out of a page: theme-color metas, inline styles and stylesheet links.
export function pageParts(html: string, pageUrl: string): { inline: string[]; stylesheets: string[] } {
  const inline = [
    ...[...html.matchAll(/<meta[^>]+name=["']theme-color["'][^>]*>/gi)].map(m => m[0]),
    ...[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1] ?? ''),
  ]
  const stylesheets = [...html.matchAll(/<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi)]
    .map(m => /href=["']([^"']+)["']/i.exec(m[0])?.[1])
    .filter((h): h is string => Boolean(h))
    .slice(0, 4)
    .map(h => new URL(h, pageUrl).toString())
  return { inline, stylesheets }
}

export function sourceKind(from: string): string {
  if (/^https?:\/\//i.test(from)) return `the website ${from}`
  const name = from.split(/[\\/]/).pop() ?? from
  return /tailwind/i.test(name) ? 'a Tailwind config' : /\.css$/i.test(name) ? 'a stylesheet' : `the file ${name}`
}

// A theme file in our own format needs no model.
export function ownThemeFile(text: string): Theme | undefined {
  try {
    const parsed = JSON.parse(text) as { dark?: unknown; light?: unknown }
    return parsed && typeof parsed === 'object' && (parsed.dark || parsed.light) ? normalizeTheme(parsed) : undefined
  } catch {
    return undefined
  }
}

export function themeFromReply(reply: string): Theme {
  return normalizeTheme(JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)))
}

export const IMPORT_SYSTEM =
  'You turn a brand\'s colours into a theme for a developer tool that shows a task\'s requirements, activity and audit. ' +
  'Reply with JSON only: {"name":string,"dark":Tokens,"light":Tokens}, where Tokens has these hex colours: ' +
  'bg (page), surface (cards), surface2 (hover/selected rows), border, text (body, at least 4.5:1 on bg), text2 (secondary), text3 (timestamps, placeholders), ' +
  'done (verified/success: the brand\'s most vivid positive colour), active (in progress/focus: a second brand accent), warn (needs review), danger (failed/blocked). ' +
  'Use the brand\'s own colours wherever they fit; derive the mode the source does not define so the brand still reads, ' +
  'darkening accents for light mode and lightening them for dark mode until each is legible on bg. name: a short lowercase name for the brand.'
