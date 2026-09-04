(function () {
  let viewer = null, proofDocument = "", ocrText = "";
  const el = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر تنفيذ الطلب.");
    return data;
  }
  function imageData(file) {
    return new Promise((resolve, reject) => {
      if (!file || (!file.type.match(/^image\/(jpeg|png|webp)$/) && !file.name.match(/\.(jpe?g|png|webp)$/i))) return reject(Error("اختر صورة JPG أو PNG أو WebP."));
      const image = new Image(), reader = new FileReader();
      reader.onload = () => { image.src = reader.result; };
      reader.onerror = () => reject(Error("تعذر فتح الصورة."));
      image.onerror = () => reject(Error("تعذر قراءة الصورة. جرّب لقطة شاشة."));
      image.onload = () => {
        const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      reader.readAsDataURL(file);
    });
  }
  async function reverseSettlement(id) {
    const reason = prompt("اكتب سبب عكس التسوية. سيبقى الإثبات والسجل محفوظين:");
    if (!reason) return;
    try {
      const data = await api(`/api/owner/settlements/${encodeURIComponent(id)}/reverse`, { method: "POST", body: JSON.stringify({ reason }) });
      alert(data.message); await load();
    } catch (error) { alert(error.message); }
  }
  async function load() {
    const data = await api("/api/credit-limits");
    el("limitList").innerHTML = data.limits.length ? data.limits.map((item) => `
      <div class="limit-card"><b>${esc(item.counterparty_name)} مدينة إلى ${esc(item.agency_name)}</b><span> — ${esc(item.currency)}</span>
      <div class="numbers"><div>السقف<br><b>${item.limit}</b></div><div>المستحق<br><b>${item.outstanding}</b></div><div>المتاح<br><b>${item.available}</b></div></div>
      ${item.blocked ? '<p class="debt-warning">تم بلوغ السقف — المعاملات الجديدة متوقفة حتى التسديد.</p>' : ""}</div>`).join("") : '<p class="meta">لا توجد سقوف مسجلة.</p>';
    el("settlementList").innerHTML = data.settlements.length ? data.settlements.map((item) => `
      <div class="limit-card"><b>${esc(item.reference_number)}</b><p>${esc(item.counterparty_name)} سدّدت إلى ${esc(item.agency_name)} — ${item.amount} ${esc(item.currency)}</p>
      <small>${esc(item.created_by_name)} · ${new Date(item.created_at).toLocaleString("ar")}</small>
      ${item.status === "reversed" ? `<p class="debt-warning">معكوسة بواسطة صاحب المنصة: ${esc(item.reversal_reason)}</p>` : ""}
      <details><summary>عرض إثبات التسليم</summary><img class="proof" src="${item.proof_document}" alt="إثبات التسليم"></details>
      ${data.viewerRole === "owner" && item.status === "confirmed" ? `<button type="button" data-reverse="${esc(item.id)}">عكس التسوية</button>` : ""}</div>`).join("") : '<p class="meta">لا توجد تسويات مسجلة.</p>';
    document.querySelectorAll("[data-reverse]").forEach((button) => { button.onclick = () => reverseSettlement(button.dataset.reverse); });
  }
  el("limitForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api("/api/agent/credit-limits", { method: "POST", body: JSON.stringify({ counterpartyAgencyId: el("limitAgency").value.trim(), currency: el("limitCurrency").value, limit: el("limitAmount").value }) });
      alert(data.message); await load();
    } catch (error) { alert(error.message); }
  });
  el("settlementProof").addEventListener("change", async (event) => {
    try { proofDocument = await imageData(event.target.files[0]); ocrText = ""; } catch (error) { alert(error.message); }
  });
  el("readProof").addEventListener("click", async () => {
    const notice = el("ocrNotice");
    try {
      if (!proofDocument) throw Error("أرفق صورة الإثبات أولاً.");
      notice.hidden = false; notice.textContent = "جاري فحص الإثبات…";
      const data = await api("/api/agent/settlements/ocr", { method: "POST", body: JSON.stringify({ proofDocument }) });
      ocrText = data.text || ""; notice.textContent = data.message || "راجع المبلغ والعملة، ثم أكد التسوية.";
    } catch (error) { notice.hidden = false; notice.textContent = error.message; }
  });
  el("settlementForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (!proofDocument) throw Error("أرفق إثبات التسليم أولاً.");
      if (!confirm("هل المبلغ والعملة مطابقان للإثبات؟ بعد التأكيد لا يمكنك التعديل أو الحذف.")) return;
      const data = await api("/api/agent/settlements", { method: "POST", body: JSON.stringify({ counterpartyAgencyId: el("settlementAgency").value.trim(), currency: el("settlementCurrency").value, amount: el("settlementAmount").value, proofDocument, ocrText }) });
      alert(`${data.message} المرجع: ${data.referenceNumber}`); event.target.reset(); proofDocument = ""; ocrText = ""; await load();
    } catch (error) { alert(error.message); }
  });
  (async () => {
    try {
      viewer = (await api("/api/auth/status")).user;
      if (viewer?.role === "agent") { el("agentControls").hidden = false; el("settlementControls").hidden = false; }
      await load();
    } catch (error) { alert(error.message); }
  })();
})();
