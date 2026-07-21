/* Последний шаг анкеты (телефон + предупреждение о передаче данных):
   проходим четыре шага, заполняя поле и нажимая «Далее». */
// ПОСЛЕ:
(async () => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('heroExam').click();
  const values = ['Иван', 'Иванов', 'Казань'];
  for (const v of values) {
    await pause(250);
    const input = document.getElementById('wInput');
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('wNext').click();
  }
  await pause(250);
})();
