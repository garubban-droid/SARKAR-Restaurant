(() => {
  const run = () => {
    try {
      if (typeof window.productionAdminLoad === 'function') {
        window.productionAdminLoad();
      }
    } catch (e) {
      console.warn('[admin module sync]', e);
    }
  };

  setInterval(run, 30000);
})();
