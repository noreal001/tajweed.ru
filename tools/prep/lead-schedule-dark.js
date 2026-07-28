/* То же в тёмной теме. */
localStorage.setItem('tajweed_theme', 'dark');
// ПОСЛЕ:
(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const values = ['Ахмад', 'Идрисов', 'Грозный', '+79001234567'];
  for (const v of values) {
    await pause(280);
    const input = document.getElementById('wInput');
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('wNext').click();
  }
  await pause(500);
})();
