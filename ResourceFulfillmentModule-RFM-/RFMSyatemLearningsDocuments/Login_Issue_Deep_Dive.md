# Login Issue Deep Dive — From Bug to Permanent Engineering Upgrade

> **Context**: Login page rendered correctly. Clicking Login triggered an infinite spinner.  
> No error was ever displayed. The Network tab showed an OPTIONS request. POST was either  
> pending or never completed. The UI never recovered.

---

## 1️⃣ Root Cause Explanation (First Principles)

### What Actually Happened in This Codebase

Four zombie Python/uvicorn processes (including one from the previous day) were **all bound
to port 8000** simultaneously. The OS allowed multiple `LISTENING` sockets because uvicorn's
`--reload` flag spawns child watchers, and previous VS Code sessions had exited without
cleanly terminating them. The result:

```
TCP  127.0.0.1:8000  0.0.0.0:0  LISTENING  31340   ← zombie
TCP  127.0.0.1:8000  0.0.0.0:0  LISTENING  54240   ← zombie (from yesterday)
TCP  127.0.0.1:8000  0.0.0.0:0  LISTENING  35744   ← zombie
TCP  127.0.0.1:8000  0.0.0.0:0  LISTENING  44376   ← zombie
```

When the browser sent a request to `127.0.0.1:8000`, the **OS kernel's TCP stack** picked
one of these listeners via its internal load-balancing (SO_REUSEADDR). The request landed
on a zombie process that had accepted the TCP connection but had **no active event loop**
processing HTTP frames. The TCP 3-way handshake succeeded (SYN → SYN-ACK → ACK), so from
the browser's perspective the connection was established. But no HTTP response ever came.

### Why the Spinner Stayed Forever

The AuthContext login function had this structure:

```tsx
const login = async (username: string, password: string) => {
  setIsLoading(true);       // ← Spinner ON
  setError(null);
  try {
    const response = await fetch(apiUrl, { ... });  // ← Hangs here forever
    // ... process response ...
  } catch (err) {
    setError(message);
  } finally {
    setIsLoading(false);    // ← Spinner OFF — but this NEVER runs
  }
};
```

**The `await fetch(...)` line is where everything froze.** Here's the precise chain:

1. `fetch()` returns a `Promise<Response>`.
2. The Promise transitions to **settled** (fulfilled or rejected) only when:
   - The TCP connection fails entirely → rejected
   - The server sends back HTTP headers → fulfilled
   - The browser-level timeout fires (browsers have **no default fetch timeout**)
3. In our case, TCP connected successfully (zombie accepted the socket), but no HTTP
   response was ever sent. The Promise **stayed pending indefinitely**.
4. `await` on a pending Promise **suspends the async function** at that line. Execution
   never reaches `catch`, never reaches `finally`.
5. `setIsLoading(false)` never executes. React state stays `{ isLoading: true }`.
6. The spinner component keeps rendering because `isLoading` is `true`.

This is not a React bug. This is **Promise fundamentals**: `await` on a never-settling
Promise is an infinite suspension.

### Why React State Did Not Recover

React state is just a value in a closure. It changes only when you call `setState`. Nobody
called `setIsLoading(false)` because the only path to it (`finally`) was blocked by the
suspended `await`. React has no concept of "state timeout" — it trusts your code to
eventually call the setter.

There's no garbage collection for pending Promises either. A Promise that never settles is
just a JavaScript object in memory with status `[[PromiseState]]: "pending"` forever. The
async function's execution context stays alive on the microtask queue, waiting for a
resolution that will never come.

### What It Means When Fetch Never Resolves

`fetch()` internally uses the browser's **Fetch API**, which sits atop the network stack:

```
fetch() → Fetch API → HTTP/2 or HTTP/1.1 framing → TLS (if https) → TCP → IP → NIC
```

When TCP connects but the server never sends HTTP headers:

- The browser keeps the **TCP socket open**, waiting for data.
- `fetch()` is waiting for at least the **status line** (`HTTP/1.1 200 OK\r\n`).
- Without that first line, `fetch()` cannot construct a `Response` object.
- The Promise stays pending. No rejection. No timeout. Just... waiting.

Browsers do NOT impose a default timeout on `fetch()`. This is by design — the Fetch spec
says the user agent "should" support timeouts but doesn't mandate one. Chrome, Firefox, and
Edge all allow `fetch()` to wait indefinitely by default.

### OPTIONS vs POST — What the Network Tab Was Showing

When you saw an `OPTIONS` request in DevTools, you were seeing a **CORS preflight**. Here's
why:

The login request was:
```
POST http://localhost:8000/api/auth/login
Content-Type: application/json    ← This header triggers preflight
Origin: http://localhost:5173     ← Different port = cross-origin
```

This is a **non-simple request** because:
- Method: POST (can be simple, but...)
- Content-Type: `application/json` (NOT one of the three "simple" types)
- Cross-origin (port 5173 → port 8000)

So the browser **must** send a preflight OPTIONS request first, before the actual POST.

If the preflight OPTIONS itself hangs (zombie server accepted TCP but never responded),
the browser **never sends the POST at all**. You see the OPTIONS as "pending" and the POST
doesn't even appear in the Network tab.

### How CORS Preflight Works Internally

```
┌──────────┐                              ┌──────────┐
│  Browser  │                              │  Server   │
│ port 5173 │                              │ port 8000 │
└─────┬─────┘                              └─────┬─────┘
      │                                          │
      │  1. JavaScript calls fetch()              │
      │                                          │
      │  2. Browser checks: Is this cross-origin? │
      │     Origin: localhost:5173                │
      │     Target: localhost:8000                │
      │     → YES (different port = different origin)
      │                                          │
      │  3. Browser checks: Is this a "simple" request?
      │     Content-Type: application/json        │
      │     → NO (json is not simple)             │
      │                                          │
      │  4. Browser sends preflight:              │
      │  ─── OPTIONS /api/auth/login ──────────→ │
      │  │ Origin: http://localhost:5173          │
      │  │ Access-Control-Request-Method: POST    │
      │  │ Access-Control-Request-Headers:        │
      │  │   content-type                         │
      │                                          │
      │  5. Server responds with CORS headers:    │
      │  ←── 200 OK ──────────────────────────── │
      │  │ Access-Control-Allow-Origin:           │
      │  │   http://localhost:5173                │
      │  │ Access-Control-Allow-Methods: POST     │
      │  │ Access-Control-Allow-Headers:          │
      │  │   content-type                         │
      │  │ Access-Control-Allow-Credentials: true │
      │                                          │
      │  6. Browser validates CORS headers        │
      │     → Origin is allowed ✓                 │
      │     → Method is allowed ✓                 │
      │     → Headers are allowed ✓               │
      │                                          │
      │  7. Browser sends actual request:         │
      │  ─── POST /api/auth/login ─────────────→ │
      │  │ Content-Type: application/json         │
      │  │ Body: {"username":"x","password":"y"}  │
      │                                          │
      │  8. Server processes and responds:        │
      │  ←── 200 OK ──────────────────────────── │
      │  │ {"access_token":"eyJ...","token_type":"bearer"}
      │                                          │
      │  9. Browser delivers Response to fetch()  │
      │     Promise resolves                      │
      │                                          │
```

If step 4 hangs (server accepts TCP but sends no HTTP response), steps 5–9 never happen.
The fetch() Promise stays pending. The browser does NOT throw an error — it just waits.

### Why the Browser Can Silently Block Requests

The browser is a **security sandbox**. It can block, delay, or modify your requests without
telling JavaScript about it. Scenarios where this happens:

1. **CORS preflight fails**: Browser gets a response but the headers don't match. Browser
   rejects the actual request. `fetch()` rejects with a `TypeError`. DevTools shows a red
   CORS error. JavaScript gets a generic "Failed to fetch" — the actual CORS error details
   are **intentionally hidden** from JS for security.

2. **CORS preflight hangs**: Server never responds to OPTIONS. Browser waits. No error
   until the browser's internal TCP timeout (varies: Chrome ~300s, Firefox ~90s).

3. **Mixed content**: HTTPS page trying to fetch HTTP. Silently blocked in some browsers.

4. **Content Security Policy**: CSP header blocks the request domain entirely.

5. **Service Worker intercept**: A rogue or stale service worker eats the request.

### The Four Failure Modes — How to Distinguish Them

| Failure Mode | TCP Connects? | OPTIONS Response? | POST Response? | fetch() behavior |
|---|---|---|---|---|
| **Network failure** (server down, port closed) | ❌ No | N/A | N/A | Rejects with `TypeError: Failed to fetch` — fast (ms) |
| **CORS rejection** (server responds but wrong headers) | ✅ Yes | ✅ Yes (wrong headers) | ❌ Never sent | Rejects with `TypeError: Failed to fetch` — fast |
| **Backend hang** (zombie process, deadlock) | ✅ Yes | ⏳ Pending or ✅ Yes | ⏳ Pending forever | **Never settles** — this was our bug |
| **Wrong base URL** (404, wrong path) | ✅ Yes | ✅ Yes | ✅ Yes (404) | Resolves with `response.ok === false` |

**Key insight**: Only "Backend hang" causes an infinite spinner. The other three either
reject the Promise (triggering `catch`) or resolve it (allowing you to check `response.ok`).

---

## 2️⃣ Full Request Lifecycle Walkthrough

Here is exactly what happens when you click Login, traced through every layer:

### Step 1: React onClick Handler

```
User clicks "Login" button
  → <form onSubmit={handleSubmit}>
  → handleSubmit(e) calls e.preventDefault()
  → handleSubmit calls login(username, password) from AuthContext
```

The `login` function is async, so `handleSubmit` gets a Promise back. If `handleSubmit`
doesn't `await` it or handle its rejection, any error from `login` becomes an
**unhandled Promise rejection** (shows as console warning, not UI error).

### Step 2: AuthContext login() Executes

```tsx
setIsLoading(true)    // React schedules a re-render with isLoading=true
setError(null)        // React schedules a re-render with error=null
```

**Important**: `setIsLoading(true)` does NOT immediately re-render. React batches state
updates. The actual re-render (showing the spinner) happens after the current synchronous
call stack completes. But since the next line is `await fetch(...)`, the function suspends
and React gets control back to render.

### Step 3: fetch() — Browser Takes Over

```tsx
const response = await fetch(apiUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
  signal: controller.signal,   // ← AbortController (added in our fix)
});
```

When `fetch()` is called, JavaScript hands the request to the **browser's network stack**.
From here, JS has zero control until a Response comes back (or the AbortController fires).

### Step 4: Browser Preflight (Automatic)

The browser sees:
- Origin: `http://localhost:5173`
- Target: `http://localhost:8000`  (different port = cross-origin)
- Content-Type: `application/json` (not a "simple" type)

→ **Preflight required.** Browser constructs and sends:

```http
OPTIONS /api/auth/login HTTP/1.1
Host: localhost:8000
Origin: http://localhost:5173
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type
```

### Step 5: CORS Validation

FastAPI's `CORSMiddleware` intercepts the OPTIONS request and responds:

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
Access-Control-Allow-Headers: content-type
Access-Control-Allow-Credentials: true
```

Browser validates:
- `Allow-Origin` includes our origin ✓
- `Allow-Methods` includes POST ✓
- `Allow-Headers` includes content-type ✓

→ **Preflight passes.** Browser proceeds with the actual POST.

### Step 6: Actual POST Request

```http
POST /api/auth/login HTTP/1.1
Host: localhost:8000
Origin: http://localhost:5173
Content-Type: application/json

{"username":"admin","password":"secret123"}
```

### Step 7: Backend Routing (FastAPI)

```
Uvicorn ASGI server receives HTTP frame
  → Starlette routing middleware
  → CORSMiddleware (passes through, already preflighted)
  → Router matches: POST /api/auth/login → auth.login()
  → Dependency injection: db = Depends(get_db) → creates SQLAlchemy Session
```

### Step 8: Backend Authentication Logic

```python
def login(credentials: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == credentials.username).first()
    #  ↑ SQLAlchemy issues: SELECT * FROM users WHERE username = ? LIMIT 1
    
    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    #  ↑ passlib.hash.pbkdf2_sha256.verify() — CPU-bound, ~100ms
    
    token = create_access_token(data={"sub": user.username, "role": user.role, ...})
    #  ↑ jose.jwt.encode() with HS256
    
    return {"access_token": token, "token_type": "bearer"}
```

### Step 9: Response Serialization

```
FastAPI serializes return dict → JSON
  → Starlette adds Content-Type: application/json
  → CORSMiddleware adds Access-Control-Allow-Origin header
  → Uvicorn frames HTTP/1.1 response
  → TCP send buffer → kernel → NIC → wire
```

### Step 10: Promise Resolution in Browser

```
Browser receives HTTP response headers
  → Constructs Response object (status, headers, body stream)
  → fetch() Promise resolves with Response
  → await resumes the async function
  → Code checks response.ok
  → If 200: parses JSON, stores token, sets user state
  → If 401: throws error with detail message
```

### Step 11: finally Block Executes

```tsx
finally {
  clearTimeout(timeoutId);    // Clear the AbortController timeout
  setIsLoading(false);        // Spinner OFF — React schedules re-render
}
```

### Step 12: React Re-renders

```
React processes batched state updates:
  - isLoading: true → false
  - user: null → { username, role, ... }  (on success)
  - error: null → "Invalid credentials"    (on failure)

Component tree re-renders:
  - Spinner disappears
  - Either: redirect to dashboard (success)
  - Or: error message appears (failure)
```

### Where Failure Freezes the UI ⚠️

```
Step 1  → Can't fail (synchronous DOM event)
Step 2  → Can't fail (React setState)
Step 3  → ★ FREEZE POINT ★ if server accepts TCP but never responds
Step 4  → ★ FREEZE POINT ★ if preflight hangs
Step 5  → Fetch rejects (CORS error) — catch handles it — no freeze
Step 6  → ★ FREEZE POINT ★ if POST hangs after preflight succeeds
Step 7  → If routing fails: 404 returned — Response resolves — no freeze
Step 8  → If DB hangs: backend thread blocks — no HTTP response — ★ FREEZE ★
Step 9  → If serialization fails: 500 returned — Response resolves — no freeze
Step 10 → If JSON parse fails: catch handles it — no freeze
Step 11 → Always runs IF step 3 settles — safe
Step 12 → Always runs IF step 11 runs — safe
```

**The only freeze points are where the HTTP response never arrives at all.**
Once ANY HTTP response arrives (200, 401, 404, 500), `fetch()` resolves and everything 
downstream works correctly.

---

## 3️⃣ Why There Was No Error Message

### fetch() Does NOT Throw on HTTP Errors

This is the most common misconception. Compare `fetch` with `axios`:

```js
// fetch — resolves on ANY HTTP response, even 4xx/5xx
const response = await fetch(url);
// response.ok === false for 4xx/5xx, but NO exception thrown
// You must check response.ok yourself

// axios — throws on 4xx/5xx
const response = await axios.get(url);
// If 401: throws AxiosError — goes to catch block automatically
```

`fetch()` rejects its Promise **only** for network-level failures:
- DNS resolution failure
- TCP connection refused (ECONNREFUSED)
- CORS preflight rejection
- Request aborted (AbortController)
- Network cable unplugged

`fetch()` resolves its Promise for **any HTTP response**, including:
- 200 OK
- 401 Unauthorized
- 404 Not Found
- 500 Internal Server Error

This means a 401 response would NOT trigger the `catch` block. The code must explicitly
check `response.ok` (which is `true` for status 200-299):

```tsx
if (!response.ok) {
  const data = await response.json();
  throw new Error(data.detail || "Login failed");
  // ↑ This throw goes to catch, which sets the error state
}
```

### When fetch() Throws vs Resolves

| Scenario | fetch() behavior | Promise state |
|---|---|---|
| Server returns 200 | Resolves | Fulfilled |
| Server returns 401 | Resolves | Fulfilled |
| Server returns 500 | Resolves | Fulfilled |
| DNS lookup fails | Rejects | Rejected |
| Connection refused | Rejects | Rejected |
| CORS blocked | Rejects | Rejected |
| AbortController fires | Rejects | Rejected |
| **Server hangs (our case)** | **Never settles** | **Pending forever** |

### Why a Pending Request Does NOT Trigger catch

The `catch` block runs only when the Promise **rejects**. A pending Promise has not
rejected — it simply hasn't done anything yet. JavaScript has no concept of "this Promise
has been pending too long." There's no built-in timeout.

```tsx
try {
  await fetch(url);           // Pending forever
  // This line never executes
} catch (err) {
  // This line ALSO never executes
  // catch only runs on REJECTION, not on "still waiting"
} finally {
  // This line ALSO never executes
  // finally runs after try OR catch completes
  // But neither has completed because await is still suspended
}
```

This is why `setIsLoading(false)` never fired. The `finally` block is not a timeout
mechanism — it's a completion mechanism. If the `try` block never completes, `finally`
never runs.

### Why a Hanging Backend Keeps the UI Stuck

The state machine looks like this:

```
                  setIsLoading(true)
                        │
                        ▼
              ┌─────────────────┐
              │  isLoading=true  │ ← UI shows spinner
              │  error=null      │
              └────────┬─────────┘
                       │
                 await fetch()
                       │
            ┌──────────┼──────────┐
            │          │          │
         Resolves    Rejects    HANGS
            │          │          │
            ▼          ▼          ▼
        process     catch()    ╔═════════╗
        response    setError   ║ STUCK   ║
            │          │       ║ FOREVER ║
            ▼          ▼       ╚═════════╝
        finally     finally
            │          │
            ▼          ▼
    setIsLoading(false)
```

The "HANGS" path is a **dead end**. No code path exists to set `isLoading` back to `false`.
The React component is trapped in a loading state with no escape.

---

## 4️⃣ Prevention Strategy (Production-Grade)

### 4.1: Request Timeout with AbortController

**This was applied as a fix.** Every `fetch()` call should have a timeout:

```
Design approach:
  - Create AbortController before fetch
  - Start a setTimeout that calls controller.abort()
  - Pass controller.signal to fetch options
  - In catch, check for AbortError specifically
  - In finally, clear the timeout

Timeout values:
  - Login/Auth:  15 seconds (users expect quick auth)
  - Data reads:  30 seconds (larger payloads)
  - File uploads: 120 seconds (slow networks)
  - Health check: 5 seconds
```

### 4.2: Global API Wrapper

Instead of raw `fetch()` everywhere, create a wrapper that enforces timeouts, error
handling, and logging:

```
Design approach:
  - Create an apiClient module that wraps fetch
  - Automatically add AbortController with configurable timeout
  - Automatically parse JSON responses
  - Automatically handle non-ok responses (throw with server message)
  - Automatically attach auth headers
  - Export typed functions: apiClient.post<T>(url, body): Promise<T>

Benefits:
  - Impossible to forget timeout
  - Impossible to forget error handling
  - Centralized auth header injection
  - Centralized logging
```

### 4.3: Network Error Interceptor

Add a global error boundary or interceptor that catches network failures and shows a
user-friendly message instead of a frozen UI:

```
Design approach:
  - For axios: use interceptors.response.use(null, errorHandler)
  - For fetch wrapper: add catch logic in the global wrapper
  - Distinguish: timeout vs network failure vs server error
  - Show toast notification for transient errors
  - Show full-page error for catastrophic failures
  - Auto-retry with exponential backoff for idempotent GETs
```

### 4.4: Backend Response Timeout

The backend should also protect against hanging database queries or external calls:

```
Design approach:
  - Add request timeout middleware in FastAPI
  - Set SQLAlchemy connection pool timeout (pool_timeout=30)
  - Set DB query timeout (execution_options={"timeout": 10})
  - Add uvicorn --timeout-keep-alive 30
  - Add health check endpoint that tests DB connectivity
  - Use async handlers if needed to avoid thread pool exhaustion
```

### 4.5: Logging Middleware

```
Design approach:
  Backend:
    - Log request method, path, duration, status code
    - Log slow queries (> 1s) as warnings
    - Log auth failures separately
    - Use structured logging (JSON format)
    - Include correlation ID in each request
  
  Frontend:
    - Log API calls in development only (never in production)
    - NEVER log credentials, tokens, or PII
    - Use error tracking service (Sentry) for production
```

### 4.6: Structured Error Responses

```
Design approach:
  Backend returns consistent error shape:
    {
      "error": {
        "code": "AUTH_INVALID_CREDENTIALS",
        "message": "Username or password is incorrect",
        "timestamp": "2026-02-06T...",
        "requestId": "abc-123"
      }
    }
  
  Frontend maps error codes to user messages:
    AUTH_INVALID_CREDENTIALS → "Incorrect username or password"
    AUTH_ACCOUNT_LOCKED      → "Account locked. Contact administrator."
    SERVER_ERROR             → "Something went wrong. Try again later."
```

### 4.7: Frontend Fallback UI After X Seconds

```
Design approach:
  - If fetch takes > 5 seconds, show "Taking longer than expected..."
  - If fetch takes > 15 seconds, show "Server may be unavailable" + retry button
  - If fetch is aborted, show "Request timed out" + retry button
  - Never leave user staring at spinner with no information
  - Use a state machine instead of boolean flags:
      idle → loading → slow → timeout → error
      (instead of just: isLoading true/false)
```

---

## 5️⃣ CORS Mastery Section

### What Is CORS?

**Cross-Origin Resource Sharing** is a browser security mechanism that blocks web pages
from making HTTP requests to a different **origin** than the one that served the page.

An **origin** is: `protocol + hostname + port`

```
http://localhost:5173   ← Origin A (frontend)
http://localhost:8000   ← Origin B (backend)
```

These are **different origins** because the port differs. The browser treats them as
separate security domains.

> CORS is enforced by the **browser only**. curl, Postman, and backend-to-backend calls
> completely ignore CORS. This is why "it works in Postman but not in the browser."

### What Is a Preflight Request?

A preflight is an **automatic OPTIONS request** sent by the browser before the actual
request. Its purpose is to ask the server: "Will you accept this cross-origin request?"

The browser sends a preflight when the request is "non-simple." A request is non-simple
if ANY of these are true:

- Method is not GET, HEAD, or POST
- Content-Type is not `text/plain`, `multipart/form-data`, or
  `application/x-www-form-urlencoded`
- Custom headers are included (e.g., `Authorization`)
- `ReadableStream` is used as body

Our login request uses `Content-Type: application/json`, which is NOT one of the three
simple types, so **preflight is required**.

### Why browser sends OPTIONS

The OPTIONS method is part of the HTTP spec (RFC 7231) and means "tell me what you
support." The browser repurposes it for CORS preflight because:

1. It's safe (no side effects on the server)
2. It's already part of HTTP — no new protocol needed
3. Servers that don't understand CORS will return an OPTIONS response without CORS
   headers, which the browser interprets as "CORS not allowed"

### Why allow_credentials Cannot Be Used with "*"

```python
# ❌ This is INVALID and the browser will reject it:
CORSMiddleware(
    allow_origins=["*"],          # Wildcard
    allow_credentials=True,        # Credentials
)
```

The CORS spec (Fetch Standard §3.2.5) explicitly forbids this combination:

> If credentials mode is "include", then `Access-Control-Allow-Origin` cannot be `*`.

**Why?** Because credentials (cookies, auth headers) are security-sensitive. If a server
says "any origin can send credentialed requests to me," it's a massive security hole. An
attacker's site could make authenticated requests to your API using the user's cookies.

**The fix**: List specific origins:

```python
CORSMiddleware(
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
)
```

### Why localhost vs 127.0.0.1 Matters

```
http://localhost:5173   ← Origin A
http://127.0.0.1:5173   ← Origin B (different!)
```

These are **two different origins** according to the browser. Even though they resolve to
the same IP, CORS compares the **string** in the `Origin` header against the server's
`Access-Control-Allow-Origin` header. If your frontend runs on `localhost:5173` but the
server only allows `127.0.0.1:5173`, CORS will block the request.

This is our FastAPI config and why it includes both:

```python
origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",  # ← Because localhost ≠ 127.0.0.1
]
```

### Why Mismatched Ports Break CORS

```
Frontend: http://localhost:5173
Backend:  http://localhost:8000
```

Port is part of the origin tuple. Different port = different origin = CORS applies.

However, if both were on the same port (e.g., Vite proxy forwarding `/api` to backend),
CORS would NOT apply because the browser sees the same origin.

This is why production deployments often put both behind a single reverse proxy (nginx):

```
https://myapp.com/        → frontend (static files)
https://myapp.com/api/    → backend (proxy_pass)
```

Same origin. No CORS needed. Simpler. More secure.

### How to Properly Configure FastAPI CORS

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",      # Vite dev server
        "http://localhost:3000",      # Alternate dev port
        "http://127.0.0.1:5173",     # Explicit IP
    ],
    allow_credentials=True,           # Required for cookies/auth headers
    allow_methods=["*"],              # Allow all HTTP methods
    allow_headers=["*"],              # Allow all headers
    expose_headers=[],                # Headers the browser can read
    max_age=600,                      # Cache preflight for 10 minutes
)
```

**Common mistakes:**
- Using wildcard `*` with `allow_credentials=True`
- Forgetting to include `http://` in origin (just `localhost:5173`)
- Not including both `localhost` and `127.0.0.1`
- Adding trailing slash (`http://localhost:5173/`)
- Adding the middleware AFTER route definitions (order matters in FastAPI)

---

## 6️⃣ Advanced Engineering Lessons

### How to Debug "UI Freeze" Issues Fast

**The 60-second triage protocol:**

```
Step 1 (5 sec): Open DevTools Console
  → Red errors? → Read them. Usually tells you exactly what's wrong.
  → No errors? → The issue is a hang, not a crash.

Step 2 (10 sec): Open DevTools Network tab, reproduce the issue
  → Request showing? → Check status column
    → "pending" = server is not responding
    → "failed" = network error or CORS
    → "(canceled)" = AbortController or navigation
    → Status code = server responded (check response body)
  → No request showing? → The JS code isn't even calling fetch.
    → Check: Is the click handler firing?
    → Check: Is there a conditional that prevents the API call?

Step 3 (15 sec): Check the pending request details
  → Headers tab: Verify URL, method, Content-Type
  → Is it OPTIONS or the actual method?
    → OPTIONS pending = CORS preflight hanging
    → Actual method pending = backend hanging

Step 4 (15 sec): Determine frontend vs backend
  → Open a new browser tab: http://localhost:8000/docs
    → If it loads → backend is running, issue is in routing/logic
    → If it doesn't load → backend is DOWN

Step 5 (15 sec): If backend is running, check logs
  → Look at the terminal running uvicorn
  → Is a request logged? → Backend received it (check for errors)
  → No request logged? → Request never reached backend (CORS/URL issue)
```

### What Signals Indicate Frontend vs Backend Issue

| Signal | Frontend Issue | Backend Issue |
|---|---|---|
| Console shows CORS error | ✅ (usually wrong URL) | ✅ (wrong CORS config) |
| Network shows "pending" | ❌ | ✅ backend not responding |
| Network shows 4xx status | ✅ wrong request shape | ✅ validation/auth error |
| Network shows 5xx status | ❌ | ✅ backend crash |
| No request in Network tab | ✅ JS not calling fetch | ❌ |
| Request sent but wrong URL | ✅ wrong env variable | ❌ |
| UI state not updating | ✅ React state issue | ❌ |
| Response is empty `{}` | ❌ | ✅ wrong serialization |

### How to Read DevTools Network Tab Like a Senior Engineer

**Column-by-column:**

```
Name             → URL path — is it correct?
Status           → HTTP status code — 200/401/404/500?
Type             → xhr/fetch/preflight — is it the right type?
Initiator        → What JS file triggered this — is it your code?
Size             → Response size — 0 bytes means empty response
Time             → Duration — >5s is suspicious
Waterfall        → Visual timeline — where is time spent?
```

**Waterfall breakdown:**
```
├── Queueing          → Browser waiting for thread/socket
├── Stalled           → Waiting for connection (too many parallel requests?)
├── DNS Lookup        → Resolving hostname (should be fast for localhost)
├── Initial Connection → TCP handshake (should be < 1ms for localhost)
├── SSL               → TLS handshake (only for HTTPS)
├── Request Sent      → Uploading request body (fast for small JSON)
├── Waiting (TTFB)    → ★ Time to First Byte — this is server processing time ★
└── Content Download  → Downloading response body
```

**The money metric is TTFB (Waiting)**. If TTFB is 50ms, backend is fast. If TTFB is 10s,
backend is slow. If TTFB keeps growing with no response, backend is hanging.

### How to Trace Request Lifecycle in FastAPI

**Add timing middleware:**

```python
import time
from starlette.middleware.base import BaseHTTPMiddleware

class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start = time.time()
        response = await call_next(request)
        duration = time.time() - start
        print(f"{request.method} {request.url.path} → {response.status_code} ({duration:.3f}s)")
        return response
```

**Check database connectivity:**

```python
@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "healthy", "db": "connected"}
```

**Debug specific endpoints:**

```python
# Temporary — remove before committing
@router.post("/login")
def login(credentials: LoginRequest, db: Session = Depends(get_db)):
    import time
    t0 = time.time()
    user = db.query(User).filter(User.username == credentials.username).first()
    print(f"  DB query: {time.time()-t0:.3f}s, found={user is not None}")
    # ... rest of handler
```

### How to Avoid Optimistic Loading Deadlocks

An "optimistic loading deadlock" is when:
1. You set a loading state before an async call
2. The async call never completes
3. The loading state never clears
4. The user is trapped

**Prevention patterns:**

```
Pattern 1: State Machine (best)
  Replace boolean isLoading with an enum:
    type LoadingState = 'idle' | 'loading' | 'slow' | 'error' | 'success'
  
  Transitions:
    idle → loading (on fetch start)
    loading → slow (after 5 seconds, via setTimeout)
    loading → success (on response)
    loading → error (on catch)
    slow → error (after 15 seconds, via AbortController)
  
  UI maps each state to a view — no state can be a dead end.

Pattern 2: Timeout Guard (simpler)
  Always pair setIsLoading(true) with a setTimeout fallback:
    setTimeout(() => {
      setIsLoading(false);
      setError("Request timed out");
    }, 15000);
  
  Even if fetch never settles, the timeout fires and recovers UI.

Pattern 3: Race Pattern
  Use Promise.race to add a timeout to any Promise:
    const result = await Promise.race([
      fetch(url),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 15000)
      )
    ]);
```

---

## 7️⃣ Production-Ready Checklist

### Auth Flow Validation

```
□ Login endpoint returns proper JWT structure
□ Token is stored securely (httpOnly cookie preferred, localStorage acceptable)
□ Token is included in subsequent API requests (Authorization header)
□ Token expiry is handled (refresh flow or redirect to login)
□ Logout clears token from storage AND state
□ Protected routes redirect to login when no token present
□ fetch/axios handles 401 responses (token expired) globally
□ Login form disables submit button while loading
□ Login form shows error on failure
□ Login form has timeout protection (AbortController)
□ NEVER log credentials or tokens (not even in development)
```

### CORS Setup

```
□ allow_origins lists EXACT frontend URLs (no trailing slash)
□ Both localhost AND 127.0.0.1 are in allow_origins
□ allow_credentials matches frontend's credentials/withCredentials setting
□ allow_credentials is NOT used with allow_origins=["*"]
□ CORSMiddleware is added BEFORE routes in FastAPI
□ Preflight works: OPTIONS request returns correct headers
□ Production origins are in environment variables, not hardcoded
□ No wildcard origins in production
```

### Environment Variable Validation

```
□ Frontend .env has correct VITE_API_BASE_URL
□ URL includes protocol (http:// or https://)
□ URL does NOT have trailing slash
□ Backend .env has correct DB_HOST, DB_PORT, DB_NAME
□ DB_PASSWORD is URL-encoded if it contains special characters
□ SECRET_KEY is set and is not the default value
□ All required env vars are validated at startup (fail fast)
□ .env is in .gitignore
□ .env.example exists with placeholder values
```

### Backend Health Verification

```
□ uvicorn is running (check terminal for "Uvicorn running on...")
□ Only ONE uvicorn process is bound to the port
□ No zombie python processes from previous sessions
□ /docs endpoint loads in browser (FastAPI Swagger UI)
□ Health check endpoint responds (/api/health)
□ Database connection works (health check includes DB query)
□ No import errors at startup (check uvicorn logs)
□ CORS headers present in response (check with curl -v)
□ After VS Code restart: verify backend terminal is still running
□ After system restart: restart uvicorn manually
```

### UI State Safety

```
□ Every setIsLoading(true) has a guaranteed path to setIsLoading(false)
□ Every fetch/axios call has timeout protection
□ catch blocks handle Error and non-Error thrown values
□ finally blocks clean up loading state regardless of outcome
□ Error messages distinguish: network error vs auth error vs server error
□ Loading states show progress or timeout feedback after N seconds
□ No console.log of sensitive data in production
□ TypeScript strict mode catches type errors at compile time
□ No catch(err: any) — use catch(err: unknown) with type narrowing
□ Error boundaries catch React rendering errors
```

### Pre-Commit Sanity Check

```
□ TypeScript compiles with zero errors (npx tsc --noEmit)
□ No console.log/console.error left in committed code
□ No hardcoded credentials or tokens
□ No any types that could be properly typed
□ API client has proper error handling wrapper
□ All async functions handle rejection
□ CORS config matches deployment environment  
□ Kill zombie backend processes before starting fresh
```

---

## Summary: The Mental Model

```
The bug was NOT in the code logic.
The bug was in the infrastructure: zombie processes.

But the code had NO DEFENSE against infrastructure failures.
A single hanging fetch() could freeze the entire UI forever.

The lesson is not "kill zombie processes."
The lesson is "never trust the network."

Every fetch() call is a departure from your controlled environment
into the chaos of TCP/IP, OS kernel scheduling, process lifecycle,
and DNS resolution. Any of these can fail silently.

Defense-in-depth for fetch():
  Layer 1: AbortController timeout (never wait forever)
  Layer 2: Error classification (tell user WHAT failed)
  Layer 3: State machine (no dead-end loading states)
  Layer 4: Health checks (know if backend is alive BEFORE user acts)
  Layer 5: Process management (systemd, Docker, PM2 — not bare terminals)
```

> "A senior engineer doesn't write code that works. A senior engineer writes code that
> fails gracefully when everything around it breaks."
