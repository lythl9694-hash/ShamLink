(function () {
  const mode = document.body.dataset.mode;
  let state = { viewer: null, agencies: [] };
  let activeAgency = null;

  async function api(path) {
    const response = await fetch(path, {
      headers: { Accept: "application/json" },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "تعذر تحميل البيانات.");
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function roleName(role) {
    return (
      {
        agent: "وكيل",
        super_admin: "مساعد صاحب المنصة",
        deputy_agent: "نائب الوكيل",
        assistant_deputy: "مساعد نائب الوكيل",
        employee: "موظف",
      }[role] || role
    );
  }

  function stat(label, value) {
    return (
      '<div class="stat"><span>' +
      escapeHtml(label) +
      "</span><strong>" +
      Number(value || 0) +
      "</strong></div>"
    );
  }

  function renderLevel(agency) {
    const details = agency.levelPrivate;
    return (
      '<div class="level-card"><div class="level-number">Level ' +
      escapeHtml(agency.level) +
      "</div>" +
      (details
        ? '<div class="progress-track"><span style="width:' +
          Number(details.progress || 0) +
          '%"></span></div><div class="level-private">التقدم: ' +
          Number(details.progress || 0) +
          "% · إجمالي أرباح العمولات: $" +
          Number(details.profitUsd || 0).toFixed(2) +
          (details.max
            ? " · الحد الأقصى"
            : " · المتبقي للمستوى التالي: $" +
              Number(details.remainingUsd || 0).toFixed(2)) +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function renderStats(agency) {
    const element = document.getElementById("stats");
    if (!element) return;
    if (mode === "owner" && !agency) {
      element.innerHTML =
        stat("الوكالات", state.agencies.length) +
        stat(
          "الموظفون",
          state.agencies.reduce((sum, item) => sum + item.employees.length, 0),
        ) +
        stat(
          "الحوالات المرتبطة",
          state.agencies.reduce((sum, item) => sum + item.counts.total, 0),
        ) +
        stat(
          "الحوالات المسلّمة",
          state.agencies.reduce((sum, item) => sum + item.counts.delivered, 0),
        );
      return;
    }
    element.innerHTML = agency
      ? stat("الموظفون", agency.employees.length) +
        stat("الحوالات الصادرة", agency.counts.outgoing) +
        stat("الحوالات الواردة", agency.counts.incoming) +
        stat("الحوالات المسلّمة", agency.counts.delivered)
      : stat("الوكالات", 0);
  }

  function renderAgencyProfile(agency) {
    const title = document.getElementById("activeAgency");
    if (title)
      title.textContent = agency
        ? agency.name + " — " + agency.id
        : "لا توجد وكالة مفعّلة";
    const profile = document.getElementById("agencyProfile");
    if (!profile) return;
    profile.innerHTML = agency
      ? '<div class="agency-identity"><div class="agent-mark">وكيل</div><div><h2>' +
        escapeHtml(agency.name) +
        '</h2><div class="badge">' +
        escapeHtml(agency.id) +
        "</div><p>" +
        escapeHtml(agency.badge) +
        "</p></div></div>" +
        renderLevel(agency)
      : '<p class="empty">لا توجد وكالة مرتبطة بهذا الحساب.</p>';
  }

  function renderAgencies() {
    const list = document.getElementById("agencyList");
    if (!list) return;
    list.innerHTML = state.agencies.length
      ? state.agencies
          .map(
            (agency) =>
              '<article class="employee-card"><div class="agent-mark small">وكيل</div><h3>' +
              escapeHtml(agency.name) +
              '</h3><div class="meta"><span class="badge">' +
              escapeHtml(agency.id) +
              "</span><br>Level " +
              escapeHtml(agency.level) +
              "<br>الموظفون: " +
              agency.employees.length +
              "<br>الحوالات: " +
              agency.counts.total +
              '</div><a class="open-agency" href="agent-dashboard.html?agency=' +
              encodeURIComponent(agency.id) +
              '">فتح ملف الوكالة</a></article>',
          )
          .join("")
      : '<p class="empty">لا توجد وكالات مفعّلة بعد.</p>';
  }

  function visibleEmployees() {
    return mode === "owner"
      ? state.agencies.flatMap((agency) =>
          agency.employees.map((employee) => ({ ...employee, agency })),
        )
      : (activeAgency?.employees || []).map((employee) => ({
          ...employee,
          agency: activeAgency,
        }));
  }

  function renderEmployees(query = "") {
    const list = document.getElementById("employeeList");
    if (!list) return;
    const text = String(query).trim().toLowerCase();
    const employees = visibleEmployees().filter(
      (employee) =>
        !text ||
        String(employee.name).toLowerCase().includes(text) ||
        String(employee.id).toLowerCase().includes(text) ||
        String(employee.phone).includes(text),
    );
    list.innerHTML = employees.length
      ? employees
          .map(
            (employee) =>
              '<article class="employee-card"><h3>' +
              escapeHtml(employee.name) +
              '</h3><div class="meta"><span class="badge">' +
              escapeHtml(employee.id) +
              "</span><br>" +
              escapeHtml(roleName(employee.role)) +
              " · " +
              escapeHtml(employee.phone) +
              "<br>" +
              escapeHtml(employee.agency.name) +
              '</div><button type="button" data-employee-id="' +
              escapeHtml(employee.id) +
              '">فتح سجل الموظف</button></article>',
          )
          .join("")
      : '<p class="empty">لا يوجد موظف مطابق للبحث.</p>';
  }

  function transferCard(transfer, action) {
    return (
      '<article class="transfer-card"><h4>حوالة رقم ' +
      escapeHtml(transfer.transfer_number) +
      '</h4><div class="meta">' +
      action +
      "<br>المستلم: " +
      escapeHtml(transfer.receiver_name) +
      "<br>المبلغ: " +
      escapeHtml(transfer.amount) +
      " " +
      escapeHtml(transfer.currency) +
      "<br>الوجهة: " +
      escapeHtml(transfer.destination_name) +
      "<br>الحالة: " +
      escapeHtml(transfer.status) +
      "<br>التاريخ: " +
      escapeHtml(
        new Date(transfer.delivered_at || transfer.created_at).toLocaleString(
          "ar",
        ),
      ) +
      "</div></article>"
    );
  }

  async function openEmployee(employeeId) {
    const detail = document.getElementById("employeeDetail");
    detail.classList.add("visible");
    detail.innerHTML = '<p class="empty">جارٍ تحميل سجل الموظف…</p>';
    try {
      const data = await api(
        "/api/employees/" + encodeURIComponent(employeeId) + "/transfers",
      );
      detail.innerHTML =
        '<div class="detail-header"><div><h2>' +
        escapeHtml(data.employee.name) +
        '</h2><div class="meta"><span class="badge">' +
        escapeHtml(data.employee.id) +
        "</span> · " +
        escapeHtml(data.employee.phone) +
        " · " +
        escapeHtml(roleName(data.employee.role)) +
        '</div></div><button type="button" id="closeDetail">إغلاق الملف</button></div><div class="stats" style="margin-top:18px">' +
        stat("أنشأ حوالات", data.created.length) +
        stat("سلّم حوالات", data.delivered.length) +
        '</div><div class="two-columns"><section><h3>الحوالات التي أنشأها</h3><div class="transfer-list">' +
        (data.created.length
          ? data.created.map((item) => transferCard(item, "إنشاء")).join("")
          : '<p class="empty">لا توجد حوالات منشأة.</p>') +
        '</div></section><section><h3>الحوالات التي سلّمها</h3><div class="transfer-list">' +
        (data.delivered.length
          ? data.delivered.map((item) => transferCard(item, "تسليم")).join("")
          : '<p class="empty">لا توجد حوالات مسلّمة.</p>') +
        "</div></section></div>";
      document.getElementById("closeDetail").onclick = () =>
        detail.classList.remove("visible");
      detail.scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      detail.innerHTML =
        '<p class="empty">' + escapeHtml(error.message) + "</p>";
    }
  }

  async function start() {
    try {
      state = await api("/api/dashboard");
      if (mode === "agent") {
        const requested = new URLSearchParams(location.search).get("agency");
        activeAgency =
          state.agencies.find((agency) => agency.id === requested) ||
          state.agencies[0] ||
          null;
        renderAgencyProfile(activeAgency);
      }
      renderStats(activeAgency);
      renderAgencies();
      renderEmployees();
    } catch (error) {
      document.getElementById("stats").innerHTML =
        '<p class="empty">' + escapeHtml(error.message) + "</p>";
    }
  }

  document
    .getElementById("employeeSearch")
    ?.addEventListener("input", (event) => renderEmployees(event.target.value));
  document
    .getElementById("employeeList")
    ?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-employee-id]");
      if (button) openEmployee(button.dataset.employeeId);
    });
  start();
})();
