/* tpot-digest popup script */

document.addEventListener("DOMContentLoaded", () => {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const dailyCount = document.getElementById("dailyCount");
  const backendUrl = document.getElementById("backendUrl");
  const authUser = document.getElementById("authUser");
  const authPass = document.getElementById("authPass");
  const saveBtn = document.getElementById("saveSettings");
  const saveFeedback = document.getElementById("saveFeedback");

  // Load saved settings
  chrome.storage.sync.get(
    {
      backendUrl: "http://localhost:8000",
      authUser: "",
      authPass: "",
    },
    (config) => {
      backendUrl.value = config.backendUrl;
      authUser.value = config.authUser;
      authPass.value = config.authPass;
    }
  );

  // Request status from service worker
  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
    if (chrome.runtime.lastError) {
      statusDot.className = "status-dot disconnected";
      statusText.textContent = "Extension error";
      return;
    }

    if (response && response.connected) {
      statusDot.className = "status-dot connected";
      statusText.textContent = "Connected to " + response.backendUrl;
    } else {
      statusDot.className = "status-dot disconnected";
      statusText.textContent = "Cannot reach backend";
    }

    if (response && typeof response.dailyCount === "number") {
      dailyCount.textContent = response.dailyCount;
    }
  });

  // Save settings
  saveBtn.addEventListener("click", () => {
    const settings = {
      backendUrl: backendUrl.value.trim() || "http://localhost:8000",
      authUser: authUser.value.trim(),
      authPass: authPass.value,
    };

    chrome.storage.sync.set(settings, () => {
      saveFeedback.textContent = "Settings saved";
      saveFeedback.style.color = "#22c55e";

      // Re-check status with new settings
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
          if (response && response.connected) {
            statusDot.className = "status-dot connected";
            statusText.textContent = "Connected to " + settings.backendUrl;
          } else {
            statusDot.className = "status-dot disconnected";
            statusText.textContent = "Cannot reach backend";
          }
        });

        saveFeedback.textContent = "";
      }, 1500);
    });
  });
});
