/* Последний шаг анкеты в тёмной теме. */
localStorage.setItem('tajweed_theme', 'dark');
// ПОСЛЕ:
(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('heroExam').click();
  for (const v of ['Иван', 'Иванов', 'Казань']) {
    await pause(250);
    const input = document.getElementById('wInput');
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('wNext').click();
  }
  await pause(250);
})();
