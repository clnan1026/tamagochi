// App shell: screen router (Start → Select → Room), language, and character
// persistence. Character/language live in shared settings (chrome.storage shim →
// Electron settings, so the tray/overlay agree); game stats live in room.js.
(() => {
  const NS = window.__tamagotchi;

  const translations = {
    en: {
      start_subtitle: "A little friend on your desktop",
      start_button: "Start",
      select_heading: "Choose your friend",
      pink_desc: "Cheerful and loves adventure",
      owlet_desc: "Gentle and loves reading books",
      dude_desc: "Curious and full of mischief",
      back_button: "Back",
      confirm_button: "Let's play",
      fainted_msg: "Your friend fainted…",
      revive_button: "Revive",
      pomodoro_heading: "Pomodoro",
      mode_pomodoro: "Pomodoro",
      mode_break: "Break",
      start_timer_button: "Start",
      pause_timer_button: "Pause",
      minutes_unit: "min",
      seconds_unit: "sec",
      save_button: "Save",
      tasks_heading: "Tasks",
      add_task_button: "+ Add Task",
      task_input_placeholder: "What are you working on?",
      tasks_empty: "No tasks yet.",
      shop_title: "Shop",
      btn_pomodoro: "⏰ Pomodoro",
      btn_shop: "🛒 Shop",
      btn_room: "🏡 Room",
    },
    ja: {
      start_subtitle: "デスクトップに住む小さな友達",
      start_button: "スタート",
      select_heading: "友達を選んでね",
      pink_desc: "陽気で冒険が大好きな友達",
      owlet_desc: "おとなしくて読書が大好きな友達",
      dude_desc: "好奇心旺盛でいたずら好きな友達",
      back_button: "戻る",
      confirm_button: "遊ぶ！",
      fainted_msg: "お友達が倒れちゃった…",
      revive_button: "元気にする",
      pomodoro_heading: "ポモドーロ",
      mode_pomodoro: "ポモドーロ",
      mode_break: "休憩",
      start_timer_button: "スタート",
      pause_timer_button: "一時停止",
      minutes_unit: "分",
      seconds_unit: "秒",
      save_button: "保存",
      tasks_heading: "タスク",
      add_task_button: "+ タスク追加",
      task_input_placeholder: "何に取り組みますか？",
      tasks_empty: "タスクはまだありません。",
      shop_title: "ショップ",
      btn_pomodoro: "⏰ ポモドーロ",
      btn_shop: "🛒 ショップ",
      btn_room: "🏡 部屋",
    },
    ko: {
      start_subtitle: "데스크톱에 사는 작은 친구",
      start_button: "시작",
      select_heading: "친구를 골라보세요",
      pink_desc: "쾌활하고 모험을 즐기는 친구",
      owlet_desc: "차분하고 독서를 좋아하는 친구",
      dude_desc: "호기심 많고 장난기 가득한 친구",
      back_button: "뒤로",
      confirm_button: "놀기!",
      fainted_msg: "친구가 기절했어요…",
      revive_button: "깨우기",
      pomodoro_heading: "뽀모도로",
      mode_pomodoro: "뽀모도로",
      mode_break: "휴식",
      start_timer_button: "시작",
      pause_timer_button: "일시정지",
      minutes_unit: "분",
      seconds_unit: "초",
      save_button: "저장",
      tasks_heading: "할 일",
      add_task_button: "+ 할 일 추가",
      task_input_placeholder: "무엇을 할까요?",
      tasks_empty: "아직 할 일이 없어요.",
      shop_title: "상점",
      btn_pomodoro: "⏰ 뽀모도로",
      btn_shop: "🛒 상점",
      btn_room: "🏡 방",
    },
  };

  // The app is authored at a fixed 390x844 (iPhone 12/13/14 logical size); scale
  // that fixed frame to fit the real window rather than rewriting app.css's
  // fixed-px layout to relative units.
  const APP_WIDTH = 390;
  const APP_HEIGHT = 844;
  const appScaleEl = document.getElementById("app-scale");
  function applyAppScale() {
    const scale = Math.min(window.innerWidth / APP_WIDTH, window.innerHeight / APP_HEIGHT);
    appScaleEl.style.transform = `scale(${scale})`;
  }
  window.addEventListener("resize", applyAppScale);
  applyAppScale();

  const screens = {
    start: document.getElementById("screen-start"),
    select: document.getElementById("screen-select"),
    room: document.getElementById("screen-room"),
    pomodoro: document.getElementById("screen-pomodoro"),
  };
  const charCards = document.querySelectorAll("#screen-select .char-card");
  const langButtons = document.querySelectorAll(".lang-btn");
  const petNameEl = document.getElementById("room-pet-name");

  const modeTabs = document.querySelectorAll(".mode-tab");
  const timerDisplay = document.getElementById("timer-display");
  const timerToggle = document.getElementById("timer-toggle");
  const timerReset = document.getElementById("timer-reset");
  const durationEditBtn = document.getElementById("duration-edit-btn");
  const durationEditor = document.getElementById("duration-editor");
  const durationInputs = {
    pomodoro: { min: document.getElementById("duration-pomodoro-min"), sec: document.getElementById("duration-pomodoro-sec") },
    break: { min: document.getElementById("duration-break-min"), sec: document.getElementById("duration-break-sec") },
  };
  const durationSaveBtn = document.getElementById("duration-save");
  const taskList = document.getElementById("task-list");
  const taskAddBtn = document.getElementById("task-add");

  const TASKS_KEY = "tama-tasks";
  const POMODORO_KEY = "tama-pomodoro";
  const MAX_TASKS = 4;

  let lang = "ja";
  let selectedChar = "pink";
  let tasks = [];
  let addingTask = false;
  let pomodoro;

  function showScreen(name) {
    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle("active", key === name);
    }
  }

  function applyLanguage(next) {
    lang = next;
    document.documentElement.lang = next;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const value = translations[next]?.[key];
      if (value) el.textContent = value;
    });
    langButtons.forEach((b) => b.classList.toggle("active", b.dataset.lang === next));
    NS.Room.setLanguage(next);
    chrome.storage.local.set({ language: next });
    // Dynamic labels that a static data-i18n sweep can't reach: the empty-tasks
    // message and the Start/Pause label, which depends on run state.
    renderTasks();
    updateTimerButton();
  }

  function selectCard(char) {
    selectedChar = char;
    charCards.forEach((c) => c.classList.toggle("selected", c.dataset.char === char));
  }

  function nameFor(char) {
    return { pink: "Pinky", owlet: "Owlet", dude: "Dudy" }[char] || char;
  }

  // --- tasks: a simple checklist capped at 4, read fresh by room.js's right-
  // click reveal, so every mutation is persisted immediately. ------------------
  function loadTasks() {
    try {
      const saved = JSON.parse(localStorage.getItem(TASKS_KEY));
      tasks = Array.isArray(saved) ? saved.slice(0, MAX_TASKS) : [];
    } catch {
      tasks = [];
    }
  }

  function persistTasks() {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch {
      /* localStorage unavailable — tasks stay session-only */
    }
  }

  function renderTasks() {
    taskList.innerHTML = "";

    if (tasks.length === 0 && !addingTask) {
      const empty = document.createElement("p");
      empty.className = "task-empty";
      empty.textContent = translations[lang].tasks_empty;
      taskList.appendChild(empty);
    }

    for (const t of tasks) {
      const row = document.createElement("div");
      row.className = "task-row" + (t.done ? " done" : "");

      const check = document.createElement("button");
      check.className = "task-checkbox";
      check.textContent = t.done ? "✓" : "";
      check.addEventListener("click", () => {
        t.done = !t.done;
        persistTasks();
        renderTasks();
      });

      const text = document.createElement("span");
      text.className = "task-text";
      text.textContent = t.text;

      const remove = document.createElement("button");
      remove.className = "task-remove";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        tasks = tasks.filter((x) => x.id !== t.id);
        persistTasks();
        renderTasks();
      });

      row.append(check, text, remove);
      taskList.appendChild(row);
    }

    if (addingTask) {
      const row = document.createElement("div");
      row.className = "task-row";
      const input = document.createElement("input");
      input.className = "task-input";
      input.type = "text";
      input.maxLength = 80;
      input.placeholder = translations[lang].task_input_placeholder;

      // Enter commits, then the input is removed from the DOM which also fires a
      // native blur — guard so that doesn't double-commit the same task.
      const commit = () => {
        if (!addingTask) return;
        addingTask = false;
        const value = input.value.trim();
        if (value) {
          tasks.push({ id: Date.now() + Math.random(), text: value, done: false });
          persistTasks();
        }
        renderTasks();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          addingTask = false;
          renderTasks();
        }
      });
      input.addEventListener("blur", commit);

      row.appendChild(input);
      taskList.appendChild(row);
      queueMicrotask(() => input.focus());
    }

    taskAddBtn.disabled = tasks.length >= MAX_TASKS || addingTask;
  }

  // --- pomodoro: wall-clock model driven independently of which screen is
  // visible, so the alarm fires even if the user went back to the Pet Room. ---
  function loadPomodoro() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(POMODORO_KEY));
    } catch {
      saved = null;
    }
    pomodoro = new NS.PomodoroTimer(saved);
  }

  function persistPomodoro() {
    try {
      localStorage.setItem(POMODORO_KEY, JSON.stringify(pomodoro.snapshot()));
    } catch {
      /* localStorage unavailable — timer stays session-only */
    }
  }

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function updateTimerDisplay() {
    timerDisplay.textContent = formatTime(pomodoro.remaining());
  }

  function updateTimerButton() {
    timerToggle.textContent =
      translations[lang][pomodoro.running ? "pause_timer_button" : "start_timer_button"];
    // Editing durations mid-focus is confusing (does it apply now or next time?),
    // so lock it out while a session is actually running.
    durationEditBtn.disabled = pomodoro.running;
    if (pomodoro.running) closeDurationEditor();
  }

  function openDurationEditor() {
    if (pomodoro.running) return;
    for (const mode of Object.keys(durationInputs)) {
      const total = pomodoro.durations[mode];
      durationInputs[mode].min.value = Math.floor(total / 60);
      durationInputs[mode].sec.value = total % 60;
    }
    durationEditor.hidden = false;
  }

  function closeDurationEditor() {
    durationEditor.hidden = true;
  }

  function saveDurations() {
    for (const mode of Object.keys(durationInputs)) {
      const minutes = Number(durationInputs[mode].min.value) || 0;
      const seconds = Number(durationInputs[mode].sec.value) || 0;
      const total = minutes * 60 + seconds;
      if (total > 0) pomodoro.setDuration(mode, total);
    }
    persistPomodoro();
    updateTimerDisplay();
    closeDurationEditor();
  }

  function onPomodoroFinish() {
    NS.playAlarm();
    NS.Room.onAlarm?.();
  }

  function tickPomodoro() {
    pomodoro.tick(onPomodoroFinish);
    updateTimerDisplay();
    updateTimerButton();
    persistPomodoro();
  }

  // --- wiring ---------------------------------------------------------------
  document.getElementById("start-btn").addEventListener("click", () => showScreen("select"));
  document.getElementById("select-back").addEventListener("click", () => showScreen("start"));

  charCards.forEach((card) => card.addEventListener("click", () => selectCard(card.dataset.char)));

  document.getElementById("select-confirm").addEventListener("click", async () => {
    await chrome.storage.local.set({ character: selectedChar });
    petNameEl.textContent = nameFor(selectedChar);
    showScreen("room"); // show first so the stage has real dimensions
    NS.Room.start(selectedChar, lang);
  });

  document.getElementById("room-back").addEventListener("click", () => {
    NS.Room.stop();
    selectCard(selectedChar);
    showScreen("select");
  });

  langButtons.forEach((btn) =>
    btn.addEventListener("click", () => applyLanguage(btn.dataset.lang))
  );

  // Opening Pomodoro does NOT stop the room — the pet keeps running underneath
  // (hidden but alive) so stats keep ticking and it can still react to the alarm.
  // The bottom dock's "Pomodoro" action button is the sole entry point to it.
  document.querySelectorAll('[data-action="pomodoro"]').forEach((btn) =>
    btn.addEventListener("click", () => showScreen("pomodoro"))
  );
  document.getElementById("pomodoro-back").addEventListener("click", () => {
    showScreen("room");
  });

  modeTabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      pomodoro.switchMode(tab.dataset.mode);
      modeTabs.forEach((t) => t.classList.toggle("active", t === tab));
      updateTimerDisplay();
      updateTimerButton();
      persistPomodoro();
    })
  );

  timerToggle.addEventListener("click", () => {
    if (pomodoro.running) {
      pomodoro.pause();
    } else {
      NS.primeAudio(); // real user gesture — safe place to unlock audio output
      pomodoro.start();
    }
    updateTimerButton();
    updateTimerDisplay();
    persistPomodoro();
  });

  timerReset.addEventListener("click", () => {
    pomodoro.reset();
    updateTimerDisplay();
    updateTimerButton();
    persistPomodoro();
  });

  durationEditBtn.addEventListener("click", () => {
    if (durationEditor.hidden) openDurationEditor();
    else closeDurationEditor();
  });
  durationSaveBtn.addEventListener("click", saveDurations);

  taskAddBtn.addEventListener("click", () => {
    if (tasks.length >= MAX_TASKS || addingTask) return;
    addingTask = true;
    renderTasks();
  });

  // --- init: hydrate from saved settings ------------------------------------
  (async () => {
    // Load tasks/pomodoro before applyLanguage(), which calls renderTasks()/
    // updateTimerButton() to refresh their dynamic (non data-i18n) text.
    loadTasks();
    loadPomodoro();

    const saved = await chrome.storage.local.get(["language", "character"]);
    applyLanguage(saved.language || "ja");

    // A character already chosen skips Start/Select entirely and jumps straight
    // into the Room — character selection is a one-time choice; the topbar's
    // "‹" back button is the only way to return to Select afterward (to switch
    // to a different character — all three are freely playable).
    if (saved.character && Array.from(charCards).some((c) => c.dataset.char === saved.character)) {
      selectedChar = saved.character;
      charCards.forEach((c) => c.classList.toggle("selected", c.dataset.char === selectedChar));
      petNameEl.textContent = nameFor(selectedChar);
      showScreen("room");
      NS.Room.start(selectedChar, lang);
    } else {
      selectCard("pink");
      showScreen("start");
    }

    modeTabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === pomodoro.mode));
    updateTimerDisplay();

    window.desktopBridge.onNavigatePomodoro?.(() => {
      showScreen("pomodoro");
    });

    setInterval(tickPomodoro, 1000);
  })();
})();
