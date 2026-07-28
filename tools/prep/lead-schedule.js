/* Последний шаг записи на урок: выбор дня и времени. Проходим четыре
   шага анкеты, заполняя поле и нажимая «Далее». */
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
