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

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function showMessage(element, message, success) {
    element.textContent = message;
    element.style.color = success ? "#056747" : "#b91c1c";
  }

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    api("/api/auth/status").then(function (data) {
      document.getElementById("setupPanel").hidden = !data.setupRequired;
      if (data.user) redirectForUser(data.user);
    });
    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const message = document.getElementById("loginMessage");
      try {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(formData(loginForm)),
        });
        if (data.user.status !== "active") {
          showMessage(message, statusText(data.user.status), false);
          return;
        }
        redirectForUser(data.user);
      } catch (error) {
        showMessage(message, error.message, false);
      }
    });
  }

  const setupForm = document.getElementById("setupForm");
  if (setupForm) {
    setupForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const message = document.getElementById("setupMessage");
      try {
        const data = await api("/api/auth/setup-owner", {
          method: "POST",
          body: JSON.stringify(formData(setupForm)),
        });
        showMessage(message, data.message + " يمكنك تسجيل الدخول الآن.", true);
        setupForm.reset();
      } catch (error) {
        showMessage(message, error.message, false);
      }
    });
  }

  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    const invite = new URLSearchParams(location.search).get("invite") || "";
    if (invite) {
      document.getElementById("inviteCode").value = invite;
      document.getElementById("inviteCode").readOnly = true;
      document.getElementById("accountTypeBox").hidden = true;
    }
    registerForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const message = document.getElementById("registerMessage");
      try {
        const data = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify(formData(registerForm)),
        });
        showMessage(message, data.message + " معرّفك: " + data.id, true);
        registerForm.reset();
      } catch (error) {
        showMessage(message, error.message, false);
      }
    });
  }

  function statusText(status) {
    const labels = {
      pending_owner: "حسابك بانتظار موافقة صاحب المنصة.",
      pending_agent: "حسابك بانتظار موافقة الوكيل.",
      pending_verification: "حسابك بانتظار التحقق.",
      rejected: "تم رفض طلب الحساب.",
      suspended: "الحساب موقوف.",
    };
    return labels[status] || "الحساب غير مفعّل بعد.";
  }

  function redirectForUser(user) {
    if (user.status !== "active") return;
    const requested = new URLSearchParams(location.search).get("returnTo");
    if (requested && requested.startsWith("/") && !requested.startsWith("//")) {
      location.href = requested;
    } else if (user.role === "owner") location.href = "owner-dashboard.html";
    else if (user.role === "agent") location.href = "agent-dashboard.html";
    else if (user.role === "employee") location.href = "transfers.html";
    else location.href = "index.html";
  }
})();
