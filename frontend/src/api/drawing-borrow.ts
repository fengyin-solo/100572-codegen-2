import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 二次图纸与技术资料借阅的专用业务服务：期限判定、批量催还、归还核销、跨模块同步都集中在这里，
// 页面组件只做渲染和调用，不写业务判断。

export const BORROW_KEY = 'drawingborrow'
export const URGE_KEY = 'drawingurge'
const CIRCUIT_KEY = 'secondarycircuit'

// 借阅期限按专业室的规则判定（天）：应还日期 = 借阅日期 + 期限；规则外的专业室走默认期限。
export const OFFICE_LOAN_DAYS: Record<string, number> = {
  继电保护室: 30,
  自动化室: 21,
  通信室: 14,
  运行管理室: 7,
}
export const DEFAULT_LOAN_DAYS = 15

// 借阅人没写清时台账里落的占位值，待补全栏靠它识别。
export const BORROWER_PLACEHOLDER = '待补录'

export function todayStr(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00`)
  base.setDate(base.getDate() + days)
  const month = String(base.getMonth() + 1).padStart(2, '0')
  const day = String(base.getDate()).padStart(2, '0')
  return `${base.getFullYear()}-${month}-${day}`
}

export function ruleDueDate(office: string, borrowDate: string): string {
  const days = OFFICE_LOAN_DAYS[office] ?? DEFAULT_LOAN_DAYS
  return addDays(borrowDate, days)
}

export function borrowerMissing(row: EntryRow): boolean {
  const name = String(row['借阅人'] ?? '').trim()
  return name === '' || name === BORROWER_PLACEHOLDER
}

export function isReturned(row: EntryRow): boolean {
  return String(row.status) === '已归还'
}

// 应还日期两处（台账、催还单）读到的必须一致；与台账登记值冲突时以借条原件为准。
export function effectiveDueDate(row: EntryRow): string {
  const onIOU = String(row['借条应还日期'] ?? '').trim()
  return onIOU !== '' ? onIOU : String(row['应还日期'] ?? '')
}

export function isOverdue(row: EntryRow, today: string = todayStr()): boolean {
  if (isReturned(row)) {
    return false
  }
  const due = effectiveDueDate(row)
  return due !== '' && due < today
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextCode(rows: EntryRow[], field: string, prefix: string): string {
  let max = 0
  for (const row of rows) {
    const code = String(row[field] ?? '')
    if (code.startsWith(prefix)) {
      const serial = Number(code.slice(prefix.length))
      if (!Number.isNaN(serial) && serial > max) {
        max = serial
      }
    }
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

// 逾期是随日期变化的派生状态，每次读台账前刷新一次 abnormal 标记，看板统计才准。
export function refreshOverdueFlags(today: string = todayStr()): void {
  const rows = listRows(BORROW_KEY)
  let changed = false
  const next = rows.map((row) => {
    const overdue = isOverdue(row, today)
    if (Boolean(row.abnormal) !== overdue) {
      changed = true
      return { ...row, abnormal: overdue }
    }
    return row
  })
  if (changed) {
    saveRows(BORROW_KEY, next)
  }
}

export type BorrowInput = {
  所属变电站: string
  卷册编号: string
  图册名称: string
  资料类别: string
  专业室: string
  借阅人: string
  借阅日期: string
  借条编号: string
  借条应还日期: string
}

export function registerBorrow(input: BorrowInput, today: string = todayStr()): ActionResult {
  const volume = input.卷册编号.trim()
  if (!input.所属变电站.trim() || !volume || !input.图册名称.trim() || !input.借阅日期) {
    return { ok: false, message: '所属变电站、卷册编号、图册名称、借阅日期都要填' }
  }
  const rows = listRows(BORROW_KEY)
  const active = rows.filter((row) => String(row['卷册编号']) === volume && !isReturned(row))
  // 过了期限还没归还的卷册，不允许再借同一卷。
  if (active.some((row) => isOverdue(row, today))) {
    return { ok: false, message: `卷册 ${volume} 已过借阅期限还没归还，按规则不允许再借同一卷` }
  }
  // 同一卷重复提交借阅只记一次。
  if (active.length > 0) {
    return { ok: true, message: `卷册 ${volume} 已有在借记录（${active[0]['借阅编号']}），重复提交只记一次，未新建` }
  }
  const due = ruleDueDate(input.专业室, input.借阅日期)
  const code = nextCode(rows, '借阅编号', `JY-${today.slice(0, 4)}-`)
  const row: EntryRow = {
    id: nextId(rows),
    status: '在借',
    pending: true,
    abnormal: false,
    借阅编号: code,
    所属变电站: input.所属变电站.trim(),
    卷册编号: volume,
    图册名称: input.图册名称.trim(),
    资料类别: input.资料类别 || '二次图纸',
    专业室: input.专业室,
    借阅人: input.借阅人.trim() || BORROWER_PLACEHOLDER,
    借阅日期: input.借阅日期,
    应还日期: due,
    借条编号: input.借条编号.trim(),
    借条应还日期: input.借条应还日期,
    归还日期: '',
    核销说明: '',
  }
  saveRows(BORROW_KEY, [...rows, row])
  return { ok: true, message: `已登记借阅 ${code}，应还日期按${input.专业室 || '默认'}规则定为 ${due}` }
}

function compactDate(date: string): string {
  return date.replace(/-/g, '')
}

export type UrgeBatchResult = ActionResult & {
  created: number
  skippedNoBorrower: string[]
  skippedExisting: string[]
}

// 批量催还：勾中的待归还图册一次提交；借阅人没写清的挑出去留在待补全栏，不挡住整批；
// 已有未办结催还单的不再重复开单。
export function submitUrgeBatch(ids: number[], today: string = todayStr()): UrgeBatchResult {
  const rows = listRows(BORROW_KEY)
  const urges = listRows(URGE_KEY)
  const targets = rows.filter((row) => ids.includes(Number(row.id)))
  const created: EntryRow[] = []
  const skippedNoBorrower: string[] = []
  const skippedExisting: string[] = []
  const touched = new Set<number>()
  const batchNo = `PH-${compactDate(today)}-${countBatch(urges, today) + 1}`
  for (const row of targets) {
    if (isReturned(row)) {
      continue
    }
    const code = String(row['借阅编号'])
    if (borrowerMissing(row)) {
      skippedNoBorrower.push(code)
      continue
    }
    const hasOpenUrge =
      urges.some((urge) => String(urge['关联借阅编号']) === code && String(urge.status) !== '已办结') ||
      created.some((urge) => String(urge['关联借阅编号']) === code)
    if (hasOpenUrge) {
      skippedExisting.push(code)
      continue
    }
    const pool = [...urges, ...created]
    created.push({
      id: nextId(pool),
      status: '催还中',
      pending: true,
      abnormal: isOverdue(row, today),
      催还单号: nextCode(pool, '催还单号', `CH-${today.slice(0, 4)}-`),
      关联借阅编号: code,
      所属变电站: row['所属变电站'],
      卷册编号: row['卷册编号'],
      图册名称: row['图册名称'],
      借阅人: row['借阅人'],
      应还日期: effectiveDueDate(row),
      催还日期: today,
      批次号: batchNo,
      办结结论: '',
      办结日期: '',
    })
    touched.add(Number(row.id))
  }
  if (created.length > 0) {
    saveRows(URGE_KEY, [...urges, ...created])
    saveRows(
      BORROW_KEY,
      rows.map((row) =>
        touched.has(Number(row.id)) && String(row.status) === '在借' ? { ...row, status: '催还中' } : row,
      ),
    )
  }
  const parts = [`已生成 ${created.length} 张催还单（批次 ${batchNo}）`]
  if (skippedNoBorrower.length > 0) {
    parts.push(`${skippedNoBorrower.length} 条借阅人没写清，已留在待补全栏：${skippedNoBorrower.join('、')}`)
  }
  if (skippedExisting.length > 0) {
    parts.push(`${skippedExisting.length} 条已有未办结催还单，不重复开单`)
  }
  return {
    ok: created.length > 0,
    message: parts.join('；'),
    created: created.length,
    skippedNoBorrower,
    skippedExisting,
  }
}

function countBatch(urges: EntryRow[], today: string): number {
  const prefix = `PH-${compactDate(today)}-`
  return new Set(
    urges.map((urge) => String(urge['批次号'] ?? '')).filter((no) => no.startsWith(prefix)),
  ).size
}

// 归还核销：必须核销到具体借阅人；关联的未办结催还单一并办结，结论同步二次回路检查。
export function returnAndWriteOff(id: number, returnDate: string, handler: string): ActionResult {
  const rows = listRows(BORROW_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条借阅记录' }
  }
  const row = rows[index]
  if (isReturned(row)) {
    return { ok: false, message: `卷册 ${row['卷册编号']} 已归还核销，不用重复操作` }
  }
  if (borrowerMissing(row)) {
    return { ok: false, message: '借阅人还没写清，归还核销必须落到具体借阅人，请先在待补全栏补录' }
  }
  if (!returnDate) {
    return { ok: false, message: '归还日期不能为空' }
  }
  const borrower = String(row['借阅人'])
  const who = handler.trim() || '值班员'
  const next = [...rows]
  next[index] = {
    ...row,
    status: '已归还',
    pending: false,
    abnormal: false,
    归还日期: returnDate,
    核销说明: `${returnDate} 由${who}经手归还，核销到借阅人${borrower}`,
  }
  saveRows(BORROW_KEY, next)
  const urges = listRows(URGE_KEY)
  const code = String(row['借阅编号'])
  let closed = 0
  const nextUrges = urges.map((urge) => {
    if (String(urge['关联借阅编号']) === code && String(urge.status) !== '已办结') {
      closed += 1
      const conclusion = `图册已归还，核销到借阅人${borrower}`
      syncToSecondaryCircuit(urge, conclusion, returnDate)
      return { ...urge, status: '已办结', pending: false, 办结结论: conclusion, 办结日期: returnDate }
    }
    return urge
  })
  if (closed > 0) {
    saveRows(URGE_KEY, nextUrges)
  }
  return {
    ok: true,
    message: `卷册 ${row['卷册编号']} 已归还，核销到借阅人${borrower}${closed > 0 ? `，关联 ${closed} 张催还单一并办结` : ''}`,
  }
}

// 催还单办结：结论同步到二次回路检查的待补录清单。
export function closeUrge(id: number, conclusion: string, closeDate: string = todayStr()): ActionResult {
  const text = conclusion.trim()
  if (!text) {
    return { ok: false, message: '办结结论不能为空，结论会同步到二次回路检查待补录清单' }
  }
  const urges = listRows(URGE_KEY)
  const index = urges.findIndex((urge) => Number(urge.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这张催还单' }
  }
  const urge = urges[index]
  if (String(urge.status) === '已办结') {
    return { ok: false, message: `催还单 ${urge['催还单号']} 已办结，不用重复操作` }
  }
  const next = [...urges]
  next[index] = { ...urge, status: '已办结', pending: false, 办结结论: text, 办结日期: closeDate }
  saveRows(URGE_KEY, next)
  syncToSecondaryCircuit(urge, text, closeDate)
  return { ok: true, message: `催还单 ${urge['催还单号']} 已办结，结论已同步到二次回路检查待补录清单` }
}

// 同步到二次回路检查待补录清单：同一催还单只同步一次。
function syncToSecondaryCircuit(urge: EntryRow, conclusion: string, date: string): void {
  const rows = listRows(CIRCUIT_KEY)
  const checkCode = `BC-${urge['催还单号']}`
  if (rows.some((row) => String(row['检查编号']) === checkCode)) {
    return
  }
  saveRows(CIRCUIT_KEY, [
    ...rows,
    {
      id: nextId(rows),
      status: '待补录',
      pending: true,
      abnormal: false,
      检查编号: checkCode,
      所属间隔: String(urge['所属变电站'] ?? ''),
      回路类别: '图纸催还办结补录',
      端子排编号: String(urge['卷册编号'] ?? ''),
      绝缘电阻: '—',
      检查人: String(urge['借阅人'] ?? ''),
      检查日期: date,
      回路状态: conclusion,
    },
  ])
}

// 借阅人补录：补录后这条记录才能参加批量催还、才能归还核销。
export function completeBorrower(id: number, borrower: string): ActionResult {
  const name = borrower.trim()
  if (!name) {
    return { ok: false, message: '借阅人姓名不能为空' }
  }
  const rows = listRows(BORROW_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条借阅记录' }
  }
  if (isReturned(rows[index])) {
    return { ok: false, message: '已归还的记录不再补录借阅人' }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 借阅人: name }
  saveRows(BORROW_KEY, next)
  return { ok: true, message: `借阅记录 ${rows[index]['借阅编号']} 已补录借阅人 ${name}，可以参加批量催还` }
}

export type DueConflict = {
  id: number
  借阅编号: string
  卷册编号: string
  台账应还: string
  借条应还: string
}

// 应还日期对账：台账登记值与借条原件不一致的未归还记录。
export function dueDateConflicts(): DueConflict[] {
  return listRows(BORROW_KEY)
    .filter((row) => !isReturned(row))
    .filter((row) => {
      const onIOU = String(row['借条应还日期'] ?? '').trim()
      return onIOU !== '' && String(row['应还日期'] ?? '') !== onIOU
    })
    .map((row) => ({
      id: Number(row.id),
      借阅编号: String(row['借阅编号']),
      卷册编号: String(row['卷册编号']),
      台账应还: String(row['应还日期']),
      借条应还: String(row['借条应还日期']),
    }))
}

// 对账处理：以借条原件为准改正台账，未办结的催还单一起对齐，保证两处读到的应还日期一致。
export function alignDueDateToIOU(id: number): ActionResult {
  const rows = listRows(BORROW_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条借阅记录' }
  }
  const onIOU = String(rows[index]['借条应还日期'] ?? '').trim()
  if (!onIOU) {
    return { ok: false, message: '这条记录没有登记借条原件日期，无法对齐' }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 应还日期: onIOU }
  saveRows(BORROW_KEY, next)
  const code = String(rows[index]['借阅编号'])
  const urges = listRows(URGE_KEY)
  let touched = 0
  const nextUrges = urges.map((urge) => {
    if (
      String(urge['关联借阅编号']) === code &&
      String(urge.status) !== '已办结' &&
      String(urge['应还日期']) !== onIOU
    ) {
      touched += 1
      return { ...urge, 应还日期: onIOU }
    }
    return urge
  })
  if (touched > 0) {
    saveRows(URGE_KEY, nextUrges)
  }
  return {
    ok: true,
    message: `已按借条原件把应还日期对齐为 ${onIOU}${touched > 0 ? `，同步更正 ${touched} 张未办结催还单` : ''}`,
  }
}

export type BorrowView = {
  raw: EntryRow
  overdue: boolean
  effectiveDue: string
  conflict: boolean
  urgeable: boolean
}

// 页面用的视图装配：逾期、有效应还日期、对账冲突、可否参加批量催还，一次算好。
export function borrowViews(today: string = todayStr()): BorrowView[] {
  const openUrgeCodes = new Set(
    listRows(URGE_KEY)
      .filter((urge) => String(urge.status) !== '已办结')
      .map((urge) => String(urge['关联借阅编号'])),
  )
  return listRows(BORROW_KEY).map((row) => {
    const onIOU = String(row['借条应还日期'] ?? '').trim()
    return {
      raw: row,
      overdue: isOverdue(row, today),
      effectiveDue: effectiveDueDate(row),
      conflict: onIOU !== '' && onIOU !== String(row['应还日期'] ?? ''),
      urgeable: !isReturned(row) && !borrowerMissing(row) && !openUrgeCodes.has(String(row['借阅编号'])),
    }
  })
}
