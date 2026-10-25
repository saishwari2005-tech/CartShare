# CartShare 🛒

CartShare is a shared shopping-cart web app for groups such as student dorms, office teams, or travel groups. One person creates a **room**, shares the six-character **room code**, and everyone in the room adds items to the same cart. The app keeps a live activity log, calculates totals, and creates a printable receipt that shows who contributed what.

The app is a **frontend-only** project built with HTML5, CSS3, Bootstrap 5, and vanilla JavaScript. It stores data in the browser's `localStorage`. It has no backend and no database.

---

## Features

| Requirement from the project brief | How CartShare does it |
| --- | --- |
| User access (login and room joining) | A name form and a room-code form, both with validation (`index.html`, `js/app.js`). |
| Create a room | Generates a unique six-character code using letters A–Z and digits 2–9. Look-alike characters (0, O, 1, I) are excluded. |
| Join a room | Enter the code. Invalid formats and unknown codes show clear error messages. |
| Shared shopping cart | Add and remove items. Each item records its name, quantity, unit price, contributor, and line total. |
| Live activity log | Records every room created, every member who joined, and every item added or removed, with timestamps. The newest entries appear first. |
| Data persistence | Rooms, items, and the activity log are saved in `localStorage`. Refreshing the page keeps everything. |
| Tab synchronisation | Changes appear in other tabs of the same browser using the `storage` event and `BroadcastChannel`. |
| Automatic calculations | Line totals and the grand total are calculated in whole cents, so there are no rounding errors. |
| Printable receipt | "Print receipt" creates a receipt with the room code, print date, items, quantities, unit prices, contributors, line totals, a grand total, and a per-person breakdown. It uses CSS `@media print` rules. |
| Responsive design | Bootstrap 5 grid, CSS Flexbox, and CSS Grid work on phones, tablets, and desktops. |
| Input validation | Required fields, name length, whole-number quantities (1–999), and prices (more than $0, up to two decimals, maximum $100,000) are all checked. |
| Free-delivery goal | A progress bar shows how close the cart is to a $75 delivery threshold. The value is a constant in `js/app.js`, so it is easy to change. |
| Empty states | Friendly messages appear when the cart or activity log is empty. |

---

## Folder structure

```
CartShare/
├── index.html        Main page (home view, room view, hidden receipt area)
├── README.md         This documentation
├── css/
│   └── style.css     Colours, layout polish, cart and receipt styles, print rules
├── js/
│   └── app.js        All application logic (validation, storage, sync, rendering, printing)
└── assets/
    └── favicon.svg   Browser-tab icon
```

Only `index.html`, `README.md`, `css/style.css`, `js/app.js`, and `assets/favicon.svg` are needed. The `assets/` folder holds the favicon, which is the only image file the project uses.

---

## Running the project locally (VS Code + Live Server)

1. Open the `CartShare` folder in VS Code (**File → Open Folder**).
2. Install the **Live Server** extension by Ritwick Dey (search "Live Server" in the Extensions panel, `Ctrl+Shift+X`).
3. Right-click `index.html` in the Explorer and choose **Open with Live Server**. You can also click **Go Live** in the status bar.
4. Your browser opens at `http://127.0.0.1:5500/index.html` (the port may differ).

Bootstrap loads from a CDN, so an internet connection is needed the first time.

---

## Testing the app

### Testing collaboration with multiple users

Each browser tab stores its own user identity, so you can act as different people in different tabs.

1. In **Tab 1**, create a room named "Aisha". Note the room code.
2. In **Tab 2**, open the same page. Join the room with the code, using the name "Ravi".
3. Add items in either tab. The cart and activity log update in both tabs.

Do not use "Duplicate tab" for the second user. A duplicated tab copies the first user's identity. Open a new tab by typing the address, or use a private/incognito window.

### Checklist

- [ ] Create a room. A six-character code appears and the cart opens.
- [ ] Join a room with a valid code. The room opens.
- [ ] Enter an unknown code. An error appears: "No room was found with code…".
- [ ] Enter a code with the wrong length or invalid characters. A format error appears.
- [ ] Leave the name blank. A "Please enter your name" error appears.
- [ ] Add an item. It appears in the table with the correct line total and grand total.
- [ ] Enter quantity 0, 1000, or 2.5. A quantity error appears.
- [ ] Enter price 0, -5, 1.234, or 200000. A price error appears.
- [ ] Remove an item and confirm. It disappears, the totals update, and the log records the removal.
- [ ] Check the activity log. Each action shows a timestamp and the newest entry is at the top.
- [ ] Refresh the page. The room, items, and log are still there.
- [ ] Open two tabs in the same browser. Changes made in one tab appear in the other.
- [ ] Click "Print receipt". The print preview shows only the receipt, with the room code, date, items, contributions, and grand total.
- [ ] Open the page on a phone or in responsive mode (F12 → device toolbar). The layout stacks and the table scrolls sideways if needed.
- [ ] Click "Leave room". You return to the home page, and the room is still saved for others.

---

## Important limitation: what "sync" means

CartShare uses `localStorage`, as the brief requires. This storage belongs to one browser on one device.

- **Works:** Multiple tabs in the same browser. Tabs refresh each other's data almost instantly.
- **Does not work:** Different devices or different people on different computers. Each device has its own separate storage, so a room created on one laptop cannot be seen on a phone.

For real cross-device collaboration, the app would need a backend or real-time database (for example Firebase Firestore, Supabase Realtime, or a Node.js server with WebSockets). That is a separate upgrade and is outside the initial brief.

---

## Deployment

CartShare is static, so it can be hosted for free on GitHub Pages, Netlify, or Vercel.

### Option A: GitHub Pages

1. Create a GitHub repository, for example `CartShare`, and upload the whole folder so that `index.html` is at the top level of the repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose `main`, and select `/ (root)`. Click **Save**.
4. After about a minute, your live URL appears, usually `https://<your-username>.github.io/CartShare/`.

### Option B: Netlify

1. Go to [app.netlify.com](https://app.netlify.com) and sign in with GitHub.
2. Click **Add new site → Import an existing project**, and choose your GitHub repository.
3. Leave the build command empty and set the publish directory to the repository root (`/`). Click **Deploy**.

### Option C: Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. Click **Add New → Project**, import the repository, and click **Deploy**. No build settings are needed.

After deploying, open the live URL in two different browser windows to test the room flow.

---

## Assumptions made

- The brief's $75 delivery threshold is used as the free-delivery goal. Change `DELIVERY_GOAL_CENTS` in `js/app.js` to use a different value.
- Currency is US dollars (`CURRENCY = 'USD'`), as in the brief's example. Change the constant to use another currency.
- Participants are identified by name. Two people with the same name are treated as one member.
- Any member can remove any item, which keeps the group in control of the shared cart.

---

## Submission

- **Repository link:** `https://github.com/<your-username>/CartShare`
- **Live website link:** `https://<your-username>.github.io/CartShare/` (or your Netlify or Vercel URL)
- **Submission name format:** `BatchID_FullName_CartShare`

---

## Technologies

- HTML5
- CSS3 (custom properties, Flexbox, Grid, print media rules)
- Bootstrap 5.3 (CDN)
- Vanilla JavaScript (ES2020+)
- Browser `localStorage`, `sessionStorage`, `storage` event, and `BroadcastChannel`
