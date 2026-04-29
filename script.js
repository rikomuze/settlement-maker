const STORAGE_KEY = "oshiSettlementMaker_v1";

let members = [];
let payments = [];

const memberNameInput = document.getElementById("memberName");
const addMemberBtn = document.getElementById("addMemberBtn");
const memberList = document.getElementById("memberList");

const itemNameInput = document.getElementById("itemName");
const itemAmountInput = document.getElementById("itemAmount");
const customItemNameWrap = document.getElementById("customItemNameWrap");
const customItemNameInput = document.getElementById("customItemName");
const payerSelect = document.getElementById("payerSelect");
const targetCheckboxes = document.getElementById("targetCheckboxes");
const addPaymentBtn = document.getElementById("addPaymentBtn");
const paymentList = document.getElementById("paymentList");
const splitModeRadios = document.querySelectorAll("input[name='splitMode']");
const equalTargetArea = document.getElementById("equalTargetArea");
const individualAmountArea = document.getElementById("individualAmountArea");
const individualAmountInputs = document.getElementById("individualAmountInputs");
const resultBox = document.getElementById("resultBox");
const copyBtn = document.getElementById("copyBtn");
const downloadImageBtn = document.getElementById("downloadImageBtn");
const resetBtn = document.getElementById("resetBtn");

function saveData() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      members,
      payments,
    })
  );
}

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);
    members = Array.isArray(parsed.members) ? parsed.members : [];
    payments = Array.isArray(parsed.payments) ? parsed.payments : [];
  } catch {
    members = [];
    payments = [];
  }
}

function formatYen(amount) {
  return `${Math.round(amount).toLocaleString()}円`;
}

function renderMembers() {
  memberList.innerHTML = "";

  members.forEach((member, index) => {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.className = "member-name";
    span.textContent = member;

    const button = document.createElement("button");
    button.className = "delete-btn";
    button.type = "button";
    button.textContent = "削除";
    button.addEventListener("click", () => {
      const deletedMember = members[index];
      members.splice(index, 1);

      payments = payments.filter((payment) => payment.payer !== deletedMember);
      payments = payments.map((payment) => ({
        ...payment,
        targets: payment.targets.filter((target) => target !== deletedMember),
      })).filter((payment) => payment.targets.length > 0);

      saveData();
      renderAll();
    });

    li.appendChild(span);
    li.appendChild(button);
    memberList.appendChild(li);
  });
}

function renderPayerOptions() {
  payerSelect.innerHTML = "";

  if (members.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "先に参加者を追加してください";
    payerSelect.appendChild(option);
    return;
  }

  members.forEach((member) => {
    const option = document.createElement("option");
    option.value = member;
    option.textContent = member;
    payerSelect.appendChild(option);
  });
}

function renderTargetCheckboxes() {
  targetCheckboxes.innerHTML = "";

  members.forEach((member) => {
    const label = document.createElement("label");
    label.className = "checkbox-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = member;
    checkbox.checked = true;

    const span = document.createElement("span");
    span.textContent = member;

    label.appendChild(checkbox);
    label.appendChild(span);
    targetCheckboxes.appendChild(label);
  });
}

function renderPayments() {
  paymentList.innerHTML = "";

  if (payments.length === 0) {
    const li = document.createElement("li");
    li.textContent = "まだ支払いは追加されていません。";
    paymentList.appendChild(li);
    return;
  }

  payments.forEach((payment, index) => {
    const li = document.createElement("li");

    const text = document.createElement("span");
    text.className = "payment-text";
    if (payment.splitMode === "individual") {
  const detailText = payment.individualAmounts
    .map((item) => `${item.member}${formatYen(item.amount)}`)
    .join("・");

  text.textContent =
    `${payment.name}：${formatYen(payment.amount)} / ` +
    `支払い：${payment.payer} / ` +
    `個別：${detailText}`;
} else {
  text.textContent =
    `${payment.name}：${formatYen(payment.amount)} / ` +
    `支払い：${payment.payer} / ` +
    `対象：${payment.targets.join("・")}`;
}

    const button = document.createElement("button");
    button.className = "delete-btn";
    button.type = "button";
    button.textContent = "削除";
    button.addEventListener("click", () => {
      payments.splice(index, 1);
      saveData();
      renderAll();
    });

    li.appendChild(text);
    li.appendChild(button);
    paymentList.appendChild(li);
  });
}

function calculateSettlement() {
  const balances = {};

  members.forEach((member) => {
    balances[member] = 0;
  });

payments.forEach((payment) => {
  balances[payment.payer] += payment.amount;

  if (payment.splitMode === "individual") {
    payment.individualAmounts.forEach((item) => {
      balances[item.member] -= item.amount;
    });
  } else {
    const share = payment.amount / payment.targets.length;

    payment.targets.forEach((target) => {
      balances[target] -= share;
    });
  }
});

  const creditors = [];
  const debtors = [];

  Object.entries(balances).forEach(([name, balance]) => {
    const rounded = Math.round(balance);

    if (rounded > 0) {
      creditors.push({ name, amount: rounded });
    } else if (rounded < 0) {
      debtors.push({ name, amount: Math.abs(rounded) });
    }
  });

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > 0) {
      settlements.push({
        from: debtor.name,
        to: creditor.name,
        amount,
      });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount === 0) i++;
    if (creditor.amount === 0) j++;
  }

  return settlements;
}
function calculateBreakdown() {
  const breakdown = {};

  members.forEach((member) => {
    breakdown[member] = {
      total: 0,
      items: [],
    };
  });

  payments.forEach((payment) => {
    if (payment.splitMode === "individual") {
      payment.individualAmounts.forEach((item) => {
        breakdown[item.member].total += item.amount;
        breakdown[item.member].items.push({
          name: payment.name,
          amount: item.amount,
          note: "個別入力",
        });
      });
    } else {
      const share = payment.amount / payment.targets.length;
      const roundedShare = Math.round(share);

      payment.targets.forEach((target) => {
        breakdown[target].total += roundedShare;
        breakdown[target].items.push({
          name: payment.name,
          amount: roundedShare,
          note: `${payment.targets.length}人で均等割り`,
        });
      });
    }
  });

  Object.keys(breakdown).forEach((member) => {
    breakdown[member].total = breakdown[member].items.reduce(
      (sum, item) => sum + item.amount,
      0
    );
  });

  return breakdown;
}


function createCopyText(settlements) {
  const breakdown = calculateBreakdown();

  const lines = ["今回の精算まとめです！", ""];

  lines.push("【精算結果】");

  if (settlements.length === 0) {
    lines.push("精算はありません。");
  } else {
    settlements.forEach((item) => {
      lines.push(`${item.from} → ${item.to}：${formatYen(item.amount)}`);
    });
  }

  lines.push("");
  lines.push("【各自の負担内訳】");

  members.forEach((member) => {
    lines.push("");
    lines.push(`${member}：合計 ${formatYen(breakdown[member].total)}`);

    if (breakdown[member].items.length === 0) {
      lines.push("・対象の支払いはありません");
    } else {
      breakdown[member].items.forEach((item) => {
        lines.push(`・${item.name}：${formatYen(item.amount)}（${item.note}）`);
      });
    }
  });

  lines.push("");
  lines.push("確認お願いします！");

  return lines.join("\n");
}
function renderResult() {
  const settlements = calculateSettlement();
  const breakdown = calculateBreakdown();

  if (members.length === 0 || payments.length === 0) {
    resultBox.className = "result-box empty";
    resultBox.textContent = "まだ精算結果はありません。";
    return;
  }

  resultBox.className = "result-box";
  resultBox.innerHTML = "";

  const settlementTitle = document.createElement("div");
  settlementTitle.className = "result-section-title";
  settlementTitle.textContent = "精算結果";
  resultBox.appendChild(settlementTitle);

  if (settlements.length === 0) {
    const noSettlement = document.createElement("div");
    noSettlement.className = "result-line";
    noSettlement.textContent = "精算はありません。全員の支払いバランスが取れています。";
    resultBox.appendChild(noSettlement);
  } else {
    settlements.forEach((item) => {
      const div = document.createElement("div");
      div.className = "result-line";
      div.textContent = `${item.from} → ${item.to}：${formatYen(item.amount)}`;
      resultBox.appendChild(div);
    });
  }

  const breakdownTitle = document.createElement("div");
  breakdownTitle.className = "result-section-title detail-title";
  breakdownTitle.textContent = "各自の負担内訳";
  resultBox.appendChild(breakdownTitle);

  members.forEach((member) => {
    const memberBlock = document.createElement("div");
    memberBlock.className = "breakdown-block";

    const memberTitle = document.createElement("div");
    memberTitle.className = "breakdown-member";
    memberTitle.textContent = `${member}：合計 ${formatYen(breakdown[member].total)}`;
    memberBlock.appendChild(memberTitle);

    if (breakdown[member].items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "breakdown-item";
      empty.textContent = "・対象の支払いはありません";
      memberBlock.appendChild(empty);
    } else {
      breakdown[member].items.forEach((item) => {
        const itemLine = document.createElement("div");
        itemLine.className = "breakdown-item";
        itemLine.textContent = `・${item.name}：${formatYen(item.amount)}（${item.note}）`;
        memberBlock.appendChild(itemLine);
      });
    }

    resultBox.appendChild(memberBlock);
  });
}
function addMember() {
  const name = memberNameInput.value.trim();

  if (!name) {
    alert("参加者の名前を入力してください。");
    return;
  }

  if (members.includes(name)) {
    alert("同じ名前の参加者がいます。");
    return;
  }

  members.push(name);
  memberNameInput.value = "";

  saveData();
  renderAll();
}

function addPayment() {
  const selectedItemName = itemNameInput.value;
const customItemName = customItemNameInput.value.trim();
const name = selectedItemName === "その他" ? customItemName : selectedItemName;
  const amount = Number(itemAmountInput.value);
  const payer = payerSelect.value;
  const splitMode = getSplitMode();

  if (members.length === 0) {
    alert("先に参加者を追加してください。");
    return;
  }

  if (!name) {
    alert("項目名を入力してください。");
    return;
  }

  if (!amount || amount <= 0) {
    alert("金額を入力してください。");
    return;
  }

  if (!payer) {
    alert("支払った人を選んでください。");
    return;
  }

  if (splitMode === "equal") {
    const targets = Array.from(
      targetCheckboxes.querySelectorAll("input[type='checkbox']:checked")
    ).map((checkbox) => checkbox.value);

    if (targets.length === 0) {
      alert("対象者を1人以上選んでください。");
      return;
    }

    payments.push({
      name,
      amount,
      payer,
      splitMode: "equal",
      targets,
    });
  }

  if (splitMode === "individual") {
    const individualAmounts = Array.from(
      individualAmountInputs.querySelectorAll("input[type='number']")
    )
      .map((input) => ({
        member: input.dataset.member,
        amount: Number(input.value),
      }))
      .filter((item) => item.amount > 0);

    if (individualAmounts.length === 0) {
      alert("個別金額を1人以上入力してください。");
      return;
    }

    const totalIndividualAmount = individualAmounts.reduce(
      (sum, item) => sum + item.amount,
      0
    );

    if (totalIndividualAmount !== amount) {
      alert(
        `個別金額の合計が支払い金額と一致していません。\n` +
        `支払い金額：${formatYen(amount)}\n` +
        `個別合計：${formatYen(totalIndividualAmount)}`
      );
      return;
    }

    payments.push({
      name,
      amount,
      payer,
      splitMode: "individual",
      individualAmounts,
      targets: individualAmounts.map((item) => item.member),
    });
  }

  itemNameInput.value = "チケット代";
  itemAmountInput.value = "";
customItemNameInput.value = "";
toggleCustomItemName();
  individualAmountInputs
    .querySelectorAll("input[type='number']")
    .forEach((input) => {
      input.value = "";
    });

  saveData();
  renderAll();
}

async function copyResult() {
  const settlements = calculateSettlement();
  const text = createCopyText(settlements);

  try {
    await navigator.clipboard.writeText(text);
    alert("コピーしました！");
  } catch {
    alert("コピーできませんでした。結果を手動でコピーしてください。");
  }
}

function resetAll() {
  const ok = confirm("入力内容をすべてリセットしますか？");

  if (!ok) return;

  members = [];
  payments = [];
  localStorage.removeItem(STORAGE_KEY);
  renderAll();
}
async function downloadResultImage() {
  if (payments.length === 0) {
    alert("先に支払いを追加してください。");
    return;
  }

  const canvas = await html2canvas(resultBox, {
    backgroundColor: "#fffaf5",
    scale: 2,
  });

  const link = document.createElement("a");
  link.download = "oshi-settlement-result.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function renderAll() {
  renderMembers();
  renderPayerOptions();
  renderTargetCheckboxes();
  renderIndividualAmountInputs();
  toggleSplitMode();
  toggleCustomItemName();
  renderPayments();
  renderResult();
}
function getSplitMode() {
  const checked = document.querySelector("input[name='splitMode']:checked");
  return checked ? checked.value : "equal";
}

function renderIndividualAmountInputs() {
  individualAmountInputs.innerHTML = "";

  members.forEach((member) => {
    const row = document.createElement("div");
    row.className = "individual-row";

    const name = document.createElement("span");
    name.textContent = member;

    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.placeholder = "例：7200";
    input.dataset.member = member;

    row.appendChild(name);
    row.appendChild(input);
    individualAmountInputs.appendChild(row);
  });
}

function toggleSplitMode() {
  const mode = getSplitMode();

  if (mode === "equal") {
    equalTargetArea.classList.remove("hidden");
    individualAmountArea.classList.add("hidden");
  } else {
    equalTargetArea.classList.add("hidden");
    individualAmountArea.classList.remove("hidden");
  }
}
function toggleCustomItemName() {
  if (itemNameInput.value === "その他") {
    customItemNameWrap.classList.remove("hidden");
  } else {
    customItemNameWrap.classList.add("hidden");
    customItemNameInput.value = "";
  }
}
addMemberBtn.addEventListener("click", addMember);
addPaymentBtn.addEventListener("click", addPayment);
copyBtn.addEventListener("click", copyResult);
downloadImageBtn.addEventListener("click", downloadResultImage);
resetBtn.addEventListener("click", resetAll);
splitModeRadios.forEach((radio) => {
  radio.addEventListener("change", toggleSplitMode);
});
itemNameInput.addEventListener("change", toggleCustomItemName);

loadData();
renderAll();