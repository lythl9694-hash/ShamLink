(function () {
  const style = document.createElement("style");
  style.textContent = `
    .announcement-bell{position:fixed;left:16px;top:16px;z-index:9998;width:50px;height:50px;border:0;border-radius:50%;background:#075f46;color:#fff;font-size:23px;box-shadow:0 5px 18px #0003;cursor:pointer}
    .announcement-count{position:absolute;right:-4px;top:-5px;min-width:22px;height:22px;padding:2px 5px;border-radius:20px;background:#dc2626;color:#fff;font:700 12px Arial;display:grid;place-items:center}
    .announcement-panel{position:fixed;inset:0;z-index:9999;background:#0007;display:none;padding:70px 14px 20px;overflow:auto}
    .announcement-panel.open{display:block}.announcement-box{width:min(620px,100%);margin:auto;background:#f5f8f6;border-radius:16px;padding:17px;direction:rtl;color:#1f2937}
    .announcement-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.announcement-head h2{margin:0;color:#075f46}.announcement-close{background:#475569!important;width:auto!important;margin:0!important}
    .announcement-card{background:#fff;border:1px solid #dbe5e1;border-right:5px solid #0b8d66;border-radius:12px;padding:14px;margin-top:12px}.announcement-card.urgent{border-right-color:#dc2626;background:#fff7f7}.announcement-card.important{border-right-color:#d97706;background:#fffaf0}
    .announcement-card h3{margin:0 0 8px}.announcement-card p{white-space:pre-wrap;line-height:1.7}.announcement-meta{color:#64748b;font-size:13px}.announcement-read{margin-top:10px!important;width:100%!important}
    .urgent-announcement{position:sticky;top:0;z-index:9000;padding:11px 55px 11px 15px;background:#b91c1c;color:#fff;text-align:center;direction:rtl;font-weight:700;cursor:pointer}
  `;
  document.head.appendChild(style);

  const bell = document.createElement("button");
  bell.type = "button";
  bell.hidden = true;
  bell.className = "announcement-bell";
  bell.setAttribute("aria-label", "الإعلانات");
  bell.innerHTML = "🔔<span class=\"announcement-count\" hidden>0</span>";
  const panel = document.createElement("div");
  panel.className = "announcement-panel";
  panel.innerHTML = '<div class="announcement-box"><div class="announcement-head"><h2>الإعلانات</h2><button class="announcement-close" type="button">إغلاق</button></div><div id="announcementItems"></div></div>';
  document.body.append(bell, panel);

  let announcements = [];
  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function render() {
    const unread = announcements.filter((item) => !item.is_read).length;
    const count = bell.querySelector(".announcement-count");
    count.hidden = unread === 0;
    count.textContent = unread > 99 ? "99+" : unread;
    document.getElementById("announcementItems").innerHTML = announcements.length
      ? announcements.map((item) => '<article class="announcement-card ' + escapeHtml(item.priority) + '"><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.body) + '</p><div class="announcement-meta">' + escapeHtml(item.author_name) + " · " + escapeHtml(new Date(item.created_at).toLocaleString("ar")) + '</div>' + (!item.is_read ? '<button class="announcement-read" data-read="' + escapeHtml(item.id) + '" type="button">تمت القراءة</button>' : "") + "</article>").join("")
      : '<p style="text-align:center;color:#64748b">لا توجد إعلانات حالياً.</p>';
    document.querySelector(".urgent-announcement")?.remove();
    const urgent = announcements.find((item) => item.priority === "urgent" && !item.is_read);
    if (urgent) {
      const banner = document.createElement("div");
      banner.className = "urgent-announcement";
      banner.textContent = "إعلان عاجل: " + urgent.title;
      banner.onclick = () => panel.classList.add("open");
      document.body.prepend(banner);
    }
  }

  async function load() {
    try {
      const response = await fetch("/api/announcements", { credentials: "same-origin" });
      if (!response.ok) return;
      bell.hidden = false;
      announcements = (await response.json()).announcements || [];
      render();
    } catch (_) {}
  }

  bell.onclick = () => panel.classList.add("open");
  panel.querySelector(".announcement-close").onclick = () => panel.classList.remove("open");
  panel.onclick = (event) => { if (event.target === panel) panel.classList.remove("open"); };
  panel.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-read]");
    if (!button) return;
    const response = await fetch("/api/announcements/" + encodeURIComponent(button.dataset.read) + "/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "same-origin" });
    if (response.ok) { const item = announcements.find((entry) => entry.id === button.dataset.read); if (item) item.is_read = true; render(); }
  });
  load();
})();
