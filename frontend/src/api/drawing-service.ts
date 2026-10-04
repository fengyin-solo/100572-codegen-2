import { drawingStore } from '@/data/drawing-store'
import {
  DEFAULT_BORROW_DAYS,
  ROOM_BORROW_RULES,
} from '@/data/drawing-seed'
import type {
  CircuitBacklogItem,
  DrawingBorrow,
  DrawingReminder,
  DrawingVolume,
  ServiceResult,
} from '@/data/drawing-types'

// 借阅台账与催还单共用同一套应还日期读法，保证两处对得上。
// 规则：借条原件写明应还日期的，一律以借条为准；没写才按专业室期限推算。
function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00`)
  base.setDate(base.getDate() + days)
  const yyyy = base.getFullYear()
  const mm = String(base.getMonth() + 1).padStart(2, '0')
  const dd = String(base.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function ruleDaysOf(room: string): number {
  return ROOM_BORROW_RULES[room] ?? DEFAULT_BORROW_DAYS
}

/** 生效应还日期：借条原件优先，冲突时以借条原件为准。 */
export function resolveDueDate(
  borrowDate: string,
  room: string,
  slipDueDate: string,
): { ruleDays: number; ruleDueDate: string; dueDate: string; source: '借条原件' | '专业室规则' } {
  const ruleDays = ruleDaysOf(room)
  const ruleDueDate = addDays(borrowDate, ruleDays)
  const slip = slipDueDate.trim()
  if (slip) {
    return { ruleDays, ruleDueDate, dueDate: slip, source: '借条原件' }
  }
  return { ruleDays, ruleDueDate, dueDate: ruleDueDate, source: '专业室规则' }
}

export function isOverdue(dueDate: string, today = todayStr()): boolean {
  return dueDate.trim() !== '' && dueDate < today
}

export function todayStr(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function activeBorrows(borrows: DrawingBorrow[], volumeId: number): DrawingBorrow[] {
  // 在借、已催还都算"还没归还"；已归还不占卷。
  return borrows.filter(
    (item) => item.volumeId === volumeId && item.status !== '已归还',
  )
}

// ---- 图册登记（按变电站分组） ----

export function listVolumes(): DrawingVolume[] {
  return [...drawingStore.state().volumes].sort((a, b) =>
    a.substation === b.substation
      ? a.volumeNo.localeCompare(b.volumeNo)
      : a.substation.localeCompare(b.substation),
  )
}

export function listVolumesGrouped(): { substation: string; volumes: DrawingVolume[] }[] {
  const groups = new Map<string, DrawingVolume[]>()
  for (const volume of listVolumes()) {
    const bucket = groups.get(volume.substation) ?? []
    bucket.push(volume)
    groups.set(volume.substation, bucket)
  }
  return [...groups.entries()].map(([substation, volumes]) => ({ substation, volumes }))
}

export function registerVolume(input: Omit<DrawingVolume, 'id'>): ServiceResult<DrawingVolume> {
  if (!input.volumeNo.trim() || !input.volumeName.trim() || !input.substation.trim()) {
    return { ok: false, message: '图册编号、图册名称、所属变电站必须登记完整' }
  }
  const state = drawingStore.state()
  if (state.volumes.some((item) => item.volumeNo === input.volumeNo.trim())) {
    return { ok: false, message: `图册编号 ${input.volumeNo} 已登记，不能重复建卷` }
  }
  const volume: DrawingVolume = {
    id: drawingStore.nextId('volumes'),
    volumeNo: input.volumeNo.trim(),
    volumeName: input.volumeName.trim(),
    substation: input.substation.trim(),
    professionalRoom: input.professionalRoom.trim() || '继电保护室',
    remark: input.remark.trim(),
  }
  drawingStore.save({ ...state, volumes: [...state.volumes, volume] })
  return { ok: true, message: `图册 ${volume.volumeNo} 已登记到 ${volume.substation}`, data: volume }
}

// ---- 借阅登记 ----

export type BorrowDraft = {
  volumeId: number
  borrower: string
  borrowerRaw?: string
  team: string
  professionalRoom: string
  borrowDate: string
  slipDueDate?: string
  operator: string
  note?: string
}

export function listBorrows(): DrawingBorrow[] {
  return [...drawingStore.state().borrows].sort((a, b) => b.borrowDate.localeCompare(a.borrowDate))
}

export function getBorrow(id: number): DrawingBorrow | undefined {
  return drawingStore.state().borrows.find((item) => item.id === id)
}

export function getVolume(id: number): DrawingVolume | undefined {
  return drawingStore.state().volumes.find((item) => item.id === id)
}

export function registerBorrow(draft: BorrowDraft): ServiceResult<DrawingBorrow> {
  const state = drawingStore.state()
  const volume = state.volumes.find((item) => item.id === Number(draft.volumeId))
  if (!volume) {
    return { ok: false, message: '没有找到对应的图册，请先登记图册' }
  }
  if (!draft.borrowDate) {
    return { ok: false, message: '借出日期必须填写' }
  }
  const room = draft.professionalRoom.trim() || volume.professionalRoom

  // 过了期限还没归还的，不允许再借同一卷。
  const blocking = activeBorrows(state.borrows, volume.id).find((item) => isOverdue(item.dueDate))
  if (blocking) {
    return {
      ok: false,
      message: `《${volume.volumeName}》已逾期未还（应还 ${blocking.dueDate}，借条 ${blocking.borrowNo}），归还前不能再借同一卷`,
    }
  }

  // 同一卷重复提交借阅只记一次：该卷已有未归还记录时直接返回原记录。
  const duplicated = activeBorrows(state.borrows, volume.id)[0]
  if (duplicated) {
    return {
      ok: true,
      message: `《${volume.volumeName}》已有在借记录（借条 ${duplicated.borrowNo}），重复提交不另登记`,
      data: duplicated,
    }
  }

  const { ruleDays, dueDate, source } = resolveDueDate(draft.borrowDate, room, draft.slipDueDate ?? '')
  const id = drawingStore.nextId('borrows')
  const borrower = draft.borrower.trim()
  const record: DrawingBorrow = {
    id,
    borrowNo: `J${draft.borrowDate.replace(/-/g, '').slice(0, 6)}-${String(id).padStart(3, '0')}`,
    volumeId: volume.id,
    borrower,
    borrowerRaw: borrower ? borrower : (draft.borrowerRaw?.trim() || '借条未写清借阅人'),
    team: draft.team.trim(),
    professionalRoom: room,
    borrowDate: draft.borrowDate,
    ruleDays,
    slipDueDate: draft.slipDueDate?.trim() ?? '',
    dueDate,
    operator: draft.operator.trim() || '值班管理员',
    status: '在借',
    returnDate: '',
    returnBorrower: '',
    note: source === '借条原件' ? `应还日期以借条原件为准（规则推算 ${addDays(draft.borrowDate, ruleDays)}）` : '',
  }
  if (draft.note?.trim()) {
    record.note = record.note ? `${record.note}；${draft.note.trim()}` : draft.note.trim()
  }
  drawingStore.save({ ...state, borrows: [...state.borrows, record] })
  return {
    ok: true,
    message: `借阅已登记：借条 ${record.borrowNo}，应还 ${record.dueDate}（${source}）` + (borrower ? '' : '；借阅人没写清，已单独挑出待补登'),
    data: record,
  }
}

/** 借阅人没写清的记录：台账里单列一栏，催还前必须补登。 */
export function listUnclearBorrows(): DrawingBorrow[] {
  return listBorrows().filter(
    (item) => item.status !== '已归还' && item.borrower.trim() === '',
  )
}

export function clarifyBorrower(id: number, borrower: string): ServiceResult {
  const name = borrower.trim()
  if (!name) {
    return { ok: false, message: '补登的借阅人不能为空' }
  }
  const state = drawingStore.state()
  const index = state.borrows.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条借阅记录' }
  }
  if (state.borrows[index].status === '已归还') {
    return { ok: false, message: '该记录已归还，无需补登' }
  }
  const next = [...state.borrows]
  next[index] = { ...next[index], borrower: name, borrowerRaw: name }
  drawingStore.save({ ...state, borrows: next })
  return { ok: true, message: `借条 ${next[index].borrowNo} 借阅人已补登为 ${name}` }
}

// ---- 批量催还 ----

export type BatchReminderResult = {
  created: DrawingReminder[]
  skipped: { borrow: DrawingBorrow; reason: string }[]
}

export function issueReminders(ids: number[]): ServiceResult<BatchReminderResult> {
  const state = drawingStore.state()
  const created: DrawingReminder[] = []
  const skipped: { borrow: DrawingBorrow; reason: string }[] = []
  const idSet = [...new Set(ids.map(Number))]
  const reminders = [...state.reminders]
  const borrows = [...state.borrows]
  const today = todayStr()

  for (const id of idSet) {
    const borrow = borrows.find((item) => item.id === id)
    if (!borrow) {
      continue
    }
    if (borrow.status === '已归还') {
      skipped.push({ borrow, reason: '已归还，无需催还' })
      continue
    }
    // 借阅人没写清的先挑出来，不挡住整批。
    if (borrow.borrower.trim() === '') {
      skipped.push({ borrow, reason: '借阅人没写清，先补登再催还' })
      continue
    }
    if (!isOverdue(borrow.dueDate, today)) {
      skipped.push({ borrow, reason: `尚未到期（应还 ${borrow.dueDate}）` })
      continue
    }
    // 同一借阅重复提交催还只记一次。
    const exists = reminders.find(
      (item) => item.borrowId === borrow.id && item.status === '待办结',
    )
    if (exists) {
      skipped.push({ borrow, reason: `催还单 ${exists.reminderNo} 已在催，重复提交不另开单` })
      continue
    }
    const reminderId = drawingStore.nextId('reminders')
    const reminder: DrawingReminder = {
      id: reminderId,
      reminderNo: `C${today.replace(/-/g, '')}-${String(reminderId).padStart(3, '0')}`,
      borrowId: borrow.id,
      volumeId: borrow.volumeId,
      borrower: borrow.borrower,
      // 催还单直接读台账生效应还日期，两处天然对得上。
      dueDate: borrow.dueDate,
      issueDate: today,
      status: '待办结',
      finishDate: '',
      conclusion: '',
    }
    reminders.push(reminder)
    created.push(reminder)
    const index = borrows.findIndex((item) => item.id === borrow.id)
    borrows[index] = { ...borrows[index], status: '已催还' }
  }

  drawingStore.save({ ...state, reminders, borrows })
  const message =
    `已开出 ${created.length} 张催还单` +
    (skipped.length ? `，${skipped.length} 条已挑出未入单` : '')
  return { ok: created.length > 0, message, data: { created, skipped } }
}

export function listReminders(): (DrawingReminder & { borrowNo: string; substation: string; volumeName: string; consistent: boolean })[] {
  const state = drawingStore.state()
  return [...state.reminders]
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .map((reminder) => {
      const borrow = state.borrows.find((item) => item.id === reminder.borrowId)
      const volume = state.volumes.find((item) => item.id === reminder.volumeId)
      return {
        ...reminder,
        borrowNo: borrow?.borrowNo ?? '—',
        substation: volume?.substation ?? '—',
        volumeName: volume?.volumeName ?? '—',
        // 对账：催还单与台账的应还日期必须一致。
        consistent: !borrow || borrow.dueDate === reminder.dueDate,
      }
    })
}

/** 台账与催还单应还日期对账；正常为空，冲突条目以借条原件（台账生效应还日期）为准纠正。 */
export function reconcileDueDates(): ServiceResult<{ fixed: number; conflicts: DrawingReminder[] }> {
  const state = drawingStore.state()
  const conflicts = state.reminders.filter((reminder) => {
    const borrow = state.borrows.find((item) => item.id === reminder.borrowId)
    return borrow && borrow.dueDate !== reminder.dueDate
  })
  if (!conflicts.length) {
    return { ok: true, message: '台账与催还单应还日期全部对得上', data: { fixed: 0, conflicts: [] } }
  }
  const reminders = state.reminders.map((reminder) => {
    const borrow = state.borrows.find((item) => item.id === reminder.borrowId)
    if (borrow && borrow.dueDate !== reminder.dueDate) {
      return { ...reminder, dueDate: borrow.dueDate }
    }
    return reminder
  })
  drawingStore.save({ ...state, reminders })
  return {
    ok: true,
    message: `发现 ${conflicts.length} 张催还单日期与台账冲突，已按借条原件（台账生效应还日期）全部更正`,
    data: { fixed: conflicts.length, conflicts },
  }
}

// ---- 催还办结：结论同步到二次回路检查待补录清单 ----

export function finishReminder(
  id: number,
  conclusion: string,
  outcome: '已归还' | '继续在借',
  finishDate = todayStr(),
): ServiceResult {
  const text = conclusion.trim()
  if (!text) {
    return { ok: false, message: '办结结论必须填写' }
  }
  const state = drawingStore.state()
  const index = state.reminders.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这张催还单' }
  }
  const reminder = state.reminders[index]
  if (reminder.status === '已办结') {
    return { ok: false, message: `催还单 ${reminder.reminderNo} 已办结，不能重复提交` }
  }
  const borrow = state.borrows.find((item) => item.id === reminder.borrowId)
  const volume = state.volumes.find((item) => item.id === reminder.volumeId)
  if (!borrow || !volume) {
    return { ok: false, message: '催还单关联的借阅记录或图册已缺失' }
  }

  const reminders = [...state.reminders]
  reminders[index] = { ...reminder, status: '已办结', finishDate, conclusion: text }

  const borrows = [...state.borrows]
  const borrowIndex = borrows.findIndex((item) => item.id === borrow.id)
  let backlog: CircuitBacklogItem[] = [...state.backlog]

  if (outcome === '已归还') {
    // 归还时核销到借阅人本人。
    borrows[borrowIndex] = {
      ...borrows[borrowIndex],
      status: '已归还',
      returnDate: finishDate,
      returnBorrower: borrow.borrower,
    }
  } else {
    borrows[borrowIndex] = { ...borrows[borrowIndex], status: '在借' }
  }

  // 无论收回与否，办结结论都同步进二次回路检查待补录清单。
  const backlogId = drawingStore.nextId('backlog')
  backlog = [
    {
      id: backlogId,
      source: '催还办结',
      reminderId: reminder.id,
      borrowId: borrow.id,
      substation: volume.substation,
      volumeName: volume.volumeName,
      borrower: borrow.borrower,
      content: `催还办结（${reminder.reminderNo}，${outcome}）：${text}`,
      createdAt: finishDate,
      status: '待补录',
      clearedAt: '',
    },
    ...backlog,
  ]

  drawingStore.save({ ...state, reminders, borrows, backlog })
  return {
    ok: true,
    message: `催还单 ${reminder.reminderNo} 已办结，结论已同步到二次回路检查待补录清单`,
  }
}

// ---- 直接归还（归还时核销到借阅人） ----

export function returnBorrow(
  id: number,
  returnBorrower: string,
  returnDate = todayStr(),
): ServiceResult {
  const name = returnBorrower.trim()
  if (!name) {
    return { ok: false, message: '归还时必须核销到借阅人，请填写归还人姓名' }
  }
  const state = drawingStore.state()
  const index = state.borrows.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条借阅记录' }
  }
  const borrow = state.borrows[index]
  if (borrow.status === '已归还') {
    return { ok: false, message: `借条 ${borrow.borrowNo} 已归还核销，不能重复归还` }
  }
  if (borrow.borrower && name !== borrow.borrower) {
    return {
      ok: false,
      message: `归还人与借阅人不一致：该卷借阅人是「${borrow.borrower}」，请本人来核销或先在台账更正`,
    }
  }
  const borrows = [...state.borrows]
  borrows[index] = {
    ...borrow,
    status: '已归还',
    returnDate,
    returnBorrower: name,
    borrower: borrow.borrower || name,
  }
  drawingStore.save({ ...state, borrows })
  return { ok: true, message: `借条 ${borrow.borrowNo} 已归还并核销到 ${name}` }
}

// ---- 二次回路检查待补录清单 ----

export function listBacklog(): CircuitBacklogItem[] {
  return drawingStore.state().backlog
}

export function clearBacklogItem(id: number): ServiceResult {
  const state = drawingStore.state()
  const index = state.backlog.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条待补录项' }
  }
  if (state.backlog[index].status === '已补录') {
    return { ok: false, message: '该待补录项已核销' }
  }
  const backlog = [...state.backlog]
  backlog[index] = { ...backlog[index], status: '已补录', clearedAt: todayStr() }
  drawingStore.save({ ...state, backlog })
  return { ok: true, message: '待补录项已核销' }
}

// ---- 台账指标 ----

export function borrowingStats(): {
  active: number
  overdue: number
  unclear: number
  pendingReminders: number
  backlogPending: number
  returned: number
} {
  const state = drawingStore.state()
  const active = state.borrows.filter((item) => item.status !== '已归还')
  return {
    active: active.length,
    overdue: active.filter((item) => isOverdue(item.dueDate)).length,
    unclear: active.filter((item) => item.borrower.trim() === '').length,
    pendingReminders: state.reminders.filter((item) => item.status === '待办结').length,
    backlogPending: state.backlog.filter((item) => item.status === '待补录').length,
    returned: state.borrows.filter((item) => item.status === '已归还').length,
  }
}

export function resetDrawingLedger(): void {
  drawingStore.reset()
}
