document.addEventListener("DOMContentLoaded", () => {
  const backendUrl = document.getElementById("backendUrl");
  const authUser = document.getElementById("authUser");
  const authPass = document.getElementById("authPass");
  const adminKey = document.getElementById("adminKey");
  const dot = document.getElementById("dot");
  const statusText = document.getElementById("statusText");
  const countEl = document.getElementById("count");
  const feedback = document.getElementById("feedback");

  chrome.storage.sync.get({ backendUrl: "http://localhost:8000", authUser: "", authPass: "", adminKey: "" }, (cfg) => {
    backendUrl.value = cfg.backendUrl;
    authUser.value = cfg.authUser;
    authPass.value = cfg.authPass;
    adminKey.value = cfg.adminKey;
  });

  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (resp) => {
    if (resp && resp.connected) {
      dot.className = "dot ok";
      statusText.textContent = "Connected";
    } else {
      dot.className = "dot fail";
      statusText.textContent = "Cannot reach backend";
    }
    countEl.textContent = (resp && resp.dailyCount) || 0;
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    chrome.storage.sync.set({
      backendUrl: backendUrl.value.trim() || "http://localhost:8000",
      authUser: authUser.value.trim(),
      authPass: authPass.value,
      adminKey: adminKey.value.trim(),
    }, () => {
      feedback.textContent = "Saved!";
      feedback.style.color = "#22c55e";
      setTimeout(() => { feedback.textContent = ""; }, 1500);
    });
  });
});
