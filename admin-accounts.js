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
                "</div>" +
                (employee.status === "pending_agent"
                  ? '<div class="send-code-actions"><button data-employee-action="approve" data-employee-id="' +
                    escapeHtml(employee.id) +
                    '">موافقة</button><button data-employee-action="reject" data-employee-id="' +
                    escapeHtml(employee.id) +
                    '" style="background:#b91c1c">رفض</button></div>'
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
})();
