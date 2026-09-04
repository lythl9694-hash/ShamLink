(function () {
  const photoBox = document.getElementById("profilePhoto");
  const photoInput = document.getElementById("photoInput");
  const form = document.getElementById("profileForm");
  const notice = document.getElementById("profileNotice");
  let savedPhoto = "";
  let selectedPhoto = "";

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

  function resizePhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file || (!file.type.match(/^image\/(jpeg|png|webp)$/) && !file.name.match(/\.(jpe?g|png|webp)$/i))) return reject(new Error("اختر صورة بصيغة JPG أو PNG أو WebP."));
      const image = new Image();
      image.onload = () => {
        const size = 512;
        const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
        const context = canvas.getContext("2d");
        const side = Math.min(image.width, image.height); const sx = (image.width - side) / 2; const sy = (image.height - side) / 2;
        context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.onerror = () => reject(new Error("تعذر قراءة هذه الصورة. جرّب اختيار لقطة شاشة للصورة."));
      const reader = new FileReader();
      reader.onload = () => { image.src = reader.result; };
      reader.onerror = () => reject(new Error("تعذر فتح الصورة من معرض الجوال."));
      reader.readAsDataURL(file);
    });
  }

  photoInput.addEventListener("change", async () => {
    if (!photoInput.files[0]) return;
    try { selectedPhoto = await resizePhoto(photoInput.files[0]); showPhoto(selectedPhoto); }
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
