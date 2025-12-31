// i18n.js - Internationalization Script for MedFlow Pro

// Default to English if no preference saved
let currentLanguage = localStorage.getItem('medflow_lang') || 'en';

document.addEventListener('DOMContentLoaded', () => {
    // Determine current page to handle specific updates (like document.title)
    const page = window.location.pathname.split('/').pop().replace('.html', '');

    // Initialize UI with current language
    changeLanguage(currentLanguage);

    // Setup toggle button event listener if it exists
    const langSelect = document.getElementById('languageSelect');
    if (langSelect) {
        langSelect.value = currentLanguage;
        langSelect.addEventListener('change', (e) => {
            changeLanguage(e.target.value);
        });
    }

    // Additional observer to handle dynamic content (like rows added by JS)
    // using a MutationObserver to re-translate or apply translation logic if dynamic elements are added
    const observer = new MutationObserver((mutations) => {
        // Debounce simple re-translation or check specific nodes
        // For simplicity, we might re-run translation on specific container updates
        // This is a basic implementation. Ideally dynamic content should be translated at generation time.
    });
});

// Auth UI Logic: Hide "Home" link if user is logged in (Hospital User)
// This runs on all pages including index, reception, doctor etc.
document.addEventListener('DOMContentLoaded', () => {
    const hospitalId = sessionStorage.getItem('hospitalId');
    if (hospitalId) {
        // Find and hide Home link in navigation
        const homeLinks = document.querySelectorAll('a[href="index.html"]');
        homeLinks.forEach(link => {
            // Verify it's a nav link by context or attributes
            if (link.closest('.main-nav') || link.getAttribute('data-i18n') === 'nav.home' || link.innerText.trim() === 'Home') {
                link.style.display = 'none';
            }
        });
    }
});

function changeLanguage(lang) {
    if (!translations[lang]) return;

    currentLanguage = lang;
    localStorage.setItem('medflow_lang', lang);

    const t = translations[lang];

    // Apply translations to elements with data-i18n attribute
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) {
            // Handle input placeholders specifically
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = t[key];
            } else {
                // For other elements, we usually want to update innerHTML or textContent
                // If the element has children (like icons), we might need to be careful.
                // For this implementation, we assume text-only or specific span wrappers.
                // If element has a 'data-i18n-target' attribute, use that (e.g. 'placeholder', 'title')
                const target = el.getAttribute('data-i18n-target');
                if (target === 'placeholder') {
                    el.placeholder = t[key];
                } else if (target === 'title') {
                    el.title = t[key];
                } else if (target === 'value') {
                    el.value = t[key];
                } else {
                    el.textContent = t[key];
                }
            }
        }
    });

    // Special handling for drop-down options if they have data-i18n
    const optionElements = document.querySelectorAll('option[data-i18n]');
    optionElements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) el.textContent = t[key];
    });

    // Update document title if mapped
    // (This part is optional but good polish)
    // We could map document titles in translations.js as well.
}

// Helper for dynamic JS strings
function translate(key) {
    if (translations[currentLanguage] && translations[currentLanguage][key]) {
        return translations[currentLanguage][key];
    }
    return key; // Fallback to key if not found
}
