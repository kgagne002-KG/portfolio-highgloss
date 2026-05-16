/* =========================================================
  Auto‑Tracking Organizer (Vanilla) — Modular app.js (Clean JS)
  Includes:
  - Defensive DOM access
  - Tasks + timers + logs
  - Recurring templates
  - Done tab (performance snapshot)
  - Eisenhower-style Priorities Matrix
  - Productivity Analytics + Standup summary
  - Attachments (URLs) on tasks
  - Auto rollover (unfinished tasks move forward to today)
  - Extension hook: window.handleAutoTimeLog(payload)
  - Badge helper: window.getOrganizerBadgeState()
  - Notifications (non-intrusive: only if already granted)
  - IndexedDB storage (with localStorage fallback + migration)
========================================================= */

(() => {
  "use strict";

  /* =========================
     0) CONFIG
  ========================= */
  const CONFIG = {
    LS_KEY: "organizer:vanilla:v1",
    IDB_NAME: "OrganizerDB",
    IDB_STORE: "kv",
    IDB_KEY: "state",
    MAX_LOG_MINUTES: 24 * 60,
    MINI_LOG_COUNT: 6,
    ANALYTICS_DAYS: 7,
    AUTO_ROLLOVER: true,
    NOTIFY_INTERVAL_MS: 15 * 60 * 1000,
  };

  /* =========================
     1) UTILS
  ========================= */
  const Utils = (() => {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const $ = (id) => document.getElementById(id);
    const has = (id) => !!$(id);

    const uid = () =>
      Math.random().toString(36).slice(2) + Date.now().toString(36);

    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

    const todayKey = (d = new Date()) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const parseDateKey = (k) => {
      const [y, m, d] = String(k).split("-").map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    };

    const dateKeyAddDays = (dateKey, deltaDays) => {
      const d = parseDateKey(dateKey);
      d.setDate(d.getDate() + deltaDays);
      return todayKey(d);
    };

    const minutesToHhMm = (mins) => {
      const h = Math.floor(mins / 60);
      const m = Math.floor(mins % 60);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    const secondsToHhMmSs = (sec) => {
      const s = Math.max(0, Math.floor(sec));
      const hh = Math.floor(s / 3600);
      const mm = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    };

    const sumMinutes = (logs = []) =>
      logs.reduce((a, l) => a + (+l.minutes || 0), 0);

    // Correct HTML escaping for &, <, >, ", '
    const escapeHtml = (unsafe) =>
      String(unsafe).replace(
        /[&<>"']/g,
        (ch) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[ch] || ch,
      );

    const deepClone = (x) =>
      typeof structuredClone === "function"
        ? structuredClone(x)
        : JSON.parse(JSON.stringify(x));

    const isValidUrl = (value) => {
      try {
        const u = new URL(String(value));
        return !!u.protocol && !!u.host;
      } catch {
        return false;
      }
    };

    return {
      $,
      has,
      uid,
      clamp,
      todayKey,
      parseDateKey,
      dateKeyAddDays,
      minutesToHhMm,
      secondsToHhMmSs,
      sumMinutes,
      escapeHtml,
      deepClone,
      dayNames,
      isValidUrl,
    };
  })();

  /* =========================
     2) STORAGE (IndexedDB + localStorage fallback)
  ========================= */
  const Storage = (() => {
    const supportsIDB = () => typeof indexedDB !== "undefined";

    const openIDB = () =>
      new Promise((resolve, reject) => {
        try {
          const req = indexedDB.open(CONFIG.IDB_NAME, 1);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(CONFIG.IDB_STORE)) {
              db.createObjectStore(CONFIG.IDB_STORE);
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } catch (e) {
          reject(e);
        }
      });

    const idbGet = async (key) => {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.IDB_STORE, "readonly");
        const store = tx.objectStore(CONFIG.IDB_STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    };

    const idbSet = async (key, value) => {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.IDB_STORE, "readwrite");
        const store = tx.objectStore(CONFIG.IDB_STORE);
        const req = store.put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    };

    const idbDel = async (key) => {
      const db = await openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.IDB_STORE, "readwrite");
        const store = tx.objectStore(CONFIG.IDB_STORE);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    };

    const lsLoad = () => {
      try {
        const raw = localStorage.getItem(CONFIG.LS_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.warn("[Organizer] localStorage load failed", e);
        return null;
      }
    };

    const lsSave = (state) => {
      try {
        localStorage.setItem(CONFIG.LS_KEY, JSON.stringify(state));
      } catch (e) {
        console.warn("[Organizer] localStorage save failed", e);
      }
    };

    const lsClear = () => {
      try {
        localStorage.removeItem(CONFIG.LS_KEY);
      } catch {}
    };

    const load = async () => {
      if (supportsIDB()) {
        try {
          const idbState = await idbGet(CONFIG.IDB_KEY);
          if (idbState) return idbState;

          // Migrate localStorage -> IndexedDB once
          const lsState = lsLoad();
          if (lsState) {
            await idbSet(CONFIG.IDB_KEY, lsState);
            return lsState;
          }
          return null;
        } catch (e) {
          console.warn(
            "[Organizer] IndexedDB load failed; falling back to localStorage",
            e,
          );
          return lsLoad();
        }
      }
      return lsLoad();
    };

    let saveTimer = null;
    const save = (state) => {
      // mirror to localStorage for resiliency/debug
      try {
        lsSave(state);
      } catch {}

      if (!supportsIDB()) return;

      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          await idbSet(CONFIG.IDB_KEY, state);
        } catch (e) {
          console.warn("[Organizer] IndexedDB save failed", e);
        }
      }, 250);
    };

    const clear = async () => {
      lsClear();
      if (supportsIDB()) {
        try {
          await idbDel(CONFIG.IDB_KEY);
        } catch {}
      }
    };

    return { load, save, clear };
  })();

  /* =========================
     3) MODEL HELPERS
  ========================= */
  const Model = (() => {
    const Status = {
      TODO: "todo",
      IN_PROGRESS: "in_progress",
      DONE: "done",
    };

    const normalizeTask = (t) => {
      if (!t) return t;

      if (!t.status) t.status = t.done ? Status.DONE : Status.TODO;
      if (typeof t.done !== "boolean") t.done = t.status === Status.DONE;

      if (t.done && t.status !== Status.DONE) t.status = Status.DONE;
      if (!t.done && t.status === Status.DONE) t.status = Status.TODO;

      if (!t.urgency) t.urgency = 2;
      if (!t.energy) t.energy = "medium";
      if (!Array.isArray(t.attachments)) t.attachments = [];
      if (!t.completedAt) t.completedAt = "";

      return t;
    };

    const isDone = (t) =>
      (t?.status || "").toLowerCase() === Status.DONE || !!t?.done;

    const setDone = (t, done) => {
      t.done = !!done;
      t.status = done ? Status.DONE : Status.TODO;
      t.completedAt = done ? new Date().toISOString() : "";
      if (!done) t.completedAt = "";
    };

    const setInProgress = (t) => {
      if (isDone(t)) return;
      t.status = Status.IN_PROGRESS;
      t.done = false;
    };

    const setTodo = (t) => {
      if (isDone(t)) return;
      t.status = Status.TODO;
      t.done = false;
    };

    return { Status, normalizeTask, isDone, setDone, setInProgress, setTodo };
  })();

  /* =========================
     4) STATE
  ========================= */
  const State = (() => {
    const DEFAULT_STATE = {
      settings: {
        workdayStart: 540,
        workdayEnd: 1020,
        autoLogTaskTimer: true,
        taskTimerMinMinutes: 1,
      },
      categories: [
        { id: "cat-work", name: "Work" },
        { id: "cat-life", name: "Life" },
        { id: "cat-health", name: "Health" },
        { id: "cat-learning", name: "Learning" },
      ],
      tasks: [],
      timeLogs: {},
      recurringTemplates: [],
      recurringGenerated: {},
      activeTaskTimer: null,
      captureInbox: [],
    };

    let state = null;
    let activeDate = Utils.todayKey();

    const hydrate = async () => {
      const incoming = await Storage.load();
      const base = Utils.deepClone(DEFAULT_STATE);

      if (!incoming) {
        state = base;
        return;
      }

      state = {
        ...base,
        ...incoming,
        settings: { ...base.settings, ...(incoming.settings || {}) },
        categories:
          Array.isArray(incoming.categories) && incoming.categories.length
            ? incoming.categories
            : base.categories,
        tasks: Array.isArray(incoming.tasks) ? incoming.tasks : [],
        timeLogs: incoming.timeLogs || {},
        recurringTemplates: Array.isArray(incoming.recurringTemplates)
          ? incoming.recurringTemplates
          : [],
        recurringGenerated: incoming.recurringGenerated || {},
        activeTaskTimer: incoming.activeTaskTimer || null,
        captureInbox: Array.isArray(incoming.captureInbox)
          ? incoming.captureInbox
          : [],
      };

      state.tasks.forEach(Model.normalizeTask);
    };

    const persist = () => Storage.save(state);

    const get = () => state;
    const setActiveDate = (dateKey) => {
      activeDate = dateKey;
    };
    const getActiveDate = () => activeDate;

    const reset = async () => {
      await Storage.clear();
      state = Utils.deepClone(DEFAULT_STATE);
      activeDate = Utils.todayKey();
      persist();
    };

    return { hydrate, persist, get, reset, setActiveDate, getActiveDate };
  })();

  /* =========================
     5) RECURRING
  ========================= */
  const Recurring = (() => {
    const shouldGenerate = (tpl, dateObj) => {
      if (!tpl?.active) return false;
      const rule = tpl.rrule || { freq: "daily" };

      if (rule.freq === "daily") return true;

      if (rule.freq === "weekly") {
        const wd = dateObj.getDay();
        const list =
          Array.isArray(rule.byWeekday) && rule.byWeekday.length
            ? rule.byWeekday
            : [wd];
        return list.includes(wd);
      }

      if (rule.freq === "monthly") {
        const md = dateObj.getDate();
        const want = Number(rule.byMonthday || md);
        return md === want;
      }

      return false;
    };

    const ensureForDate = (dateKey) => {
      const s = State.get();
      const dateObj = Utils.parseDateKey(dateKey);
      const generatedForDay = s.recurringGenerated[dateKey] || {};
      let changed = false;

      for (const tpl of s.recurringTemplates) {
        if (!tpl?.id) continue;
        if (!shouldGenerate(tpl, dateObj)) continue;
        if (generatedForDay[tpl.id]) continue;

        const task = Model.normalizeTask({
          id: Utils.uid(),
          title: (tpl.title || "Recurring Task").trim(),
          categoryId: tpl.categoryId || s.categories[0]?.id,
          priority: tpl.priority ?? 2,
          urgency: 2,
          energy: "medium",
          dueDate: "",
          notes: tpl.notes || "",
          attachments: [],
          done: false,
          status: Model.Status.TODO,
          completedAt: "",
          archived: false,
          forDate: dateKey,
          sourceTemplateId: tpl.id,
          createdAt: new Date().toISOString(),
        });

        s.tasks.unshift(task);
        s.recurringGenerated[dateKey] = {
          ...(s.recurringGenerated[dateKey] || {}),
          [tpl.id]: true,
        };
        changed = true;
      }

      if (changed) State.persist();
    };

    return { ensureForDate };
  })();

  /* =========================
     6) AUTO-RESCHEDULING (rollover)
  ========================= */
  const Rescheduler = (() => {
    const rolloverToToday = () => {
      if (!CONFIG.AUTO_ROLLOVER) return;
      const s = State.get();
      const today = Utils.todayKey();
      let changed = false;

      for (const t of s.tasks) {
        Model.normalizeTask(t);
        if (t.archived) continue;
        if (Model.isDone(t)) continue;
        if (!t.forDate) continue;
        if (t.forDate < today) {
          t.forDate = today;
          changed = true;
        }
      }

      if (changed) State.persist();
    };

    return { rolloverToToday };
  })();

  /* =========================
     7) MATRIX + ANALYTICS
  ========================= */
  const Matrix = (() => {
    const bucket = (t) => {
      const importance = +t.priority || 2;
      const urgency = +t.urgency || 2;
      if (importance >= 3 && urgency >= 3) return "DO_NOW";
      if (importance >= 3 && urgency <= 2) return "SCHEDULE";
      return "DELETE";
    };
    return { bucket };
  })();

  const Analytics = (() => {
    const getLogsForRange = (endDateKey, days) => {
      const s = State.get();
      const keys = [];
      for (let i = 0; i < days; i++)
        keys.push(Utils.dateKeyAddDays(endDateKey, -i));
      const all = keys.flatMap((k) => s.timeLogs[k] || []);
      return { keys, logs: all };
    };

    const compute = () => {
      const s = State.get();
      const activeDate = State.getActiveDate();

      const { logs } = getLogsForRange(activeDate, CONFIG.ANALYTICS_DAYS);

      const total = Utils.sumMinutes(logs);

      const focus = logs
        .filter((l) => (l.type || "").toLowerCase() === "task")
        .reduce((a, l) => a + (+l.minutes || 0), 0);

      const meetings = logs
        .filter((l) => (l.type || "").toLowerCase() === "meeting")
        .reduce((a, l) => a + (+l.minutes || 0), 0);

      const breaks = Math.max(0, total - focus - meetings);

      const activeDays = (() => {
        let count = 0;
        for (let i = 0; i < CONFIG.ANALYTICS_DAYS; i++) {
          const k = Utils.dateKeyAddDays(activeDate, -i);
          if (Utils.sumMinutes(s.timeLogs[k] || []) > 0) count++;
        }
        return count;
      })();

      const todayLogs = s.timeLogs[activeDate] || [];
      const todayTotal = Utils.sumMinutes(todayLogs);
      const workdayMins = Math.max(
        0,
        (s.settings.workdayEnd || 0) - (s.settings.workdayStart || 0),
      );
      const overtime = Math.max(0, todayTotal - workdayMins);

      return {
        focusMinutes: focus,
        breakMinutes: breaks,
        activeDays,
        overtimeMinutes: overtime,
      };
    };

    const standupSummary = () => {
      const s = State.get();
      const activeDate = State.getActiveDate();

      const tasksForDate = s.tasks
        .filter((t) => !t.archived)
        .filter((t) => (t.forDate ? t.forDate === activeDate : true))
        .map(Model.normalizeTask);

      const doneToday = tasksForDate.filter((t) => Model.isDone(t));
      const inProgress = tasksForDate.filter(
        (t) => t.status === Model.Status.IN_PROGRESS && !Model.isDone(t),
      );
      const planned = tasksForDate.filter(
        (t) => t.status === Model.Status.TODO && !Model.isDone(t),
      );

      const logs = (s.timeLogs[activeDate] || []).slice().reverse();
      const focus = logs
        .filter((l) => (l.type || "").toLowerCase() === "task")
        .reduce((a, l) => a + (+l.minutes || 0), 0);
      const meeting = logs
        .filter((l) => (l.type || "").toLowerCase() === "meeting")
        .reduce((a, l) => a + (+l.minutes || 0), 0);

      const lines = [];
      lines.push(`Stand‑up (${activeDate})`);
      lines.push("");
      lines.push(`✅ Done (${doneToday.length}):`);
      if (doneToday.length) {
        doneToday.slice(0, 12).forEach((t) => lines.push(`- ${t.title}`));
        if (doneToday.length > 12)
          lines.push(`- …and ${doneToday.length - 12} more`);
      } else {
        lines.push("- (none)");
      }

      lines.push("");
      lines.push(`🟡 In Progress (${inProgress.length}):`);
      if (inProgress.length)
        inProgress.forEach((t) => lines.push(`- ${t.title}`));
      else lines.push("- (none)");

      lines.push("");
      lines.push(`🔜 Next (${planned.length}):`);
      if (planned.length)
        planned.slice(0, 12).forEach((t) => lines.push(`- ${t.title}`));
      else lines.push("- (none)");

      lines.push("");
      lines.push(
        `⏱ Time: Focus ${Utils.minutesToHhMm(focus)} • Meetings ${Utils.minutesToHhMm(meeting)}`,
      );
      return lines.join("\n");
    };

    return { compute, standupSummary };
  })();

  /* =========================
     8) NOTIFICATIONS (non-intrusive)
  ========================= */
  const Reminders = (() => {
    const canNotify = () =>
      "Notification" in window && Notification.permission === "granted";

    const checkDueToday = () => {
      if (!canNotify()) return;

      const s = State.get();
      const today = Utils.todayKey();
      const active = State.getActiveDate();
      if (active !== today) return;

      const due = s.tasks
        .map(Model.normalizeTask)
        .filter((t) => !t.archived && !Model.isDone(t))
        .filter((t) => t.dueDate && t.dueDate === today);

      if (!due.length) return;

      const lines = due.slice(0, 4).map((t) => `• ${t.title}`);
      if (due.length > 4) lines.push(`• …and ${due.length - 4} more`);

      try {
        new Notification("Tasks due today", { body: lines.join("\n") });
      } catch {}
    };

    const requestPermission = async () => {
      if (!("Notification" in window)) return false;
      if (Notification.permission === "granted") return true;
      if (Notification.permission === "denied") return false;
      const p = await Notification.requestPermission();
      return p === "granted";
    };

    window.enableOrganizerNotifications = requestPermission;

    return { checkDueToday, requestPermission };
  })();

  /* =========================
     9) UI
  ========================= */
  const UI = (() => {
    const fillSelect = (selectEl, includeAll = false) => {
      if (!selectEl) return;
      const s = State.get();
      selectEl.innerHTML = "";

      if (includeAll) {
        const opt = document.createElement("option");
        opt.value = "all";
        opt.textContent = "All categories";
        selectEl.appendChild(opt);
      }

      s.categories.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        selectEl.appendChild(opt);
      });
    };

    const fillAllSelects = () => {
      if (Utils.has("taskCategory")) fillSelect(Utils.$("taskCategory"));
      if (Utils.has("logCategory")) fillSelect(Utils.$("logCategory"));
      if (Utils.has("tplCategory")) fillSelect(Utils.$("tplCategory"));
      if (Utils.has("categoryFilter"))
        fillSelect(Utils.$("categoryFilter"), true);

      if (Utils.has("categoryFilter") && !Utils.$("categoryFilter").value) {
        Utils.$("categoryFilter").value = "all";
      }
    };

    const renderHeader = () => {
      const s = State.get();
      const activeDate = State.getActiveDate();

      if (Utils.has("date")) Utils.$("date").value = activeDate;

      if (Utils.has("dateLabel")) {
        const dt = Utils.parseDateKey(activeDate);
        Utils.$("dateLabel").textContent = dt.toLocaleDateString(undefined, {
          weekday: "long",
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }

      if (Utils.has("workdayLabel")) {
        Utils.$("workdayLabel").textContent =
          `${Utils.minutesToHhMm(s.settings.workdayStart)}–${Utils.minutesToHhMm(s.settings.workdayEnd)}`;
      }

      const logs = s.timeLogs[activeDate] || [];
      const total = Utils.sumMinutes(logs);

      if (Utils.has("loggedToday"))
        Utils.$("loggedToday").textContent = Utils.minutesToHhMm(total);

      const taskMinutes = logs
        .filter((l) => (l.type || "").toLowerCase() === "task")
        .reduce((a, l) => a + (+l.minutes || 0), 0);

      if (Utils.has("taskTimeToday"))
        Utils.$("taskTimeToday").textContent = Utils.minutesToHhMm(taskMinutes);

      const workdayMins = Math.max(
        0,
        s.settings.workdayEnd - s.settings.workdayStart,
      );
      const pct = workdayMins
        ? Math.min(100, Math.round((total / workdayMins) * 100))
        : 0;

      if (Utils.has("dayProgressPct"))
        Utils.$("dayProgressPct").textContent = pct + "%";
      if (Utils.has("dayProgressBar"))
        Utils.$("dayProgressBar").style.width = pct + "%";
    };

    const renderActiveTimer = () => {
      if (!Utils.has("activeTimerBanner")) return;
      const s = State.get();
      const banner = Utils.$("activeTimerBanner");
      const cur = s.activeTaskTimer;

      if (!cur?.taskId || !cur.startedAtISO) {
        banner.classList.add("hidden");
        return;
      }

      const task = s.tasks.find((t) => t.id === cur.taskId);
      const startedAt = new Date(cur.startedAtISO);

      if (Utils.has("activeTimerTitle"))
        Utils.$("activeTimerTitle").textContent = task?.title || "Task";
      if (Utils.has("activeTimerStart"))
        Utils.$("activeTimerStart").textContent =
          startedAt.toLocaleTimeString();

      banner.classList.remove("hidden");
    };

    const renderTasks = () => {
      if (!Utils.has("taskList")) return;

      const s = State.get();
      const activeDate = State.getActiveDate();

      const q = Utils.has("search")
        ? Utils.$("search").value.trim().toLowerCase()
        : "";
      const filter = Utils.has("categoryFilter")
        ? Utils.$("categoryFilter").value || "all"
        : "all";

      const list = s.tasks
        .map(Model.normalizeTask)
        .filter((t) => !t.archived)
        .filter((t) => (t.forDate ? t.forDate === activeDate : true))
        .filter((t) => (filter === "all" ? true : t.categoryId === filter))
        .filter((t) =>
          q
            ? (t.title + " " + (t.notes || "")).toLowerCase().includes(q)
            : true,
        )
        .sort((a, b) => {
          const aDone = Model.isDone(a);
          const bDone = Model.isDone(b);
          if (aDone !== bDone) return aDone ? 1 : -1;
          return (
            (b.priority || 2) - (a.priority || 2) ||
            (b.urgency || 2) - (a.urgency || 2)
          );
        });

      const box = Utils.$("taskList");
      box.innerHTML = "";

      if (Utils.has("noTasks"))
        Utils.$("noTasks").classList.toggle("hidden", list.length > 0);

      list.forEach((t) => {
        const cat = s.categories.find((c) => c.id === t.categoryId);
        const isActive = s.activeTaskTimer?.taskId === t.id;
        const done = Model.isDone(t);

        const urgencyLabel = { 1: "Not urgent", 2: "Soon", 3: "Urgent" }[
          +t.urgency || 2
        ];
        const energyLabel = (t.energy || "medium").toUpperCase();

        const statusBadge = done
          ? "DONE"
          : t.status === Model.Status.IN_PROGRESS
            ? "IN PROGRESS"
            : "TO DO";

        const attachmentHtml =
          t.attachments && t.attachments.length
            ? (() => {
                const first = t.attachments[0];
                const safe = Utils.escapeHtml(first);
                const href = Utils.isValidUrl(first) ? first : null;
                return href
                  ? `<div class="muted small" style="margin-top:6px;">📎 ${href}${safe}</a></div>`
                  : `<div class="muted small" style="margin-top:6px;">📎 ${safe}</div>`;
              })()
            : "";

        const row = document.createElement("div");
        row.className = "item";

        row.dataset.priority = String(t.priority || 2);
        row.dataset.active = String(isActive);
        row.innerHTML = `
          <div>
            <div class="title ${done ? "muted" : ""}">
              ${done ? "✓ " : ""}${Utils.escapeHtml(t.title)}
            </div>
            <div class="muted small">
              ${Utils.escapeHtml(cat?.name || t.categoryId)} • P${t.priority || 2}
              • ${Utils.escapeHtml(urgencyLabel)} • Energy ${Utils.escapeHtml(energyLabel)}
              • <span class="pill mini">${Utils.escapeHtml(statusBadge)}</span>
              ${t.sourceTemplateId ? " • Recurring" : ""}
              ${t.dueDate ? " • Due " + Utils.escapeHtml(t.dueDate) : ""}
            </div>
            ${t.notes ? `<div class="muted small" style="margin-top:6px;">${Utils.escapeHtml(t.notes)}</div>` : ""}
            ${attachmentHtml}
          </div>
          <div class="row wrap end">
            <button class="secondary" data-action="timer" data-id="${t.id}">
              ${isActive ? "Stop" : "Start"}
            </button>
            <button class="secondary" data-action="toggle" data-id="${t.id}">
              ${done ? "Undone" : "Done"}
            </button>
            <button class="danger" data-action="delete" data-id="${t.id}">Delete</button>
          </div>
        `;
        box.appendChild(row);
      });
    };

    const renderLogs = () => {
      const s = State.get();
      const activeDate = State.getActiveDate();
      const logs = s.timeLogs[activeDate] || [];

      if (Utils.has("logsTotal"))
        Utils.$("logsTotal").textContent = Utils.minutesToHhMm(
          Utils.sumMinutes(logs),
        );

      if (Utils.has("logList")) {
        const full = Utils.$("logList");
        full.innerHTML = "";

        if (Utils.has("noLogs"))
          Utils.$("noLogs").classList.toggle("hidden", logs.length > 0);

        logs.forEach((l) => {
          const row = document.createElement("div");
          row.className = "item";
          row.innerHTML = `
            <div>
              <div class="title">${Utils.escapeHtml(l.title || "Log")}</div>
              <div class="muted small">
                ${String(l.type || "other").toUpperCase()} • ${l.minutes}m
                ${l.taskId ? " • Linked to task" : ""}
              </div>
              ${l.note ? `<div class="muted small" style="margin-top:6px;">${Utils.escapeHtml(l.note)}</div>` : ""}
            </div>
            <div class="row end">
              <button class="danger" data-action="delLog" data-id="${l.id}">Remove</button>
            </div>
          `;
          full.appendChild(row);
        });
      }

      if (Utils.has("logListMini")) {
        const mini = Utils.$("logListMini");
        mini.innerHTML = "";
        const top = logs.slice(0, CONFIG.MINI_LOG_COUNT);

        if (Utils.has("noLogsMini"))
          Utils.$("noLogsMini").classList.toggle("hidden", top.length > 0);

        top.forEach((l) => {
          const row = document.createElement("div");
          row.className = "item";
          row.innerHTML = `
            <div>
              <div class="title">${Utils.escapeHtml(l.title || "Log")}</div>
              <div class="muted small">${String(l.type || "other").toUpperCase()} • ${l.minutes}m</div>
            </div>
          `;
          mini.appendChild(row);
        });
      }
    };

    const renderTemplates = () => {
      if (!Utils.has("tplList")) return;
      const s = State.get();

      if (Utils.has("tplCount"))
        Utils.$("tplCount").textContent = s.recurringTemplates.length;

      const box = Utils.$("tplList");
      box.innerHTML = "";

      if (Utils.has("noTpl"))
        Utils.$("noTpl").classList.toggle(
          "hidden",
          s.recurringTemplates.length > 0,
        );

      s.recurringTemplates.forEach((t) => {
        const rule = t.rrule || { freq: "daily" };
        const label =
          rule.freq === "daily"
            ? "Daily"
            : rule.freq === "weekly"
              ? `Weekly (${(rule.byWeekday || []).map((d) => Utils.dayNames[d]).join(", ") || "—"})`
              : `Monthly (day ${rule.byMonthday || "?"})`;

        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
          <div>
            <div class="title">${Utils.escapeHtml(t.title)}</div>
            <div class="muted small">${Utils.escapeHtml(label)} • P${t.priority ?? 2} • ${t.active ? "Active" : "Off"}</div>
            ${t.notes ? `<div class="muted small" style="margin-top:6px;">${Utils.escapeHtml(t.notes)}</div>` : ""}
          </div>
          <div class="row wrap end">
            <button class="secondary" data-action="tplToggle" data-id="${t.id}">
              ${t.active ? "Disable" : "Enable"}
            </button>
            <button class="danger" data-action="tplDelete" data-id="${t.id}">Delete</button>
          </div>
        `;
        box.appendChild(row);
      });
    };

    const renderSettings = () => {
      const s = State.get();
      if (Utils.has("wdStart"))
        Utils.$("wdStart").value = s.settings.workdayStart;
      if (Utils.has("wdEnd")) Utils.$("wdEnd").value = s.settings.workdayEnd;
      if (Utils.has("autoLogTask"))
        Utils.$("autoLogTask").checked = !!s.settings.autoLogTaskTimer;
      if (Utils.has("minTaskMinutes"))
        Utils.$("minTaskMinutes").value = s.settings.taskTimerMinMinutes;
    };

    const renderWeeklyPicker = () => {
      if (!Utils.has("tplWeekly")) return;
      const holder = Utils.$("tplWeekly");
      holder.innerHTML = "";
      Utils.dayNames.forEach((name, idx) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "secondary";
        b.textContent = name;
        b.dataset.wd = String(idx);
        b.addEventListener("click", () => b.classList.toggle("on"));
        holder.appendChild(b);
      });
    };

    const renderDone = () => {
      if (!Utils.has("doneList")) return;
      const s = State.get();

      const doneTasks = s.tasks
        .map(Model.normalizeTask)
        .filter((t) => !t.archived)
        .filter((t) => Model.isDone(t))
        .sort((a, b) =>
          String(b.completedAt || "").localeCompare(
            String(a.completedAt || ""),
          ),
        );

      Utils.$("doneList").innerHTML = "";

      if (Utils.has("doneCount"))
        Utils.$("doneCount").textContent = String(doneTasks.length);
      if (Utils.has("noDone"))
        Utils.$("noDone").classList.toggle("hidden", doneTasks.length > 0);

      doneTasks.forEach((t) => {
        const row = document.createElement("div");
        row.className = "item";
        row.innerHTML = `
          <div>
            <div class="title">✓ ${Utils.escapeHtml(t.title)}</div>
            <div class="muted small">
              Completed ${t.completedAt ? new Date(t.completedAt).toLocaleString() : "(date unknown)"}
              ${t.forDate ? " • Scheduled " + Utils.escapeHtml(t.forDate) : ""}
            </div>
            ${t.notes ? `<div class="muted small" style="margin-top:6px;">${Utils.escapeHtml(t.notes)}</div>` : ""}
          </div>
        `;
        Utils.$("doneList").appendChild(row);
      });
    };

    const renderMatrix = () => {
      if (
        !Utils.has("matrixNow") ||
        !Utils.has("matrixSchedule") ||
        !Utils.has("matrixDelete")
      )
        return;

      const s = State.get();
      const activeDate = State.getActiveDate();

      const tasks = s.tasks
        .map(Model.normalizeTask)
        .filter((t) => !t.archived)
        .filter((t) => !Model.isDone(t))
        .filter((t) => (t.forDate ? t.forDate === activeDate : true));

      const now = [];
      const schedule = [];
      const del = [];

      tasks.forEach((t) => {
        const b = Matrix.bucket(t);
        if (b === "DO_NOW") now.push(t);
        else if (b === "SCHEDULE") schedule.push(t);
        else del.push(t);
      });

      const renderList = (el, list) => {
        el.innerHTML = "";
        list
          .sort(
            (a, b) =>
              (b.priority || 2) - (a.priority || 2) ||
              (b.urgency || 2) - (a.urgency || 2),
          )
          .forEach((t) => {
            const item = document.createElement("div");
            item.className = "item";
            item.innerHTML = `
              <div>
                <div class="title">${Utils.escapeHtml(t.title)}</div>
                <div class="muted small">P${t.priority || 2} • Urgency ${t.urgency || 2} • Energy ${(t.energy || "medium").toUpperCase()}</div>
              </div>
            `;
            el.appendChild(item);
          });

        if (!list.length) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = "Nothing here.";
          el.appendChild(empty);
        }
      };

      renderList(Utils.$("matrixNow"), now);
      renderList(Utils.$("matrixSchedule"), schedule);
      renderList(Utils.$("matrixDelete"), del);
    };

    const renderAnalytics = () => {
      const any =
        Utils.has("focusTime") ||
        Utils.has("breakTime") ||
        Utils.has("activeDays") ||
        Utils.has("overtime") ||
        Utils.has("standupSummary");
      if (!any) return;

      const stats = Analytics.compute();

      if (Utils.has("focusTime"))
        Utils.$("focusTime").textContent = Utils.minutesToHhMm(
          stats.focusMinutes,
        );
      if (Utils.has("breakTime"))
        Utils.$("breakTime").textContent = Utils.minutesToHhMm(
          stats.breakMinutes,
        );
      if (Utils.has("activeDays"))
        Utils.$("activeDays").textContent = String(stats.activeDays);
      if (Utils.has("overtime"))
        Utils.$("overtime").textContent = Utils.minutesToHhMm(
          stats.overtimeMinutes,
        );

      if (Utils.has("standupSummary"))
        Utils.$("standupSummary").value = Analytics.standupSummary();
    };

    const renderAll = () => {
      Recurring.ensureForDate(State.getActiveDate());
      fillAllSelects();
      renderHeader();
      renderActiveTimer();
      renderTasks();
      renderLogs();
      renderDone();
      renderMatrix();
      renderAnalytics();
      renderTemplates();
      renderSettings();
    };

    return {
      renderAll,
      renderTasks,
      renderActiveTimer,
      renderWeeklyPicker,
      renderAnalytics,
    };
  })();

  /* =========================
     10) TIMER
  ========================= */
  const Timer = (() => {
    const start = (taskId) => {
      const s = State.get();
      if (s.activeTaskTimer?.taskId)
        stop("Auto-stopped when starting another task");

      const task = s.tasks.find((t) => t.id === taskId);
      if (task) Model.setInProgress(task);

      s.activeTaskTimer = { taskId, startedAtISO: new Date().toISOString() };
      State.persist();
      UI.renderActiveTimer();
      UI.renderTasks();
      UI.renderAnalytics();
    };

    const stop = (reason = "Stopped") => {
      const s = State.get();
      const cur = s.activeTaskTimer;
      if (!cur?.taskId || !cur.startedAtISO) return;

      const startedAt = new Date(cur.startedAtISO);
      const endedAt = new Date();
      const minutes = Math.max(
        +s.settings.taskTimerMinMinutes || 1,
        Math.round((endedAt - startedAt) / 60000),
      );

      const task = s.tasks.find((t) => t.id === cur.taskId);
      if (task && !Model.isDone(task)) Model.setTodo(task);

      s.activeTaskTimer = null;

      if (s.settings.autoLogTaskTimer) {
        const dateKey = Utils.todayKey(startedAt);
        const log = {
          id: Utils.uid(),
          type: "task",
          title: task?.title || "Task",
          categoryId: task?.categoryId || s.categories[0]?.id,
          minutes: Utils.clamp(minutes, 0, CONFIG.MAX_LOG_MINUTES),
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          note: `Auto-logged from Task Timer • ${reason}`,
          taskId: cur.taskId,
        };
        s.timeLogs[dateKey] = [log, ...(s.timeLogs[dateKey] || [])];
      }

      State.persist();
      UI.renderAll();
    };

    const tick = () => {
      const s = State.get();
      const cur = s.activeTaskTimer;
      if (!cur?.startedAtISO) return;
      if (!Utils.has("activeTimerElapsed")) return;

      const startedAt = new Date(cur.startedAtISO);
      Utils.$("activeTimerElapsed").textContent = Utils.secondsToHhMmSs(
        (Date.now() - startedAt) / 1000,
      );
    };

    return { start, stop, tick };
  })();

  /* =========================
     11) ACTIONS
  ========================= */
  const Actions = (() => {
    const addTask = () => {
      const s = State.get();
      const title = Utils.has("taskTitle")
        ? Utils.$("taskTitle").value.trim()
        : "";
      if (!title) return;

      const attach = Utils.has("taskAttachUrl")
        ? Utils.$("taskAttachUrl").value.trim()
        : "";
      const attachments = attach ? [attach] : [];

      const task = Model.normalizeTask({
        id: Utils.uid(),
        title,
        categoryId: Utils.has("taskCategory")
          ? Utils.$("taskCategory").value
          : s.categories[0]?.id,
        priority: Utils.has("taskPriority")
          ? +Utils.$("taskPriority").value
          : 2,
        urgency: Utils.has("taskUrgency") ? +Utils.$("taskUrgency").value : 2,
        energy: Utils.has("taskEnergy")
          ? Utils.$("taskEnergy").value
          : "medium",
        dueDate: Utils.has("taskDue") ? Utils.$("taskDue").value || "" : "",
        notes: Utils.has("taskNotes") ? Utils.$("taskNotes").value || "" : "",
        attachments,
        done: false,
        status: Model.Status.TODO,
        completedAt: "",
        archived: false,
        forDate:
          Utils.has("taskForDate") && Utils.$("taskForDate").checked
            ? State.getActiveDate()
            : "",
        sourceTemplateId: "",
        createdAt: new Date().toISOString(),
      });

      s.tasks.unshift(task);
      State.persist();

      if (Utils.has("taskTitle")) Utils.$("taskTitle").value = "";
      if (Utils.has("taskNotes")) Utils.$("taskNotes").value = "";
      if (Utils.has("taskAttachUrl")) Utils.$("taskAttachUrl").value = "";

      UI.renderAll();
    };

    const toggleTask = (taskId) => {
      const s = State.get();
      const t = s.tasks.find((x) => x.id === taskId);
      if (!t) return;
      Model.normalizeTask(t);

      if (!Model.isDone(t) && s.activeTaskTimer?.taskId === t.id) {
        Timer.stop("Stopped because task was marked complete");
      }

      Model.setDone(t, !Model.isDone(t));
      State.persist();
      UI.renderAll();
    };

    const deleteTask = (taskId) => {
      const s = State.get();
      if (s.activeTaskTimer?.taskId === taskId)
        Timer.stop("Stopped because task was deleted");
      s.tasks = s.tasks.filter((t) => t.id !== taskId);
      State.persist();
      UI.renderAll();
    };

    const addManualLog = () => {
      const s = State.get();
      const title = Utils.has("logTitle")
        ? Utils.$("logTitle").value.trim()
        : "";
      if (!title) return;

      const activeDate = State.getActiveDate();
      const log = {
        id: Utils.uid(),
        type: Utils.has("logType") ? Utils.$("logType").value : "task",
        title,
        categoryId: Utils.has("logCategory")
          ? Utils.$("logCategory").value
          : s.categories[0]?.id,
        minutes: Utils.clamp(
          +(Utils.has("logMinutes") ? Utils.$("logMinutes").value : 25),
          1,
          600,
        ),
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        note: Utils.has("logNote") ? Utils.$("logNote").value || "" : "",
      };

      s.timeLogs[activeDate] = [log, ...(s.timeLogs[activeDate] || [])];
      State.persist();

      if (Utils.has("logTitle")) Utils.$("logTitle").value = "";
      if (Utils.has("logNote")) Utils.$("logNote").value = "";

      UI.renderAll();
    };

    const deleteLog = (logId) => {
      const s = State.get();
      const activeDate = State.getActiveDate();
      s.timeLogs[activeDate] = (s.timeLogs[activeDate] || []).filter(
        (l) => l.id !== logId,
      );
      State.persist();
      UI.renderAll();
    };

    const addTemplate = () => {
      const s = State.get();
      const title = Utils.has("tplTitle")
        ? Utils.$("tplTitle").value.trim()
        : "";
      if (!title) return;

      const freq = Utils.has("tplFreq") ? Utils.$("tplFreq").value : "weekly";
      let rrule;

      if (freq === "daily") rrule = { freq: "daily" };

      if (freq === "weekly") {
        const picked = Array.from(
          document.querySelectorAll("#tplWeekly button.on"),
        ).map((b) => +b.dataset.wd);
        rrule = {
          freq: "weekly",
          byWeekday: picked.length
            ? picked
            : [Utils.parseDateKey(State.getActiveDate()).getDay()],
        };
      }

      if (freq === "monthly") {
        const md = Utils.has("tplMonthday")
          ? +Utils.$("tplMonthday").value ||
            Utils.parseDateKey(State.getActiveDate()).getDate()
          : Utils.parseDateKey(State.getActiveDate()).getDate();
        rrule = { freq: "monthly", byMonthday: Utils.clamp(md, 1, 31) };
      }

      const tpl = {
        id: Utils.uid(),
        title,
        categoryId: Utils.has("tplCategory")
          ? Utils.$("tplCategory").value
          : s.categories[0]?.id,
        priority: Utils.has("tplPriority") ? +Utils.$("tplPriority").value : 2,
        notes: Utils.has("tplNotes") ? Utils.$("tplNotes").value || "" : "",
        active: Utils.has("tplActive") ? !!Utils.$("tplActive").checked : true,
        rrule,
        createdAt: new Date().toISOString(),
      };

      s.recurringTemplates.unshift(tpl);
      State.persist();

      if (Utils.has("tplTitle")) Utils.$("tplTitle").value = "";
      if (Utils.has("tplNotes")) Utils.$("tplNotes").value = "";

      Recurring.ensureForDate(State.getActiveDate());
      UI.renderAll();
    };

    const toggleTemplate = (tplId) => {
      const s = State.get();
      const t = s.recurringTemplates.find((x) => x.id === tplId);
      if (!t) return;
      t.active = !t.active;
      State.persist();
      Recurring.ensureForDate(State.getActiveDate());
      UI.renderAll();
    };

    const deleteTemplate = (tplId) => {
      const s = State.get();
      s.recurringTemplates = s.recurringTemplates.filter((x) => x.id !== tplId);
      State.persist();
      UI.renderAll();
    };

    const exportData = () => {
      const s = State.get();
      const blob = new Blob([JSON.stringify(s, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `organizer-backup-${Utils.todayKey()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const importData = async (file) => {
      if (!file) return;
      try {
        const incoming = JSON.parse(await file.text());
        Storage.save(incoming);
        await State.hydrate();
        UI.renderAll();
      } catch {
        alert("Import failed: invalid JSON.");
      }
    };

    // First‑run welcome modal (shown once)
    if (!localStorage.getItem("organizer:first-run-seen")) {
      const modal = document.getElementById("firstRunModal");
      modal?.classList.remove("hidden");
    }

    document
      .getElementById("dismissFirstRun")
      ?.addEventListener("click", () => {
        localStorage.setItem("organizer:first-run-seen", "1");
        document.getElementById("firstRunModal")?.classList.add("hidden");
      });

    return {
      addTask,
      toggleTask,
      deleteTask,
      addManualLog,
      deleteLog,
      addTemplate,
      toggleTemplate,
      deleteTemplate,
      exportData,
      importData,
    };
  })();

  /* =========================
     12) EVENTS
  ========================= */
  const Events = (() => {
    const bindTabs = () => {
      document.querySelectorAll(".tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          document
            .querySelectorAll(".tab")
            .forEach((b) => b.classList.toggle("active", b === btn));
          const tabName = btn.dataset.tab;
          document.querySelectorAll("main[id^='tab-']").forEach((main) => {
            main.classList.toggle("hidden", main.id !== `tab-${tabName}`);
          });
          UI.renderAll();
        });
      });
    };

    const bindHeaderControls = () => {
      if (Utils.has("search"))
        Utils.$("search").addEventListener("input", UI.renderTasks);
      if (Utils.has("categoryFilter"))
        Utils.$("categoryFilter").addEventListener("change", UI.renderTasks);
    };

    const bindDate = () => {
      if (!Utils.has("date")) return;
      Utils.$("date").addEventListener("change", () => {
        const v = Utils.$("date").value || Utils.todayKey();
        State.setActiveDate(v);
        Recurring.ensureForDate(v);
        UI.renderAll();
      });
    };

    const bindButtons = () => {
      if (Utils.has("addTaskBtn"))
        Utils.$("addTaskBtn").addEventListener("click", Actions.addTask);
      if (Utils.has("addLogBtn"))
        Utils.$("addLogBtn").addEventListener("click", Actions.addManualLog);
      if (Utils.has("addTplBtn"))
        Utils.$("addTplBtn").addEventListener("click", Actions.addTemplate);

      if (Utils.has("stopTimerBtn")) {
        Utils.$("stopTimerBtn").addEventListener("click", () =>
          Timer.stop("Stopped manually"),
        );
      }

      if (Utils.has("exportBtn"))
        Utils.$("exportBtn").addEventListener("click", Actions.exportData);

      if (Utils.has("importFile")) {
        Utils.$("importFile").addEventListener("change", async (e) => {
          const f = e.target.files?.[0];
          await Actions.importData(f);
          e.target.value = "";
        });
      }

      if (Utils.has("resetBtn")) {
        Utils.$("resetBtn").addEventListener("click", async () => {
          if (!confirm("Reset all local organizer data?")) return;
          await State.reset();
          UI.renderAll();
        });
      }

      if (Utils.has("copyStandupBtn")) {
        Utils.$("copyStandupBtn").addEventListener("click", async () => {
          if (!Utils.has("standupSummary")) return;
          const text = Utils.$("standupSummary").value || "";
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            const ta = Utils.$("standupSummary");
            ta.focus();
            ta.select();
            document.execCommand("copy");
          }
        });
      }
    };

    const bindDelegation = () => {
      if (Utils.has("taskList")) {
        Utils.$("taskList").addEventListener("click", (e) => {
          const btn = e.target.closest("button[data-action]");
          if (!btn) return;
          const id = btn.dataset.id;
          const action = btn.dataset.action;

          if (action === "toggle") Actions.toggleTask(id);
          if (action === "delete") Actions.deleteTask(id);

          if (action === "timer") {
            const s = State.get();
            const isActive = s.activeTaskTimer?.taskId === id;
            isActive ? Timer.stop("Stopped from task row") : Timer.start(id);
          }
        });
      }

      if (Utils.has("logList")) {
        Utils.$("logList").addEventListener("click", (e) => {
          const btn = e.target.closest("button[data-action='delLog']");
          if (!btn) return;
          Actions.deleteLog(btn.dataset.id);
        });
      }

      if (Utils.has("tplList")) {
        Utils.$("tplList").addEventListener("click", (e) => {
          const btn = e.target.closest("button[data-action]");
          if (!btn) return;
          const id = btn.dataset.id;
          const action = btn.dataset.action;
          if (action === "tplToggle") Actions.toggleTemplate(id);
          if (action === "tplDelete") Actions.deleteTemplate(id);
        });
      }
    };

    const bindSettings = () => {
      const s = State.get();

      if (Utils.has("wdStart")) {
        Utils.$("wdStart").addEventListener("change", () => {
          s.settings.workdayStart = Utils.clamp(
            +Utils.$("wdStart").value || 0,
            0,
            1439,
          );
          State.persist();
          UI.renderAll();
        });
      }

      if (Utils.has("wdEnd")) {
        Utils.$("wdEnd").addEventListener("change", () => {
          s.settings.workdayEnd = Utils.clamp(
            +Utils.$("wdEnd").value || 0,
            0,
            1439,
          );
          State.persist();
          UI.renderAll();
        });
      }

      if (Utils.has("autoLogTask")) {
        Utils.$("autoLogTask").addEventListener("change", () => {
          s.settings.autoLogTaskTimer = Utils.$("autoLogTask").checked;
          State.persist();
        });
      }

      if (Utils.has("minTaskMinutes")) {
        Utils.$("minTaskMinutes").addEventListener("change", () => {
          s.settings.taskTimerMinMinutes = Utils.clamp(
            +Utils.$("minTaskMinutes").value || 1,
            1,
            60,
          );
          State.persist();
        });
      }
    };

    const bindAll = () => {
      bindTabs();
      bindHeaderControls();
      bindDate();
      bindButtons();
      bindDelegation();
      bindSettings();
    };

    return { bindAll };
  })();

  /* =========================
     13) EXTENSION + SHARE HOOKS (EXPOSED GLOBALS)
  ========================= */
  const Integrations = (() => {
    const handleAutoTimeLog = (payload) => {
      try {
        const s = State.get();
        const p = payload || {};
        const startedAt = p.startedAtISO
          ? new Date(p.startedAtISO)
          : new Date();
        const endedAt = p.endedAtISO ? new Date(p.endedAtISO) : new Date();
        const minutes =
          typeof p.minutes === "number"
            ? p.minutes
            : Math.max(1, Math.round((endedAt - startedAt) / 60000));

        const dateKey = Utils.todayKey(startedAt);
        const log = {
          id: Utils.uid(),
          type: (p.type || "other").toLowerCase(),
          title: p.title || (p.domain ? `Auto: ${p.domain}` : "Auto capture"),
          categoryId: p.categoryId || s.categories[0]?.id,
          minutes: Utils.clamp(minutes, 0, CONFIG.MAX_LOG_MINUTES),
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          note: p.note || "Auto-captured time",
        };

        s.timeLogs[dateKey] = [log, ...(s.timeLogs[dateKey] || [])];

        s.captureInbox.unshift({
          id: Utils.uid(),
          title: log.title,
          minutes: log.minutes,
          startedAt: log.startedAt,
          endedAt: log.endedAt,
          source: "extension",
          domain: p.domain || "",
        });

        State.persist();
        UI.renderAll();
      } catch (e) {
        console.warn("[Organizer] handleAutoTimeLog failed", e);
      }
    };

    // Expose for extension + console testing
    window.handleAutoTimeLog = handleAutoTimeLog;

    // Badge helper for extension popup/background
    window.getOrganizerBadgeState = () => {
      const s = State.get();
      const today = Utils.todayKey();
      const dueToday = s.tasks
        .map(Model.normalizeTask)
        .filter((t) => !t.archived && !Model.isDone(t))
        .filter((t) => t.dueDate && t.dueDate === today).length;

      const timerRunning = !!s.activeTaskTimer?.taskId;
      return { dueToday, timerRunning };
    };

    // Basic share via URL params: ?title=...&text=...&url=...
    const tryConsumeShareParams = () => {
      try {
        const url = new URL(window.location.href);
        const title = url.searchParams.get("title") || "";
        const text = url.searchParams.get("text") || "";
        const sharedUrl = url.searchParams.get("url") || "";
        if (!title && !text && !sharedUrl) return;

        const s = State.get();
        const combinedTitle = (
          title ||
          text ||
          sharedUrl ||
          "Shared item"
        ).trim();

        const noteParts = [];
        if (text) noteParts.push(text);
        if (sharedUrl) noteParts.push(sharedUrl);

        const task = Model.normalizeTask({
          id: Utils.uid(),
          title: combinedTitle.slice(0, 140),
          categoryId: s.categories[0]?.id,
          priority: 2,
          urgency: 2,
          energy: "medium",
          dueDate: "",
          notes: noteParts.join("\n\n"),
          attachments: sharedUrl ? [sharedUrl] : [],
          done: false,
          status: Model.Status.TODO,
          completedAt: "",
          archived: false,
          forDate: Utils.todayKey(),
          sourceTemplateId: "",
          createdAt: new Date().toISOString(),
        });

        s.tasks.unshift(task);
        State.persist();

        url.searchParams.delete("title");
        url.searchParams.delete("text");
        url.searchParams.delete("url");
        window.history.replaceState({}, document.title, url.toString());

        UI.renderAll();
      } catch {}
    };

    return { handleAutoTimeLog, tryConsumeShareParams };
  })();

  /* =========================
     14) INIT
  ========================= */
  const Init = (() => {
    const run = async () => {
      console.log("[Organizer] init");
      await State.hydrate();

      Rescheduler.rolloverToToday();

      const d = State.getActiveDate();
      if (Utils.has("date")) Utils.$("date").value = d;
      if (Utils.has("year"))
        Utils.$("year").textContent = String(new Date().getFullYear());

      if (Utils.has("tplFreq")) {
        Utils.$("tplFreq").addEventListener("change", () => {
          const f = Utils.$("tplFreq").value;
          if (Utils.has("tplMonthly"))
            Utils.$("tplMonthly").classList.toggle("hidden", f !== "monthly");
        });
      }

      UI.renderWeeklyPicker();
      Events.bindAll();

      Recurring.ensureForDate(d);
      Integrations.tryConsumeShareParams();
      UI.renderAll();

      setInterval(Timer.tick, 1000);
      setInterval(Reminders.checkDueToday, CONFIG.NOTIFY_INTERVAL_MS);
    };

    return { run };
  })();

  /* =========================
     15) BOOTSTRAP
  ========================= */
  Init.run();
})();
