<template>
  <section class="page" data-module="drawingborrow">
    <header class="page-head">
      <div>
        <h2>二次图纸与技术资料借阅台账</h2>
        <p class="page-desc">
          图册按变电站分组登记，借阅期限按专业室规则判定；逾期未还的卷册不允许再借，归还时核销到借阅人。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows(BORROW_KEY)">导出借阅台账</button>
        <button class="btn" type="button" @click="exportRows(URGE_KEY)">导出催还单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span v-if="overdueCount" class="legend-item overdue-badge">逾期未还：{{ overdueCount }}</span>
    </p>

    <section class="panel">
      <h3>登记借阅</h3>
      <form class="form-grid" @submit.prevent="submitBorrow">
        <label class="form-item">
          <span>所属变电站</span>
          <input v-model="borrowForm.所属变电站" placeholder="如：城东110kV变电站" />
        </label>
        <label class="form-item">
          <span>卷册编号</span>
          <input v-model="borrowForm.卷册编号" placeholder="同一卷重复提交只记一次" />
        </label>
        <label class="form-item">
          <span>图册名称</span>
          <input v-model="borrowForm.图册名称" placeholder="图纸或技术资料名称" />
        </label>
        <label class="form-item">
          <span>资料类别</span>
          <select v-model="borrowForm.资料类别">
            <option>二次图纸</option>
            <option>技术资料</option>
          </select>
        </label>
        <label class="form-item">
          <span>专业室（期限 {{ loanDaysPreview }} 天）</span>
          <select v-model="borrowForm.专业室">
            <option v-for="office in offices" :key="office">{{ office }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>借阅人（可后补）</span>
          <input v-model="borrowForm.借阅人" placeholder="没写清的进待补全栏" />
        </label>
        <label class="form-item">
          <span>借阅日期</span>
          <input v-model="borrowForm.借阅日期" type="date" />
        </label>
        <label class="form-item">
          <span>借条编号</span>
          <input v-model="borrowForm.借条编号" placeholder="借条原件编号" />
        </label>
        <label class="form-item">
          <span>借条应还日期</span>
          <input v-model="borrowForm.借条应还日期" type="date" />
        </label>
        <div class="form-item form-submit">
          <button class="btn primary" type="submit">提交借阅登记</button>
        </div>
      </form>
      <p class="panel-hint">
        应还日期按专业室规则自动判定；借条原件日期与规则不一致时，以借条原件为准。
      </p>
    </section>

    <section v-if="conflicts.length" class="panel">
      <h3>应还日期对账（台账与借条原件不一致，以借条原件为准）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>借阅编号</th>
            <th>卷册编号</th>
            <th>台账应还日期</th>
            <th>借条应还日期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in conflicts" :key="item.id">
            <td>{{ item.借阅编号 }}</td>
            <td>{{ item.卷册编号 }}</td>
            <td>{{ item.台账应还 }}</td>
            <td>{{ item.借条应还 }}</td>
            <td>
              <button class="link" type="button" @click="alignDue(item.id)">按借条原件对齐</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="incompleteRows.length" class="panel">
      <h3>借阅人待补全（{{ incompleteRows.length }} 条，补录后才能参加批量催还、才能归还核销）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>借阅编号</th>
            <th>所属变电站</th>
            <th>卷册编号</th>
            <th>图册名称</th>
            <th>应还日期</th>
            <th>借阅人</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="view in incompleteRows" :key="view.raw.id">
            <td>{{ view.raw['借阅编号'] }}</td>
            <td>{{ view.raw['所属变电站'] }}</td>
            <td>{{ view.raw['卷册编号'] }}</td>
            <td>{{ view.raw['图册名称'] }}</td>
            <td>
              {{ view.effectiveDue }}
              <span v-if="view.overdue" class="overdue-badge">逾期未还</span>
            </td>
            <td>
              <input v-model="borrowerDrafts[view.raw.id]" placeholder="补录借阅人姓名" />
            </td>
            <td>
              <button class="link" type="button" @click="saveBorrower(view.raw.id)">保存借阅人</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h3>借阅台账（按变电站分组）</h3>
        <div class="page-actions">
          <span class="panel-hint">已勾 {{ selected.size }} 卷</span>
          <button class="btn primary" type="button" :disabled="!selected.size" @click="submitUrge">
            批量提交催还
          </button>
        </div>
      </div>
      <div v-for="group in groupedRows" :key="group.substation" class="station-group">
        <h4 class="group-title">{{ group.substation }}（{{ group.rows.length }} 卷）</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th class="check-col">
                <input
                  type="checkbox"
                  :checked="allSelected(group.rows)"
                  :disabled="!urgeableOf(group.rows).length"
                  title="全选本组可催还卷册"
                  @change="toggleGroup(group.rows, $event)"
                />
              </th>
              <th>借阅编号</th>
              <th>卷册编号</th>
              <th>图册名称</th>
              <th>资料类别</th>
              <th>专业室</th>
              <th>借阅人</th>
              <th>借阅日期</th>
              <th>应还日期</th>
              <th>当前状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="view in group.rows" :key="view.raw.id">
              <td class="check-col">
                <input
                  v-if="view.urgeable"
                  type="checkbox"
                  :checked="selected.has(view.raw.id)"
                  @change="toggleOne(view.raw.id, $event)"
                />
                <span v-else>—</span>
              </td>
              <td>{{ view.raw['借阅编号'] }}</td>
              <td>{{ view.raw['卷册编号'] }}</td>
              <td>{{ view.raw['图册名称'] }}</td>
              <td>{{ view.raw['资料类别'] }}</td>
              <td>{{ view.raw['专业室'] }}</td>
              <td>{{ view.raw['借阅人'] }}</td>
              <td>{{ view.raw['借阅日期'] }}</td>
              <td>
                {{ view.effectiveDue }}
                <span v-if="view.conflict" class="panel-hint">
                  （台账记 {{ view.raw['应还日期'] }}，以借条原件为准）
                </span>
              </td>
              <td>
                {{ view.raw.status }}
                <span v-if="view.overdue" class="overdue-badge">逾期未还</span>
              </td>
              <td class="row-actions">
                <button
                  v-if="view.raw.status !== '已归还'"
                  class="link"
                  type="button"
                  @click="openReturn(view.raw.id)"
                >
                  归还核销
                </button>
                <span v-else class="panel-hint">{{ view.raw['归还日期'] }} 已核销</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!groupedRows.length" class="empty-state">暂无借阅记录，可先在上方登记借阅</p>
      <form v-if="returnTarget" class="inline-form" @submit.prevent="confirmReturn">
        <span>
          归还核销 {{ returnTarget['卷册编号'] }}（借阅人：{{ returnTarget['借阅人'] }}）：
        </span>
        <label>
          归还日期
          <input v-model="returnForm.归还日期" type="date" />
        </label>
        <label>
          经手人
          <input v-model="returnForm.经手人" />
        </label>
        <button class="btn primary" type="submit">确认归还并核销到借阅人</button>
        <button class="btn ghost" type="button" @click="returnTargetId = null">取消</button>
      </form>
    </section>

    <section class="panel">
      <h3>催还单（应还日期与台账一致，冲突时以借条原件为准）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>催还单号</th>
            <th>关联借阅</th>
            <th>卷册编号</th>
            <th>借阅人</th>
            <th>应还日期</th>
            <th>催还日期</th>
            <th>批次号</th>
            <th>当前状态</th>
            <th>办结结论</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="urge in urgeRows" :key="urge.id">
            <td>{{ urge['催还单号'] }}</td>
            <td>{{ urge['关联借阅编号'] }}</td>
            <td>{{ urge['卷册编号'] }}</td>
            <td>{{ urge['借阅人'] }}</td>
            <td>{{ urge['应还日期'] }}</td>
            <td>{{ urge['催还日期'] }}</td>
            <td>{{ urge['批次号'] }}</td>
            <td>{{ urge.status }}</td>
            <td>{{ urge['办结结论'] || '—' }}</td>
            <td>
              <button
                v-if="urge.status !== '已办结'"
                class="link"
                type="button"
                @click="openClose(Number(urge.id))"
              >
                办结
              </button>
              <span v-else class="panel-hint">{{ urge['办结日期'] }} 办结</span>
            </td>
          </tr>
          <tr v-if="!urgeRows.length">
            <td colspan="10" class="empty-state">暂无催还单，勾选待归还图册批量提交</td>
          </tr>
        </tbody>
      </table>
      <form v-if="closeTarget" class="inline-form" @submit.prevent="confirmClose">
        <span>办结 {{ closeTarget['催还单号'] }} 的结论：</span>
        <input v-model="closeConclusion" placeholder="结论会同步到二次回路检查待补录清单" />
        <button class="btn primary" type="submit">确认办结</button>
        <button class="btn ghost" type="button" @click="closeTargetId = null">取消</button>
      </form>
    </section>

    <footer class="page-foot">
      <span>共 {{ views.length }} 条借阅记录 · {{ urgeRows.length }} 张催还单</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="message" class="ok-text">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  BORROW_KEY,
  DEFAULT_LOAN_DAYS,
  OFFICE_LOAN_DAYS,
  URGE_KEY,
  alignDueDateToIOU,
  borrowViews,
  borrowerMissing,
  closeUrge,
  completeBorrower,
  dueDateConflicts,
  refreshOverdueFlags,
  registerBorrow,
  returnAndWriteOff,
  submitUrgeBatch,
  todayStr,
  type BorrowView,
  type DueConflict,
} from '@/api/drawing-borrow'
import { downloadEntries } from '@/api/local-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const offices = Object.keys(OFFICE_LOAN_DAYS)
const statuses = ['在借', '催还中', '已归还']

const views = ref<BorrowView[]>([])
const urgeRows = ref<EntryRow[]>([])
const conflicts = ref<DueConflict[]>([])
const selected = ref<Set<number>>(new Set())
const borrowerDrafts = ref<Record<number, string>>({})
const message = ref('')
const errorMessage = ref('')

const borrowForm = reactive({
  所属变电站: '',
  卷册编号: '',
  图册名称: '',
  资料类别: '二次图纸',
  专业室: offices[0],
  借阅人: '',
  借阅日期: '',
  借条编号: '',
  借条应还日期: '',
})

const returnTargetId = ref<number | null>(null)
const returnForm = reactive({ 归还日期: '', 经手人: '' })
const closeTargetId = ref<number | null>(null)
const closeConclusion = ref('')

const loanDaysPreview = computed(() => OFFICE_LOAN_DAYS[borrowForm.专业室] ?? DEFAULT_LOAN_DAYS)
const overdueCount = computed(() => views.value.filter((view) => view.overdue).length)
const incompleteRows = computed(() =>
  views.value.filter((view) => borrowerMissing(view.raw) && view.raw.status !== '已归还'),
)
const ledgerRows = computed(() => views.value.filter((view) => !borrowerMissing(view.raw)))
const groupedRows = computed(() => {
  const groups = new Map<string, BorrowView[]>()
  for (const view of ledgerRows.value) {
    const substation = String(view.raw['所属变电站'] || '未登记变电站')
    if (!groups.has(substation)) {
      groups.set(substation, [])
    }
    groups.get(substation)!.push(view)
  }
  return [...groups.entries()].map(([substation, rows]) => ({ substation, rows }))
})
const stats = computed(() => [
  { label: '在借卷册', value: views.value.filter((view) => view.raw.status !== '已归还').length },
  { label: '逾期未还', value: overdueCount.value },
  { label: '催还中', value: views.value.filter((view) => view.raw.status === '催还中').length },
  { label: '借阅人待补全', value: incompleteRows.value.length },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: views.value.filter((view) => view.raw.status === status).length,
  })),
)
const returnTarget = computed(
  () => views.value.find((view) => Number(view.raw.id) === returnTargetId.value)?.raw ?? null,
)
const closeTarget = computed(
  () => urgeRows.value.find((urge) => Number(urge.id) === closeTargetId.value) ?? null,
)

function urgeableOf(rows: BorrowView[]): number[] {
  return rows.filter((view) => view.urgeable).map((view) => Number(view.raw.id))
}

function allSelected(rows: BorrowView[]): boolean {
  const ids = urgeableOf(rows)
  return ids.length > 0 && ids.every((id) => selected.value.has(id))
}

function toggleOne(id: number, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = new Set(selected.value)
  if (checked) {
    next.add(id)
  } else {
    next.delete(id)
  }
  selected.value = next
}

function toggleGroup(rows: BorrowView[], event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = new Set(selected.value)
  for (const id of urgeableOf(rows)) {
    if (checked) {
      next.add(id)
    } else {
      next.delete(id)
    }
  }
  selected.value = next
}

function clearMessages() {
  message.value = ''
  errorMessage.value = ''
}

function submitBorrow() {
  clearMessages()
  const result = registerBorrow({ ...borrowForm })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  borrowForm.卷册编号 = ''
  borrowForm.图册名称 = ''
  borrowForm.借阅人 = ''
  borrowForm.借条编号 = ''
  borrowForm.借条应还日期 = ''
  reload()
}

function submitUrge() {
  clearMessages()
  const result = submitUrgeBatch([...selected.value])
  if (result.ok) {
    message.value = result.message
  } else {
    errorMessage.value = result.message
  }
  selected.value = new Set()
  reload()
}

function saveBorrower(id: number) {
  clearMessages()
  const result = completeBorrower(id, borrowerDrafts.value[id] ?? '')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  reload()
}

function alignDue(id: number) {
  clearMessages()
  const result = alignDueDateToIOU(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  reload()
}

function openReturn(id: number) {
  clearMessages()
  returnTargetId.value = id
  returnForm.归还日期 = todayStr()
  returnForm.经手人 = store.operator
}

function confirmReturn() {
  clearMessages()
  if (returnTargetId.value === null) {
    return
  }
  const result = returnAndWriteOff(returnTargetId.value, returnForm.归还日期, returnForm.经手人)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  returnTargetId.value = null
  reload()
}

function openClose(id: number) {
  clearMessages()
  closeTargetId.value = id
  closeConclusion.value = ''
}

function confirmClose() {
  clearMessages()
  if (closeTargetId.value === null) {
    return
  }
  const result = closeUrge(closeTargetId.value, closeConclusion.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  closeTargetId.value = null
  reload()
}

function exportRows(key: string) {
  downloadEntries(key)
}

function reload() {
  refreshOverdueFlags()
  views.value = borrowViews()
  urgeRows.value = listRows(URGE_KEY)
  conflicts.value = dueDateConflicts()
}

onMounted(() => {
  borrowForm.借阅日期 = todayStr()
  reload()
})
</script>
