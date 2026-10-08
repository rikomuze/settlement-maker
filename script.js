/* 推し活 立替精算 v2
 * 保存キー・保存形式は v1 と互換（members: string[], payments: [...]）。
 * v2 で追加したのは settled（送金済みチェック）だけで、v1 からは無視される。
 */
const STORAGE_KEY = "oshiSettlementMaker_v1";
const DEFAULT_MEMBER = "わたし"; // 初回とリセット後に最初から入れておく

let members = [];
let payments = [];
let settled = {};

// フォームの状態
let editingIndex = null;
let formPayer = "";
let formTargets = new Set();
let indivValues = {};

const $ = (id) => document.getElementById(id);
const el = {
  memberForm: $("memberForm"), memberName: $("memberName"), memberList: $("memberList"), memberError: $("memberError"),
  paymentList: $("paymentList"), paymentsEmpty: $("paymentsEmpty"),
  payForm: $("payForm"), formHeading: $("formHeading"),
  itemChips: $("itemChips"), itemName: $("itemName"), itemAmount: $("itemAmount"),
  payerChips: $("payerChips"), targetChips: $("targetChips"), toggleAllBtn: $("toggleAllBtn"),
  equalArea: $("equalArea"), equalNote: $("equalNote"),
  individualArea: $("individualArea"), individualInputs: $("individualInputs"), individualNote: $("individualNote"),
  formError: $("formError"), submitBtn: $("submitPaymentBtn"),
  editActions: $("editActions"), cancelEditBtn: $("cancelEditBtn"), deletePaymentBtn: $("deletePaymentBtn"),
  resultSection: $("resultSection"), slip: $("slip"), resultActions: $("resultActions"),
  copyBtn: $("copyBtn"), imageBtn: $("imageBtn"), resetBtn: $("resetBtn"),
  summaryBar: $("summaryBar"), summaryText: $("summaryText"),
  toast: $("toast"), toastText: $("toastText"), toastUndo: $("toastUndo"),
  imageSheet: $("imageSheet"), imageSheetImg: $("imageSheetImg"), imageSheetClose: $("imageSheetClose"),
};

/* ---------- 保存 ---------- */
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ members, payments, settled }));
  } catch {
    showToast("この端末に保存できませんでした（プライベートモードの可能性があります）");
  }
}

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed) { members = [DEFAULT_MEMBER]; return; }
    members = Array.isArray(parsed.members) ? parsed.members.filter((m) => typeof m === "string") : [];
    payments = Array.isArray(parsed.payments) ? parsed.payments.filter(isValidPayment) : [];
    settled = parsed.settled && typeof parsed.settled === "object" ? parsed.settled : {};
  } catch {
    members = []; payments = []; settled = {};
  }
}

function isValidPayment(p) {
  return p && typeof p.name === "string" && Number(p.amount) > 0 && typeof p.payer === "string" &&
    (p.splitMode === "individual" ? Array.isArray(p.individualAmounts) : Array.isArray(p.targets));
}

function snapshot() {
  return JSON.stringify({ members, payments, settled });
}
function restore(snap) {
  const s = JSON.parse(snap);
  members = s.members; payments = s.payments; settled = s.settled || {};
  cancelEdit(false);
  syncFormToMembers(true);
  saveData();
  renderAll();
}

/* ---------- 計算 ---------- */
const yen = (n) => `${Math.round(n).toLocaleString("ja-JP")}円`;

// 全角数字・カンマ・円記号を許容して整数に
function parseAmount(str) {
  const s = String(str || "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，、\s円¥￥]/g, "");
  if (!/^\d+$/.test(s)) return s === "" ? null : NaN;
  return Number(s);
}

// 1件の支払いを「誰がいくら負担するか」に分解（必ず合計が金額と一致する）
function sharesOf(p) {
  if (p.splitMode === "individual") {
    return p.individualAmounts.map((i) => ({ member: i.member, amount: Math.round(Number(i.amount)) }));
  }
  const amount = Math.round(Number(p.amount));
  const n = p.targets.length;
  const base = Math.floor(amount / n);
  let rem = amount - base * n;
  // 端数は立て替えた人から順に1円ずつ
  const order = p.targets.includes(p.payer) ? [p.payer, ...p.targets.filter((t) => t !== p.payer)] : p.targets;
  const extra = new Set(order.slice(0, rem));
  return p.targets.map((t) => ({ member: t, amount: base + (extra.has(t) ? 1 : 0) }));
}

function hasRemainder(p) {
  return p.splitMode !== "individual" && Math.round(p.amount) % p.targets.length !== 0;
}

function calcLedger() {
  const ledger = {};
  members.forEach((m) => (ledger[m] = { paid: 0, owed: 0, items: [] }));
  payments.forEach((p) => {
    if (ledger[p.payer]) ledger[p.payer].paid += Math.round(p.amount);
    sharesOf(p).forEach((s) => {
      if (!ledger[s.member]) return;
      ledger[s.member].owed += s.amount;
      ledger[s.member].items.push({ name: p.name, amount: s.amount });
    });
  });
  return ledger;
}

function calcTransfers(ledger) {
  const creditors = [];
  const debtors = [];
  members.forEach((m) => {
    const b = ledger[m].paid - ledger[m].owed;
    if (b > 0) creditors.push({ name: m, amount: b });
    if (b < 0) debtors.push({ name: m, amount: -b });
  });
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const out = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0) out.push({ from: debtors[i].name, to: creditors[j].name, amount });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }
  return out;
}

const transferKey = (t) => `${t.from}>${t.to}>${t.amount}`;

/* ---------- メンバー ---------- */
function renderMembers() {
  el.memberList.innerHTML = "";
  members.forEach((m) => {
    const chip = document.createElement("span");
    chip.className = "member-chip";
    const name = document.createElement("span");
    name.textContent = m;
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "×";
    del.setAttribute("aria-label", `${m}を削除`);
    del.addEventListener("click", () => removeMember(m));
    chip.append(name, del);
    el.memberList.appendChild(chip);
  });
  el.memberName.placeholder = members.length === 0 ? "名前（例：わたし）" : "いっしょに行く人の名前";
}

function addMember(e) {
  e.preventDefault();
  const name = el.memberName.value.trim();
  el.memberError.textContent = "";
  el.memberName.removeAttribute("aria-invalid");
  if (!name) return fieldError(el.memberName, el.memberError, "名前を入力してください");
  if (members.includes(name)) return fieldError(el.memberName, el.memberError, `「${name}」はもう追加されています`);
  members.push(name);
  formTargets.add(name);
  if (!formPayer) formPayer = name;
  el.memberName.value = "";
  saveData();
  renderAll();
  el.memberName.focus();
}

function removeMember(name) {
  const snap = snapshot();
  const related = payments.filter((p) => p.payer === name || sharesOf(p).some((s) => s.member === name)).length;

  members = members.filter((m) => m !== name);
  payments = payments
    .filter((p) => p.payer !== name)
    .map((p) => {
      if (p.splitMode === "individual") {
        const individualAmounts = p.individualAmounts.filter((i) => i.member !== name);
        const amount = individualAmounts.reduce((s, i) => s + Number(i.amount), 0);
        return { ...p, amount, individualAmounts, targets: individualAmounts.map((i) => i.member) };
      }
      return { ...p, targets: p.targets.filter((t) => t !== name) };
    })
    .filter((p) => (p.splitMode === "individual" ? p.individualAmounts.length > 0 : p.targets.length > 0));

  cancelEdit(false);
  syncFormToMembers(false);
  saveData();
  renderAll();
  showToast(related ? `${name}を削除しました（関係する支払い${related}件も変わりました）` : `${name}を削除しました`, () => restore(snap));
}

/* ---------- 支払い一覧 ---------- */
function describePayment(p) {
  if (p.splitMode === "individual") {
    return `${p.payer}が立替 ／ ` + p.individualAmounts.map((i) => `${i.member} ${Number(i.amount).toLocaleString("ja-JP")}`).join("・");
  }
  const who = p.targets.length === members.length ? `全員${p.targets.length}人` : p.targets.join("・");
  return `${p.payer}が立替 ／ ${who}で均等`;
}

function renderPayments() {
  el.paymentList.innerHTML = "";
  if (members.length === 0) {
    el.paymentsEmpty.textContent = "先に「いっしょに精算する人」を追加してください。";
  } else if (payments.length === 0) {
    el.paymentsEmpty.textContent = "まだありません。下のフォームから1件ずつ追加します。";
  } else {
    el.paymentsEmpty.textContent = "";
  }

  payments.forEach((p, idx) => {
    const li = document.createElement("li");
    li.className = "payment-item" + (idx === editingIndex ? " is-editing" : "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "payment-row";
    btn.setAttribute("aria-label", `${p.name} ${yen(p.amount)} を編集`);
    btn.innerHTML = `<span class="payment-name"></span><span class="payment-amount"></span><span class="payment-meta"></span>`;
    btn.querySelector(".payment-name").textContent = p.name;
    btn.querySelector(".payment-amount").textContent = yen(p.amount);
    btn.querySelector(".payment-meta").textContent = describePayment(p);
    btn.addEventListener("click", () => startEdit(idx));
    li.appendChild(btn);
    el.paymentList.appendChild(li);
  });

  if (payments.length > 1) {
    const total = payments.reduce((s, p) => s + Math.round(p.amount), 0);
    const li = document.createElement("li");
    li.className = "payment-total";
    li.innerHTML = `<span>${payments.length}件・タップで修正</span><strong></strong>`;
    li.querySelector("strong").textContent = `合計 ${yen(total)}`;
    el.paymentList.appendChild(li);
  } else if (payments.length === 1) {
    const li = document.createElement("li");
    li.className = "payment-total";
    li.innerHTML = `<span>タップで修正・削除できます</span>`;
    el.paymentList.appendChild(li);
  }

  el.payForm.hidden = members.length === 0;
}

/* ---------- 支払いフォーム ---------- */
function syncFormToMembers(resetTargets) {
  if (!members.includes(formPayer)) formPayer = members[0] || "";
  if (resetTargets) formTargets = new Set(members);
  else formTargets = new Set([...formTargets].filter((m) => members.includes(m)));
  Object.keys(indivValues).forEach((m) => { if (!members.includes(m)) delete indivValues[m]; });
}

function getMode() {
  return document.querySelector("input[name='splitMode']:checked").value;
}
function setMode(mode) {
  document.querySelector(`input[name='splitMode'][value='${mode}']`).checked = true;
}

function renderForm() {
  // 項目チップ
  el.itemChips.querySelectorAll(".chip").forEach((c) => {
    c.setAttribute("aria-pressed", String(c.dataset.item === el.itemName.value.trim()));
  });

  // 立て替えた人
  el.payerChips.innerHTML = "";
  members.forEach((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(m === formPayer));
    b.textContent = m;
    b.addEventListener("click", () => { formPayer = m; renderForm(); });
    el.payerChips.appendChild(b);
  });

  const mode = getMode();
  el.equalArea.hidden = mode !== "equal";
  el.individualArea.hidden = mode !== "individual";

  // 割る人
  el.targetChips.innerHTML = "";
  members.forEach((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("aria-pressed", String(formTargets.has(m)));
    b.textContent = m;
    b.addEventListener("click", () => {
      formTargets.has(m) ? formTargets.delete(m) : formTargets.add(m);
      renderForm();
    });
    el.targetChips.appendChild(b);
  });
  const allOn = members.length > 0 && members.every((m) => formTargets.has(m));
  el.toggleAllBtn.textContent = allOn ? "全員はずす" : "全員えらぶ";

  // 個別入力（入力中のフォーカスを壊さないよう、メンバーが変わったときだけ作り直す）
  const existing = [...el.individualInputs.querySelectorAll("input")].map((i) => i.dataset.member).join("\n");
  if (existing !== members.join("\n")) {
    el.individualInputs.innerHTML = "";
    members.forEach((m) => {
      const row = document.createElement("label");
      row.className = "individual-row";
      const name = document.createElement("span");
      name.textContent = m;
      const wrap = document.createElement("div");
      wrap.className = "yen-input";
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.placeholder = "0";
      input.dataset.member = m;
      input.addEventListener("input", () => { indivValues[m] = input.value; updateNotes(); });
      const unit = document.createElement("span");
      unit.textContent = "円";
      unit.setAttribute("aria-hidden", "true");
      wrap.append(input, unit);
      row.append(name, wrap);
      el.individualInputs.appendChild(row);
    });
  }
  el.individualInputs.querySelectorAll("input").forEach((i) => {
    if (document.activeElement !== i) i.value = indivValues[i.dataset.member] || "";
  });

  updateNotes();

  // 編集モード
  const editing = editingIndex !== null;
  el.payForm.classList.toggle("is-editing", editing);
  el.formHeading.textContent = editing ? `「${payments[editingIndex].name}」を修正中` : "支払いを追加";
  el.submitBtn.textContent = editing ? "修正を保存" : "この支払いを追加";
  el.editActions.hidden = !editing;
}

function updateNotes() {
  const amount = parseAmount(el.itemAmount.value);
  const mode = getMode();

  if (mode === "equal") {
    const n = formTargets.size;
    el.equalNote.className = "live-note";
    if (!n) {
      el.equalNote.innerHTML = "割る人を1人以上えらんでください";
    } else if (amount > 0) {
      const base = Math.floor(amount / n);
      const rem = amount - base * n;
      el.equalNote.innerHTML = `${n}人で割って <strong>1人 ${yen(base)}</strong>` +
        (rem ? `（端数${rem}円は立て替えた人が負担）` : "");
    } else {
      el.equalNote.textContent = `${n}人で割ります`;
    }
    return;
  }

  const sum = Object.entries(indivValues)
    .filter(([m]) => members.includes(m))
    .reduce((s, [, v]) => s + (parseAmount(v) > 0 ? parseAmount(v) : 0), 0);
  el.individualNote.className = "live-note";
  if (amount === null || Number.isNaN(amount)) {
    el.individualNote.innerHTML = sum > 0
      ? `合計 <strong>${yen(sum)}</strong>（上の金額が空なら、この合計で追加します）`
      : "人ごとに金額を入れてください。0円の人は空のままで大丈夫です";
  } else if (sum === amount) {
    el.individualNote.classList.add("ok");
    el.individualNote.innerHTML = `合計 <strong>${yen(sum)} ✓ ぴったり</strong>`;
  } else {
    el.individualNote.classList.add("warn");
    const diff = amount - sum;
    el.individualNote.innerHTML = `合計 ${yen(sum)} ／ <strong>${diff > 0 ? `あと${yen(diff)}` : `${yen(-diff)}多い`}</strong>`;
  }
}

function fieldError(input, box, msg) {
  box.textContent = msg;
  if (input) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
  return false;
}

function clearFormErrors() {
  el.formError.textContent = "";
  el.payForm.querySelectorAll("[aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
}

function submitPayment(e) {
  e.preventDefault();
  clearFormErrors();

  const name = el.itemName.value.trim();
  let amount = parseAmount(el.itemAmount.value);
  const mode = getMode();

  if (!name) return fieldError(el.itemName, el.formError, "なにの支払いか選ぶか、入力してください");
  if (Number.isNaN(amount)) return fieldError(el.itemAmount, el.formError, "金額は数字で入力してください（例：48000）");
  if (!formPayer) return fieldError(null, el.formError, "立て替えた人をえらんでください");

  let payment;
  if (mode === "equal") {
    if (!amount) return fieldError(el.itemAmount, el.formError, "金額を入力してください");
    const targets = members.filter((m) => formTargets.has(m));
    if (!targets.length) return fieldError(null, el.formError, "割る人を1人以上えらんでください");
    payment = { name, amount, payer: formPayer, splitMode: "equal", targets };
  } else {
    const individualAmounts = [];
    for (const m of members) {
      const v = parseAmount(indivValues[m]);
      if (Number.isNaN(v)) {
        const input = el.individualInputs.querySelector(`input[data-member="${CSS.escape(m)}"]`);
        return fieldError(input, el.formError, `${m}の金額は数字で入力してください`);
      }
      if (v > 0) individualAmounts.push({ member: m, amount: v });
    }
    if (!individualAmounts.length) return fieldError(null, el.formError, "1人以上の金額を入力してください");
    const sum = individualAmounts.reduce((s, i) => s + i.amount, 0);
    if (amount === null) amount = sum;
    if (sum !== amount) {
      return fieldError(el.itemAmount, el.formError,
        `人ごとの合計（${yen(sum)}）が金額（${yen(amount)}）と合っていません`);
    }
    payment = { name, amount, payer: formPayer, splitMode: "individual", individualAmounts, targets: individualAmounts.map((i) => i.member) };
  }

  if (editingIndex !== null) {
    payments[editingIndex] = payment;
    showToast(`「${name}」を修正しました`);
  } else {
    payments.push(payment);
    showToast(`「${name}」${yen(amount)} を追加しました`);
  }
  saveData();
  resetForm();
  renderAll();
}

function resetForm() {
  editingIndex = null;
  el.itemName.value = "";
  el.itemAmount.value = "";
  indivValues = {};
  setMode("equal");
  formTargets = new Set(members);
  clearFormErrors();
}

function startEdit(idx) {
  const p = payments[idx];
  editingIndex = idx;
  clearFormErrors();
  el.itemName.value = p.name;
  el.itemAmount.value = Math.round(p.amount).toLocaleString("ja-JP");
  formPayer = members.includes(p.payer) ? p.payer : members[0];
  setMode(p.splitMode === "individual" ? "individual" : "equal");
  formTargets = new Set(p.splitMode === "individual" ? members : p.targets);
  indivValues = {};
  if (p.splitMode === "individual") p.individualAmounts.forEach((i) => (indivValues[i.member] = String(i.amount)));
  renderPayments();
  renderForm();
  updateSummaryBar();
  el.payForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEdit(render = true) {
  if (editingIndex === null) return;
  resetForm();
  if (render) { renderPayments(); renderForm(); updateSummaryBar(); }
}

function deleteEditing() {
  if (editingIndex === null) return;
  const snap = snapshot();
  const [removed] = payments.splice(editingIndex, 1);
  resetForm();
  saveData();
  renderAll();
  showToast(`「${removed.name}」を削除しました`, () => restore(snap));
}

/* ---------- 精算スリップ ---------- */
function todayLabel() {
  const d = new Date();
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function renderResult() {
  const slip = el.slip;
  slip.innerHTML = '<span class="slip-tape" aria-hidden="true"></span>';

  const head = document.createElement("div");
  head.innerHTML = `<p class="slip-title">精算メモ</p><p class="slip-sub"></p><hr class="slip-rule">`;
  slip.appendChild(head);

  const ready = members.length >= 2 && payments.length > 0;
  el.resultActions.hidden = !ready;

  if (!ready) {
    head.querySelector(".slip-sub").textContent = todayLabel();
    const p = document.createElement("p");
    p.className = "slip-empty";
    p.innerHTML = members.length < 2
      ? "メンバーを<strong>2人以上</strong>追加して、<br>立て替えた支払いを入れると<br>ここに「誰が誰にいくら」がでます。"
      : "立て替えた支払いを1件以上入れると、<br>ここに「誰が誰にいくら」がでます。";
    slip.appendChild(p);
    return;
  }

  const ledger = calcLedger();
  const transfers = calcTransfers(ledger);
  const total = payments.reduce((s, p) => s + Math.round(p.amount), 0);
  head.querySelector(".slip-sub").textContent = `${todayLabel()}　支払い${payments.length}件・合計 ${yen(total)}`;

  // 古い「済」チェックを掃除
  const keys = new Set(transfers.map(transferKey));
  Object.keys(settled).forEach((k) => { if (!keys.has(k)) delete settled[k]; });

  const label = document.createElement("p");
  label.className = "slip-label";
  label.textContent = transfers.length ? `送金 ${transfers.length}回で精算できます` : "送金";
  if (transfers.length) {
    const tip = document.createElement("span");
    tip.className = "slip-tip";
    tip.textContent = "払い終わったら○をタップ";
    label.appendChild(tip);
  }
  slip.appendChild(label);

  if (!transfers.length) {
    const even = document.createElement("p");
    even.className = "all-even";
    even.textContent = "送金は必要ありません。みんなぴったりです";
    slip.appendChild(even);
  } else {
    const ul = document.createElement("ul");
    ul.className = "transfer-list";
    transfers.forEach((t) => {
      const key = transferKey(t);
      const done = !!settled[key];
      const li = document.createElement("li");
      li.className = "transfer" + (done ? " is-done" : "");
      li.innerHTML = `
        <button type="button" class="done-toggle" aria-pressed="${done}"><span>✓</span></button>
        <div class="transfer-body">
          <div class="transfer-who"><b></b><span class="arrow">→</span><b></b><span>へ</span></div>
          <span class="transfer-amount"></span>
        </div>`;
      const [fromEl, toEl] = li.querySelectorAll(".transfer-who b");
      fromEl.textContent = t.from;
      toEl.textContent = t.to;
      li.querySelector(".transfer-amount").innerHTML = `${t.amount.toLocaleString("ja-JP")}<small>円</small>`;
      const toggle = li.querySelector(".done-toggle");
      toggle.setAttribute("aria-label", `${t.from}から${t.to}への${yen(t.amount)}を${done ? "未送金に戻す" : "送金済みにする"}`);
      toggle.addEventListener("click", () => {
        if (settled[key]) delete settled[key]; else settled[key] = true;
        saveData();
        renderResult();
        updateSummaryBar();
      });
      ul.appendChild(li);
    });
    slip.appendChild(ul);
    const doneCount = transfers.filter((t) => settled[transferKey(t)]).length;
    if (doneCount === transfers.length) {
      const fin = document.createElement("p");
      fin.className = "done-all";
      fin.textContent = "ぜんぶ送金済みです。おつかれさまでした";
      slip.appendChild(fin);
    }
  }

  const rule = document.createElement("hr");
  rule.className = "slip-rule";
  slip.appendChild(rule);

  // 収支表
  const tl = document.createElement("p");
  tl.className = "slip-label";
  tl.textContent = "みんなの収支";
  slip.appendChild(tl);

  const table = document.createElement("table");
  table.className = "balance-table";
  table.innerHTML = `<thead><tr><th scope="col">名前</th><th scope="col">立て替え</th><th scope="col">負担</th><th scope="col">差額</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  members.forEach((m) => {
    const { paid, owed } = ledger[m];
    const diff = paid - owed;
    const tr = document.createElement("tr");
    tr.innerHTML = `<th scope="row"></th><td>${paid.toLocaleString("ja-JP")}</td><td>${owed.toLocaleString("ja-JP")}</td><td class="${diff > 0 ? "plus" : diff < 0 ? "minus" : ""}">${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(diff).toLocaleString("ja-JP")}</td>`;
    tr.querySelector("th").textContent = m;
    tbody.appendChild(tr);
  });
  slip.appendChild(table);

  // 内訳（たたむ）
  const det = document.createElement("details");
  det.className = "detail";
  det.innerHTML = "<summary>ひとりずつの内訳を見る</summary>";
  members.forEach((m) => {
    const box = document.createElement("div");
    box.className = "detail-person";
    const who = document.createElement("p");
    who.className = "who";
    who.innerHTML = "<span></span><span></span>";
    who.children[0].textContent = m;
    who.children[1].textContent = `負担 ${yen(ledger[m].owed)}`;
    box.appendChild(who);
    if (!ledger[m].items.length) {
      const l = document.createElement("p");
      l.className = "line";
      l.textContent = "負担する支払いはありません";
      box.appendChild(l);
    }
    ledger[m].items.forEach((it) => {
      const l = document.createElement("p");
      l.className = "line";
      l.innerHTML = "<span></span><span></span>";
      l.children[0].textContent = it.name;
      l.children[1].textContent = yen(it.amount);
      box.appendChild(l);
    });
    det.appendChild(box);
  });
  slip.appendChild(det);

  if (payments.some(hasRemainder)) {
    const note = document.createElement("p");
    note.className = "rounding-note";
    note.textContent = "※ 割り切れない端数は、立て替えた人が1円ずつ多く負担する形にしています。";
    slip.appendChild(note);
  }
}

/* ---------- コピー ---------- */
function buildCopyText() {
  const ledger = calcLedger();
  const transfers = calcTransfers(ledger);
  const lines = ["【推し活 立替精算】", ""];
  lines.push("■ 送金");
  if (!transfers.length) lines.push("送金は必要ありません");
  transfers.forEach((t) => lines.push(`${t.from} → ${t.to}　${yen(t.amount)}${settled[transferKey(t)] ? "（済）" : ""}`));
  lines.push("", "■ 立て替えた支払い");
  payments.forEach((p) => lines.push(`・${p.name} ${yen(p.amount)}（${describePayment(p)}）`));
  lines.push("", "■ ひとりずつの負担");
  members.forEach((m) => {
    const items = ledger[m].items.map((i) => `${i.name} ${i.amount.toLocaleString("ja-JP")}`).join("・");
    lines.push(`${m}　${yen(ledger[m].owed)}${items ? `（${items}）` : ""}`);
  });
  if (payments.some(hasRemainder)) lines.push("※端数は立て替えた人が負担");
  lines.push("", "確認お願いします！");
  return lines.join("\n");
}

async function copyResult() {
  const text = buildCopyText();
  try {
    await navigator.clipboard.writeText(text);
    showToast("コピーしました。LINEなどに貼り付けてください");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand("copy");
    ta.remove();
    showToast(ok ? "コピーしました。LINEなどに貼り付けてください" : "コピーできませんでした。画像で保存をお使いください");
  }
}

/* ---------- 画像（Canvasに直接描く） ---------- */
const FONT = '"Zen Kaku Gothic New", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
const HAND = '"Klee One", "Zen Kaku Gothic New", "Hiragino Sans", sans-serif';

function drawReceipt() {
  const ledger = calcLedger();
  const transfers = calcTransfers(ledger);
  const total = payments.reduce((s, p) => s + Math.round(p.amount), 0);
  const W = 1080, PAD = 72, IN = 64;
  const rowH = 64, tRowH = 128;
  const H = 200 + 120 + 80 + Math.max(1, transfers.length) * (tRowH + 18) + 80 + 70 + members.length * rowH + 150;

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");

  g.fillStyle = "#f1ebe1"; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(64,56,47,.07)";
  for (let y = 0; y < H; y += 44) for (let x = 0; x < W; x += 44) { g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); }

  const x0 = PAD, x1 = W - PAD, top = 90, bottom = H - 80;
  g.fillStyle = "#fff";
  g.beginPath();
  // ギザギザの上下端
  g.moveTo(x0, top);
  for (let x = x0; x < x1; x += 24) { g.lineTo(x + 12, top - 10); g.lineTo(Math.min(x + 24, x1), top); }
  g.lineTo(x1, bottom);
  for (let x = x1; x > x0; x -= 24) { g.lineTo(x - 12, bottom + 10); g.lineTo(Math.max(x - 24, x0), bottom); }
  g.closePath();
  g.shadowColor = "rgba(84,65,51,.12)"; g.shadowBlur = 24; g.shadowOffsetY = 8;
  g.fill();
  g.shadowColor = "transparent";

  // テープ
  g.save(); g.translate(W / 2, top - 6); g.rotate(-0.04);
  g.fillStyle = "rgba(181,211,193,.85)"; g.fillRect(-90, -18, 180, 36); g.restore();

  const L = x0 + IN, R = x1 - IN;
  let y = top + 86;
  g.textAlign = "center"; g.fillStyle = "#3d362f";
  g.font = `600 52px ${HAND}`; g.fillText("精算メモ", W / 2, y);
  y += 50;
  g.font = `400 28px ${FONT}`; g.fillStyle = "#6f6458";
  g.fillText(`${todayLabel()}　支払い${payments.length}件・合計 ${yen(total)}`, W / 2, y);
  y += 44;
  dashed(g, L, R, y); y += 64;

  g.textAlign = "left"; g.fillStyle = "#6f6458"; g.font = `700 28px ${FONT}`;
  g.fillText(transfers.length ? `送金 ${transfers.length}回で精算できます` : "送金", L, y);
  y += 30;

  if (!transfers.length) {
    g.fillStyle = "#e5ede6"; roundRect(g, L, y, R - L, tRowH, 10); g.fill();
    g.fillStyle = "#3d362f"; g.font = `700 34px ${FONT}`; g.textAlign = "center";
    g.fillText("送金は必要ありません", W / 2, y + tRowH / 2 + 12);
    g.textAlign = "left"; y += tRowH + 18;
  }
  transfers.forEach((t) => {
    const done = !!settled[transferKey(t)];
    g.fillStyle = done ? "#f2f4f1" : "#faf6ef"; roundRect(g, L, y, R - L, tRowH, 10); g.fill();
    g.fillStyle = done ? "#9a9086" : "#3d362f";
    g.font = `700 32px ${FONT}`;
    g.fillText(fit(g, `${t.from}  →  ${t.to} へ`, R - L - 340), L + 32, y + 72);
    g.textAlign = "right";
    g.font = `700 52px ${FONT}`;
    g.fillText(t.amount.toLocaleString("ja-JP"), R - 76, y + 82);
    g.font = `700 30px ${FONT}`; g.fillText("円", R - 32, y + 82);
    if (done) { g.font = `700 24px ${FONT}`; g.fillStyle = "#5b7563"; g.fillText("済", R - 32, y + 36); }
    g.textAlign = "left";
    y += tRowH + 18;
  });

  y += 18; dashed(g, L, R, y); y += 62;
  g.fillStyle = "#6f6458"; g.font = `700 28px ${FONT}`; g.fillText("みんなの収支", L, y);
  y += 50;
  const cols = [R - 400, R - 210, R];
  g.font = `400 24px ${FONT}`; g.textAlign = "right";
  ["立て替え", "負担", "差額"].forEach((h, i) => g.fillText(h, cols[i], y));
  y += 20;
  members.forEach((m) => {
    const { paid, owed } = ledger[m];
    const d = paid - owed;
    y += rowH - 18;
    g.textAlign = "left"; g.fillStyle = "#3d362f"; g.font = `700 30px ${FONT}`;
    g.fillText(fit(g, m, cols[0] - L - 150), L, y);
    g.textAlign = "right"; g.font = `400 30px ${FONT}`;
    g.fillText(paid.toLocaleString("ja-JP"), cols[0], y);
    g.fillText(owed.toLocaleString("ja-JP"), cols[1], y);
    g.font = `700 30px ${FONT}`;
    g.fillStyle = d > 0 ? "#5b7563" : d < 0 ? "#94566a" : "#3d362f";
    g.fillText(`${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toLocaleString("ja-JP")}`, cols[2], y);
    y += 18;
    g.strokeStyle = "#e3d9cc"; g.lineWidth = 2; g.setLineDash([3, 6]);
    g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.setLineDash([]);
  });

  g.textAlign = "center"; g.fillStyle = "#8a7d70"; g.font = `400 22px ${FONT}`;
  g.fillText("MUZE TOOL BOX ｜ 推し活 立替精算", W / 2, bottom - 36);
  return c;
}

function dashed(g, a, b, y) {
  g.strokeStyle = "#c7b9aa"; g.lineWidth = 3; g.setLineDash([10, 8]);
  g.beginPath(); g.moveTo(a, y); g.lineTo(b, y); g.stroke(); g.setLineDash([]);
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

const isInAppBrowser = () => /Line\/|Instagram|FBAN|FBAV|Twitter|TwitterAndroid|MicroMessenger/i.test(navigator.userAgent);

async function saveImage() {
  try { await document.fonts.ready; } catch {}
  const canvas = drawReceipt();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return showToast("画像を作れませんでした。コピーをお使いください");
  const fileName = `settlement-${todayLabel().replace(/\./g, "")}.png`;
  const file = new File([blob], fileName, { type: "image/png" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return; // 自分で閉じた
      // それ以外は長押し保存へ
    }
    return showImageSheet(blob);
  }
  if (isInAppBrowser()) return showImageSheet(blob);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  showToast("画像をダウンロードしました");
}

let sheetUrl = null;
function showImageSheet(blob) {
  if (sheetUrl) URL.revokeObjectURL(sheetUrl);
  sheetUrl = URL.createObjectURL(blob);
  el.imageSheetImg.src = sheetUrl;
  el.imageSheet.hidden = false;
  el.imageSheetClose.focus();
}
function closeImageSheet() {
  el.imageSheet.hidden = true;
  el.imageBtn.focus();
}

/* ---------- リセット ---------- */
function resetAll() {
  const isFresh = !payments.length && members.length === 1 && members[0] === DEFAULT_MEMBER;
  if (isFresh) return;
  const snap = snapshot();
  members = [DEFAULT_MEMBER]; payments = []; settled = {};
  formPayer = DEFAULT_MEMBER;
  resetForm();
  saveData();
  renderAll();
  showToast("ぜんぶ消しました", () => restore(snap), 8000);
}

/* ---------- トースト ---------- */
let toastTimer = null;
let toastUndoFn = null;
function showToast(msg, undo = null, ms = 5000) {
  el.toastText.textContent = msg;
  toastUndoFn = undo;
  el.toastUndo.hidden = !undo;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; toastUndoFn = null; }, ms);
}

/* ---------- 下部バー ---------- */
let resultVisible = false;
let formFocused = false;
// 入力中（キーボード表示中）は下部バーを隠す
document.addEventListener("focusin", (e) => {
  if (e.target.matches("input[type='text']")) { formFocused = true; updateSummaryBar(); }
});
document.addEventListener("focusout", () => {
  setTimeout(() => {
    formFocused = !!(document.activeElement && document.activeElement.matches("input[type='text']"));
    updateSummaryBar();
  }, 0);
});
function updateSummaryBar() {
  const ready = members.length >= 2 && payments.length > 0;
  const show = ready && !resultVisible && !formFocused && editingIndex === null;
  if (ready) {
    const transfers = calcTransfers(calcLedger());
    const left = transfers.filter((t) => !settled[transferKey(t)]).length;
    el.summaryText.innerHTML = transfers.length
      ? (left ? `送金 <b>${transfers.length}回</b>${left < transfers.length ? `（のこり${left}）` : ""}で精算` : "<b>ぜんぶ送金済み</b>")
      : "<b>送金なし</b>（みんなぴったり）";
  }
  el.summaryBar.hidden = !show;
  document.documentElement.style.setProperty("--bar-h", show ? `${el.summaryBar.offsetHeight || 64}px` : "0px");
}

/* ---------- まとめて描画 ---------- */
function renderAll() {
  renderMembers();
  renderPayments();
  renderForm();
  renderResult();
  updateSummaryBar();
}

/* ---------- イベント ---------- */
el.memberForm.addEventListener("submit", addMember);
el.memberName.addEventListener("input", () => { el.memberError.textContent = ""; el.memberName.removeAttribute("aria-invalid"); });

el.itemChips.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  el.itemName.value = chip.dataset.item;
  el.itemName.removeAttribute("aria-invalid");
  renderForm();
  if (!el.itemAmount.value) el.itemAmount.focus();
});
el.itemName.addEventListener("input", () => {
  el.itemChips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.item === el.itemName.value.trim())));
});
el.itemAmount.addEventListener("input", () => { el.itemAmount.removeAttribute("aria-invalid"); updateNotes(); });
el.itemAmount.addEventListener("blur", () => {
  const v = parseAmount(el.itemAmount.value);
  if (v > 0) el.itemAmount.value = v.toLocaleString("ja-JP");
});
document.querySelectorAll("input[name='splitMode']").forEach((r) => r.addEventListener("change", () => { clearFormErrors(); renderForm(); }));
el.toggleAllBtn.addEventListener("click", () => {
  const allOn = members.every((m) => formTargets.has(m));
  formTargets = allOn ? new Set() : new Set(members);
  renderForm();
});
el.payForm.addEventListener("submit", submitPayment);
el.cancelEditBtn.addEventListener("click", () => cancelEdit());
el.deletePaymentBtn.addEventListener("click", deleteEditing);

el.copyBtn.addEventListener("click", copyResult);
el.imageBtn.addEventListener("click", saveImage);
el.resetBtn.addEventListener("click", resetAll);

el.toastUndo.addEventListener("click", () => {
  const fn = toastUndoFn;
  el.toast.hidden = true;
  toastUndoFn = null;
  if (fn) { fn(); showToast("元に戻しました"); }
});

el.imageSheetClose.addEventListener("click", closeImageSheet);
el.imageSheet.addEventListener("click", (e) => { if (e.target === el.imageSheet) closeImageSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.imageSheet.hidden) closeImageSheet(); });

if ("IntersectionObserver" in window) {
  new IntersectionObserver((entries) => {
    resultVisible = entries[0].isIntersecting;
    updateSummaryBar();
  }, { rootMargin: "0px 0px -30% 0px" }).observe(el.resultSection);
}

/* ---------- 起動 ---------- */
loadData();
syncFormToMembers(true);
renderAll();
