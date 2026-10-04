/** 二次图纸与技术资料借阅台账的领域类型。 */

/** 图册：按变电站分组登记。 */
export type DrawingVolume = {
  id: number
  volumeNo: string // 图册编号
  volumeName: string // 图册名称
  substation: string // 所属变电站（分组字段）
  professionalRoom: string // 归口专业室（决定借阅期限）
  remark: string
}

/** 借阅记录（台账 + 借条）。 */
export type DrawingBorrow = {
  id: number
  borrowNo: string // 借条编号
  volumeId: number // 借走的图册
  borrower: string // 借阅人；借条没写清时留空
  borrowerRaw: string // 借条原始誊写，保留"没写清"的样子
  team: string // 借阅班组
  professionalRoom: string // 申请借阅的专业室，决定期限
  borrowDate: string // 借出日期 YYYY-MM-DD
  ruleDays: number // 按专业室规则判定出的借阅期限（天）
  slipDueDate: string // 借条原件写明的应还日期；没有则空
  dueDate: string // 台账生效应还日期：借条原件优先，否则按期限推算
  operator: string // 经办人
  status: '在借' | '已催还' | '已归还'
  returnDate: string // 实际归还日期
  returnBorrower: string // 归还核销时确认的借阅人
  note: string
}

/** 催还单。 */
export type DrawingReminder = {
  id: number
  reminderNo: string // 催还单号
  borrowId: number // 关联借阅记录
  volumeId: number
  borrower: string
  dueDate: string // 催还单读到的应还日期，必须与台账一致
  issueDate: string // 催还发出日期
  status: '待办结' | '已办结'
  finishDate: string // 办结日期
  conclusion: string // 办结结论
}

/** 催还办结结论同步到二次回路检查的待补录清单项。 */
export type CircuitBacklogItem = {
  id: number
  source: '催还办结'
  reminderId: number
  borrowId: number
  substation: string
  volumeName: string
  borrower: string
  content: string // 待补录内容（取自催还办结结论）
  createdAt: string
  status: '待补录' | '已补录'
  clearedAt: string
}

export type ServiceResult<T = unknown> = {
  ok: boolean
  message: string
  data?: T
}
