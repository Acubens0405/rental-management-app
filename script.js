console.log("Rental app script loaded");

(function () {
  "use strict";

  var TAB_EVENT_GUARD_MS = 450;
  var lastTabEventAt = 0;
  var lastTabTarget = "";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function initTabs() {
    try {
      var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-tab-target]"));
      var panels = Array.prototype.slice.call(document.querySelectorAll("[data-tab-panel]"));

      if (!buttons.length || !panels.length) {
        return;
      }

      function showTab(targetId) {
        if (!targetId) {
          return;
        }

        panels.forEach(function (panel) {
          panel.hidden = panel.id !== targetId;
        });

        buttons.forEach(function (button) {
          var isActive = button.getAttribute("data-tab-target") === targetId;
          button.classList.toggle("active", isActive);
          button.setAttribute("aria-selected", isActive ? "true" : "false");
        });
      }

      function handleTabEvent(event) {
        var button = event.currentTarget;
        var targetId = button.getAttribute("data-tab-target");
        var now = Date.now();

        if (lastTabTarget === targetId && now - lastTabEventAt < TAB_EVENT_GUARD_MS) {
          event.preventDefault();
          return;
        }

        lastTabTarget = targetId;
        lastTabEventAt = now;
        event.preventDefault();
        showTab(targetId);
      }

      buttons.forEach(function (button) {
        ["click", "touchend", "pointerup"].forEach(function (eventName) {
          button.addEventListener(eventName, handleTabEvent, { passive: false });
        });
      });

      var activeButton = document.querySelector("[data-tab-target].active") || buttons[0];
      showTab(activeButton.getAttribute("data-tab-target"));
      window.rentalAppShowTab = showTab;
    } catch (error) {
      console.error("Tab initialization failed", error);
    }
  }

  ready(initTabs);
})();

(function () {
  "use strict";

  var STORAGE_KEY = "welfareRentalMvp.v1";
  var activeStatuses = ["契約中", "返却予定", "点検中"];
  var defaultProducts = [
    { id: createId(), name: "楽歩ベーシック", category: "車いす", price: 10000, stock: 5 },
    { id: createId(), name: "emigoⅢ", category: "車いす", price: 10000, stock: 5 },
    { id: createId(), name: "neoNOPPO", category: "歩行車", price: 10000, stock: 5 },
    { id: createId(), name: "KC01", category: "電動車いす", price: 20000, stock: 3 },
    { id: createId(), name: "電動楽歩", category: "電動車いす", price: 40000, stock: 2 }
  ];

  var state = loadState();

  function createId() {
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function yen(value) {
    return Number(value || 0).toLocaleString("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }
    return value.replace(/-/g, "/");
  }

  function todayIso() {
    return toLocalIso(new Date());
  }

  function addDaysIso(days) {
    var date = new Date();
    date.setDate(date.getDate() + days);
    return toLocalIso(date);
  }

  function toLocalIso(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.products)) {
        return {
          products: saved.products,
          customers: saved.customers || [],
          dealers: saved.dealers || [],
          contracts: saved.contracts || []
        };
      }
    } catch (error) {
      console.error("Failed to load localStorage data", error);
    }

    return {
      products: defaultProducts,
      customers: [
        { id: createId(), name: "山田 太郎", phone: "090-0000-0000", address: "大阪府大阪市", memo: "デモ顧客" }
      ],
      dealers: [
        { id: createId(), name: "福祉用具ショップA", contact: "佐藤様", phone: "06-0000-0000", memo: "評価中" }
      ],
      contracts: []
    };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Failed to save localStorage data", error);
      alert("ブラウザ保存に失敗しました。空き容量やプライベートモードをご確認ください。");
    }
  }

  function byId(collection, id) {
    return state[collection].find(function (item) {
      return item.id === id;
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char];
    });
  }

  function getInput(id) {
    return document.getElementById(id);
  }

  function setValue(id, value) {
    var input = getInput(id);
    if (input) {
      input.value = value == null ? "" : value;
    }
  }

  function isActiveContract(contract) {
    return activeStatuses.indexOf(contract.status) !== -1;
  }

  function productRentedQuantity(productId) {
    return state.contracts.reduce(function (sum, contract) {
      if (contract.productId === productId && isActiveContract(contract)) {
        return sum + Number(contract.quantity || 0);
      }
      return sum;
    }, 0);
  }

  function contractMonthlyRevenue(contract) {
    var product = byId("products", contract.productId);
    if (!product || !isActiveContract(contract)) {
      return 0;
    }
    return Number(product.price || 0) * Number(contract.quantity || 1);
  }

  function statusClass(status) {
    if (status === "返却予定") {
      return "status return";
    }
    if (status === "返却済み") {
      return "status done";
    }
    if (status === "点検中") {
      return "status inspect";
    }
    return "status";
  }

  function renderEmpty(message) {
    return '<div class="empty-state">' + escapeHtml(message) + "</div>";
  }

  function renderActions(collection, id) {
    return '<div class="row-actions">' +
      '<button class="small-button" type="button" data-edit="' + collection + '" data-id="' + id + '">編集</button>' +
      '<button class="small-button danger" type="button" data-delete="' + collection + '" data-id="' + id + '">削除</button>' +
      "</div>";
  }

  function renderDashboard() {
    var activeContracts = state.contracts.filter(isActiveContract);
    var rented = activeContracts.reduce(function (sum, contract) {
      return sum + Number(contract.quantity || 0);
    }, 0);
    var totalStock = state.products.reduce(function (sum, product) {
      return sum + Number(product.stock || 0);
    }, 0);
    var monthly = activeContracts.reduce(function (sum, contract) {
      return sum + contractMonthlyRevenue(contract);
    }, 0);
    var returnAlerts = getReturnAlerts();
    var inspectionAlerts = getInspectionAlerts();

    getInput("dashboardKpis").innerHTML = [
      kpi("現在の契約件数", activeContracts.length + "件", "契約中・返却予定・点検中"),
      kpi("貸出中台数", rented + "台", "稼働しているレンタル台数"),
      kpi("空き在庫台数", Math.max(totalStock - rented, 0) + "台", "保有台数から貸出中を差引"),
      kpi("月額売上見込み", yen(monthly), "年間 " + yen(monthly * 12)),
      kpi("年間売上見込み", yen(monthly * 12), "月額売上見込みの12か月換算"),
      kpi("商品数", state.products.length + "件", "登録済み商品"),
      kpi("返却予定件数", returnAlerts.length + "件", "7日以内または期限超過"),
      kpi("点検予定件数", inspectionAlerts.length + "件", "返却済み・点検中")
    ].join("");

    getInput("productRevenueCards").innerHTML = state.products.map(function (product) {
      var rentedQty = productRentedQuantity(product.id);
      var revenue = rentedQty * Number(product.price || 0);
      return '<article class="mini-card"><strong>' + escapeHtml(product.name) + '</strong>' +
        '<span>' + rentedQty + '台稼働 / 月額 ' + yen(revenue) + '</span></article>';
    }).join("") || renderEmpty("商品がありません。");

    getInput("dashboardAlerts").innerHTML = [
      '<article class="mini-card"><strong>返却予定</strong><span>' + returnAlerts.length + '件を確認してください。</span></article>',
      '<article class="mini-card"><strong>点検予定</strong><span>' + inspectionAlerts.length + '件を確認してください。</span></article>'
    ].join("");
  }

  function kpi(label, value, note) {
    return '<article class="kpi-card"><div class="kpi-label">' + escapeHtml(label) + '</div>' +
      '<div class="kpi-value">' + escapeHtml(value) + '</div>' +
      '<div class="kpi-note">' + escapeHtml(note) + '</div></article>';
  }

  function renderProducts() {
    getInput("productList").innerHTML = state.products.map(function (product) {
      var rented = productRentedQuantity(product.id);
      var free = Math.max(Number(product.stock || 0) - rented, 0);
      return '<article class="list-card">' +
        '<div><div class="list-title">' + escapeHtml(product.name) + '</div><div class="list-meta">' + escapeHtml(product.category) + '</div></div>' +
        '<div><strong>' + yen(product.price) + '</strong><div class="list-meta">月額</div></div>' +
        '<div><strong>' + Number(product.stock || 0) + '台</strong><div class="list-meta">保有</div></div>' +
        '<div><strong>' + free + '台</strong><div class="list-meta">空き</div></div>' +
        renderActions("products", product.id) +
        '</article>';
    }).join("") || renderEmpty("商品を登録してください。");
  }

  function renderCustomers() {
    getInput("customerList").innerHTML = state.customers.map(function (customer) {
      return '<article class="list-card">' +
        '<div><div class="list-title">' + escapeHtml(customer.name) + '</div><div class="list-meta">' + escapeHtml(customer.memo || "") + '</div></div>' +
        '<div><strong>' + escapeHtml(customer.phone || "-") + '</strong><div class="list-meta">電話</div></div>' +
        '<div class="list-meta">' + escapeHtml(customer.address || "-") + '</div>' +
        '<div></div>' +
        renderActions("customers", customer.id) +
        '</article>';
    }).join("") || renderEmpty("顧客を登録してください。");
  }

  function renderDealers() {
    getInput("dealerList").innerHTML = state.dealers.map(function (dealer) {
      return '<article class="list-card">' +
        '<div><div class="list-title">' + escapeHtml(dealer.name) + '</div><div class="list-meta">' + escapeHtml(dealer.memo || "") + '</div></div>' +
        '<div><strong>' + escapeHtml(dealer.contact || "-") + '</strong><div class="list-meta">担当者</div></div>' +
        '<div><strong>' + escapeHtml(dealer.phone || "-") + '</strong><div class="list-meta">電話</div></div>' +
        '<div></div>' +
        renderActions("dealers", dealer.id) +
        '</article>';
    }).join("") || renderEmpty("販売店を登録してください。");
  }

  function renderContracts() {
    getInput("contractList").innerHTML = state.contracts.map(function (contract) {
      var product = byId("products", contract.productId);
      var customer = byId("customers", contract.customerId);
      var dealer = byId("dealers", contract.dealerId);
      return '<article class="list-card two-actions">' +
        '<div><div class="list-title">' + escapeHtml(product ? product.name : "商品未設定") + '</div><div class="list-meta">' + escapeHtml(customer ? customer.name : "顧客未設定") + ' / ' + escapeHtml(dealer ? dealer.name : "販売店未設定") + '</div></div>' +
        '<div><strong>' + formatDate(contract.startDate) + '</strong><div class="list-meta">開始日</div></div>' +
        '<div><strong>' + formatDate(contract.plannedEndDate) + '</strong><div class="list-meta">終了予定</div></div>' +
        '<div><strong>' + Number(contract.quantity || 1) + '台</strong><div class="list-meta">' + yen(contractMonthlyRevenue(contract)) + '</div></div>' +
        '<div><span class="' + statusClass(contract.status) + '">' + escapeHtml(contract.status) + '</span></div>' +
        renderActions("contracts", contract.id) +
        '</article>';
    }).join("") || renderEmpty("契約を登録してください。");
  }

  function renderBilling() {
    var rows = state.contracts.filter(isActiveContract);
    var monthly = rows.reduce(function (sum, contract) {
      return sum + contractMonthlyRevenue(contract);
    }, 0);
    getInput("billingSummary").textContent = "月額売上見込み " + yen(monthly) + " / 年間 " + yen(monthly * 12);
    getInput("billingList").innerHTML = rows.map(function (contract) {
      var product = byId("products", contract.productId);
      var customer = byId("customers", contract.customerId);
      var dealer = byId("dealers", contract.dealerId);
      return '<article class="list-card">' +
        '<div><div class="list-title">' + escapeHtml(customer ? customer.name : "-") + '</div><div class="list-meta">' + escapeHtml(dealer ? dealer.name : "-") + '</div></div>' +
        '<div><strong>' + escapeHtml(product ? product.name : "-") + '</strong><div class="list-meta">商品</div></div>' +
        '<div><strong>' + Number(contract.quantity || 1) + '台</strong><div class="list-meta">台数</div></div>' +
        '<div><strong>' + yen(contractMonthlyRevenue(contract)) + '</strong><div class="list-meta">月額</div></div>' +
        '<div><span class="' + statusClass(contract.status) + '">' + escapeHtml(contract.status) + '</span></div>' +
        '</article>';
    }).join("") || renderEmpty("請求対象の契約がありません。");
  }

  function getReturnAlerts() {
    var limit = addDaysIso(7);
    return state.contracts.filter(function (contract) {
      return contract.plannedEndDate && contract.status !== "返却済み" && contract.plannedEndDate <= limit;
    }).sort(function (a, b) {
      return a.plannedEndDate.localeCompare(b.plannedEndDate);
    });
  }

  function getInspectionAlerts() {
    return state.contracts.filter(function (contract) {
      return contract.status === "返却済み" || contract.status === "点検中";
    }).sort(function (a, b) {
      return String(a.returnDate || a.plannedEndDate).localeCompare(String(b.returnDate || b.plannedEndDate));
    });
  }

  function renderSchedule() {
    getInput("returnAlertList").innerHTML = renderScheduleRows(getReturnAlerts(), "返却予定");
    getInput("inspectionAlertList").innerHTML = renderScheduleRows(getInspectionAlerts(), "点検予定");
  }

  function renderScheduleRows(rows, type) {
    if (!rows.length) {
      return renderEmpty(type + "はありません。");
    }
    return rows.map(function (contract) {
      var product = byId("products", contract.productId);
      var customer = byId("customers", contract.customerId);
      return '<article class="list-card">' +
        '<div><div class="list-title">' + escapeHtml(customer ? customer.name : "-") + '</div><div class="list-meta">' + escapeHtml(product ? product.name : "-") + '</div></div>' +
        '<div><strong>' + formatDate(contract.plannedEndDate) + '</strong><div class="list-meta">終了予定</div></div>' +
        '<div><strong>' + formatDate(contract.returnDate) + '</strong><div class="list-meta">返却日</div></div>' +
        '<div><span class="' + statusClass(contract.status) + '">' + escapeHtml(contract.status) + '</span></div>' +
        '<div class="row-actions"><button class="small-button" type="button" data-edit="contracts" data-id="' + contract.id + '">契約確認</button></div>' +
        '</article>';
    }).join("");
  }

  function renderSelects() {
    fillSelect("contractProduct", state.products, "商品を選択", function (item) {
      return item.name + " / " + yen(item.price);
    });
    fillSelect("contractCustomer", state.customers, "顧客を選択", function (item) {
      return item.name;
    });
    fillSelect("contractDealer", state.dealers, "販売店を選択", function (item) {
      return item.name;
    });
  }

  function fillSelect(id, items, placeholder, labeler) {
    var select = getInput(id);
    if (!select) {
      return;
    }
    var current = select.value;
    select.innerHTML = '<option value="">' + escapeHtml(placeholder) + '</option>' + items.map(function (item) {
      return '<option value="' + item.id + '">' + escapeHtml(labeler(item)) + '</option>';
    }).join("");
    select.value = items.some(function (item) { return item.id === current; }) ? current : "";
  }

  function renderAll() {
    renderSelects();
    renderDashboard();
    renderProducts();
    renderCustomers();
    renderDealers();
    renderContracts();
    renderBilling();
    renderSchedule();
  }

  function resetForm(formId) {
    var form = getInput(formId);
    if (form) {
      form.reset();
      Array.prototype.slice.call(form.querySelectorAll('input[type="hidden"]')).forEach(function (input) {
        input.value = "";
      });
    }
  }

  function upsert(collection, item) {
    var index = state[collection].findIndex(function (existing) {
      return existing.id === item.id;
    });
    if (index >= 0) {
      state[collection][index] = item;
    } else {
      state[collection].push(item);
    }
    saveState();
    renderAll();
  }

  function deleteItem(collection, id) {
    if (!confirm("このデータを削除しますか？")) {
      return;
    }
    state[collection] = state[collection].filter(function (item) {
      return item.id !== id;
    });
    if (collection === "products") {
      state.contracts = state.contracts.filter(function (contract) { return contract.productId !== id; });
    }
    if (collection === "customers") {
      state.contracts = state.contracts.filter(function (contract) { return contract.customerId !== id; });
    }
    if (collection === "dealers") {
      state.contracts = state.contracts.filter(function (contract) { return contract.dealerId !== id; });
    }
    saveState();
    renderAll();
  }

  function editItem(collection, id) {
    var item = byId(collection, id);
    if (!item) {
      return;
    }
    if (collection === "products") {
      setValue("productId", item.id);
      setValue("productName", item.name);
      setValue("productCategory", item.category);
      setValue("productPrice", item.price);
      setValue("productStock", item.stock);
      safeShowTab("products");
    }
    if (collection === "customers") {
      setValue("customerId", item.id);
      setValue("customerName", item.name);
      setValue("customerPhone", item.phone);
      setValue("customerAddress", item.address);
      setValue("customerMemo", item.memo);
      safeShowTab("customers");
    }
    if (collection === "dealers") {
      setValue("dealerId", item.id);
      setValue("dealerName", item.name);
      setValue("dealerContact", item.contact);
      setValue("dealerPhone", item.phone);
      setValue("dealerMemo", item.memo);
      safeShowTab("dealers");
    }
    if (collection === "contracts") {
      setValue("contractId", item.id);
      setValue("contractProduct", item.productId);
      setValue("contractCustomer", item.customerId);
      setValue("contractDealer", item.dealerId);
      setValue("contractStart", item.startDate);
      setValue("contractEndPlan", item.plannedEndDate);
      setValue("contractReturn", item.returnDate);
      setValue("contractQuantity", item.quantity);
      setValue("contractStatus", item.status);
      setValue("contractMemo", item.memo);
      safeShowTab("contracts");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function safeShowTab(id) {
    if (typeof window.rentalAppShowTab === "function") {
      window.rentalAppShowTab(id);
    }
  }

  function bindForms() {
    getInput("productForm").addEventListener("submit", function (event) {
      event.preventDefault();
      upsert("products", {
        id: getInput("productId").value || createId(),
        name: getInput("productName").value.trim(),
        category: getInput("productCategory").value.trim(),
        price: Number(getInput("productPrice").value || 0),
        stock: Number(getInput("productStock").value || 0)
      });
      resetForm("productForm");
    });

    getInput("customerForm").addEventListener("submit", function (event) {
      event.preventDefault();
      upsert("customers", {
        id: getInput("customerId").value || createId(),
        name: getInput("customerName").value.trim(),
        phone: getInput("customerPhone").value.trim(),
        address: getInput("customerAddress").value.trim(),
        memo: getInput("customerMemo").value.trim()
      });
      resetForm("customerForm");
    });

    getInput("dealerForm").addEventListener("submit", function (event) {
      event.preventDefault();
      upsert("dealers", {
        id: getInput("dealerId").value || createId(),
        name: getInput("dealerName").value.trim(),
        contact: getInput("dealerContact").value.trim(),
        phone: getInput("dealerPhone").value.trim(),
        memo: getInput("dealerMemo").value.trim()
      });
      resetForm("dealerForm");
    });

    getInput("contractForm").addEventListener("submit", function (event) {
      event.preventDefault();
      upsert("contracts", {
        id: getInput("contractId").value || createId(),
        productId: getInput("contractProduct").value,
        customerId: getInput("contractCustomer").value,
        dealerId: getInput("contractDealer").value,
        startDate: getInput("contractStart").value,
        plannedEndDate: getInput("contractEndPlan").value,
        returnDate: getInput("contractReturn").value,
        quantity: Number(getInput("contractQuantity").value || 1),
        status: getInput("contractStatus").value,
        memo: getInput("contractMemo").value.trim()
      });
      resetForm("contractForm");
      setValue("contractQuantity", 1);
    });
  }

  function bindButtons() {
    [
      ["clearProductForm", "productForm"],
      ["clearCustomerForm", "customerForm"],
      ["clearDealerForm", "dealerForm"],
      ["clearContractForm", "contractForm"]
    ].forEach(function (pair) {
      getInput(pair[0]).addEventListener("click", function () {
        resetForm(pair[1]);
        if (pair[1] === "contractForm") {
          setValue("contractQuantity", 1);
        }
      });
    });

    document.body.addEventListener("click", function (event) {
      var editButton = event.target.closest("[data-edit]");
      var deleteButton = event.target.closest("[data-delete]");
      var exportButton = event.target.closest("[data-export]");

      if (editButton) {
        editItem(editButton.getAttribute("data-edit"), editButton.getAttribute("data-id"));
      }
      if (deleteButton) {
        deleteItem(deleteButton.getAttribute("data-delete"), deleteButton.getAttribute("data-id"));
      }
      if (exportButton) {
        exportCsv(exportButton.getAttribute("data-export"));
      }
    });

    getInput("exportAllCsv").addEventListener("click", function () {
      exportCsv("all");
    });

    getInput("resetDemoData").addEventListener("click", function () {
      if (!confirm("保存済みデータを初期デモ状態に戻しますか？")) {
        return;
      }
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      renderAll();
    });
  }

  function exportCsv(type) {
    var rows = buildCsvRows(type);
    var csv = rows.map(function (row) {
      return row.map(csvCell).join(",");
    }).join("\n");
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "rental-" + type + "-" + todayIso() + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    var text = String(value == null ? "" : value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function buildCsvRows(type) {
    if (type === "products") {
      return [["商品名", "カテゴリ", "月額", "保有台数", "貸出中", "空き"]].concat(state.products.map(function (product) {
        var rented = productRentedQuantity(product.id);
        return [product.name, product.category, product.price, product.stock, rented, Math.max(Number(product.stock || 0) - rented, 0)];
      }));
    }
    if (type === "customers") {
      return [["顧客名", "電話番号", "住所", "メモ"]].concat(state.customers.map(function (customer) {
        return [customer.name, customer.phone, customer.address, customer.memo];
      }));
    }
    if (type === "dealers") {
      return [["販売店名", "担当者", "電話番号", "メモ"]].concat(state.dealers.map(function (dealer) {
        return [dealer.name, dealer.contact, dealer.phone, dealer.memo];
      }));
    }
    if (type === "contracts" || type === "billing") {
      return [["商品", "顧客", "販売店", "開始日", "終了予定日", "返却日", "台数", "ステータス", "月額", "メモ"]].concat(state.contracts.map(function (contract) {
        var product = byId("products", contract.productId);
        var customer = byId("customers", contract.customerId);
        var dealer = byId("dealers", contract.dealerId);
        return [
          product ? product.name : "",
          customer ? customer.name : "",
          dealer ? dealer.name : "",
          contract.startDate,
          contract.plannedEndDate,
          contract.returnDate,
          contract.quantity,
          contract.status,
          contractMonthlyRevenue(contract),
          contract.memo
        ];
      }));
    }
    return [["種別", "件数"], ["商品", state.products.length], ["顧客", state.customers.length], ["販売店", state.dealers.length], ["契約", state.contracts.length]];
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    try {
      bindForms();
      bindButtons();
      setValue("contractStart", todayIso());
      setValue("contractEndPlan", addDaysIso(30));
      renderAll();
    } catch (error) {
      console.error("App initialization failed", error);
    }
  });
})();
