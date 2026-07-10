document.addEventListener('DOMContentLoaded', async () => {
  const translations = {
    ko: {
      app_subtitle: "브라우저에 사는 펫 설정",
      status_message: "설정은 자동으로 저장됩니다."
    },
    en: {
      app_subtitle: "Browser Pet Settings",
      status_message: "Settings are saved automatically."
    },
    ja: {
      app_subtitle: "ブラウザペットの設定",
      status_message: "設定は自動的に保存されます。"
    }
  };

  const langButtons = document.querySelectorAll('.lang-btn');
  const statusMessage = document.getElementById('status-message');

  function updateLanguage(lang) {
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

  const storage = await chrome.storage.local.get(['language']);
  const savedLang = storage.language || 'ja';
  
  updateLanguage(savedLang);

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
});