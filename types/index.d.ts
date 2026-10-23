export type ReqStatus =
  | 'captured'
  | 'in_progress'
  | 'implemented'
  | 'verified'
  | 'blocked'
  | 'needs_clarification'
  | 'deferred'

export type Evidence = {
  kind: 'test' | 'edit' | 'manual' | 'note'
  at: number
  text: string
  eventId?: string
}

export type ReqVersion = {
  at: number
  text: string
  kind: 'original' | 'refinement'
  by: 'you' | 'agent'
}

export type Requirement = {
  id: string
  title: string
  status: ReqStatus
  at: number
  history: ReqVersion[]
  evidence: Evidence[]
  needsReverify?: boolean
}

export type EventKind = 'discovery' | 'plan' | 'code' | 'command' | 'test' | 'message'

export type ActivityEvent = {
  id: string
  kind: EventKind
  at: number
  title: string
  detail?: string
  file?: string
  diff?: string
  state?: 'running' | 'ok' | 'failed'
}

export type ReplyMode = 'comment' | 'requirement' | 'redirect'
export type Delivery = 'kept' | 'queued' | 'received' | 'acted' | 'failed'

export type Reply = {
  id: string
  eventId: string
  at: number
  text: string
  mode: ReplyMode
  delivery: Delivery
  reqId?: string
  interrupt?: boolean
  error?: string
}

export type Filter = 'key' | 'all' | 'code' | 'tests' | 'messages'

export type View = {
  tab: 'reqs' | 'activity' | 'audit'
  selectedEvent?: string
  selectedReq?: string
  mode: ReplyMode
  refines: string
  interrupt: boolean
  filter: Filter
  dark: boolean
}

export type ThemeTokens = {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  text2: string
  text3: string
  done: string
  active: string
  warn: string
  danger: string
}

export type Theme = {
  name: string
  dark: ThemeTokens
  light: ThemeTokens
}

declare module 'claude-code' {
  interface PluginState {
    praetorium: {
      reqs: Requirement[]
      events: ActivityEvent[]
      replies: Reply[]
      view: View
      turnId: string
      inboxSeq: number
      title: string
      theme: Theme
    }
  }
}
