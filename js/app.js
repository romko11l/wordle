(function () {
  "use strict";

  const ROWS = 6;
  const COLS = 5;

  // Раскладка ЙЦУКЕН. ⌫ — Backspace, ⏎ — Enter.
  const KEYBOARD_ROWS = [
    ["й", "ц", "у", "к", "е", "н", "г", "ш", "щ", "з", "х", "ъ"],
    ["ф", "ы", "в", "а", "п", "р", "о", "л", "д", "ж", "э"],
    ["⏎", "я", "ч", "с", "м", "и", "т", "ь", "б", "ю", "⌫"],
  ];

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const params = new URLSearchParams(window.location.search);
  const DEBUG = params.has("debug");

  // --- Слово дня -------------------------------------------------------------

  function getDayNumber() {
    const now = new Date();
    const localMidnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const epoch = Date.UTC(2024, 0, 1); // отсчёт дней с 1 января 2024
    return Math.floor((localMidnight - epoch) / 86400000);
  }

  function normalize(w) {
    // Ё трактуем как Е, чтобы не путать игрока.
    return w.toLowerCase().replace(/ё/g, "е");
  }

  const dayNumber = getDayNumber();
  // ?day=N — принудительно открыть слово конкретного дня (для отладки).
  const forcedDay = params.has("day") ? parseInt(params.get("day"), 10) : null;
  const effectiveDay = Number.isFinite(forcedDay) ? forcedDay : dayNumber;

  const wordIndex = ((effectiveDay % WORDS.length) + WORDS.length) % WORDS.length;
  const ANSWER = normalize(WORDS[wordIndex]);

  if (DEBUG) {
    console.log("[Вордли] день:", effectiveDay, "слово:", ANSWER);
  }

  // --- Состояние -------------------------------------------------------------

  const STORAGE_KEY = "wordle_ru_v1";

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.day !== effectiveDay) return null; // другой день — начинаем заново
      return data;
    } catch (e) {
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ day: effectiveDay, guesses: state.guesses, status: state.status })
      );
    } catch (e) {
      /* localStorage может быть недоступен — играем без сохранения */
    }
  }

  const saved = loadState();
  const state = {
    guesses: saved ? saved.guesses : [], // массив завершённых попыток (строки)
    current: "", // текущий набираемый ввод
    status: saved ? saved.status : "playing", // "playing" | "won" | "lost"
  };

  // --- DOM -------------------------------------------------------------------

  const boardEl = document.getElementById("board");
  const keyboardEl = document.getElementById("keyboard");
  const messageEl = document.getElementById("message");
  const overlayEl = document.getElementById("overlay");

  const tiles = []; // tiles[row][col]
  const keyEls = {}; // буква -> элемент клавиши

  function buildBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "row";
      const rowTiles = [];
      for (let c = 0; c < COLS; c++) {
        const tile = document.createElement("div");
        tile.className = "tile";
        rowEl.appendChild(tile);
        rowTiles.push(tile);
      }
      boardEl.appendChild(rowEl);
      tiles.push(rowTiles);
    }
  }

  function buildKeyboard() {
    keyboardEl.innerHTML = "";
    for (const row of KEYBOARD_ROWS) {
      const rowEl = document.createElement("div");
      rowEl.className = "kb-row";
      for (const key of row) {
        const btn = document.createElement("button");
        btn.className = "key";
        btn.textContent = key;
        if (key === "⏎" || key === "⌫") btn.classList.add("wide");
        else keyEls[key] = btn;
        btn.addEventListener("click", () => handleKey(key));
        rowEl.appendChild(btn);
      }
      keyboardEl.appendChild(rowEl);
    }
  }

  // --- Оценка попытки --------------------------------------------------------

  function evaluate(guess) {
    const result = new Array(COLS).fill("absent");
    const answerChars = ANSWER.split("");
    const used = new Array(COLS).fill(false);

    // Первый проход — точные совпадения.
    for (let i = 0; i < COLS; i++) {
      if (guess[i] === answerChars[i]) {
        result[i] = "correct";
        used[i] = true;
      }
    }
    // Второй проход — буквы не на своём месте.
    for (let i = 0; i < COLS; i++) {
      if (result[i] === "correct") continue;
      for (let j = 0; j < COLS; j++) {
        if (!used[j] && guess[i] === answerChars[j]) {
          result[i] = "present";
          used[j] = true;
          break;
        }
      }
    }
    return result;
  }

  const KEY_PRIORITY = { absent: 0, present: 1, correct: 2 };

  function paintKey(letter, status) {
    const el = keyEls[letter];
    if (!el) return;
    const cur = el.dataset.status;
    if (cur && KEY_PRIORITY[cur] >= KEY_PRIORITY[status]) return;
    el.dataset.status = status;
    el.classList.remove("absent", "present", "correct");
    el.classList.add(status);
  }

  // --- Отрисовка -------------------------------------------------------------

  function renderGuess(rowIndex, guess, animate) {
    const result = evaluate(guess);
    for (let i = 0; i < COLS; i++) {
      const tile = tiles[rowIndex][i];
      tile.textContent = guess[i];
      tile.classList.add("filled");
      const apply = () => {
        tile.classList.add(result[i]);
        paintKey(guess[i], result[i]);
      };
      if (animate) {
        setTimeout(() => {
          tile.classList.add("reveal");
          setTimeout(apply, 250);
        }, i * 250);
      } else {
        apply();
      }
    }
  }

  function renderCurrent() {
    const rowIndex = state.guesses.length;
    if (rowIndex >= ROWS) return;
    for (let i = 0; i < COLS; i++) {
      const tile = tiles[rowIndex][i];
      const ch = state.current[i] || "";
      tile.textContent = ch;
      tile.classList.toggle("filled", !!ch);
    }
  }

  function restore() {
    state.guesses.forEach((guess, idx) => renderGuess(idx, guess, false));
  }

  // --- Сообщения и финал -----------------------------------------------------

  let messageTimer = null;
  function flash(text) {
    messageEl.textContent = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => (messageEl.textContent = ""), 1800);
  }

  function shakeRow() {
    const rowEl = boardEl.children[state.guesses.length];
    if (!rowEl) return;
    rowEl.classList.add("shake");
    setTimeout(() => rowEl.classList.remove("shake"), 500);
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("error");
  }

  // --- Финал -----------------------------------------------------------------

  function showOverlay() {
    const titleEl = document.getElementById("overlay-title");
    const textEl = document.getElementById("overlay-text");
    if (state.status === "won") {
      titleEl.textContent = "Победа!";
      textEl.innerHTML = `Отгадано за ${state.guesses.length} из 6.<br><b>${ANSWER.toUpperCase()}</b>`;
    } else {
      titleEl.textContent = "Не угадали";
      textEl.innerHTML = `Загаданное слово:<br><b>${ANSWER.toUpperCase()}</b>`;
    }
    overlayEl.classList.remove("hidden");
  }

  function finish(status) {
    state.status = status;
    saveState();
    setTimeout(showOverlay, COLS * 250 + 400);
    if (tg && tg.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred(status === "won" ? "success" : "error");
    }
  }

  // --- Ввод ------------------------------------------------------------------

  function handleKey(key) {
    if (state.status !== "playing") {
      if (state.guesses.length > 0) showOverlay();
      return;
    }
    if (key === "⏎") return submit();
    if (key === "⌫") {
      state.current = state.current.slice(0, -1);
      renderCurrent();
      return;
    }
    if (state.current.length >= COLS) return;
    state.current += key;
    renderCurrent();
  }

  function submit() {
    if (state.current.length < COLS) {
      flash("Мало букв");
      shakeRow();
      return;
    }
    const guess = state.current;
    const rowIndex = state.guesses.length;
    state.guesses.push(guess);
    state.current = "";
    renderGuess(rowIndex, guess, true);
    saveState();

    if (guess === ANSWER) {
      finish("won");
    } else if (state.guesses.length >= ROWS) {
      finish("lost");
    }
  }

  // Физическая клавиатура (для локальной отладки в браузере).
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter") return handleKey("⏎");
    if (e.key === "Backspace") return handleKey("⌫");
    const ch = normalize(e.key);
    if (/^[а-я]$/.test(ch)) handleKey(ch);
  });

  // --- Закрытие модалки ------------------------------------------------------

  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) overlayEl.classList.add("hidden");
  });

  // --- Telegram интеграция ---------------------------------------------------

  function applyTelegramTheme() {
    if (!tg) return;
    tg.ready();
    tg.expand();
    const tp = tg.themeParams || {};
    const root = document.documentElement.style;
    if (tp.bg_color) root.setProperty("--bg", tp.bg_color);
    if (tp.text_color) root.setProperty("--text", tp.text_color);
    if (tp.hint_color) root.setProperty("--hint", tp.hint_color);
    if (tg.setHeaderColor && tp.bg_color) {
      try { tg.setHeaderColor(tp.bg_color); } catch (e) {}
    }
  }

  // --- Старт -----------------------------------------------------------------

  buildBoard();
  buildKeyboard();
  applyTelegramTheme();
  restore();
  renderCurrent();
  if (state.status !== "playing" && state.guesses.length > 0) {
    setTimeout(showOverlay, 300);
  }
})();
