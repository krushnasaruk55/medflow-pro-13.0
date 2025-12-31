// Global Utilities

// Loading State
window.showLoading = function (message = 'Loading...') {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.innerHTML = `
            <div class="spinner"></div>
            <div id="loading-text" style="color:white; margin-top:10px; font-weight:500;">${message}</div>
        `;
        document.body.appendChild(overlay);
    } else {
        document.getElementById('loading-text').innerText = message;
        overlay.style.display = 'flex';
    }
};

window.hideLoading = function () {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
};

// Global Error Handler for Fetch
window.fetchWithLoading = async function (url, options = {}) {
    showLoading();
    try {
        const res = await fetch(url, options);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(e);
        // showToast('Network Error', 'error'); // If toast exists
        throw e;
    } finally {
        hideLoading();
    }
};
