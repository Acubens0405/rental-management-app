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
        var exists = panels.some(function (panel) {
          return panel.id === targetId;
        });
        if (!targetId || !exists) {
          targetId = "dashboard";
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
  var SUPABASE_CONFIG_KEY = "welfareRentalSupabase.v1";
  var SUPABASE_PROJECT_URL = "https://fdsrgfxvjtqlbcisgdxu.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_LCZ7zuoMtS9UMFQHWxONPQ_fUeRFaSW";
  var CLOUD_TABLES = {
    products: "rental_products",
    dealers: "rental_dealers",
    contracts: "rental_contracts"
  };
  var supabaseClient = null;
  var realtimeChannel = null;
  var cloudEnabled = false;
  var cloudReady = false;
  var applyingRemoteChange = false;
  var activeStatuses = ["契約中", "返却予定", "点検中"];
  var PRODUCT_CATALOG = [
    { serial: "see01-000001", name: "楽歩ベーシック", category: "車いす", price: 10000, cost: 80000, stock: 1 },
    { serial: "see02-000046", name: "emigoⅢ", category: "車いす", price: 10000, cost: 85000, stock: 1 },
    { serial: "neo-000001", name: "neoNOPPO", category: "歩行車", price: 10000, cost: 70000, stock: 1 },
    { serial: "KC01-000012", name: "KC01", category: "電動車いす", price: 20000, cost: 180000, stock: 1 },
    { serial: "eraku-000001", name: "電動楽歩", category: "電動車いす", price: 40000, cost: 280000, stock: 1 }
  ];
  var defaultProducts = PRODUCT_CATALOG.map(function (product) {
    return {
      id: createId(),
      serial: product.serial,
      name: product.name,
      category: product.category,
      price: product.price,
      cost: product.cost,
      stock: product.stock
    };
  });

  var state = loadState();

  function createId() {
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function yen(value) {
    return Number(value || 0).toLocaleString("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
  }

  function productLabel(product) {
    if (!product) {
      return "-";
    }
    return product.name + "／" + product.category;
  }

  function productFullLabel(product) {
    if (!product) {
      return "-";
    }
    return (product.serial ? product.serial + " / " : "") + productLabel(product);
  }

  function productCatalogValue(product) {
    return product.name + "||" + product.category;
  }

  function parseProductSelection(value) {
    var parts = String(value || "").split("||");
    return {
      name: parts[0] || "",
      category: parts[1] || ""
    };
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

  function parseIsoDate(value) {
    if (!value) {
      return null;
    }
    var date = new Date(value + "T00:00:00");
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), daysInMonth(date.getFullYear(), date.getMonth()));
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function inclusiveDays(start, end) {
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  }

  function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function currentBillingMonth() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  }

  function billingMonthLabel(value) {
    var parts = String(value || "").split("-");
    if (parts.length !== 2) {
      return value || "-";
    }
    return parts[0] + "年" + Number(parts[1]) + "月";
  }

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.products)) {
        return {
          products: saved.products.map(normalizeProduct),
          dealers: (saved.dealers || []).map(normalizeDealer),
          contracts: (saved.contracts || []).map(normalizeContract)
        };
      }
    } catch (error) {
      console.error("Failed to load localStorage data", error);
    }

    return {
      products: defaultProducts,
      dealers: [
        { id: createId(), name: "デモ販売店", contact: "佐藤様", phone: "06-0000-0000", address: "大阪府大阪市中央区", memo: "評価中" }
      ],
      contracts: []
    };
  }

  function normalizeProduct(product) {
    return {
      id: product.id || createId(),
      serial: product.serial || "",
      name: product.name || "",
      category: product.category || "",
      price: Number(product.price || 0),
      cost: Number(product.cost || 0),
      stock: Number(product.stock || 0)
    };
  }

  function normalizeDealer(dealer) {
    return {
      id: dealer.id || createId(),
      name: dealer.name || "",
      contact: dealer.contact || "",
      phone: dealer.phone || "",
      address: dealer.address || "",
      memo: dealer.memo || ""
    };
  }

  function normalizeContract(contract) {
    return {
      id: contract.id || createId(),
      productId: contract.productId || "",
      dealerId: contract.dealerId || "",
      startDate: contract.startDate || "",
      plannedEndDate: contract.plannedEndDate || "",
      returnDate: contract.returnDate || "",
      quantity: Number(contract.quantity || 1),
      status: contract.status || "契約中",
      memo: contract.memo || ""
    };
  }

  function productToRow(product) {
    return {
      id: product.id,
      serial: product.serial,
      name: product.name,
      category: product.category,
      price: Number(product.price || 0),
      cost: Number(product.cost || 0),
      stock: Number(product.stock || 0),
      updated_at: new Date().toISOString()
    };
  }

  function dealerToRow(dealer) {
    return {
      id: dealer.id,
      name: dealer.name,
      contact: dealer.contact,
      phone: dealer.phone,
      address: dealer.address,
      memo: dealer.memo,
      updated_at: new Date().toISOString()
    };
  }

  function contractToRow(contract) {
    return {
      id: contract.id,
      product_id: contract.productId,
      dealer_id: contract.dealerId,
      start_date: contract.startDate || null,
      planned_end_date: contract.plannedEndDate || null,
      return_date: contract.returnDate || null,
      quantity: Number(contract.quantity || 1),
      status: contract.status,
      memo: contract.memo,
      updated_at: new Date().toISOString()
    };
  }

  function rowToProduct(row) {
    return normalizeProduct({
      id: row.id,
      serial: row.serial,
      name: row.name,
      category: row.category,
      price: row.price,
      cost: row.cost,
      stock: row.stock
    });
  }

  function rowToDealer(row) {
    return normalizeDealer({
      id: row.id,
      name: row.name,
      contact: row.contact,
      phone: row.phone,
      address: row.address,
      memo: row.memo
    });
  }

  function rowToContract(row) {
    return normalizeContract({
      id: row.id,
      productId: row.product_id,
      dealerId: row.dealer_id,
      startDate: row.start_date,
      plannedEndDate: row.planned_end_date,
      returnDate: row.return_date,
      quantity: row.quantity,
      status: row.status,
      memo: row.memo
    });
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Failed to save localStorage data", error);
      alert("ブラウザ保存に失敗しました。空き容量やプライベートモードをご確認ください。");
    }
  }

  function loadCloudConfig() {
    try {
      var saved = JSON.parse(localStorage.getItem(SUPABASE_CONFIG_KEY) || "null") || {};
      return {
        url: saved.url || SUPABASE_PROJECT_URL,
        anonKey: saved.anonKey || SUPABASE_ANON_KEY
      };
    } catch (error) {
      console.error("Failed to load Supabase settings", error);
      return {
        url: SUPABASE_PROJECT_URL,
        anonKey: SUPABASE_ANON_KEY
      };
    }
  }

  function saveCloudConfig(config) {
    localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(config));
  }

  function clearCloudConfig() {
    localStorage.removeItem(SUPABASE_CONFIG_KEY);
  }

  function setCloudStatus(message) {
    var status = getInput("cloudStatus");
    if (status) {
      status.textContent = message;
    }
  }

  function createSupabaseClient(config) {
    if (!config.url || !config.anonKey || !window.supabase || !window.supabase.createClient) {
      return null;
    }
    return window.supabase.createClient(config.url, config.anonKey);
  }

  async function initCloudStorage() {
    var config = loadCloudConfig();
    setValue("supabaseUrl", config.url || "");
    setValue("supabaseAnonKey", config.anonKey || "");
    supabaseClient = createSupabaseClient(config);
    cloudEnabled = Boolean(supabaseClient);
    if (!cloudEnabled) {
      setCloudStatus("未設定：この端末のブラウザ内に保存中");
      return;
    }
    setCloudStatus("Supabase接続中...");
    try {
      await loadStateFromCloud();
      subscribeCloudChanges();
      cloudReady = true;
      setCloudStatus("クラウド同期中：他端末の更新も自動反映されます");
    } catch (error) {
      console.error("Supabase connection failed", error);
      cloudEnabled = false;
      setCloudStatus("Supabase接続エラー：URL、anon key、テーブル設定を確認してください");
    }
  }

  async function loadStateFromCloud() {
    var productsResult = await supabaseClient.from(CLOUD_TABLES.products).select("*").order("created_at", { ascending: true });
    var dealersResult = await supabaseClient.from(CLOUD_TABLES.dealers).select("*").order("created_at", { ascending: true });
    var contractsResult = await supabaseClient.from(CLOUD_TABLES.contracts).select("*").order("created_at", { ascending: true });
    if (productsResult.error || dealersResult.error || contractsResult.error) {
      throw productsResult.error || dealersResult.error || contractsResult.error;
    }
    var cloudProducts = (productsResult.data || []).map(rowToProduct);
    state = {
      products: cloudProducts.length ? cloudProducts : state.products,
      dealers: (dealersResult.data || []).map(rowToDealer),
      contracts: (contractsResult.data || []).map(rowToContract)
    };
    if (!cloudProducts.length) {
      await syncLocalToCloud();
    }
    saveState();
    renderAll();
  }

  function subscribeCloudChanges() {
    if (!supabaseClient) {
      return;
    }
    if (realtimeChannel) {
      supabaseClient.removeChannel(realtimeChannel);
    }
    realtimeChannel = supabaseClient
      .channel("rental-management-live")
      .on("postgres_changes", { event: "*", schema: "public", table: CLOUD_TABLES.products }, reloadFromCloudSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: CLOUD_TABLES.dealers }, reloadFromCloudSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: CLOUD_TABLES.contracts }, reloadFromCloudSoon)
      .subscribe();
  }

  function reloadFromCloudSoon() {
    if (applyingRemoteChange || !cloudEnabled) {
      return;
    }
    applyingRemoteChange = true;
    setTimeout(async function () {
      try {
        await loadStateFromCloud();
        setCloudStatus("クラウド同期中：最新データに更新しました");
      } catch (error) {
        console.error("Supabase realtime reload failed", error);
        setCloudStatus("クラウド再読込エラー：通信状態を確認してください");
      } finally {
        applyingRemoteChange = false;
      }
    }, 300);
  }

  async function upsertCloudItem(collection, item) {
    if (!cloudEnabled || !supabaseClient) {
      return;
    }
    var table = CLOUD_TABLES[collection];
    var row = collection === "products" ? productToRow(item) : collection === "dealers" ? dealerToRow(item) : contractToRow(item);
    var result = await supabaseClient.from(table).upsert(row);
    if (result.error) {
      throw result.error;
    }
  }

  async function deleteCloudItem(collection, id) {
    if (!cloudEnabled || !supabaseClient) {
      return;
    }
    var result = await supabaseClient.from(CLOUD_TABLES[collection]).delete().eq("id", id);
    if (result.error) {
      throw result.error;
    }
  }

  async function syncLocalToCloud() {
    if (!cloudEnabled || !supabaseClient) {
      setCloudStatus("Supabase未設定：同期設定を保存してください");
      return;
    }
    try {
      if (state.products.length) {
        await supabaseClient.from(CLOUD_TABLES.products).upsert(state.products.map(productToRow));
      }
      if (state.dealers.length) {
        await supabaseClient.from(CLOUD_TABLES.dealers).upsert(state.dealers.map(dealerToRow));
      }
      if (state.contracts.length) {
        await supabaseClient.from(CLOUD_TABLES.contracts).upsert(state.contracts.map(contractToRow));
      }
      setCloudStatus("クラウド同期中：現在データを送信しました");
    } catch (error) {
      console.error("Supabase sync failed", error);
      setCloudStatus("クラウド送信エラー：Supabase設定を確認してください");
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

  function monthlyAmount(contract) {
    var product = byId("products", contract.productId);
    return product ? Number(product.price || 0) * Number(contract.quantity || 1) : 0;
  }

  function proratedAmountForRange(contract, rangeStart, rangeEnd) {
    var amount = monthlyAmount(contract);
    if (!amount || !rangeStart || !rangeEnd || rangeEnd < rangeStart) {
      return 0;
    }
    var monthDays = daysInMonth(rangeStart.getFullYear(), rangeStart.getMonth());
    var usedDays = inclusiveDays(rangeStart, rangeEnd);
    var fullMonth = rangeStart.getDate() === 1 && rangeEnd.getDate() === monthDays;
    return fullMonth ? amount : Math.round(amount / monthDays * usedDays);
  }

  function contractPlannedRevenue(contract) {
    var start = parseIsoDate(contract.startDate);
    var end = parseIsoDate(contract.plannedEndDate);
    if (!start || !end || end < start) {
      return 0;
    }
    var total = 0;
    var cursor = startOfMonth(start);
    while (cursor <= end) {
      var monthStart = startOfMonth(cursor);
      var monthEnd = endOfMonth(cursor);
      var usageStart = start > monthStart ? start : monthStart;
      var usageEnd = end < monthEnd ? end : monthEnd;
      total += proratedAmountForRange(contract, usageStart, usageEnd);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return total;
  }

  function contractInvoiceDetail(contract) {
    var product = byId("products", contract.productId);
    var start = parseIsoDate(contract.startDate);
    var end = parseIsoDate(contract.plannedEndDate);
    var targetStart = startOfMonth(new Date());
    var targetEnd = endOfMonth(targetStart);
    var detail = {
      targetMonth: currentBillingMonth(),
      monthly: product ? Number(product.price || 0) * Number(contract.quantity || 1) : 0,
      daily: 0,
      invoice: 0,
      isProrated: false
    };
    if (!product || !start || !end || end < targetStart || start > targetEnd || !isActiveContract(contract)) {
      return detail;
    }
    var usageStart = start > targetStart ? start : targetStart;
    var usageEnd = end < targetEnd ? end : targetEnd;
    detail.isProrated = !(usageStart.getDate() === 1 && usageEnd.getDate() === daysInMonth(usageStart.getFullYear(), usageStart.getMonth()));
    detail.daily = proratedAmountForRange(contract, usageStart, usageEnd);
    detail.invoice = detail.isProrated ? detail.daily : detail.monthly;
    return detail;
  }

  function dealerForContract(contract) {
    return byId("dealers", contract.dealerId);
  }

  function productRevenueStats(product) {
    var cumulative = state.contracts.reduce(function (sum, contract) {
      return contract.productId === product.id ? sum + contractPlannedRevenue(contract) : sum;
    }, 0);
    var cost = Number(product.cost || 0);
    var rate = cost ? Math.round(cumulative / cost * 100) : 0;
    return {
      cumulative: cumulative,
      rate: rate,
      recovered: cost > 0 && cumulative >= cost,
      profit: cumulative - cost
    };
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
    var planned = activeContracts.reduce(function (sum, contract) {
      return sum + contractPlannedRevenue(contract);
    }, 0);
    var invoiceThisMonth = activeContracts.reduce(function (sum, contract) {
      return sum + contractInvoiceDetail(contract).invoice;
    }, 0);
    var productStats = state.products.map(function (product) {
      return { product: product, stats: productRevenueStats(product) };
    });
    var recoveredCount = productStats.filter(function (item) { return item.stats.recovered; }).length;
    var unrecoveredCount = productStats.filter(function (item) { return !item.stats.recovered; }).length;
    var returnAlerts = getReturnAlerts();
    var inspectionAlerts = getInspectionAlerts();

    getInput("dashboardKpis").innerHTML = [
      kpi("現在の契約件数", activeContracts.length + "件", "契約中・返却予定・点検中"),
      kpi("貸出中台数", rented + "台", "稼働しているレンタル台数"),
      kpi("空き在庫台数", Math.max(totalStock - rented, 0) + "台", "保有台数から貸出中を差引"),
      kpi("今月の請求予定額", yen(invoiceThisMonth), currentBillingMonth() + " 請求額合計"),
      kpi("月額ストック売上", yen(monthly), "契約中商品の月額満額合計"),
      kpi("予定総売上", yen(planned), "終了予定日までの予定金額合計"),
      kpi("原価回収済み件数", recoveredCount + "件", "品番別の累計売上で判定"),
      kpi("未回収件数", unrecoveredCount + "件", "原価未達の商品"),
      kpi("年間ストック換算", yen(monthly * 12), "月額ストック売上の12か月換算"),
      kpi("商品数", state.products.length + "件", "登録済み商品"),
      kpi("返却予定件数", returnAlerts.length + "件", "7日以内または期限超過"),
      kpi("点検予定件数", inspectionAlerts.length + "件", "返却済み・点検中")
    ].join("");

    getInput("productRevenueCards").innerHTML = state.products.map(function (product) {
      var rentedQty = productRentedQuantity(product.id);
      var revenue = rentedQty * Number(product.price || 0);
      return '<article class="mini-card"><strong>' + escapeHtml(productFullLabel(product)) + '</strong>' +
        '<span>' + rentedQty + '台稼働 / 月額 ' + yen(revenue) + '</span></article>';
    }).join("") || renderEmpty("商品がありません。");

    getInput("serialRecoveryCards").innerHTML = productStats.map(function (item) {
      return '<article class="mini-card"><strong>' + escapeHtml(productFullLabel(item.product)) + '</strong>' +
        '<span>原価 ' + yen(item.product.cost) + ' / 累計 ' + yen(item.stats.cumulative) + ' / 回収率 ' + item.stats.rate + '% / ' + (item.stats.recovered ? '原価回収済み' : '未回収') + '</span></article>';
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
      var stats = productRevenueStats(product);
      return '<article class="list-card">' +
        '<div><div class="list-title">' + escapeHtml(productFullLabel(product)) + '</div><div class="list-meta">品番 / 商品名／カテゴリ</div></div>' +
        '<div><strong>' + yen(product.price) + '</strong><div class="list-meta">月額</div></div>' +
        '<div><strong>' + yen(product.cost) + '</strong><div class="list-meta">原価額</div></div>' +
        '<div><strong>' + Number(product.stock || 0) + '台</strong><div class="list-meta">保有</div></div>' +
        '<div><strong>' + free + '台</strong><div class="list-meta">空き / 回収率 ' + stats.rate + '%</div></div>' +
        renderActions("products", product.id) +
        '</article>';
    }).join("") || renderEmpty("商品を登録してください。");
    getInput("productProfitList").innerHTML = state.products.map(function (product) {
      var stats = productRevenueStats(product);
      return '<article class="list-card">' +
        '<div><div class="list-title">' + escapeHtml(productFullLabel(product)) + '</div><div class="list-meta">' + (stats.recovered ? '原価回収済み' : '未回収') + '</div></div>' +
        '<div><strong>' + yen(product.cost) + '</strong><div class="list-meta">原価額</div></div>' +
        '<div><strong>' + yen(stats.cumulative) + '</strong><div class="list-meta">累計レンタル売上</div></div>' +
        '<div><strong>' + stats.rate + '%</strong><div class="list-meta">原価回収率</div></div>' +
        '<div><strong>' + yen(stats.profit) + '</strong><div class="list-meta">利益目安</div></div>' +
        '</article>';
    }).join("") || renderEmpty("商品がありません。");
  }

  function renderDealers() {
    getInput("dealerList").innerHTML = state.dealers.map(function (dealer) {
      return '<article class="list-card">' +
        '<div><div class="list-title">' + escapeHtml(dealer.name) + '</div><div class="list-meta">' + escapeHtml(dealer.memo || "") + '</div></div>' +
        '<div><strong>' + escapeHtml(dealer.contact || "-") + '</strong><div class="list-meta">担当者</div></div>' +
        '<div><strong>' + escapeHtml(dealer.phone || "-") + '</strong><div class="list-meta">電話番号</div></div>' +
        '<div><strong>' + escapeHtml(dealer.address || "-") + '</strong><div class="list-meta">住所</div></div>' +
        renderActions("dealers", dealer.id) +
        '</article>';
    }).join("") || renderEmpty("販売店を登録してください。");
  }

  function renderContracts() {
    getInput("contractList").innerHTML = state.contracts.map(function (contract) {
      var product = byId("products", contract.productId);
      var dealer = dealerForContract(contract);
      var planned = contractPlannedRevenue(contract);
      var invoice = contractInvoiceDetail(contract);
      return '<article class="list-card two-actions">' +
        '<div><div class="list-title">' + escapeHtml(product ? productFullLabel(product) : "商品未設定") + '</div><div class="list-meta">' + escapeHtml(dealer ? dealer.name : "販売店未設定") + ' / 担当者：' + escapeHtml(dealer && dealer.contact ? dealer.contact : "未設定") + '</div></div>' +
        '<div><strong>' + formatDate(contract.startDate) + '</strong><div class="list-meta">開始日</div></div>' +
        '<div><strong>' + formatDate(contract.plannedEndDate) + '</strong><div class="list-meta">終了予定</div></div>' +
        '<div><strong>' + escapeHtml(dealer && dealer.phone ? dealer.phone : "-") + '</strong><div class="list-meta">担当者電話番号</div></div>' +
        '<div><strong>' + yen(invoice.invoice) + '</strong><div class="list-meta">請求額 / 予定 ' + yen(planned) + '</div></div>' +
        '<div><span class="' + statusClass(contract.status) + '">' + escapeHtml(contract.status) + '</span></div>' +
        renderActions("contracts", contract.id) +
        '</article>';
    }).join("") || renderEmpty("契約を登録してください。");
  }

  function renderBilling() {
    var rows = state.contracts.filter(isActiveContract);
    var planned = rows.reduce(function (sum, contract) {
      return sum + contractPlannedRevenue(contract);
    }, 0);
    var invoiceTotal = rows.reduce(function (sum, contract) {
      return sum + contractInvoiceDetail(contract).invoice;
    }, 0);
    getInput("billingSummary").textContent = "今月の請求予定額 " + yen(invoiceTotal) + " / 予定総額 " + yen(planned);
    getInput("billingList").innerHTML = rows.map(function (contract) {
      var product = byId("products", contract.productId);
      var dealer = dealerForContract(contract);
      var plannedRevenue = contractPlannedRevenue(contract);
      var invoice = contractInvoiceDetail(contract);
      return '<article class="list-card">' +
        '<div><div class="list-title">今月の請求予定額：' + yen(invoice.invoice) + '</div><div class="list-meta">請求先：' + escapeHtml(dealer ? dealer.name : "-") + ' / 販売店名：' + escapeHtml(dealer ? dealer.name : "-") + '</div></div>' +
        '<div><strong>' + escapeHtml(dealer && dealer.contact ? dealer.contact : "-") + '</strong><div class="list-meta">担当者 / ' + escapeHtml(dealer && dealer.phone ? dealer.phone : "-") + '</div></div>' +
        '<div><strong>' + escapeHtml(product ? productLabel(product) : "-") + '</strong><div class="list-meta">商品名 / 品番：' + escapeHtml(product && product.serial ? product.serial : "-") + '</div></div>' +
        '<div><strong>' + escapeHtml(billingMonthLabel(invoice.targetMonth)) + '</strong><div class="list-meta">請求対象月</div></div>' +
        '<div><strong>' + formatDate(contract.startDate) + '</strong><div class="list-meta">開始日</div></div>' +
        '<div><strong>' + formatDate(contract.plannedEndDate) + '</strong><div class="list-meta">終了予定日</div></div>' +
        '<div><strong>' + (invoice.isProrated ? 'あり' : 'なし') + '</strong><div class="list-meta">日割り / 月額参考 ' + yen(invoice.monthly) + '</div></div>' +
        '<div><strong>' + yen(plannedRevenue) + '</strong><div class="list-meta">予定総額</div></div>' +
        '<div><span class="' + statusClass(contract.status) + '">' + escapeHtml(contract.status) + '</span></div>' +
        '<div class="list-meta">' + escapeHtml(contract.memo || "") + '</div>' +
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
      var dealer = dealerForContract(contract);
      return '<article class="list-card">' +
        '<div><div class="list-title">' + escapeHtml(dealer ? dealer.name : "-") + '</div><div class="list-meta">担当者：' + escapeHtml(dealer && dealer.contact ? dealer.contact : "-") + ' / ' + escapeHtml(product ? productFullLabel(product) : "-") + '</div></div>' +
        '<div><strong>' + formatDate(contract.plannedEndDate) + '</strong><div class="list-meta">終了予定</div></div>' +
        '<div><strong>' + formatDate(contract.returnDate) + '</strong><div class="list-meta">返却日</div></div>' +
        '<div><span class="' + statusClass(contract.status) + '">' + escapeHtml(contract.status) + '</span></div>' +
        '<div class="row-actions"><button class="small-button" type="button" data-edit="contracts" data-id="' + contract.id + '">契約確認</button></div>' +
        '</article>';
    }).join("");
  }

  function renderSelects() {
    fillProductCatalogSelect();
    fillSelect("contractProduct", state.products, "商品を選択", function (item) {
      return productFullLabel(item) + " / " + yen(item.price);
    });
    fillSelect("contractDealer", state.dealers, "販売店を選択", function (item) {
      return item.name;
    });
    updateContractDealerFields();
  }

  function fillProductCatalogSelect() {
    var select = getInput("productName");
    if (!select) {
      return;
    }
    var current = select.value;
    select.innerHTML = '<option value="">商品名／カテゴリを選択</option>' + PRODUCT_CATALOG.map(function (product) {
      var value = productCatalogValue(product);
      return '<option value="' + escapeHtml(value) + '">' + escapeHtml(productLabel(product)) + '</option>';
    }).join("");
    select.value = PRODUCT_CATALOG.some(function (product) {
      return productCatalogValue(product) === current;
    }) ? current : "";
  }

  function ensureProductCatalogOption(product) {
    var select = getInput("productName");
    if (!select || !product) {
      return;
    }
    var value = productCatalogValue(product);
    var exists = Array.prototype.slice.call(select.options).some(function (option) {
      return option.value === value;
    });
    if (!exists && value !== "||") {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = productLabel(product);
      select.appendChild(option);
    }
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

  function updateContractDealerFields() {
    var dealer = byId("dealers", getInput("contractDealer") ? getInput("contractDealer").value : "");
    setValue("contractContact", dealer && dealer.contact ? dealer.contact : "");
    setValue("contractContactPhone", dealer && dealer.phone ? dealer.phone : "");
  }

  function renderAll() {
    [
      renderSelects,
      renderDashboard,
      renderProducts,
      renderDealers,
      renderContracts,
      renderBilling,
      renderSchedule
    ].forEach(function (renderPart) {
      try {
        renderPart();
      } catch (error) {
        console.error("Render failed", renderPart.name, error);
      }
    });
  }

  function resetForm(formId) {
    var form = getInput(formId);
    if (form) {
      form.reset();
      Array.prototype.slice.call(form.querySelectorAll('input[type="hidden"]')).forEach(function (input) {
        input.value = "";
      });
    }
    if (formId === "productForm") {
      setProductEditMode(null);
    }
  }

  function setProductEditMode(product) {
    var notice = getInput("productEditNotice");
    var button = getInput("productSubmitButton");
    if (notice) {
      if (product) {
        notice.hidden = false;
        notice.textContent = "編集中：" + productFullLabel(product) + "。内容を変更して「更新保存」を押してください。";
      } else {
        notice.hidden = true;
        notice.textContent = "";
      }
    }
    if (button) {
      button.textContent = product ? "更新保存" : "保存";
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
    upsertCloudItem(collection, item).catch(function (error) {
      console.error("Cloud save failed", error);
      setCloudStatus("クラウド保存エラー：通信状態またはSupabase権限を確認してください");
    });
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
    if (collection === "dealers") {
      state.contracts = state.contracts.filter(function (contract) { return contract.dealerId !== id; });
    }
    saveState();
    renderAll();
    deleteCloudItem(collection, id).catch(function (error) {
      console.error("Cloud delete failed", error);
      setCloudStatus("クラウド削除エラー：通信状態またはSupabase権限を確認してください");
    });
  }

  function editItem(collection, id) {
    var item = byId(collection, id);
    var targetFormId = "";
    if (!item) {
      return;
    }
    if (collection === "products") {
      targetFormId = "productForm";
      setValue("productId", item.id);
      setValue("productSerial", item.serial);
      ensureProductCatalogOption(item);
      setValue("productName", productCatalogValue(item));
      setValue("productPrice", item.price);
      setValue("productCost", item.cost);
      setValue("productStock", item.stock);
      setProductEditMode(item);
      safeShowTab("products");
    }
    if (collection === "dealers") {
      targetFormId = "dealerForm";
      setValue("dealerId", item.id);
      setValue("dealerName", item.name);
      setValue("dealerContact", item.contact);
      setValue("dealerPhone", item.phone);
      setValue("dealerAddress", item.address);
      setValue("dealerMemo", item.memo);
      safeShowTab("dealers");
    }
    if (collection === "contracts") {
      targetFormId = "contractForm";
      setValue("contractId", item.id);
      setValue("contractProduct", item.productId);
      setValue("contractDealer", item.dealerId);
      updateContractDealerFields();
      setValue("contractStart", item.startDate);
      setValue("contractEndPlan", item.plannedEndDate);
      setValue("contractReturn", item.returnDate);
      setValue("contractQuantity", item.quantity);
      setValue("contractStatus", item.status);
      setValue("contractMemo", item.memo);
      safeShowTab("contracts");
    }
    scrollToEditForm(targetFormId);
  }

  function safeShowTab(id) {
    if (typeof window.rentalAppShowTab === "function") {
      window.rentalAppShowTab(id);
    }
  }

  function scrollToEditForm(formId) {
    var form = getInput(formId);
    if (!form) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    form.classList.add("editing-form");
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(function () {
      form.classList.remove("editing-form");
    }, 1800);
  }

  function bindForms() {
    getInput("productForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var selectedProduct = parseProductSelection(getInput("productName").value);
      upsert("products", {
        id: getInput("productId").value || createId(),
        serial: getInput("productSerial").value.trim(),
        name: selectedProduct.name,
        category: selectedProduct.category,
        price: Number(getInput("productPrice").value || 0),
        cost: Number(getInput("productCost").value || 0),
        stock: Number(getInput("productStock").value || 0)
      });
      resetForm("productForm");
    });

    getInput("dealerForm").addEventListener("submit", function (event) {
      event.preventDefault();
      upsert("dealers", {
        id: getInput("dealerId").value || createId(),
        name: getInput("dealerName").value.trim(),
        contact: getInput("dealerContact").value.trim(),
        phone: getInput("dealerPhone").value.trim(),
        address: getInput("dealerAddress").value.trim(),
        memo: getInput("dealerMemo").value.trim()
      });
      resetForm("dealerForm");
    });

    getInput("contractForm").addEventListener("submit", function (event) {
      event.preventDefault();
      upsert("contracts", {
        id: getInput("contractId").value || createId(),
        productId: getInput("contractProduct").value,
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

    getInput("resetDemoData").addEventListener("click", async function () {
      if (!confirm("保存済みデータを初期デモ状態に戻しますか？")) {
        return;
      }
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      saveState();
      if (cloudEnabled && supabaseClient) {
        try {
          await supabaseClient.from(CLOUD_TABLES.contracts).delete().neq("id", "");
          await supabaseClient.from(CLOUD_TABLES.dealers).delete().neq("id", "");
          await supabaseClient.from(CLOUD_TABLES.products).delete().neq("id", "");
          await syncLocalToCloud();
        } catch (error) {
          console.error("Cloud reset failed", error);
          setCloudStatus("クラウド初期化エラー：Supabase権限を確認してください");
        }
      }
      renderAll();
    });

    getInput("contractDealer").addEventListener("change", updateContractDealerFields);
    getInput("saveCloudSettings").addEventListener("click", async function () {
      var config = {
        url: getInput("supabaseUrl").value.trim(),
        anonKey: getInput("supabaseAnonKey").value.trim()
      };
      if (!config.url || !config.anonKey) {
        alert("Supabase Project URL と anon public key を入力してください。");
        return;
      }
      saveCloudConfig(config);
      await initCloudStorage();
    });
    getInput("syncLocalToCloud").addEventListener("click", syncLocalToCloud);
    getInput("clearCloudSettings").addEventListener("click", function () {
      clearCloudConfig();
      cloudEnabled = false;
      cloudReady = false;
      supabaseClient = null;
      setValue("supabaseUrl", "");
      setValue("supabaseAnonKey", "");
      setCloudStatus("同期解除：この端末のブラウザ内に保存中");
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
    link.download = (type === "billing" ? "invoice" : "rental-" + type) + "-" + todayIso() + ".csv";
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
      return [["品番", "商品名／カテゴリ", "月額", "原価額", "保有台数", "貸出中", "空き", "累計レンタル売上", "原価回収率", "原価回収状態", "利益目安"]].concat(state.products.map(function (product) {
        var rented = productRentedQuantity(product.id);
        var stats = productRevenueStats(product);
        return [product.serial, productLabel(product), product.price, product.cost, product.stock, rented, Math.max(Number(product.stock || 0) - rented, 0), stats.cumulative, stats.rate + "%", stats.recovered ? "原価回収済み" : "未回収", stats.profit];
      }));
    }
    if (type === "dealers") {
      return [["販売店名", "担当者", "電話番号", "住所", "メモ"]].concat(state.dealers.map(function (dealer) {
        return [dealer.name, dealer.contact, dealer.phone, dealer.address, dealer.memo];
      }));
    }
    if (type === "contracts" || type === "billing") {
      return [["請求先", "販売店名", "担当者", "担当者電話番号", "商品名", "品番", "請求対象月", "開始日", "終了予定日", "日割り有無", "今月の請求予定額", "予定総額", "ステータス", "メモ", "月額金額（参考）"]].concat(state.contracts.map(function (contract) {
        var product = byId("products", contract.productId);
        var dealer = dealerForContract(contract);
        var invoice = contractInvoiceDetail(contract);
        return [
          dealer ? dealer.name : "",
          dealer ? dealer.name : "",
          dealer ? dealer.contact : "",
          dealer ? dealer.phone : "",
          product ? productLabel(product) : "",
          product ? product.serial : "",
          billingMonthLabel(invoice.targetMonth),
          contract.startDate,
          contract.plannedEndDate,
          invoice.isProrated ? "あり" : "なし",
          invoice.invoice,
          contractPlannedRevenue(contract),
          contract.status,
          contract.memo,
          invoice.monthly
        ];
      }));
    }
    return [["種別", "件数"], ["商品", state.products.length], ["販売店", state.dealers.length], ["契約", state.contracts.length]];
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
      initCloudStorage();
    } catch (error) {
      console.error("App initialization failed", error);
    }
  });
})();
