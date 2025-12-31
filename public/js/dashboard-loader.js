// Dashboard Loader functionality to standardize initialization
// Using simple UMD pattern for compatibility

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DashboardLoader = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const DashboardLoader = {
        init: function () {
            console.log('Dashboard Loader Initialized');
            this.setupGlobalHandlers();
        },

        setupGlobalHandlers: function () {
            // Global error handler for fetch
            const originalFetch = window.fetch;
            window.fetch = async function (...args) {
                try {
                    const response = await originalFetch(...args);
                    if (response.status === 401) {
                        // Handle unauthorized access globally
                        console.warn('Unauthorized access detected, redirecting to login...');
                        // Optional: window.location.href = '/login.html';
                    }
                    return response;
                } catch (error) {
                    console.error('Network request failed:', error);
                    throw error;
                }
            };
        }
    };

    // Auto-init on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => DashboardLoader.init());
    } else {
        DashboardLoader.init();
    }

    return DashboardLoader;
}));
