import type {
  CircuitBacklogItem,
  DrawingBorrow,
  DrawingReminder,
  DrawingVolume,
} from './drawing-types'
import {
  SEED_BACKLOG,
  SEED_BORROWS,
  SEED_REMINDERS,
  SEED_VOLUMES,
} from './drawing-seed'

// 借阅台账独立存一份 localStorage：图册、借阅记录、催还单、待补录清单各一张表。
const STORAGE_KEY = 'substation-protection:drawing-borrow'

type DrawingState = {
  volumes: DrawingVolume[]
  borrows: DrawingBorrow[]
  reminders: DrawingReminder[]
  backlog: CircuitBacklogItem[]
  seq: Record<string, number>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedState(): DrawingState {
  return {
    volumes: clone(SEED_VOLUMES),
    borrows: clone(SEED_BORROWS),
    reminders: clone(SEED_REMINDERS),
    backlog: clone(SEED_BACKLOG),
    seq: {
      volumes: SEED_VOLUMES.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      borrows: SEED_BORROWS.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      reminders: SEED_REMINDERS.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      backlog: SEED_BACKLOG.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    },
  }
}

let cache: DrawingState | null = null

function read(): DrawingState {
  if (cache !== null) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = seedState()
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cache = seedState()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    return cache
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DrawingState>
    const base = seedState()
    cache = {
      volumes: parsed.volumes ?? base.volumes,
      borrows: parsed.borrows ?? base.borrows,
      reminders: parsed.reminders ?? base.reminders,
      backlog: parsed.backlog ?? base.backlog,
      seq: { ...base.seq, ...(parsed.seq ?? {}) },
    }
    return cache
  } catch {
    cache = seedState()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    return cache
  }
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage && cache) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  }
}

export const drawingStore = {
  state(): DrawingState {
    return read()
  },
  save(next: DrawingState): void {
    cache = next
    persist()
  },
  nextId(kind: keyof DrawingState['seq']): number {
    const state = read()
    const id = state.seq[kind]
    state.seq[kind] = id + 1
    persist()
    return id
  },
  reset(): DrawingState {
    cache = seedState()
    persist()
    return cache
  },
  storageKey(): string {
    return STORAGE_KEY
  },
}
