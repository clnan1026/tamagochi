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
      feed_button: "🍖 Feed",
      play_button: "🎮 Play",
      fainted_msg: "Your friend fainted…",
      revive_button: "Revive",
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
      feed_button: "🍖 ごはん",
      play_button: "🎮 あそぶ",
      fainted_msg: "お友達が倒れちゃった…",
      revive_button: "元気にする",
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
      feed_button: "🍖 먹이",
      play_button: "🎮 놀기",
      fainted_msg: "친구가 기절했어요…",
      revive_button: "깨우기",
    },
  };

  const screens = {
    start: document.getElementById("screen-start"),
    select: document.getElementById("screen-select"),
    room: document.getElementById("screen-room"),
  };
  const charCards = document.querySelectorAll("#screen-select .char-card");
  const langButtons = document.querySelectorAll(".lang-btn");
  const petNameEl = document.getElementById("room-pet-name");

  let lang = "ja";
  let selectedChar = "pink";

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
  }

  function selectCard(char) {
    selectedChar = char;
    charCards.forEach((c) => c.classList.toggle("selected", c.dataset.char === char));
  }

  function nameFor(char) {
    return { pink: "Pinky", owlet: "Owlet", dude: "Dudy" }[char] || char;
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

  // --- init: hydrate from saved settings ------------------------------------
  (async () => {
    const saved = await chrome.storage.local.get(["language", "character"]);
    applyLanguage(saved.language || "ja");
    selectCard(saved.character || "pink");
  })();
})();
