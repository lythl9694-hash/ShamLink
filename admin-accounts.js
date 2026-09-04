(function () {
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "تعذر تنفيذ الطلب.");
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

  const logoutButton = document.getElementById("logoutButton");
  if (logoutButton) {
    logoutButton.addEventListener("click", async function () {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      location.href = "login.html";
    });
  }

  let currentAccount = null;
  api("/api/auth/status")
    .then(function (data) {
      currentAccount = data.user;
      if (currentAccount?.role !== "owner") {
        document.querySelectorAll(".owner-only").forEach((element) => {
          element.hidden = true;
        });
      }
      if (currentAccount?.role !== "agent") {
        document.querySelectorAll(".agent-only").forEach((element) => {
          element.hidden = true;
        });
        document.querySelectorAll(".agent-role-actions").forEach((element) => {
          element.hidden = true;
        });
      }
      initializeAnnouncementManagement();
    })
    .catch(function () {});

  const pendingAgents = document.getElementById("pendingAgents");
  if (pendingAgents) loadAgents();

  async function loadAgents() {
    try {
      const data = await api("/api/owner/agents");
      const agents = data.agents.filter(
        (agent) => agent.status === "pending_owner",
      );
      pendingAgents.innerHTML = agents.length
        ? agents
            .map(
              (agent) =>
                '<article class="employee-card"><h3>' +
                escapeHtml(agent.name) +
                '</h3><div class="meta">' +
                escapeHtml(agent.id) +
                " · " +
                escapeHtml(agent.phone) +
                '</div><label>اسم الوكالة</label><input data-agency-name="' +
                escapeHtml(agent.id) +
                '" placeholder="اسم وكالة الوكيل"><div class="send-code-actions"><button data-agent-action="approve" data-agent-id="' +
                escapeHtml(agent.id) +
                '">موافقة وتفعيل</button><button data-agent-action="reject" data-agent-id="' +
                escapeHtml(agent.id) +
                '" style="background:#b91c1c">رفض</button></div></article>',
            )
            .join("")
        : '<p class="empty">لا توجد طلبات وكلاء معلقة.</p>';
    } catch (error) {
      pendingAgents.innerHTML =
        '<p class="empty">' + escapeHtml(error.message) + "</p>";
    }
  }

  pendingAgents?.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-agent-action]");
    if (!button) return;
    const id = button.dataset.agentId;
    const action = button.dataset.agentAction;
    const agencyName = document
      .querySelector(`[data-agency-name="${CSS.escape(id)}"]`)
      ?.value.trim();
    if (action === "approve" && !agencyName)
      return alert("أدخل اسم الوكالة أولاً.");
    try {
      await api(`/api/owner/agents/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({ agencyName }),
      });
      loadAgents();
    } catch (error) {
      alert(error.message);
    }
  });

  const superAdminForm = document.getElementById("superAdminForm");
  const superAdminList = document.getElementById("superAdminList");

  async function loadSuperAdmins() {
    if (!superAdminList || currentAccount?.role !== "owner") return;
    try {
      const data = await api("/api/owner/super-admins");
      superAdminList.innerHTML = data.admins.length ? data.admins.map((admin) =>
        '<article class="employee-card"><h3>' + escapeHtml(admin.name) + '</h3><div class="meta"><span class="badge">' +
        escapeHtml(admin.id) + "</span><br>" + escapeHtml(admin.phone) + "<br>نشر الإعلانات: " +
        (admin.canPublishAnnouncements ? "مسموح" : "متوقف") + '</div><div class="send-code-actions"><button data-admin-publish="' +
        escapeHtml(admin.id) + '" data-allowed="' + (admin.canPublishAnnouncements ? "false" : "true") + '">' +
        (admin.canPublishAnnouncements ? "إيقاف نشر الإعلانات" : "تشغيل نشر الإعلانات") + '</button><button data-admin-revoke="' +
        escapeHtml(admin.id) + '" style="background:#b91c1c">سحب Super Admin</button></div></article>',
      ).join("") : '<p class="empty">لا يوجد مساعدون حالياً.</p>';
    } catch (error) { superAdminList.innerHTML = '<p class="empty">' + escapeHtml(error.message) + "</p>"; }
  }

  superAdminForm?.addEventListener("submit", async function (event) {
    event.preventDefault();
    try {
      await api("/api/owner/super-admins", { method: "POST", body: JSON.stringify({ userId: document.getElementById("superAdminUserId").value.trim() }) });
      superAdminForm.reset();
      loadSuperAdmins();
    } catch (error) { alert(error.message); }
  });

  superAdminList?.addEventListener("click", async function (event) {
    const publish = event.target.closest("[data-admin-publish]");
    const revoke = event.target.closest("[data-admin-revoke]");
    try {
      if (publish) await api("/api/owner/super-admins/" + encodeURIComponent(publish.dataset.adminPublish) + "/announcement-permission", { method: "POST", body: JSON.stringify({ allowed: publish.dataset.allowed === "true" }) });
      if (revoke && confirm("هل تريد سحب صلاحية Super Admin؟")) await api("/api/owner/super-admins/" + encodeURIComponent(revoke.dataset.adminRevoke) + "/revoke", { method: "POST", body: "{}" });
      if (publish || revoke) loadSuperAdmins();
    } catch (error) { alert(error.message); }
  });

  const announcementSection = document.getElementById("announcementManagement");
  const announcementForm = document.getElementById("announcementForm");
  const managedAnnouncements = document.getElementById("managedAnnouncements");

  async function initializeAnnouncementManagement() {
    if (!announcementSection) return;
    try {
      const access = await api("/api/announcements");
      if (!access.canPublish) {
        announcementForm.hidden = true;
        managedAnnouncements.innerHTML = '<p class="empty">صلاحية نشر الإعلانات متوقفة. يستطيع صاحب المنصة تشغيلها لك.</p>';
        return;
      }
      announcementForm.hidden = false;
      loadManagedAnnouncements();
      loadSuperAdmins();
    } catch (error) { announcementSection.hidden = true; }
  }

  async function loadManagedAnnouncements() {
    if (!managedAnnouncements) return;
    try {
      const data = await api("/api/announcements/manage");
      managedAnnouncements.innerHTML = data.announcements.length ? data.announcements.map((item) =>
        '<div class="ledger-row"><strong>' + escapeHtml(item.title) + '</strong><br><span class="meta">' +
        escapeHtml(item.body) + "<br>الفئة: " + escapeHtml(item.audience) + " · الأهمية: " + escapeHtml(item.priority) +
        " · الحالة: " + (item.is_active ? "منشور" : "متوقف") + "</span>" + (item.is_active ? '<button type="button" data-close-announcement="' + escapeHtml(item.id) + '" style="margin-top:8px;background:#b91c1c">إيقاف الإعلان</button>' : "") + "</div>",
      ).join("") : '<p class="empty">لم تُنشر إعلانات بعد.</p>';
    } catch (error) { managedAnnouncements.innerHTML = '<p class="empty">' + escapeHtml(error.message) + "</p>"; }
  }

  announcementForm?.addEventListener("submit", async function (event) {
    event.preventDefault();
    const notice = document.getElementById("announcementManagementNotice");
    try {
      const endsValue = document.getElementById("announcementEndsAt").value;
      const data = await api("/api/announcements", { method: "POST", body: JSON.stringify({
        title: document.getElementById("announcementTitle").value.trim(), body: document.getElementById("announcementBody").value.trim(),
        audience: document.getElementById("announcementAudience").value, priority: document.getElementById("announcementPriority").value,
        endsAt: endsValue ? new Date(endsValue).toISOString() : null,
      }) });
      notice.hidden = false; notice.textContent = data.message; announcementForm.reset(); loadManagedAnnouncements();
    } catch (error) { notice.hidden = false; notice.textContent = error.message; }
  });

  managedAnnouncements?.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-close-announcement]");
    if (!button) return;
    try { await api("/api/announcements/" + encodeURIComponent(button.dataset.closeAnnouncement) + "/close", { method: "POST", body: "{}" }); loadManagedAnnouncements(); }
    catch (error) { alert(error.message); }
  });

  const createInvite = document.getElementById("createInvite");
  if (createInvite) {
    createInvite.addEventListener("click", async function () {
      try {
        const data = await api("/api/agent/invitations", {
          method: "POST",
          body: "{}",
        });
        const result = document.getElementById("inviteResult");
        result.hidden = false;
        result.innerHTML =
          "كود الدعوة: <strong>" +
          escapeHtml(data.code) +
          '</strong><br><input id="inviteUrl" readonly value="' +
          escapeHtml(data.url) +
          '"><button type="button" id="copyInvite">نسخ الرابط</button>';
        document.getElementById("copyInvite").onclick = async function () {
          await navigator.clipboard.writeText(data.url);
          this.textContent = "تم النسخ";
        };
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const pendingEmployees = document.getElementById("pendingEmployees");
  if (pendingEmployees) loadEmployees();

  async function loadEmployees() {
    try {
      const data = await api("/api/agent/employees");
      pendingEmployees.innerHTML = data.employees.length
        ? data.employees
            .map(
              (employee) =>
                '<article class="employee-card"><h3>' +
                escapeHtml(employee.name) +
                '</h3><div class="meta"><span class="badge">' +
                escapeHtml(employee.id) +
                "</span><br>" +
                escapeHtml(employee.phone) +
                "<br>الحالة: " +
                escapeHtml(employee.status) +
                "<br>الدور: " +
                escapeHtml(roleName(employee.role)) +
                "</div>" +
                (employee.status === "pending_agent"
                  ? '<div class="send-code-actions"><button data-employee-action="approve" data-employee-id="' +
                    escapeHtml(employee.id) +
                    '">موافقة</button><button data-employee-action="reject" data-employee-id="' +
                    escapeHtml(employee.id) +
                    '" style="background:#b91c1c">رفض</button></div>'
                  : employee.status === "active"
                    ? '<div class="send-code-actions agent-role-actions"><button data-staff-role="deputy_agent" data-employee-id="' +
                      escapeHtml(employee.id) +
                      '">تعيين نائب وكيل</button><button data-staff-role="assistant_deputy" data-employee-id="' +
                      escapeHtml(employee.id) +
                      '">تعيين مساعد نائب</button><button data-staff-role="employee" data-employee-id="' +
                      escapeHtml(employee.id) +
                      '" style="background:#475569">إعادة كموظف</button></div>'
                    : "") +
                "</article>",
            )
            .join("")
        : '<p class="empty">لا يوجد موظفون أو طلبات جديدة.</p>';
    } catch (error) {
      pendingEmployees.innerHTML =
        '<p class="empty">' + escapeHtml(error.message) + "</p>";
    }
  }

  pendingEmployees?.addEventListener("click", async function (event) {
    const roleButton = event.target.closest("[data-staff-role]");
    if (roleButton) {
      if (currentAccount?.role !== "agent") return;
      try {
        await api(
          `/api/agent/employees/${encodeURIComponent(roleButton.dataset.employeeId)}/role`,
          {
            method: "POST",
            body: JSON.stringify({ role: roleButton.dataset.staffRole }),
          },
        );
        loadEmployees();
      } catch (error) {
        alert(error.message);
      }
      return;
    }
    const button = event.target.closest("[data-employee-action]");
    if (!button) return;
    try {
      await api(
        `/api/agent/employees/${encodeURIComponent(button.dataset.employeeId)}/${button.dataset.employeeAction}`,
        { method: "POST", body: "{}" },
      );
      loadEmployees();
    } catch (error) {
      alert(error.message);
    }
  });

  const liquidityBalances = document.getElementById("liquidityBalances");
  const liquidityLedger = document.getElementById("liquidityLedger");
  const liquidityForm = document.getElementById("liquidityForm");

  function formatMoney(value, currency) {
    return new Intl.NumberFormat("ar", {
      minimumFractionDigits: currency === "SYP" ? 0 : 2,
      maximumFractionDigits: currency === "SYP" ? 0 : 2,
    }).format(Number(value || 0)) + " " + currency;
  }

  async function loadLiquidity() {
    if (!liquidityBalances || !liquidityLedger) return;
    try {
      const data = await api("/api/liquidity");
      liquidityBalances.innerHTML = data.balances.length
        ? data.balances.map((item) =>
            '<div class="balance-card"><span>' + escapeHtml(item.agencyName) +
            " — " + escapeHtml(item.currency) + '</span><strong>' +
            escapeHtml(formatMoney(item.balance, item.currency)) + "</strong></div>",
          ).join("")
        : '<p class="empty">لا توجد أرصدة سيولة بعد.</p>';
      liquidityLedger.innerHTML = data.ledger.length
        ? '<h3>آخر الحركات</h3>' + data.ledger.slice(0, 30).map((item) => {
            const positive = Number(item.amount_minor) >= 0;
            return '<div class="ledger-row"><strong>' + escapeHtml(item.agency_name) +
              " — " + escapeHtml(item.currency) + '</strong><br><span class="' +
              (positive ? "ledger-positive" : "ledger-negative") + '">' +
              (positive ? "+" : "") + escapeHtml(formatMoney(item.amount, item.currency)) +
              "</span> · الرصيد بعد الحركة: " + escapeHtml(formatMoney(item.balanceAfter, item.currency)) +
              "<br><span class=\"meta\">" + escapeHtml(item.reason || item.movement_type) +
              " · " + escapeHtml(new Date(item.created_at).toLocaleString("ar")) + "</span></div>";
          }).join("")
        : "";
    } catch (error) {
      liquidityBalances.innerHTML = '<p class="empty">' + escapeHtml(error.message) + "</p>";
    }
  }

  liquidityForm?.addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = liquidityForm.querySelector('button[type="submit"]');
    const notice = document.getElementById("liquidityNotice");
    button.disabled = true;
    try {
      const data = await api("/api/owner/liquidity/adjust", {
        method: "POST",
        body: JSON.stringify({
          agencyId: document.getElementById("liquidityAgencyId").value.trim(),
          currency: document.getElementById("liquidityCurrency").value,
          amount: document.getElementById("liquidityAmount").value,
          direction: document.getElementById("liquidityDirection").value,
          reason: document.getElementById("liquidityReason").value.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      notice.hidden = false;
      notice.textContent = data.message;
      liquidityForm.reset();
      await loadLiquidity();
    } catch (error) {
      notice.hidden = false;
      notice.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  loadLiquidity();

  function roleName(role) {
    return (
      {
        employee: "موظف",
        deputy_agent: "نائب الوكيل",
        assistant_deputy: "مساعد نائب الوكيل",
      }[role] || role
    );
  }
})();
