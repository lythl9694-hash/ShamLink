(function () {
  const photoBox = document.getElementById("profilePhoto");
  const photoInput = document.getElementById("photoInput");
  const form = document.getElementById("profileForm");
  const notice = document.getElementById("profileNotice");
  let savedPhoto = "";
  let selectedPhoto = "";
  const cropModal = document.getElementById("cropModal");
  const cropCanvas = document.getElementById("cropCanvas");
  const cropContext = cropCanvas.getContext("2d");
  const cropZoom = document.getElementById("cropZoom");
  let cropImage = null, baseScale = 1, offsetX = 0, offsetY = 0, dragging = false, lastX = 0, lastY = 0;

  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر تنفيذ الطلب.");
    return data;
  }

  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const roleName = (role) => ({ owner: "صاحب المنصة", super_admin: "مساعد صاحب المنصة", agent: "وكيل", deputy_agent: "نائب الوكيل", assistant_deputy: "مساعد نائب الوكيل", employee: "موظف", client: "مستخدم" }[role] || role);

  function showPhoto(source) { photoBox.innerHTML = source ? '<img src="' + source + '" alt="الصورة الشخصية" />' : "👤"; }

  async function loadProfile() {
    try {
      const profile = (await api("/api/profile")).profile;
      savedPhoto = profile.profilePhoto || "";
      showPhoto(savedPhoto);
      document.getElementById("profileName").textContent = profile.name;
      document.getElementById("profileBio").value = profile.profileBio || "";
      document.getElementById("profileData").innerHTML =
        '<div class="profile-field"><span>المعرّف</span><strong>' + escapeHtml(profile.id) + '</strong></div>' +
        '<div class="profile-field"><span>نوع الحساب</span><strong>' + escapeHtml(roleName(profile.role)) + '</strong></div>' +
        '<div class="profile-field"><span>رقم الجوال</span><strong>' + escapeHtml(profile.phone) + '</strong></div>' +
        '<div class="profile-field"><span>الوكالة</span><strong>' + escapeHtml(profile.agencyName || "غير مرتبط بوكالة") + '</strong></div>';
    } catch (error) { notice.hidden = false; notice.textContent = error.message; }
  }

  function openCropper(file) {
    return new Promise((resolve, reject) => {
      if (!file || (!file.type.match(/^image\/(jpeg|png|webp)$/) && !file.name.match(/\.(jpe?g|png|webp)$/i))) return reject(new Error("اختر صورة بصيغة JPG أو PNG أو WebP."));
      const image = new Image();
      image.onload = () => {
        cropImage = image; baseScale = Math.max(300 / image.width, 300 / image.height); offsetX = 0; offsetY = 0; cropZoom.value = "1"; cropModal.hidden = false; drawCrop(); resolve();
      };
      image.onerror = () => reject(new Error("تعذر قراءة هذه الصورة. جرّب اختيار لقطة شاشة للصورة."));
      const reader = new FileReader();
      reader.onload = () => { image.src = reader.result; };
      reader.onerror = () => reject(new Error("تعذر فتح الصورة من معرض الجوال."));
      reader.readAsDataURL(file);
    });
  }

  function drawCrop() {
    if (!cropImage) return;
    const scale = baseScale * Number(cropZoom.value);
    const width = cropImage.width * scale, height = cropImage.height * scale;
    const x = (300 - width) / 2 + offsetX, y = (300 - height) / 2 + offsetY;
    cropContext.clearRect(0, 0, 300, 300); cropContext.drawImage(cropImage, x, y, width, height);
  }
  function clampOffsets() {
    const scale = baseScale * Number(cropZoom.value), width = cropImage.width * scale, height = cropImage.height * scale;
    offsetX = Math.min((width - 300) / 2, Math.max(-(width - 300) / 2, offsetX));
    offsetY = Math.min((height - 300) / 2, Math.max(-(height - 300) / 2, offsetY));
  }
  cropZoom.addEventListener("input", () => { clampOffsets(); drawCrop(); });
  cropCanvas.addEventListener("pointerdown", (event) => { dragging = true; lastX = event.clientX; lastY = event.clientY; cropCanvas.setPointerCapture(event.pointerId); });
  cropCanvas.addEventListener("pointermove", (event) => { if (!dragging) return; offsetX += event.clientX - lastX; offsetY += event.clientY - lastY; lastX = event.clientX; lastY = event.clientY; clampOffsets(); drawCrop(); });
  cropCanvas.addEventListener("pointerup", () => { dragging = false; });
  document.getElementById("applyCrop").addEventListener("click", () => {
    const output = document.createElement("canvas"); output.width = 512; output.height = 512;
    output.getContext("2d").drawImage(cropCanvas, 0, 0, 300, 300, 0, 0, 512, 512);
    selectedPhoto = output.toDataURL("image/jpeg", 0.8); showPhoto(selectedPhoto); cropModal.hidden = true;
  });
  document.getElementById("cancelCrop").addEventListener("click", () => { cropModal.hidden = true; cropImage = null; photoInput.value = ""; });

  photoInput.addEventListener("change", async () => {
    if (!photoInput.files[0]) return;
    try { await openCropper(photoInput.files[0]); }
    catch (error) { notice.hidden = false; notice.textContent = error.message; }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const data = await api("/api/profile", { method: "POST", body: JSON.stringify({ profilePhoto: selectedPhoto || savedPhoto, profileBio: document.getElementById("profileBio").value.trim() }) });
      savedPhoto = selectedPhoto || savedPhoto; selectedPhoto = ""; photoInput.value = ""; notice.hidden = false; notice.textContent = data.message;
    } catch (error) { notice.hidden = false; notice.textContent = error.message; }
    finally { button.disabled = false; }
  });

  document.getElementById("removePhoto").addEventListener("click", async () => {
    if (!savedPhoto && !selectedPhoto) return;
    try { const data = await api("/api/profile/photo", { method: "DELETE" }); savedPhoto = ""; selectedPhoto = ""; photoInput.value = ""; showPhoto(""); notice.hidden = false; notice.textContent = data.message; }
    catch (error) { notice.hidden = false; notice.textContent = error.message; }
  });

  loadProfile();
})();
