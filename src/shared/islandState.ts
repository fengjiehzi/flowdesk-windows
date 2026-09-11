export type IslandState =
  | 'HIDDEN'
  | 'ENTERING'
  | 'COMPACT'
  | 'EXPANDED'
  | 'COLLAPSING'

export type IslandEvent =
  | 'SHOW_COMPACT'
  | 'ENTER_DONE'
  | 'EXPAND'
  | 'COLLAPSE_DONE'
  | 'LEAVE_DELAY'
  | 'REENTER'
  | 'HIDE'

const transitions: Partial<Record<IslandState, Partial<Record<IslandEvent, IslandState>>>> = {
  HIDDEN: { SHOW_COMPACT: 'ENTERING' },
  ENTERING: { ENTER_DONE: 'COMPACT', EXPAND: 'EXPANDED', LEAVE_DELAY: 'HIDDEN', HIDE: 'HIDDEN' },
  COMPACT: { EXPAND: 'EXPANDED', LEAVE_DELAY: 'HIDDEN', HIDE: 'HIDDEN' },
  EXPANDED: { LEAVE_DELAY: 'COLLAPSING', HIDE: 'HIDDEN' },
  COLLAPSING: { COLLAPSE_DONE: 'COMPACT', REENTER: 'EXPANDED', LEAVE_DELAY: 'HIDDEN', HIDE: 'HIDDEN' }
}

export function nextIslandState(state: IslandState, event: IslandEvent): IslandState {
  return transitions[state]?.[event] ?? state
}
