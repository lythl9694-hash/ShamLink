(function () {
  const mode = document.body.dataset.mode;
  const transfers = JSON.parse(
    localStorage.getItem("shamlink_transfers") || "[]",
  );
  const savedAgencies = JSON.parse(
    localStorage.getItem("shamlink_agency_profiles") || "{}",
  );
  const savedEmployees = JSON.parse(
    localStorage.getItem("shamlink_employee_profiles") || "{}",
  );

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildAgencies() {
    const agencies = { ...savedAgencies };
    transfers.forEach(function (transfer) {
      if (transfer.sourceAgencyId) {
        agencies[transfer.sourceAgencyId] = {
          id: transfer.sourceAgencyId,
          name: transfer.source,
        };
      }
    });
    return Object.values(agencies);
  }

  function buildEmployees() {
    const employees = { ...savedEmployees };
    transfers.forEach(function (transfer) {
      if (transfer.creatorEmployeeId) {
        employees[transfer.creatorEmployeeId] = {
          ...(employees[transfer.creatorEmployeeId] || {}),
          id: transfer.creatorEmployeeId,
          name: transfer.createdBy || "غير مسجل",
          phone: transfer.createdByPhone || "",
          agencyId: transfer.sourceAgencyId || "",
        };
      }
      if (transfer.employeeId) {
        employees[transfer.employeeId] = {
          ...(employees[transfer.employeeId] || {}),
          id: transfer.employeeId,
          name: transfer.deliveredBy || "غير مسجل",
        };
      }
    });
    return Object.values(employees);
  }

  const agencies = buildAgencies();
  const employees = buildEmployees();
  let activeAgencyId = "";

  function agencyById(id) {
    return agencies.find((agency) => agency.id === id);
  }

  function transfersForAgency(agencyId) {
    const agency = agencyById(agencyId);
    if (!agency) return [];
    return transfers.filter(
      (transfer) =>
        transfer.sourceAgencyId === agencyId ||
        normalize(transfer.destination) === normalize(agency.name),
    );
  }

  function employeesForAgency(agencyId) {
    const relatedTransfers = transfersForAgency(agencyId);
    const ids = new Set();
    employees.forEach(function (employee) {
      if (employee.agencyId === agencyId) ids.add(employee.id);
    });
    relatedTransfers.forEach(function (transfer) {
      if (transfer.sourceAgencyId === agencyId && transfer.creatorEmployeeId) {
        ids.add(transfer.creatorEmployeeId);
      }
      const agency = agencyById(agencyId);
      if (
        agency &&
        normalize(transfer.destination) === normalize(agency.name) &&
        transfer.employeeId
      ) {
        ids.add(transfer.employeeId);
      }
    });
    return employees.filter((employee) => ids.has(employee.id));
  }

  function currentEmployees() {
    return mode === "agent" ? employeesForAgency(activeAgencyId) : employees;
  }

  function currentTransfers() {
    return mode === "agent" ? transfersForAgency(activeAgencyId) : transfers;
  }

  function renderStats() {
    const visibleTransfers = currentTransfers();
    const visibleEmployees = currentEmployees();
    const outgoing =
      mode === "agent"
        ? visibleTransfers.filter(
            (item) => item.sourceAgencyId === activeAgencyId,
          )
        : visibleTransfers;
    const delivered = visibleTransfers.filter(
      (item) => item.status === "تم التسليم",
    );
    document.getElementById("stats").innerHTML =
      '<div class="stat"><span>الوكالات</span><strong>' +
      (mode === "agent" ? (activeAgencyId ? 1 : 0) : agencies.length) +
      '</strong></div><div class="stat"><span>الموظفون</span><strong>' +
      visibleEmployees.length +
      '</strong></div><div class="stat"><span>الحوالات الصادرة</span><strong>' +
      outgoing.length +
      '</strong></div><div class="stat"><span>الحوالات المسلّمة</span><strong>' +
      delivered.length +
      "</strong></div>";
  }

  function renderAgencies() {
    const section = document.getElementById("agenciesSection");
    if (!section) return;
    const list = document.getElementById("agencyList");
    if (!agencies.length) {
      list.innerHTML = '<p class="empty">لا توجد وكالات مسجلة بعد.</p>';
      return;
    }
    list.innerHTML = agencies
      .map(function (agency) {
        const agencyTransfers = transfersForAgency(agency.id);
        return (
          '<article class="employee-card"><h3>' +
          escapeHtml(agency.name) +
          '</h3><div class="meta">المعرّف: <span class="badge">' +
          escapeHtml(agency.id) +
          "</span><br>عدد الموظفين: " +
          employeesForAgency(agency.id).length +
          "<br>الحوالات المرتبطة: " +
          agencyTransfers.length +
          '</div><a href="agent-dashboard.html?agency=' +
          encodeURIComponent(agency.id) +
          '" class="home-link" style="display:block;background:#07875f;text-align:center;margin-top:10px">فتح لوحة الوكالة</a></article>'
        );
      })
      .join("");
  }

  function renderEmployees(query) {
    const text = normalize(query);
    const filtered = currentEmployees().filter(
      (employee) =>
        !text ||
        normalize(employee.name).includes(text) ||
        normalize(employee.id).includes(text) ||
        normalize(employee.phone).includes(text),
    );
    const list = document.getElementById("employeeList");
    if (!filtered.length) {
      list.innerHTML = '<p class="empty">لا يوجد موظف مطابق للبحث.</p>';
      return;
    }
    list.innerHTML = filtered
      .map(function (employee) {
        const agency = agencyById(employee.agencyId);
        return (
          '<article class="employee-card"><h3>' +
          escapeHtml(employee.name || "غير مسجل") +
          '</h3><div class="meta"><span class="badge">' +
          escapeHtml(employee.id) +
          "</span><br>الجوال: " +
          escapeHtml(employee.phone || "غير مسجل") +
          "<br>الوكالة: " +
          escapeHtml(agency?.name || "غير محددة") +
          '</div><button type="button" data-employee-id="' +
          escapeHtml(employee.id) +
          '">فتح سجل الموظف</button></article>'
        );
      })
      .join("");
  }

  function transferCard(transfer, action) {
    return (
      '<article class="transfer-card"><h4>حوالة رقم ' +
      escapeHtml(transfer.code) +
      '</h4><div class="meta">' +
      action +
      "<br>من: " +
      escapeHtml(transfer.source) +
      " — إلى: " +
      escapeHtml(transfer.destination) +
      "<br>المستلم: " +
      escapeHtml(transfer.receiver) +
      "<br>المبلغ: " +
      escapeHtml(transfer.amount) +
      " " +
      escapeHtml(transfer.currency) +
      "<br>الحالة: " +
      escapeHtml(transfer.status || "قيد الانتظار") +
      "<br>التاريخ: " +
      escapeHtml(action === "تسليم" ? transfer.deliveredAt : transfer.date) +
      "</div></article>"
    );
  }

  function openEmployee(employeeId) {
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) return;
    const created = transfers.filter(
      (transfer) => transfer.creatorEmployeeId === employeeId,
    );
    const delivered = transfers.filter(
      (transfer) => transfer.employeeId === employeeId,
    );
    const agency = agencyById(employee.agencyId);
    document.getElementById("employeeDetail").innerHTML =
      '<div class="detail-header"><div><h2>' +
      escapeHtml(employee.name || "ملف الموظف") +
      '</h2><div class="meta"><span class="badge">' +
      escapeHtml(employee.id) +
      "</span> · " +
      escapeHtml(employee.phone || "رقم غير مسجل") +
      " · " +
      escapeHtml(agency?.name || "وكالة غير محددة") +
      '</div></div><button type="button" id="closeDetail">إغلاق الملف</button></div>' +
      '<div class="stats" style="margin-top:18px"><div class="stat"><span>أنشأ حوالات</span><strong>' +
      created.length +
      '</strong></div><div class="stat"><span>سلّم حوالات</span><strong>' +
      delivered.length +
      '</strong></div></div><div class="two-columns"><section><h3>الحوالات التي أنشأها</h3><div class="transfer-list">' +
      (created.length
        ? created.map((item) => transferCard(item, "إنشاء")).join("")
        : '<p class="empty">لا توجد حوالات منشأة.</p>') +
      '</div></section><section><h3>الحوالات التي سلّمها</h3><div class="transfer-list">' +
      (delivered.length
        ? delivered.map((item) => transferCard(item, "تسليم")).join("")
        : '<p class="empty">لا توجد حوالات مسلّمة.</p>') +
      "</div></section></div>";
    document.getElementById("employeeDetail").classList.add("visible");
    document
      .getElementById("employeeDetail")
      .scrollIntoView({ behavior: "smooth" });
    document.getElementById("closeDetail").onclick = function () {
      document.getElementById("employeeDetail").classList.remove("visible");
    };
  }

  function chooseAgency(id) {
    activeAgencyId = id;
    const agency = agencyById(id);
    const title = document.getElementById("activeAgency");
    title.textContent = agency
      ? agency.name + " — " + agency.id
      : "اختر الوكالة لعرض بياناتها";
    if (agency) {
      localStorage.setItem("shamlink_active_agency_id", agency.id);
      const url = new URL(window.location.href);
      url.searchParams.set("agency", agency.id);
      history.replaceState({}, "", url);
    }
    renderStats();
    renderEmployees(document.getElementById("employeeSearch").value);
  }

  if (mode === "agent") {
    const picker = document.getElementById("agencyPicker");
    picker.innerHTML =
      '<option value="">اختر معرف الوكالة</option>' +
      agencies
        .map(
          (agency) =>
            '<option value="' +
            escapeHtml(agency.id) +
            '">' +
            escapeHtml(agency.name) +
            " — " +
            escapeHtml(agency.id) +
            "</option>",
        )
        .join("");
    picker.addEventListener("change", () => chooseAgency(picker.value));
    const requested =
      new URLSearchParams(window.location.search).get("agency") ||
      localStorage.getItem("shamlink_active_agency_id") ||
      "";
    if (agencyById(requested)) {
      picker.value = requested;
      chooseAgency(requested);
    }
  }

  document
    .getElementById("employeeSearch")
    .addEventListener("input", (event) => {
      renderEmployees(event.target.value);
    });
  document.getElementById("employeeList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-employee-id]");
    if (button) openEmployee(button.dataset.employeeId);
  });

  renderAgencies();
  renderStats();
  renderEmployees("");
})();
