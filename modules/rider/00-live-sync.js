(() => {
  const run = () => {
    try {
      if (typeof window.loadOrders === 'function') {
        window.loadOrders(true);
      }
    } catch (e) {
      console.warn('[rider module sync]', e);
    }
  };

  setInterval(run, 20000);
})();
