/* ============================================================
   CartShare - app.js
   Plain (vanilla) JavaScript. No frameworks, no backend.

   Storage design:
   - localStorage key "cartshare:rooms"   -> ALL rooms, items and activity.
                                             Shared by every tab in the same browser.
   - sessionStorage key "cartshare:session" -> who THIS tab is (name + room code).
                                             Per tab, so you can test two users in two tabs.
   Sync design:
   - The "storage" event tells other tabs when localStorage changed.
   - BroadcastChannel also tells other tabs, in browsers that support it.
   ============================================================ */

/* ---------- 1. Configuration ---------- */
const ROOMS_STORAGE_KEY = 'cartshare:rooms';
const SESSION_STORAGE_KEY = 'cartshare:session';
const SYNC_CHANNEL_NAME = 'cartshare-sync';
const ROOM_CODE_LENGTH = 6;
// Letters and digits without look-alike characters (0/O and 1/I are left out)
const ROOM_CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_NAME_LENGTH = 30;
const MAX_ITEM_NAME_LENGTH = 60;
const MAX_QUANTITY = 999;
const MAX_UNIT_PRICE_DOLLARS = 100000;
const MAX_ACTIVITY_ENTRIES = 100;
const DELIVERY_GOAL_CENTS = 7500;   // $75 free-delivery goal (example from the brief)
const CURRENCY = 'USD';
const ALERT_DURATION_MS = 4000;
const MAX_VISIBLE_ALERTS = 3;

/* ---------- 2. Application state ---------- */
// The session for THIS tab: { name, roomCode } or null
let currentSession = null;
// BroadcastChannel instance, created only if the browser supports it
let syncChannel = null;

/* ---------- 3. DOM references (looked up once) ---------- */
const $ = (id) => document.getElementById(id);

const dom = {
  alertArea: $('alert-area'),
  syncBadge: $('sync-badge'),

  homeView: $('home-view'),
  roomView: $('room-view'),

  createForm: $('create-room-form'),
  createName: $('create-name'),
  createNameError: $('create-name-error'),

  joinForm: $('join-room-form'),
  joinName: $('join-name'),
  joinNameError: $('join-name-error'),
  joinCode: $('join-code'),
  joinCodeError: $('join-code-error'),

  roomCodeDisplay: $('room-code-display'),
  copyCodeButton: $('copy-code-btn'),
  currentUserName: $('current-user-name'),
  leaveRoomButton: $('leave-room-btn'),

  addItemForm: $('add-item-form'),
  itemName: $('item-name'),
  itemNameError: $('item-name-error'),
  itemQuantity: $('item-quantity'),
  itemQuantityError: $('item-quantity-error'),
  itemPrice: $('item-price'),
  itemPriceError: $('item-price-error'),

  itemCountBadge: $('item-count-badge'),
  deliveryGoal: $('delivery-goal'),
  cartEmpty: $('cart-empty'),
  cartTableWrapper: $('cart-table-wrapper'),
  cartBody: $('cart-body'),
  grandTotal: $('grand-total'),

  memberCount: $('member-count'),
  memberList: $('member-list'),
  activityEmpty: $('activity-empty'),
  activityList: $('activity-list'),

  printReceiptButton: $('print-receipt-btn'),
  receiptPrint: $('receipt-print'),
};

/* Pairs each form field with its error message element, so errors can be shown in one place */
const addItemFieldMap = {
  name: { input: dom.itemName, feedback: dom.itemNameError },
  quantity: { input: dom.itemQuantity, feedback: dom.itemQuantityError },
  price: { input: dom.itemPrice, feedback: dom.itemPriceError },
};
const createRoomFieldMap = {
  name: { input: dom.createName, feedback: dom.createNameError },
};
const joinRoomFieldMap = {
  name: { input: dom.joinName, feedback: dom.joinNameError },
  code: { input: dom.joinCode, feedback: dom.joinCodeError },
};

/* =============================================================
   4. Small helper functions
   ============================================================= */

/**
 * Escapes text before it is inserted into HTML.
 * This stops names or item names like "<b>x</b>" from changing the page.
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const replacements = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return replacements[character];
  });
}

/** Creates a reasonably unique id for items and activity entries. */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/** Current time in ISO format (safe to store and sort). */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Converts cents (whole number, e.g. 350) into money text (e.g. "$3.50").
 * All money is kept in cents internally to avoid decimal rounding errors.
 */
function formatCents(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY }).format(cents / 100);
}

/** Turns an ISO timestamp into readable local date and time. */
function formatTimestamp(isoText) {
  return new Date(isoText).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Returns true if two names are the same person, ignoring capital letters. */
function isSameName(firstName, secondName) {
  return firstName.toLowerCase() === secondName.toLowerCase();
}

/* =============================================================
   5. Storage helpers (localStorage for rooms, sessionStorage for this tab)
   ============================================================= */

/** Reads every room from localStorage. Returns an object like { "K7Q2M9": {...} }. */
function loadAllRooms() {
  try {
    const savedText = localStorage.getItem(ROOMS_STORAGE_KEY);
    if (!savedText) {
      return {};
    }
    const parsed = JSON.parse(savedText);
    // Guard against corrupted data: it must be a plain object
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch (error) {
    console.error('Saved room data could not be read. Starting with an empty list.', error);
    return {};
  }
}

/**
 * Writes every room to localStorage, then tells other tabs about the change.
 * Returns true when the save worked.
 */
function saveAllRooms(rooms) {
  try {
    localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms));
  } catch (error) {
    console.error('Could not save room data.', error);
    showAlert('Could not save your changes. Browser storage may be full or turned off.', 'danger');
    return false;
  }
  notifyOtherTabs();
  return true;
}

/** Reads this tab's session (name + room code), or returns null. */
function loadSession() {
  try {
    const savedText = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!savedText) {
      return null;
    }
    const session = JSON.parse(savedText);
    if (session && typeof session.name === 'string' && typeof session.roomCode === 'string') {
      return session;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/** Saves this tab's session so a page refresh keeps the user in the room. */
function saveSession(session) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.error('Could not save the session.', error);
  }
}

/** Removes this tab's session (used when the user leaves a room). */
function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    console.error('Could not clear the session.', error);
  }
}

/* =============================================================
   6. Validation (returns clear messages for the user)
   ============================================================= */

/** Checks a person's name. Returns { value } when valid, or { error } when not. */
function validateName(rawName) {
  const cleanName = rawName.trim().replace(/\s+/g, ' ');
  if (cleanName === '') {
    return { error: 'Please enter your name.' };
  }
  if (cleanName.length > MAX_NAME_LENGTH) {
    return { error: `Your name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  return { value: cleanName };
}

/** Checks a room code. Returns { value } (uppercase) when valid, or { error }. */
function validateRoomCode(rawCode) {
  const cleanCode = rawCode.trim().toUpperCase();
  if (cleanCode === '') {
    return { error: 'Please enter the room code.' };
  }
  const isCorrectLength = cleanCode.length === ROOM_CODE_LENGTH;
  const usesOnlyAllowedCharacters = [...cleanCode].every((character) =>
    ROOM_CODE_CHARACTERS.includes(character)
  );
  if (!isCorrectLength || !usesOnlyAllowedCharacters) {
    return {
      error: `Room codes are ${ROOM_CODE_LENGTH} characters long, using letters A–Z and digits 2–9 (for example K7Q2M9).`,
    };
  }
  return { value: cleanCode };
}

/**
 * Checks the add-item form.
 * Returns { valid: true, value: {...} } or { valid: false, errors: {...} }.
 * Money is converted to whole cents here.
 */
function validateItemInput({ name, quantity, price }) {
  const errors = {};

  // Item name
  const cleanName = name.trim().replace(/\s+/g, ' ');
  if (cleanName === '') {
    errors.name = 'Please enter an item name.';
  } else if (cleanName.length > MAX_ITEM_NAME_LENGTH) {
    errors.name = `Item names must be ${MAX_ITEM_NAME_LENGTH} characters or fewer.`;
  }

  // Quantity: whole number from 1 to 999
  const quantityText = quantity.trim();
  let quantityNumber = 0;
  if (!/^\d+$/.test(quantityText)) {
    errors.quantity = `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`;
  } else {
    quantityNumber = Number(quantityText);
    if (quantityNumber < 1 || quantityNumber > MAX_QUANTITY) {
      errors.quantity = `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`;
    }
  }

  // Unit price: up to 2 decimal places, greater than 0, not above the maximum
  const priceText = price.trim();
  let unitPriceCents = 0;
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(priceText)) {
    errors.price = 'Unit price must be a number with up to 2 decimal places (for example 3.50).';
  } else {
    const priceNumber = Number(priceText);
    if (priceNumber <= 0 || priceNumber > MAX_UNIT_PRICE_DOLLARS) {
      errors.price = `Unit price must be more than $0 and no more than ${formatCents(MAX_UNIT_PRICE_DOLLARS * 100)}.`;
    } else {
      unitPriceCents = Math.round(priceNumber * 100);
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    value: { name: cleanName, quantity: quantityNumber, unitPriceCents },
  };
}

/** Shows error messages next to the right fields. Pass {} to clear all errors. */
function showFieldErrors(errors, fieldMap) {
  Object.entries(fieldMap).forEach(([fieldKey, { input, feedback }]) => {
    const message = errors[fieldKey] || '';
    input.classList.toggle('is-invalid', message !== '');
    feedback.textContent = message;
  });
}

/* =============================================================
   7. Cart calculations
   ============================================================= */

/**
 * Works out each line total and the overall totals for a list of items.
 * Line total = quantity × unit price (in cents), so the maths is exact.
 */
function calculateCart(items) {
  let totalCents = 0;
  let totalUnits = 0;

  const lines = items.map((item) => {
    const lineTotalCents = item.quantity * item.unitPriceCents;
    totalCents += lineTotalCents;
    totalUnits += item.quantity;
    return { ...item, lineTotalCents };
  });

  return { lines, totalCents, totalUnits };
}

/* =============================================================
   8. Room operations (create, join, add, remove, activity log)
   ============================================================= */

/** Makes a random room code that is not already used. */
function generateRoomCode(existingRooms) {
  let code = '';
  do {
    code = '';
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      const randomIndex = Math.floor(Math.random() * ROOM_CODE_CHARACTERS.length);
      code += ROOM_CODE_CHARACTERS[randomIndex];
    }
  } while (existingRooms[code]);
  return code;
}

/** Builds one activity log entry. */
function makeActivityEntry(type, actorName, message) {
  return {
    id: generateId(),
    type,          // 'created', 'joined', 'added' or 'removed'
    actor: actorName,
    message,       // plain text; escaped when displayed
    at: nowIso(),
  };
}

/** Adds an entry to the top of a room's activity log and keeps only the latest entries. */
function addActivityEntry(room, type, actorName, message) {
  room.activity.unshift(makeActivityEntry(type, actorName, message));
  room.activity = room.activity.slice(0, MAX_ACTIVITY_ENTRIES);
}

/**
 * Safely changes one room and saves it.
 * The mutate function changes the room object. Returning false means "nothing changed".
 * Returns true when the change was saved.
 */
function updateRoom(roomCode, mutate) {
  const rooms = loadAllRooms();
  const room = rooms[roomCode];
  if (!room) {
    return false;
  }
  if (mutate(room) === false) {
    return false;
  }
  return saveAllRooms(rooms);
}

/** Creates a new room. Returns the room code, or null if saving failed. */
function createRoom(creatorName) {
  const rooms = loadAllRooms();
  const roomCode = generateRoomCode(rooms);
  const timestamp = nowIso();

  rooms[roomCode] = {
    code: roomCode,
    createdAt: timestamp,
    members: [{ name: creatorName, joinedAt: timestamp }],
    items: [],
    activity: [makeActivityEntry('created', creatorName, `${creatorName} created room ${roomCode}`)],
  };

  return saveAllRooms(rooms) ? roomCode : null;
}

/**
 * Joins an existing room. Returns { ok: true } or { error: "message" }.
 * A name that is already in the room is not added twice, and no duplicate "joined" entry is logged.
 */
function joinRoom(name, roomCode) {
  const rooms = loadAllRooms();
  const room = rooms[roomCode];
  if (!room) {
    return { error: `No room was found with code ${roomCode}. Check the code and try again.` };
  }

  const alreadyMember = room.members.some((member) => isSameName(member.name, name));
  if (!alreadyMember) {
    room.members.push({ name, joinedAt: nowIso() });
    addActivityEntry(room, 'joined', name, `${name} joined the room`);
    if (!saveAllRooms(rooms)) {
      return { error: 'Could not save your join request. Please try again.' };
    }
  }
  return { ok: true };
}

/** Adds an item to the room's cart and logs it. Returns true when saved. */
function addItemToRoom(roomCode, item, contributorName) {
  return updateRoom(roomCode, (room) => {
    room.items.push({
      id: generateId(),
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      contributor: contributorName,
      addedAt: nowIso(),
    });
    addActivityEntry(
      room,
      'added',
      contributorName,
      `${contributorName} added ${item.quantity} × ${item.name} (${formatCents(item.unitPriceCents)} each)`
    );
  });
}

/**
 * Removes an item from the room's cart and logs it.
 * Returns false if the item no longer exists (for example, someone else removed it first).
 */
function removeItemFromRoom(roomCode, itemId, actorName) {
  return updateRoom(roomCode, (room) => {
    const itemIndex = room.items.findIndex((item) => item.id === itemId);
    if (itemIndex === -1) {
      return false; // nothing to remove, so nothing to save
    }
    const [removedItem] = room.items.splice(itemIndex, 1);
    addActivityEntry(
      room,
      'removed',
      actorName,
      `${actorName} removed ${removedItem.quantity} × ${removedItem.name}`
    );
  });
}

/* =============================================================
   9. Sessions and view switching
   ============================================================= */

/** Starts a session for this tab: the user is now inside a room. */
function startSession(name, roomCode) {
  currentSession = { name, roomCode };
  saveSession(currentSession);
}

/** Shows the home page (create/join forms) and hides the room page. */
function showHomeView() {
  dom.homeView.classList.remove('d-none');
  dom.roomView.classList.add('d-none');
}

/** Shows the room page and hides the home page. */
function showRoomView() {
  dom.homeView.classList.add('d-none');
  dom.roomView.classList.remove('d-none');
}

/* =============================================================
   10. Rendering (builds what the user sees from the saved data)
   ============================================================= */

/**
 * Redraws the whole screen from localStorage.
 * This runs after every change, and also when another tab changes the data.
 */
function renderAll() {
  if (!currentSession) {
    showHomeView();
    return;
  }

  const rooms = loadAllRooms();
  const room = rooms[currentSession.roomCode];

  // The room no longer exists in this browser (for example, storage was cleared)
  if (!room) {
    clearSession();
    currentSession = null;
    showHomeView();
    showAlert('That room is no longer saved in this browser. Create or join a room to continue.', 'warning');
    return;
  }

  showRoomView();
  renderRoomHeader(room);
  renderCart(room);
  renderDeliveryGoal(room);
  renderMembers(room);
  renderActivityLog(room);
}

/** Shows the room code and the name of the current user. */
function renderRoomHeader(room) {
  dom.roomCodeDisplay.textContent = room.code;
  dom.currentUserName.textContent = currentSession.name;
}

/** Draws the cart table, line totals and the grand total. */
function renderCart(room) {
  const { lines, totalCents } = calculateCart(room.items);
  const itemCount = room.items.length;

  dom.itemCountBadge.textContent = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;

  if (itemCount === 0) {
    dom.cartEmpty.classList.remove('d-none');
    dom.cartTableWrapper.classList.add('d-none');
    dom.cartBody.innerHTML = '';
    dom.grandTotal.textContent = formatCents(0);
    return;
  }

  dom.cartEmpty.classList.add('d-none');
  dom.cartTableWrapper.classList.remove('d-none');

  dom.cartBody.innerHTML = lines
    .map((line) => {
      const safeName = escapeHtml(line.name);
      const safeId = escapeHtml(line.id);
      return `
        <tr>
          <td class="fw-semibold">${safeName}</td>
          <td class="text-center">${line.quantity}</td>
          <td class="text-end d-none d-sm-table-cell">${formatCents(line.unitPriceCents)}</td>
          <td>${escapeHtml(line.contributor)}</td>
          <td class="text-end fw-semibold">${formatCents(line.lineTotalCents)}</td>
          <td class="text-center">
            <button type="button" class="btn btn-sm btn-outline-danger"
                    data-action="remove-item" data-item-id="${safeId}"
                    aria-label="Remove ${safeName} from the cart">Remove</button>
          </td>
        </tr>`;
    })
    .join('');

  dom.grandTotal.textContent = formatCents(totalCents);
}

/** Draws the free-delivery goal progress bar and a short message. */
function renderDeliveryGoal(room) {
  const { totalCents } = calculateCart(room.items);
  const percent = Math.min(100, Math.round((totalCents / DELIVERY_GOAL_CENTS) * 100));
  const remainingCents = DELIVERY_GOAL_CENTS - totalCents;

  const message = remainingCents > 0
    ? `Add ${formatCents(remainingCents)} more to reach the ${formatCents(DELIVERY_GOAL_CENTS)} free-delivery goal.`
    : `Goal reached! The cart is ${formatCents(-remainingCents)} above the free-delivery goal.`;

  dom.deliveryGoal.innerHTML = `
    <div class="d-flex justify-content-between small fw-semibold mb-1">
      <span>Free-delivery goal</span>
      <span>${percent}%</span>
    </div>
    <div class="progress" role="progressbar" aria-label="Free-delivery goal progress"
         aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-bar" style="width: ${percent}%"></div>
    </div>
    <p class="small cs-muted mt-2 mb-0">${escapeHtml(message)}</p>`;
}

/** Draws the list of people in the room. */
function renderMembers(room) {
  dom.memberCount.textContent = room.members.length;

  dom.memberList.innerHTML = room.members
    .map((member) => {
      const isCurrentUser = isSameName(member.name, currentSession.name);
      const youBadge = isCurrentUser ? ' <span class="badge text-bg-light border">you</span>' : '';
      const initial = escapeHtml(member.name.charAt(0).toUpperCase());
      return `
        <li class="cs-member-item">
          <span class="cs-avatar" aria-hidden="true">${initial}</span>
          <span>${escapeHtml(member.name)}${youBadge}</span>
        </li>`;
    })
    .join('');
}

/** Draws the activity log, newest entries first, with timestamps. */
function renderActivityLog(room) {
  if (room.activity.length === 0) {
    dom.activityEmpty.classList.remove('d-none');
    dom.activityList.innerHTML = '';
    return;
  }

  dom.activityEmpty.classList.add('d-none');
  dom.activityList.innerHTML = room.activity
    .map((entry) => `
      <li class="cs-activity-item activity-${escapeHtml(entry.type)}">
        <div>${escapeHtml(entry.message)}</div>
        <div class="small cs-muted">${escapeHtml(formatTimestamp(entry.at))}</div>
      </li>`)
    .join('');
}

/* =============================================================
   11. Alerts (success, info, warning, danger messages)
   ============================================================= */

/**
 * Shows a message at the top of the page.
 * Errors stay until closed. Other messages disappear after a few seconds.
 * Text is inserted with textContent, so it is always safe.
 */
function showAlert(message, type = 'info') {
  const alertElement = document.createElement('div');
  alertElement.className = `alert alert-${type} alert-dismissible fade show`;
  alertElement.setAttribute('role', type === 'danger' ? 'alert' : 'status');
  alertElement.textContent = message;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn-close';
  closeButton.setAttribute('aria-label', 'Close message');
  closeButton.addEventListener('click', () => alertElement.remove());
  alertElement.appendChild(closeButton);

  dom.alertArea.appendChild(alertElement);

  // Keep the list short so messages do not pile up
  while (dom.alertArea.children.length > MAX_VISIBLE_ALERTS) {
    dom.alertArea.firstElementChild.remove();
  }

  if (type !== 'danger') {
    setTimeout(() => alertElement.remove(), ALERT_DURATION_MS);
  }
}

/* =============================================================
   12. Receipt (printable summary)
   ============================================================= */

/** Builds the receipt HTML for the given room. All text is escaped. */
function buildReceiptHtml(room) {
  const { lines, totalCents, totalUnits } = calculateCart(room.items);
  const printedAt = new Date().toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });

  // Table of items
  const itemRows = lines.length === 0
    ? '<tr><td colspan="6">No items were added to this cart.</td></tr>'
    : lines
        .map((line, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(line.name)}</td>
            <td class="num">${line.quantity}</td>
            <td class="num">${formatCents(line.unitPriceCents)}</td>
            <td>${escapeHtml(line.contributor)}</td>
            <td class="num">${formatCents(line.lineTotalCents)}</td>
          </tr>`)
        .join('');

  // Totals per person, to help split costs fairly
  const contributionByPerson = new Map();
  lines.forEach((line) => {
    const previous = contributionByPerson.get(line.contributor) || 0;
    contributionByPerson.set(line.contributor, previous + line.lineTotalCents);
  });
  const contributorRows = contributionByPerson.size === 0
    ? '<tr><td colspan="2">No contributions yet.</td></tr>'
    : [...contributionByPerson.entries()]
        .map(([personName, personCents]) => `
          <tr>
            <td>${escapeHtml(personName)}</td>
            <td class="num">${formatCents(personCents)}</td>
          </tr>`)
        .join('');

  const participantNames = room.members.map((member) => escapeHtml(member.name)).join(', ');

  return `
    <div class="receipt">
      <header class="receipt-header">
        <h1>CartShare Receipt</h1>
        <p>Room code: <strong>${escapeHtml(room.code)}</strong></p>
        <p>Printed: ${escapeHtml(printedAt)}</p>
        <p>Participants: ${participantNames || 'None'}</p>
      </header>

      <div class="receipt-section-title">Items</div>
      <table class="receipt-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="num">Unit price</th>
            <th>Contributor</th>
            <th class="num">Line total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2">Total units</td>
            <td class="num">${totalUnits}</td>
            <td colspan="2"></td>
            <td></td>
          </tr>
          <tr class="grand-total">
            <td colspan="5">Grand total (estimated)</td>
            <td class="num">${formatCents(totalCents)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="receipt-section-title">Contributions by person</div>
      <table class="receipt-table">
        <thead>
          <tr>
            <th>Contributor</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${contributorRows}</tbody>
      </table>

      <footer class="receipt-footer">
        Estimated total based on prices entered by room members. This is not an official invoice.
      </footer>
    </div>`;
}

/** Builds the receipt for the current room, then opens the browser print dialog. */
function printReceipt() {
  if (!currentSession) {
    return;
  }
  const rooms = loadAllRooms();
  const room = rooms[currentSession.roomCode];
  if (!room) {
    showAlert('The room could not be found, so the receipt was not created.', 'danger');
    return;
  }

  dom.receiptPrint.innerHTML = buildReceiptHtml(room);
  window.print();
}

/* =============================================================
   13. Tab synchronisation (storage event + BroadcastChannel)
   ============================================================= */

/** Tells other tabs in this browser that the saved data changed (BroadcastChannel). */
function notifyOtherTabs() {
  if (syncChannel) {
    syncChannel.postMessage({ type: 'rooms-changed', sentAt: Date.now() });
  }
}

/** Redraws this tab when another tab changed the data. */
function handleExternalChange() {
  if (currentSession) {
    renderAll();
  }
}

/** Sets up the two sync methods. Both only work between tabs of the SAME browser profile. */
function setupTabSync() {
  // Method 1: the browser fires "storage" in OTHER tabs when localStorage changes
  window.addEventListener('storage', (event) => {
    if (event.key === ROOMS_STORAGE_KEY) {
      handleExternalChange();
    }
  });

  // Method 2: BroadcastChannel, where the browser supports it
  if ('BroadcastChannel' in window) {
    syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    syncChannel.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'rooms-changed') {
        handleExternalChange();
      }
    });
    dom.syncBadge.textContent = 'Live sync: tabs in this browser';
  } else {
    dom.syncBadge.textContent = 'Live sync: storage events';
  }
}

/* =============================================================
   14. Event handlers (what happens when the user clicks or types)
   ============================================================= */

/** Create room form. */
function handleCreateRoom(event) {
  event.preventDefault();

  const nameResult = validateName(dom.createName.value);
  showFieldErrors(nameResult.error ? { name: nameResult.error } : {}, createRoomFieldMap);
  if (nameResult.error) {
    dom.createName.focus();
    return;
  }

  const roomCode = createRoom(nameResult.value);
  if (!roomCode) {
    return; // showAlert was already called inside saveAllRooms
  }

  startSession(nameResult.value, roomCode);
  dom.createForm.reset();
  showAlert(`Room ${roomCode} created. Share this code with your group.`, 'success');
  renderAll();
}

/** Join room form. */
function handleJoinRoom(event) {
  event.preventDefault();

  const nameResult = validateName(dom.joinName.value);
  const codeResult = validateRoomCode(dom.joinCode.value);

  const errors = {};
  if (nameResult.error) {
    errors.name = nameResult.error;
  }
  if (codeResult.error) {
    errors.code = codeResult.error;
  }
  showFieldErrors(errors, joinRoomFieldMap);
  if (Object.keys(errors).length > 0) {
    return;
  }

  const joinResult = joinRoom(nameResult.value, codeResult.value);
  if (joinResult.error) {
    showFieldErrors({ code: joinResult.error }, joinRoomFieldMap);
    return;
  }

  startSession(nameResult.value, codeResult.value);
  dom.joinForm.reset();
  showAlert(`You joined room ${codeResult.value}.`, 'success');
  renderAll();
}

/** Add item form. */
function handleAddItem(event) {
  event.preventDefault();

  const result = validateItemInput({
    name: dom.itemName.value,
    quantity: dom.itemQuantity.value,
    price: dom.itemPrice.value,
  });
  showFieldErrors(result.valid ? {} : result.errors, addItemFieldMap);
  if (!result.valid) {
    return;
  }

  const saved = addItemToRoom(currentSession.roomCode, result.value, currentSession.name);
  if (!saved) {
    showAlert('The item could not be added. The room may no longer exist.', 'danger');
    return;
  }

  dom.addItemForm.reset();
  dom.itemQuantity.value = '1';
  dom.itemName.focus();
  showAlert(`Added ${result.value.name} to the cart.`, 'success');
  renderAll();
}

/**
 * Remove button inside the cart table.
 * One listener on the table body handles every remove button (event delegation).
 */
function handleCartClick(event) {
  const removeButton = event.target.closest('[data-action="remove-item"]');
  if (!removeButton || !currentSession) {
    return;
  }

  const itemId = removeButton.dataset.itemId;
  const room = loadAllRooms()[currentSession.roomCode];
  const item = room ? room.items.find((candidate) => candidate.id === itemId) : null;
  if (!item) {
    renderAll();
    return;
  }

  const confirmed = window.confirm(`Remove "${item.name}" from the cart?`);
  if (!confirmed) {
    return;
  }

  const removed = removeItemFromRoom(currentSession.roomCode, itemId, currentSession.name);
  if (removed) {
    showAlert(`Removed ${item.name} from the cart.`, 'info');
  } else {
    showAlert('That item was already removed.', 'warning');
  }
  renderAll();
}

/** Copy the room code to the clipboard. */
async function handleCopyCode() {
  if (!currentSession) {
    return;
  }
  const roomCode = currentSession.roomCode;
  try {
    await navigator.clipboard.writeText(roomCode);
    showAlert(`Room code ${roomCode} copied.`, 'success');
  } catch (error) {
    showAlert(`Copying is not available here. The room code is ${roomCode}.`, 'warning');
  }
}

/** Leave room: this tab forgets the session. The shared cart stays saved in this browser. */
function handleLeaveRoom() {
  const roomCode = currentSession ? currentSession.roomCode : '';
  clearSession();
  currentSession = null;
  showHomeView();
  showAlert(`You left room ${roomCode}. The cart is still saved in this browser.`, 'info');
}

/* =============================================================
   15. Start-up
   ============================================================= */

/** Connects every button and form to its handler. Called once when the page loads. */
function attachEventListeners() {
  dom.createForm.addEventListener('submit', handleCreateRoom);
  dom.joinForm.addEventListener('submit', handleJoinRoom);
  dom.addItemForm.addEventListener('submit', handleAddItem);
  dom.cartBody.addEventListener('click', handleCartClick);
  dom.copyCodeButton.addEventListener('click', handleCopyCode);
  dom.leaveRoomButton.addEventListener('click', handleLeaveRoom);
  dom.printReceiptButton.addEventListener('click', printReceipt);

  // Clear a field's error as soon as the user starts fixing it
  dom.createName.addEventListener('input', () => showFieldErrors({}, createRoomFieldMap));
  dom.joinName.addEventListener('input', () => showFieldErrors({}, joinRoomFieldMap));
  dom.joinCode.addEventListener('input', () => {
    dom.joinCode.value = dom.joinCode.value.toUpperCase();
    showFieldErrors({}, joinRoomFieldMap);
  });
  [dom.itemName, dom.itemQuantity, dom.itemPrice].forEach((input) => {
    input.addEventListener('input', () => showFieldErrors({}, addItemFieldMap));
  });
}

/** Runs when the page is ready. */
function init() {
  setupTabSync();
  attachEventListeners();

  // If this tab already has a session (for example after a refresh), go straight back into the room
  currentSession = loadSession();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
