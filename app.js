document.addEventListener("DOMContentLoaded", () => {
  const pages = [...document.querySelectorAll(".page")];

  function showPage(id) {
    pages.forEach(p => p.classList.toggle("active-page", p.id === id));
    document.querySelectorAll(".nav-link").forEach(b =>
      b.classList.toggle("active", b.dataset.page === id)
    );
    window.scrollTo(0, 0);
  }

  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-page]");
    if (btn) showPage(btn.dataset.page);
  });

  document.querySelectorAll(".nav-link").forEach(b =>
    b.addEventListener("click", () => showPage(b.dataset.page))
  );

  document.querySelectorAll(".side-link").forEach(b =>
    b.addEventListener("click", () => {
      if (b.dataset.page) showPage(b.dataset.page);
    })
  );

  // Create meeting
  const createBtn = document.getElementById("createBtn");

  if (createBtn) {
    createBtn.addEventListener("click", () => {
      const name =
        document.getElementById("meetingName")?.value || "Team Meeting";

      const code = Math.random().toString(36).slice(2, 8);

      const shareBox = document.querySelector("#shareBox span");

      if (shareBox) {
        shareBox.textContent =
          `${location.origin}${location.pathname}?room=${code}`;
      }

      alert(`Meeting created: ${name}\nMeeting code: ${code}`);
    });
  }

  // Copy meeting link
  const copyBtn = document.getElementById("copyBtn");

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text =
        document.querySelector("#shareBox span")?.textContent || "";

      try {
        await navigator.clipboard.writeText(text);
        alert("Meeting link copied.");
      } catch {
        alert("Unable to copy the meeting link.");
      }
    });
  }

  // Join meeting
  const joinBtn = document.getElementById("joinBtn");

  if (joinBtn) {
    joinBtn.addEventListener("click", () => {
      const code =
        document.getElementById("meetingCode")?.value.trim() || "";

      if (!code) {
        alert("Please enter the meeting code.");
        return;
      }

      const url =
        `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;

      window.location.href = url;
    });
  }

  // Navigation helpers
  document.querySelectorAll("[data-go-meeting]").forEach(btn => {
    btn.addEventListener("click", () => {
      const meetingPage =
        document.getElementById("meeting") ||
        document.getElementById("room") ||
        document.querySelector(".meeting-page");

      if (meetingPage) showPage(meetingPage.id);
    });
  });

  // Host registration
  const hostForm = document.getElementById("hostRegistrationForm");

  if (hostForm) {
    hostForm.addEventListener("submit", async e => {
      e.preventDefault();

      const name =
        document.getElementById("hostName")?.value.trim() || "";

      const email =
        document.getElementById("hostEmail")?.value.trim() || "";

      if (!name || !email) {
        alert("Please enter your name and email.");
        return;
      }

      localStorage.setItem(
        "mnt_host_registration",
        JSON.stringify({
          name,
          email,
          created_at: new Date().toISOString()
        })
      );

      alert("Host registration submitted successfully.");
      hostForm.reset();
    });
  }

  // Simple schedule storage
  const scheduleForm = document.getElementById("scheduleForm");

  if (scheduleForm) {
    scheduleForm.addEventListener("submit", e => {
      e.preventDefault();

      const data = Object.fromEntries(new FormData(scheduleForm).entries());

      const schedules =
        JSON.parse(localStorage.getItem("mnt_schedules") || "[]");

      schedules.push({
        ...data,
        created_at: new Date().toISOString()
      });

      localStorage.setItem("mnt_schedules", JSON.stringify(schedules));

      alert("Meeting scheduled successfully.");
      scheduleForm.reset();
    });
  }

  // Logout buttons
  document.querySelectorAll("[data-logout]").forEach(btn => {
    btn.addEventListener("click", () => {
      localStorage.removeItem("mnt_admin_session");
      localStorage.removeItem("mnt_host_registration");
      location.reload();
    });
  });

  // IMPORTANT:
  // Meeting microphone, camera, screen sharing and participant media
  // are controlled by meeting-v45-livekit.js.
  //
  // Do NOT create another getUserMedia/getDisplayMedia handler here.
  // This prevents duplicate microphone/camera streams and echo conflicts.

  // Recording demo
  const recordBtn = document.getElementById("recordBtn");

  if (recordBtn) {
    let recorder = null;
    let chunks = [];

    recordBtn.addEventListener("click", async () => {
      if (recorder && recorder.state === "recording") {
        recorder.stop();
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });

        chunks = [];

        recorder = new MediaRecorder(stream);

        recorder.ondataavailable = e => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, {
            type: "video/webm"
          });

          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");

          a.href = url;
          a.download =
            `MNTchnology-Meeting-${Date.now()}.webm`;

          document.body.appendChild(a);
          a.click();
          a.remove();

          stream.getTracks().forEach(track => track.stop());

          recordBtn.textContent = "Start Recording";
        };

        recorder.start();

        recordBtn.textContent = "Stop Recording";

      } catch (error) {
        console.error("Recording error:", error);
        alert("Screen recording was cancelled or unavailable.");
      }
    });
  }

  // Admin login
  const adminLoginForm = document.getElementById("adminLoginForm");

  if (adminLoginForm) {
    adminLoginForm.addEventListener("submit", e => {
      e.preventDefault();

      const email =
        document.getElementById("adminEmail")?.value.trim() || "";

      const password =
        document.getElementById("adminPassword")?.value || "";

      if (!email || !password) {
        alert("Please enter your email and password.");
        return;
      }

      localStorage.setItem(
        "mnt_admin_session",
        JSON.stringify({
          email,
          login_time: new Date().toISOString()
        })
      );

      alert("Admin login successful.");
    });
  }

  // Prevent accidental duplicate form submissions
  document.querySelectorAll("form").forEach(form => {
    form.addEventListener("submit", () => {
      const submit = form.querySelector(
        'button[type="submit"], input[type="submit"]'
      );

      if (submit) {
        setTimeout(() => {
          submit.disabled = false;
        }, 1000);
      }
    });
  });
});
