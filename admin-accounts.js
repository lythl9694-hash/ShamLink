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
      if (currentAccount?.role !== "agent") {
        document.querySelectorAll(".agent-only").forEach((element) => {
          element.hidden = true;
        });
        document.querySelectorAll(".agent-role-actions").forEach((element) => {
          element.hidden = true;
        });
      }
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
