const monthLabel = document.getElementById('month-label');
const weekdayRow = document.getElementById('weekday-row');
const calendarGrid = document.getElementById('calendar-grid');
const prevMonthBtn = document.getElementById('prev-month-btn');
const nextMonthBtn = document.getElementById('next-month-btn');

function hasCalendarDom() {
  return Boolean(monthLabel && weekdayRow && calendarGrid);
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const statusOrder = ['available', 'hold', 'soldout'];
const statusLabels = {
  available: 'Available',
  hold: 'Hold',
  soldout: 'Sold out'
};
const STORAGE_URL = window.location.hostname.endsWith('github.io') ? null : '/api/bookings';
const LOCAL_STORAGE_KEY = 'vagamon-bookings-state';
const SESSION_STORAGE_KEY = 'vagamon-bookings-session-state';
const AUTO_SYNC_INTERVAL_MS = 5000;
const stateChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('vagamon-bookings') : null;

const today = new Date();
const currentYear = today.getFullYear();
const MIN_VISIBLE_MONTH = 7;
const MAX_VISIBLE_MONTH = 11;
let currentMonth = new Date(currentYear, MIN_VISIBLE_MONTH, 1);
const calendarState = new Map();

function getSafeStorage(storageName) {
  if (typeof window === 'undefined' || !window[storageName]) {
    return null;
  }

  try {
    return window[storageName];
  } catch (error) {
    console.warn(`Unable to access ${storageName}:`, error);
    return null;
  }
}

function readStoredState(storage, storageKey) {
  if (!storage) {
    return null;
  }

  try {
    const savedState = storage.getItem(storageKey);
    if (!savedState) {
      return null;
    }

    return JSON.parse(savedState);
  } catch (error) {
    console.warn('Unable to read stored calendar state:', error);
    return null;
  }
}

function persistState(storage, storageKey, stateObject) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(storageKey, JSON.stringify(stateObject));
  } catch (error) {
    console.warn('Unable to persist calendar state:', error);
  }
}

function loadLocalState() {
  const storageSources = [
    { storage: getSafeStorage('localStorage'), storageKey: LOCAL_STORAGE_KEY },
    { storage: getSafeStorage('sessionStorage'), storageKey: SESSION_STORAGE_KEY }
  ];

  storageSources.some(({ storage, storageKey }) => {
    const parsedState = readStoredState(storage, storageKey);
    if (!parsedState) {
      return false;
    }

    Object.entries(parsedState).forEach(([dateKey, status]) => {
      if (statusOrder.includes(status)) {
        calendarState.set(dateKey, status);
      }
    });

    return Object.keys(parsedState).length > 0;
  });
}

function saveLocalState() {
  const stateObject = Object.fromEntries(calendarState);
  persistState(getSafeStorage('localStorage'), LOCAL_STORAGE_KEY, stateObject);
  persistState(getSafeStorage('sessionStorage'), SESSION_STORAGE_KEY, stateObject);
}

function setSyncStatus(message) {
  const syncStatus = document.getElementById('sync-status');
  if (syncStatus) {
    syncStatus.textContent = message;
  }
}

function publishLocalState() {
  if (stateChannel) {
    stateChannel.postMessage(getStateObject());
  }
}

async function loadRemoteState() {
  if (!hasCalendarDom()) {
    return;
  }

  if (!STORAGE_URL) {
    setSyncStatus('Saved on this device. Open tabs update automatically.');
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    const response = await fetch(STORAGE_URL, { cache: 'no-store', signal: controller.signal });
    window.clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('Unable to fetch remote state');
    }

    const data = await response.json();
    const hasChanges = applyRemoteState(data);
    saveLocalState();

    if (hasChanges) {
      renderCalendar();
    }
    setSyncStatus('Synced across devices. Changes save automatically.');
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.warn('Unable to sync calendar state remotely:', error);
      setSyncStatus('Remote sync unavailable. Changes are saved on this device.');
    }
  }
}

async function saveRemoteState() {
  if (!hasCalendarDom()) {
    return;
  }

  const stateObject = getStateObject();
  saveLocalState();

  if (!STORAGE_URL) {
    setSyncStatus('Saved on this device. Open tabs update automatically.');
    return;
  }

  if (typeof window !== 'undefined' && window.navigator && window.navigator.onLine === false) {
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    const response = await fetch(STORAGE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stateObject),
      cache: 'no-store',
      signal: controller.signal
    });
    window.clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('Unable to save remote state');
    }
    setSyncStatus('Synced across devices. Changes save automatically.');
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.warn('Unable to sync calendar state remotely:', error);
      setSyncStatus('Remote sync unavailable. Changes are saved on this device.');
    }
  }
}

function getStateObject() {
  return Object.fromEntries(calendarState);
}

function applyRemoteState(data) {
  let hasChanges = false;

  if (data && typeof data === 'object') {
    Object.entries(data).forEach(([dateKey, status]) => {
      if (statusOrder.includes(status)) {
        const previousStatus = calendarState.get(dateKey);
        if (previousStatus !== status) {
          calendarState.set(dateKey, status);
          hasChanges = true;
        }
      }
    });
  }

  return hasChanges;
}

function updateNavigationState() {
  if (!prevMonthBtn || !nextMonthBtn) {
    return;
  }

  const monthIndex = currentMonth.getFullYear() * 12 + currentMonth.getMonth();
  const startIndex = currentYear * 12 + MIN_VISIBLE_MONTH;
  const endIndex = currentYear * 12 + MAX_VISIBLE_MONTH;

  prevMonthBtn.disabled = monthIndex <= startIndex;
  nextMonthBtn.disabled = monthIndex >= endIndex;
}

function attachMonthNavigation() {
  if (!prevMonthBtn || !nextMonthBtn) {
    return;
  }

  prevMonthBtn.addEventListener('click', () => {
    const monthIndex = currentMonth.getFullYear() * 12 + currentMonth.getMonth();
    const startIndex = currentYear * 12 + MIN_VISIBLE_MONTH;

    if (monthIndex > startIndex) {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
      renderCalendar();
    }
  });

  nextMonthBtn.addEventListener('click', () => {
    const monthIndex = currentMonth.getFullYear() * 12 + currentMonth.getMonth();
    const endIndex = currentYear * 12 + MAX_VISIBLE_MONTH;

    if (monthIndex < endIndex) {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
      renderCalendar();
    }
  });
}

function renderCalendar() {
  if (!hasCalendarDom()) {
    return;
  }

  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return;
  }

  if (!weekdayRow || typeof weekdayRow.innerHTML === 'undefined' || !calendarGrid || typeof calendarGrid.innerHTML === 'undefined') {
    return;
  }

  updateNavigationState();

  monthLabel.textContent = currentMonth.toLocaleDateString('en', {
    month: 'long',
    year: 'numeric'
  });

  weekdayRow.innerHTML = '';
  weekdays.forEach((day) => {
    const label = document.createElement('div');
    label.className = 'weekday';
    label.textContent = day;
    weekdayRow.appendChild(label);
  });

  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const prevMonthDays = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 0).getDate();

  calendarGrid.innerHTML = '';

  for (let i = 0; i < firstDay; i += 1) {
    const cell = document.createElement('button');
    cell.className = 'date-cell muted';
    cell.type = 'button';
    cell.disabled = true;
    const dayNumber = prevMonthDays - firstDay + i + 1;
    cell.innerHTML = `<span class="day-number">${dayNumber}</span><span class="status-label">Prev</span>`;
    calendarGrid.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cell = document.createElement('button');
    if (!cell) {
      continue;
    }

    cell.type = 'button';
    const dateKey = `${currentMonth.getFullYear()}-${currentMonth.getMonth() + 1}-${day}`;
    const status = calendarState.get(dateKey) || 'available';
    if (cell.dataset) {
      cell.dataset.status = status;
    }
    cell.className = `date-cell ${status}`;
    cell.innerHTML = `<span class="day-number">${day}</span><span class="status-label">${statusLabels[status]}</span>`;

    if (typeof cell.addEventListener === 'function') {
      cell.addEventListener('click', async () => {
        const currentStatus = cell.dataset.status || 'available';
        const nextIndex = (statusOrder.indexOf(currentStatus) + 1) % statusOrder.length;
        const nextStatus = statusOrder[nextIndex];
        cell.dataset.status = nextStatus;
        cell.className = `date-cell ${nextStatus}`;
        cell.innerHTML = `<span class="day-number">${day}</span><span class="status-label">${statusLabels[nextStatus]}</span>`;
        calendarState.set(dateKey, nextStatus);
        saveLocalState();
        publishLocalState();
        renderCalendar();
        await saveRemoteState();
        window.setTimeout(() => {
          loadRemoteState();
        }, 800);
      });
    }

    calendarGrid.appendChild(cell);
  }

  const fillCount = (7 - ((firstDay + daysInMonth) % 7)) % 7;
  for (let i = 0; i < fillCount; i += 1) {
    const cell = document.createElement('button');
    cell.className = 'date-cell muted';
    cell.type = 'button';
    cell.disabled = true;
    cell.innerHTML = `<span class="day-number">${i + 1}</span><span class="status-label">Next</span>`;
    calendarGrid.appendChild(cell);
  }
}

function startAutoSync() {
  if (!hasCalendarDom()) {
    return;
  }

  window.setInterval(() => {
    loadRemoteState();
  }, AUTO_SYNC_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadRemoteState();
    }
  });

  window.addEventListener('focus', () => {
    loadRemoteState();
  });

  window.addEventListener('online', () => {
    loadRemoteState();
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== LOCAL_STORAGE_KEY || !event.newValue) {
      return;
    }

    const nextState = readStoredState(getSafeStorage('localStorage'), LOCAL_STORAGE_KEY);
    if (nextState) {
      const hasChanges = applyRemoteState(nextState);
      if (hasChanges) {
        renderCalendar();
      }
    }
  });

  if (stateChannel) {
    stateChannel.addEventListener('message', (event) => {
      const hasChanges = applyRemoteState(event.data);
      if (hasChanges) {
        saveLocalState();
        renderCalendar();
      }
    });
  }
}

async function init() {
  if (!hasCalendarDom()) {
    return;
  }

  loadLocalState();
  await loadRemoteState();
  attachMonthNavigation();
  renderCalendar();
  startAutoSync();
}

window.addEventListener('beforeunload', saveLocalState);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
