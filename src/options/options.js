document.addEventListener('DOMContentLoaded', async () => {
  const translations = {
    ko: {
      app_subtitle: "브라우저에 사는 펫 설정",
      char_section_title: "👤 캐릭터 선택",
      pink_desc: "쾌활하고 모험을 즐기는 친구",
      owlet_desc: "차분하고 독서를 좋아하는 친구",
      dude_desc: "호기심 많고 장난기 가득한 친구",
      lang_section_title: "🌐 언어 설정 (Language)",
      status_message: "설정은 자동으로 저장됩니다."
    },
    en: {
      app_subtitle: "Browser Pet Settings",
      char_section_title: "👤 Select Character",
      pink_desc: "Cheerful and loves adventure",
      owlet_desc: "Gentle and loves reading books",
      dude_desc: "Curious and full of mischief",
      lang_section_title: "🌐 Language Settings",
      status_message: "Settings are saved automatically."
    },
    ja: {
      app_subtitle: "ブラウザペットの設定",
      char_section_title: "👤 キャラクター選択",
      pink_desc: "陽気で冒険が大好きな友達",
      owlet_desc: "おとなしくて読書が大好きな友達",
      dude_desc: "好奇心旺盛でいたずら好きな友達",
      lang_section_title: "🌐 言語設定 (Language)",
      status_message: "設定は自動的に保存されます。"
    }
  };

  const langButtons = document.querySelectorAll('.lang-btn');
  const charCards = document.querySelectorAll('.char-card');
  const statusMessage = document.getElementById('status-message');

  let currentLang = "ja";

  function updateLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;

    const elementsToTranslate = document.querySelectorAll('[data-i18n]');
    elementsToTranslate.forEach(element => {
      const translationKey = element.getAttribute('data-i18n');
      if (translations[lang] && translations[lang][translationKey]) {
        element.textContent = translations[lang][translationKey];
      }
    });

    langButtons.forEach(btn => {
      if (btn.getAttribute('data-lang') === lang) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  const storage = await chrome.storage.local.get(['language', 'character']);
  const savedLang = storage.language || 'ja';
  const savedChar = storage.character || 'pink';

  updateLanguage(savedLang);
  document.querySelector(`[data-char="${savedChar}"]`)?.classList.add('selected');

  langButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const selectedLang = button.getAttribute('data-lang');
      await chrome.storage.local.set({ language: selectedLang });
      updateLanguage(selectedLang);
      
      const saveFeedback = {
        ko: "설정 완료!",
        en: "Saved!",
        ja: "保存完了！"
      };
      
      statusMessage.textContent = saveFeedback[selectedLang];
      setTimeout(() => {
        updateLanguage(selectedLang);
      }, 1500);
    });
  });

  charCards.forEach(card => {
    card.addEventListener('click', async () => {
      const selectedChar = card.getAttribute('data-char');
      
      charCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      await chrome.storage.local.set({ character: selectedChar });

      const charSaveFeedback = {
        ko: "캐릭터 변경 완료!",
        en: "Character changed!",
        ja: "キャラクター変更完了！"
      };

      statusMessage.textContent = charSaveFeedback[currentLang];
      setTimeout(() => {
        updateLanguage(currentLang);
      }, 1500);
    });
  });
});