<template>
  <section class="page" data-module="drawingborrow">
    <header class="page-head">
      <div>
        <h2>二次图纸与技术资料借阅台账</h2>
        <p class="page-desc">
          图册按变电站分组登记；借阅期限按专业室规则判定，借条原件写明应还日期的以借条为准；
          逾期未还同一卷不得再借；勾选多条可一次提交催还，借阅人没写清的单独成栏不挡整批；
          催还办结结论同步到二次回路检查待补录清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="resetAll">恢复示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在借图册</span>
        <strong class="stat-value">{{ stats.active }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">逾期未还</span>
        <strong class="stat-value" :class="{ alarm: stats.overdue > 0 }">{{ stats.overdue }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">借阅人待补登</span>
        <strong class="stat-value" :class="{ alarm: stats.unclear > 0 }">{{ stats.unclear }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待办结催还单</span>
        <strong class="stat-value">{{ stats.pendingReminders }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">回路检查待补录</span>
        <strong class="stat-value" :class="{ alarm: stats.backlogPending > 0 }">{{ stats.backlogPending }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已归还核销</span>
        <strong class="stat-value">{{ stats.returned }}</strong>
      </article>
    </div>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <em v-if="tabBadge(tab.key)" class="tab-badge">{{ tabBadge(tab.key) }}</em>
      </button>
    </nav>

    <p v-if="message" class="flash" :class="messageKind">{{ message }}</p>

    <!-- ============ 借阅台账 ============ -->
    <template v-if="activeTab === 'ledger'">
      <!-- 借阅登记 -->
      <form class="panel" @submit.prevent="submitBorrow">
        <h3 class="panel-title">借阅登记</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>图册（按变电站）</span>
            <select v-model="borrowForm.volumeId" required>
              <option value="" disabled>选择图册</option>
              <optgroup v-for="group in volumeGroups" :key="group.substation" :label="group.substation">
                <option v-for="v in group.volumes" :key="v.id" :value="v.id">
                  {{ v.volumeNo }} 《{{ v.volumeName }}》
                </option>
              </optgroup>
            </select>
          </label>
          <label class="form-item">
            <span>借阅人（借条没写清先留空）</span>
            <input v-model="borrowForm.borrower" placeholder="姓名" />
          </label>
          <label class="form-item">
            <span>借阅班组</span>
            <input v-model="borrowForm.team" placeholder="如 继保一班" />
          </label>
          <label class="form-item">
            <span>专业室（决定期限）</span>
            <select v-model="borrowForm.professionalRoom">
              <option v-for="room in rooms" :key="room" :value="room">{{ room }}（{{ ruleDaysOf(room) }}天）</option>
            </select>
          </label>
          <label class="form-item">
            <span>借出日期</span>
            <input v-model="borrowForm.borrowDate" type="date" required />
          </label>
          <label class="form-item">
            <span>借条原件应还日期（可空，优先于规则）</span>
            <input v-model="borrowForm.slipDueDate" type="date" />
          </label>
        </div>
        <div class="panel-foot">
          <button class="btn primary" type="submit">登记借阅</button>
          <span class="hint" v-if="selectedVolume">
            规则应还：{{ borrowPreview.ruleDueDate }}；
            台账生效：<b>{{ borrowPreview.dueDate }}</b>（{{ borrowPreview.source }}）
          </span>
        </div>
      </form>

      <!-- 借阅人没写清：单独成一栏，不挡住整批催还 -->
      <section v-if="unclearRows.length" class="panel warn-panel">
        <h3 class="panel-title">借阅人没写清（{{ unclearRows.length }} 条，先补登后才能催还）</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>借条编号</th><th>变电站</th><th>图册</th><th>班组</th><th>借条誊写</th><th>应还日期</th><th>补登借阅人</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in unclearRows" :key="row.id">
              <td>{{ row.borrowNo }}</td>
              <td>{{ volumeOf(row.volumeId)?.substation ?? '—' }}</td>
              <td>{{ volumeOf(row.volumeId)?.volumeName ?? '—' }}</td>
              <td>{{ row.team || '—' }}</td>
              <td class="muted">{{ row.borrowerRaw }}</td>
              <td>{{ row.dueDate }}</td>
              <td class="row-actions">
                <input v-model="clarifyNames[row.id]" placeholder="填写借阅人姓名" class="inline-input" />
                <button class="btn" type="button" @click="clarify(row.id)">补登</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 台账主表：按变电站分组，勾选批量催还 -->
      <section class="panel">
        <div class="panel-head">
          <h3 class="panel-title">借阅台账（按变电站分组）</h3>
          <div class="row-actions">
            <button class="btn" type="button" @click="selectAllOverdue">全选逾期可催</button>
            <button class="btn primary" type="button" :disabled="!checkedIds.length" @click="batchRemind">
              批量催还（{{ checkedIds.length }}）
            </button>
          </div>
        </div>
        <table class="data-table ledger-table">
          <thead>
            <tr>
              <th class="col-check">催还</th>
              <th>借条编号</th><th>图册编号 / 名称</th><th>借阅人</th><th>班组</th>
              <th>借出日期</th><th>期限</th><th>应还日期</th><th>状态</th><th>操作</th>
            </tr>
          </thead>
          <tbody v-for="group in groupedBorrows" :key="group.substation">
            <tr class="group-row">
              <td colspan="10">{{ group.substation }}（{{ group.rows.length }} 条在借/催还）</td>
            </tr>
            <tr v-for="row in group.rows" :key="row.id" :class="{ overdue: overdueOf(row), unclear: !row.borrower }">
              <td class="col-check">
                <input
                  type="checkbox"
                  :checked="checkedIds.includes(row.id)"
                  :disabled="!canRemind(row)"
                  :title="canRemind(row) ? '' : remindBlockReason(row)"
                  @change="toggleCheck(row.id, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td>{{ row.borrowNo }}</td>
              <td>{{ volumeOf(row.volumeId)?.volumeNo ?? '—' }}<br /><span class="muted">{{ volumeOf(row.volumeId)?.volumeName ?? '—' }}</span></td>
              <td>{{ row.borrower || '（没写清）' }}</td>
              <td>{{ row.team || '—' }}</td>
              <td>{{ row.borrowDate }}</td>
              <td>{{ row.ruleDays }}天</td>
              <td>
                {{ row.dueDate }}
                <span v-if="row.slipDueDate" class="tag">借条原件</span>
                <span v-if="overdueOf(row)" class="tag alarm-tag">逾期</span>
              </td>
              <td>
                <span class="status-pill" :class="`st-${row.status}`">{{ row.status }}</span>
              </td>
              <td class="row-actions">
                <button class="link" type="button" @click="openReturn(row)">归还核销</button>
              </td>
            </tr>
          </tbody>
          <tr v-for="row in returnedRows" :key="`rt-${row.id}`" class="returned-row">
            <td class="col-check">—</td>
            <td>{{ row.borrowNo }}</td>
            <td colspan="2" class="muted">{{ volumeOf(row.volumeId)?.volumeName ?? '—' }}</td>
            <td>{{ row.returnBorrower }}</td>
            <td class="muted" colspan="2">借出 {{ row.borrowDate }}</td>
            <td>{{ row.dueDate }}</td>
            <td><span class="status-pill st-已归还">已归还</span></td>
            <td class="muted">{{ row.returnDate }} 核销到本人</td>
          </tr>
        </table>
        <p v-if="!borrows.length" class="empty-state">暂无借阅记录</p>
      </section>
    </template>

    <!-- ============ 图册登记 ============ -->
    <template v-if="activeTab === 'volumes'">
      <form class="panel" @submit.prevent="submitVolume">
        <h3 class="panel-title">登记图册</h3>
        <div class="form-grid">
          <label class="form-item"><span>图册编号</span><input v-model="volumeForm.volumeNo" placeholder="如 EC-2201-ZL-03" required /></label>
          <label class="form-item"><span>图册名称</span><input v-model="volumeForm.volumeName" placeholder="如 220kV母线保护二次竣工图" required /></label>
          <label class="form-item"><span>所属变电站</span><input v-model="volumeForm.substation" placeholder="如 220kV云栖变电站" required /></label>
          <label class="form-item">
            <span>归口专业室</span>
            <select v-model="volumeForm.professionalRoom">
              <option v-for="room in rooms" :key="room" :value="room">{{ room }}</option>
            </select>
          </label>
          <label class="form-item wide"><span>备注</span><input v-model="volumeForm.remark" /></label>
        </div>
        <div class="panel-foot">
          <button class="btn primary" type="submit">登记到变电站分组</button>
        </div>
      </form>

      <section v-for="group in volumeGroups" :key="group.substation" class="panel">
        <h3 class="panel-title">{{ group.substation }}（{{ group.volumes.length }} 卷）</h3>
        <table class="data-table">
          <thead><tr><th>图册编号</th><th>图册名称</th><th>归口专业室</th><th>期限规则</th><th>备注</th><th>在借情况</th></tr></thead>
          <tbody>
            <tr v-for="v in group.volumes" :key="v.id">
              <td>{{ v.volumeNo }}</td>
              <td>《{{ v.volumeName }}》</td>
              <td>{{ v.professionalRoom }}</td>
              <td>{{ ruleDaysOf(v.professionalRoom) }} 天</td>
              <td>{{ v.remark || '—' }}</td>
              <td>
                <template v-if="activeVolume(v.id)">
                  <span :class="overdueOf(activeVolume(v.id) as DrawingBorrow) ? 'error-text' : ''">
                    {{ (activeVolume(v.id) as DrawingBorrow).borrowNo }} ·
                    {{ (activeVolume(v.id) as DrawingBorrow).borrower || '借阅人未写清' }} ·
                    应还 {{ (activeVolume(v.id) as DrawingBorrow).dueDate }}
                  </span>
                </template>
                <span v-else class="muted">在库可借</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- ============ 催还单 ============ -->
    <template v-if="activeTab === 'reminders'">
      <section class="panel">
        <div class="panel-head">
          <h3 class="panel-title">催还单（应还日期与台账同源）</h3>
          <button class="btn" type="button" @click="reconcile">按借条原件对账应还日期</button>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>催还单号</th><th>借条编号</th><th>变电站</th><th>图册</th><th>借阅人</th><th>应还日期</th><th>开出日期</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in reminders" :key="r.id" :class="{ 'date-conflict': !r.consistent }">
              <td>{{ r.reminderNo }}</td>
              <td>{{ r.borrowNo }}</td>
              <td>{{ r.substation }}</td>
              <td>{{ r.volumeName }}</td>
              <td>{{ r.borrower }}</td>
              <td>
                {{ r.dueDate }}
                <span v-if="!r.consistent" class="tag alarm-tag">与台账冲突</span>
                <span v-else class="tag">与台账一致</span>
              </td>
              <td>{{ r.issueDate }}</td>
              <td>
                <span class="status-pill" :class="r.status === '待办结' ? 'st-已催还' : 'st-已归还'">{{ r.status }}</span>
                <div v-if="r.finishDate" class="muted">{{ r.finishDate }}：{{ r.conclusion }}</div>
              </td>
              <td class="row-actions">
                <button v-if="r.status === '待办结'" class="link" type="button" @click="openFinish(r)">办结</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!reminders.length" class="empty-state">暂无催还单，到借阅台账勾选逾期记录批量开出</p>
      </section>
    </template>

    <!-- ============ 待补录清单 ============ -->
    <template v-if="activeTab === 'backlog'">
      <section class="panel">
        <h3 class="panel-title">二次回路检查 · 待补录清单（催还办结结论同步）</h3>
        <table class="data-table">
          <thead><tr><th>来源</th><th>变电站</th><th>图册</th><th>借阅人</th><th>待补录内容</th><th>生成时间</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="item in backlog" :key="item.id">
              <td>{{ item.source }}</td>
              <td>{{ item.substation }}</td>
              <td>{{ item.volumeName }}</td>
              <td>{{ item.borrower }}</td>
              <td>{{ item.content }}</td>
              <td>{{ item.createdAt }}</td>
              <td><span class="status-pill" :class="item.status === '待补录' ? 'st-已催还' : 'st-已归还'">{{ item.status }}</span></td>
              <td class="row-actions">
                <button v-if="item.status === '待补录'" class="link" type="button" @click="clearItem(item.id)">补录核销</button>
                <span v-else class="muted">{{ item.clearedAt }} 已核销</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!backlog.length" class="empty-state">暂无待补录项</p>
      </section>
    </template>

    <!-- 归还核销弹窗 -->
    <div v-if="returnTarget" class="modal-mask" @click.self="returnTarget = null">
      <div class="modal">
        <h3>归还核销</h3>
        <p class="muted">{{ returnTarget.borrowNo }} · {{ volumeOf(returnTarget.volumeId)?.volumeName }} · 应还 {{ returnTarget.dueDate }}</p>
        <label class="form-item">
          <span>归还人（须核销到借阅人本人）</span>
          <input v-model="returnName" placeholder="借阅人姓名" />
        </label>
        <label class="form-item">
          <span>归还日期</span>
          <input v-model="returnDate" type="date" />
        </label>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="returnTarget = null">取消</button>
          <button class="btn primary" type="button" @click="confirmReturn">确认归还核销</button>
        </div>
      </div>
    </div>

    <!-- 催还办结弹窗 -->
    <div v-if="finishTarget" class="modal-mask" @click.self="finishTarget = null">
      <div class="modal">
        <h3>催还单办结</h3>
        <p class="muted">{{ finishTarget.reminderNo }} · {{ finishTarget.volumeName }} · 借阅人 {{ finishTarget.borrower }} · 应还 {{ finishTarget.dueDate }}</p>
        <label class="form-item">
          <span>办结结论（同步到二次回路检查待补录清单）</span>
          <textarea v-model="finishConclusion" rows="3" placeholder="如：图纸已收回，端子排变更页需补录"></textarea>
        </label>
        <label class="form-item">
          <span>处置结果</span>
          <select v-model="finishOutcome">
            <option value="已归还">图册已收回，归还核销</option>
            <option value="继续在借">暂未收回，继续在借（结论仍同步补录）</option>
          </select>
        </label>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="finishTarget = null">取消</button>
          <button class="btn primary" type="button" @click="confirmFinish">提交办结</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  borrowingStats,
  clarifyBorrower,
  clearBacklogItem,
  finishReminder,
  getVolume,
  isOverdue,
  issueReminders,
  listBacklog,
  listBorrows,
  listReminders,
  listUnclearBorrows,
  listVolumesGrouped,
  reconcileDueDates,
  registerBorrow,
  registerVolume,
  resetDrawingLedger,
  resolveDueDate,
  returnBorrow,
  ruleDaysOf,
  todayStr,
} from '@/api/drawing-service'
import type { CircuitBacklogItem, DrawingBorrow, DrawingReminder } from '@/data/drawing-types'

const rooms = ['继电保护室', '自动化室', '变电检修室', '直流系统室']
const tabs: { key: string; label: string }[] = [
  { key: 'ledger', label: '借阅台账' },
  { key: 'volumes', label: '图册登记' },
  { key: 'reminders', label: '催还单' },
  { key: 'backlog', label: '回路检查待补录' },
]

const activeTab = ref('ledger')
const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')

const volumesRefresh = ref(0)
const borrows = ref<DrawingBorrow[]>([])
const reminders = ref<(DrawingReminder & { borrowNo: string; substation: string; volumeName: string; consistent: boolean })[]>([])
const backlog = ref<CircuitBacklogItem[]>([])
const checkedIds = ref<number[]>([])
const clarifyNames = reactive<Record<number, string>>({})

const volumeGroups = computed(() => {
  void volumesRefresh.value
  return listVolumesGrouped()
})
const unclearRows = computed(() => listUnclearBorrows())
const activeBorrows = computed(() =>
  borrows.value.filter((row) => row.status !== '已归还'),
)
const returnedRows = computed(() =>
  borrows.value.filter((row) => row.status === '已归还'),
)
const groupedBorrows = computed(() => {
  const map = new Map<string, DrawingBorrow[]>()
  for (const row of activeBorrows.value) {
    const sub = getVolume(row.volumeId)?.substation ?? '未分组'
    const bucket = map.get(sub) ?? []
    bucket.push(row)
    map.set(sub, bucket)
  }
  return [...map.entries()].map(([substation, rows]) => ({ substation, rows }))
})
const stats = computed(() => borrowingStats())

function tabBadge(key: string): number {
  if (key === 'ledger') return stats.value.unclear
  if (key === 'reminders') return stats.value.pendingReminders
  if (key === 'backlog') return stats.value.backlogPending
  return 0
}

function volumeOf(id: number) {
  return getVolume(id)
}
function activeVolume(volumeId: number): DrawingBorrow | undefined {
  return borrows.value.find((row) => row.volumeId === volumeId && row.status !== '已归还')
}
function overdueOf(row: DrawingBorrow): boolean {
  return row.status !== '已归还' && isOverdue(row.dueDate)
}
function canRemind(row: DrawingBorrow): boolean {
  return row.status !== '已归还' && !!row.borrower.trim() && isOverdue(row.dueDate)
}
function remindBlockReason(row: DrawingBorrow): string {
  if (!row.borrower.trim()) return '借阅人没写清，已在上方单独成栏，补登后再催'
  if (!isOverdue(row.dueDate)) return '尚未到期'
  return ''
}
function toggleCheck(id: number, checked: boolean) {
  if (checked) {
    if (!checkedIds.value.includes(id)) checkedIds.value.push(id)
  } else {
    checkedIds.value = checkedIds.value.filter((item) => item !== id)
  }
}
function selectAllOverdue() {
  checkedIds.value = activeBorrows.value.filter((row) => canRemind(row)).map((row) => row.id)
}

function flash(text: string, kind: 'ok' | 'err' = 'ok') {
  message.value = text
  messageKind.value = kind
}

// ---- 借阅登记 ----
const today = todayStr()
const borrowForm = reactive({
  volumeId: '' as number | '',
  borrower: '',
  team: '',
  professionalRoom: '继电保护室',
  borrowDate: today,
  slipDueDate: '',
})
const selectedVolume = computed(() =>
  borrowForm.volumeId === '' ? undefined : getVolume(Number(borrowForm.volumeId)),
)
const borrowPreview = computed(() => {
  if (!selectedVolume.value || !borrowForm.borrowDate) {
    return { ruleDueDate: '—', dueDate: '—', source: '—' }
  }
  const room = borrowForm.professionalRoom || selectedVolume.value.professionalRoom
  const r = resolveDueDate(borrowForm.borrowDate, room, borrowForm.slipDueDate)
  return { ruleDueDate: r.ruleDueDate, dueDate: r.dueDate, source: r.source }
})

function submitBorrow() {
  if (borrowForm.volumeId === '') {
    flash('请选择要借阅的图册', 'err')
    return
  }
  const result = registerBorrow({
    volumeId: Number(borrowForm.volumeId),
    borrower: borrowForm.borrower,
    team: borrowForm.team,
    professionalRoom: borrowForm.professionalRoom,
    borrowDate: borrowForm.borrowDate,
    slipDueDate: borrowForm.slipDueDate,
    operator: '值班管理员',
  })
  flash(result.message, result.ok ? 'ok' : 'err')
  if (result.ok) {
    borrowForm.borrower = ''
    borrowForm.team = ''
    borrowForm.slipDueDate = ''
  }
  reload()
}

// ---- 图册登记 ----
const volumeForm = reactive({ volumeNo: '', volumeName: '', substation: '', professionalRoom: '继电保护室', remark: '' })
function submitVolume() {
  const result = registerVolume({ ...volumeForm })
  flash(result.message, result.ok ? 'ok' : 'err')
  if (result.ok) {
    volumeForm.volumeNo = ''
    volumeForm.volumeName = ''
    volumeForm.substation = ''
    volumeForm.remark = ''
    volumesRefresh.value++
  }
}

// ---- 批量催还 ----
function batchRemind() {
  const result = issueReminders(checkedIds.value)
  if (!result.ok || !result.data) {
    flash(result.message, 'err')
    return
  }
  const { created, skipped } = result.data
  const lines = [`已提交：开出 ${created.length} 张催还单`]
  if (skipped.length) {
    lines.push(`挑出 ${skipped.length} 条未入单：`)
    lines.push(...skipped.map((item) => `· ${item.borrow.borrowNo}（${item.borrow.borrower || '借阅人没写清'}）${item.reason}`))
  }
  flash(lines.join('\n'), created.length ? 'ok' : 'err')
  checkedIds.value = []
  reload()
}

function clarify(id: number) {
  const result = clarifyBorrower(id, clarifyNames[id] ?? '')
  flash(result.message, result.ok ? 'ok' : 'err')
  if (result.ok) clarifyNames[id] = ''
  reload()
}

// ---- 归还核销 ----
const returnTarget = ref<DrawingBorrow | null>(null)
const returnName = ref('')
const returnDate = ref(today)
function openReturn(row: DrawingBorrow) {
  returnTarget.value = row
  returnName.value = row.borrower
  returnDate.value = today
}
function confirmReturn() {
  if (!returnTarget.value) return
  const result = returnBorrow(returnTarget.value.id, returnName.value, returnDate.value)
  flash(result.message, result.ok ? 'ok' : 'err')
  if (result.ok) returnTarget.value = null
  reload()
}

// ---- 催还办结 ----
const finishTarget = ref<(typeof reminders.value)[number] | null>(null)
const finishConclusion = ref('')
const finishOutcome = ref<'已归还' | '继续在借'>('已归还')
function openFinish(row: (typeof reminders.value)[number]) {
  finishTarget.value = row
  finishConclusion.value = ''
  finishOutcome.value = '已归还'
}
function confirmFinish() {
  if (!finishTarget.value) return
  const result = finishReminder(finishTarget.value.id, finishConclusion.value, finishOutcome.value)
  flash(result.message, result.ok ? 'ok' : 'err')
  if (result.ok) finishTarget.value = null
  reload()
}

function reconcile() {
  const result = reconcileDueDates()
  flash(result.message, result.ok ? 'ok' : 'err')
  reload()
}

function clearItem(id: number) {
  const result = clearBacklogItem(id)
  flash(result.message, result.ok ? 'ok' : 'err')
  reload()
}

function resetAll() {
  resetDrawingLedger()
  checkedIds.value = []
  flash('已恢复为示例数据')
  reload()
}

function reload() {
  borrows.value = listBorrows()
  reminders.value = listReminders()
  backlog.value = listBacklog()
  checkedIds.value = checkedIds.value.filter((id) => {
    const row = borrows.value.find((item) => item.id === id)
    return row ? canRemind(row) : false
  })
}

reload()
</script>

<style scoped>
.alarm { color: #b42318; }
.muted { color: var(--muted); }
.hint { color: var(--muted); font-size: 12px; margin-left: 10px; }
.tab-bar { display: flex; gap: 6px; margin-bottom: 12px; }
.tab-btn { position: relative; border: 1px solid var(--border); background: #fff; border-radius: 6px 6px 0 0; padding: 8px 14px; cursor: pointer; font-size: 13px; }
.tab-btn.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.tab-badge { font-style: normal; background: #b42318; color: #fff; border-radius: 999px; padding: 0 7px; font-size: 11px; margin-left: 6px; }
.flash { white-space: pre-line; background: #ecfdf3; border: 1px solid #a6f4c5; color: #027a48; border-radius: 6px; padding: 8px 12px; font-size: 13px; }
.flash.err { background: #fef3f2; border-color: #fecdca; color: #b42318; }
.panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; }
.warn-panel { border-color: #fdb022; background: #fffaeb; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.panel-title { font-size: 14px; margin: 0 0 10px; }
.panel-foot { margin-top: 10px; }
.form-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.form-item { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); margin-bottom: 8px; }
.form-item.wide { grid-column: span 2; }
.form-item input, .form-item select, .form-item textarea { font-size: 13px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; color: #1f2937; }
.inline-input { width: 130px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 6px; }
.col-check { width: 42px; text-align: center; }
.group-row td { background: #eef2f7; font-weight: 600; font-size: 12px; }
.ledger-table tr.overdue td { background: #fff7f6; }
.ledger-table tr.unclear td { background: #fffaeb; }
.returned-row td { background: #f8fafc; color: var(--muted); }
.tag { display: inline-block; font-size: 11px; background: #eef2f7; border-radius: 4px; padding: 0 6px; margin-left: 4px; }
.alarm-tag { background: #fee4e2; color: #b42318; }
.status-pill { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: 12px; }
.st-在借 { background: #e0efff; color: #1f6feb; }
.st-已催还 { background: #fef0c7; color: #b54708; }
.st-已归还 { background: #d1fadf; color: #027a48; }
tr.date-conflict td { background: #fff7f6; }
.modal-mask { position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45); display: flex; align-items: center; justify-content: center; z-index: 20; }
.modal { background: #fff; border-radius: 8px; padding: 18px 20px; width: 460px; }
.modal h3 { margin: 0 0 6px; font-size: 15px; }
.modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
