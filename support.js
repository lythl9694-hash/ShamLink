(function () {
  const style = document.createElement("style");
  style.textContent = `
    .support-widget{position:fixed;right:15px;bottom:16px;z-index:9997;display:grid;gap:9px;direction:rtl}
    .support-toggle,.support-link{border:0;border-radius:999px;color:#fff;text-decoration:none;box-shadow:0 4px 14px #0003;font:700 15px Arial;display:flex;align-items:center;justify-content:center;gap:7px;min-height:46px;padding:10px 15px;cursor:pointer}
    .support-toggle{background:#075f46}.support-link.whatsapp{background:#16a34a}.support-link.telegram{background:#168acd}.support-options{display:none;gap:8px}.support-widget.open .support-options{display:grid}
  `;
  document.head.appendChild(style);
  const widget = document.createElement("div");
  widget.className = "support-widget";
  widget.hidden = true;
  widget.innerHTML = '<div class="support-options"></div><button type="button" class="support-toggle">💬 الدعم الفني</button>';
  document.body.appendChild(widget);
  widget.querySelector(".support-toggle").onclick = () => widget.classList.toggle("open");

  fetch("/api/support")
    .then((response) => response.ok ? response.json() : Promise.reject())
    .then((data) => {
      const contacts = data.contacts || {};
      const links = [];
      if (contacts.whatsapp?.enabled && contacts.whatsapp.value) {
        const number = contacts.whatsapp.value.replace(/^https:\/\/wa\.me\//, "").replace(/\D/g, "");
        links.push('<a class="support-link whatsapp" target="_blank" rel="noopener" href="https://wa.me/' + number + '">واتساب</a>');
      }
      if (contacts.telegram?.enabled && contacts.telegram.value) {
        const handle = contacts.telegram.value.replace(/^https:\/\/t\.me\//, "").replace(/^@/, "");
        links.push('<a class="support-link telegram" target="_blank" rel="noopener" href="https://t.me/' + encodeURIComponent(handle) + '">تلغرام</a>');
      }
      if (!links.length) return;
      widget.querySelector(".support-options").innerHTML = links.join("");
      widget.hidden = false;
    })
    .catch(() => {});
})();
