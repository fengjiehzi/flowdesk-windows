export type IslandState =
  | 'HIDDEN'
  | 'TRIGGER_VISIBLE'
  | 'ENTERING'
  | 'COMPACT'
  | 'EXPANDED'
  | 'COLLAPSING'
  | 'SETTINGS_OPEN'

export type IslandEvent =
  | 'POINTER_TOP'
  | 'SHOW_COMPACT'
  | 'ENTER_DONE'
  | 'EXPAND'
  | 'COLLAPSE_DONE'
  | 'LEAVE_DELAY'
  | 'REENTER'
  | 'OPEN_SETTINGS'
  | 'CLOSE_SETTINGS'

const transitions: Partial<Record<IslandState, Partial<Record<IslandEvent, IslandState>>>> = {
  HIDDEN: { POINTER_TOP: 'TRIGGER_VISIBLE', SHOW_COMPACT: 'ENTERING' },
  TRIGGER_VISIBLE: { ENTER_DONE: 'COMPACT', LEAVE_DELAY: 'HIDDEN' },
  ENTERING: { ENTER_DONE: 'COMPACT', EXPAND: 'EXPANDED', LEAVE_DELAY: 'HIDDEN' },
  COMPACT: { EXPAND: 'EXPANDED', LEAVE_DELAY: 'HIDDEN' },
  EXPANDED: { LEAVE_DELAY: 'COLLAPSING', OPEN_SETTINGS: 'SETTINGS_OPEN' },
  COLLAPSING: { COLLAPSE_DONE: 'COMPACT', REENTER: 'EXPANDED', LEAVE_DELAY: 'HIDDEN' },
  SETTINGS_OPEN: { CLOSE_SETTINGS: 'EXPANDED' }
}

export function nextIslandState(state: IslandState, event: IslandEvent): IslandState {
  return transitions[state]?.[event] ?? state
}
