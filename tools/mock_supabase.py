"""
A throwaway stand-in for Supabase, so the two apps can be opened and clicked
through without a real project behind them.

    python tools/mock_supabase.py           # API on http://localhost:5174
    python -m http.server 5173 --directory app

Then open http://localhost:5173/?demo and sign in with any password.

It speaks just enough PostgREST to satisfy js/data/*: eq/gte/lte/in filters,
order, limit/range, exact counts, and the RPCs. [4.2] The RPCs now follow the
real schema's rules — stale revisions, locked approved days, upserts, a
read-only table, Riyadh dates — so "it works in the demo" means something for
those flows. It is still a development aid and enforces no authentication or
RLS: never point a build you intend to ship at it.
"""
import base64
import json
import random
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

PORT = 5174
OWNER_ID = "11111111-1111-1111-1111-111111111111"
WORKER_ID = "22222222-2222-2222-2222-222222222222"


RIYADH = timezone(timedelta(hours=3))   # no DST in Saudi Arabia


def riyadh_today():
    """The business day, as the real today_riyadh() computes it."""
    return datetime.now(RIYADH).date()


def now_iso():
    return datetime.now(RIYADH).isoformat(timespec="seconds")


# ---------------------------------------------------------------- fake data
def build_entries():
    """~90 days of plausible history: mostly approved, a few awaiting review."""
    random.seed(7)
    rows = []
    today = riyadh_today()

    # Stops at offset 3: the three most recent days belong to the review
    # queue below. entry_date is unique in the real schema, so the mock must
    # not hand out two rows for one day either.
    for offset in range(90, 3, -1):
        day = today - timedelta(days=offset)
        if day.weekday() == 4 and random.random() < 0.3:      # the odd closed Friday
            continue

        cash = round(random.uniform(40, 260), 2)
        mada = round(random.uniform(60, 420), 2)
        customers = random.randint(3, 34)
        confidence = round(random.uniform(0.72, 0.99), 2)
        debt = round(random.uniform(10, 90), 2) if random.random() < 0.3 else 0
        repaid = round(random.uniform(10, 120), 2) if random.random() < 0.2 else 0

        rows.append({
            "id": f"row-{offset}",
            "entry_date": day.isoformat(),
            "cash_total": cash, "mada_total": mada,
            "total": round(cash + mada, 2), "customer_count": customers,
            "extracted_cash": cash if random.random() > 0.15 else round(cash + 10, 2),
            "extracted_mada": mada, "extracted_customers": customers,
            # [4.3] Some days carry debt sold on credit or an old debt paid back.
            "debt_total": debt, "repaid_total": repaid,
            "extracted_debt": debt, "extracted_repaid": repaid,
            "extraction_confidence": confidence, "extraction_error": None,
            "photo_path": f"{day.isoformat()}_mock.jpg", "notes": None,
            "status": "approved",
            "source": "worker_upload" if offset < 60 else "owner_import",
            "revision": 1,
            "submitted_at": f"{day.isoformat()}T20:40:00+03:00",
            "reviewed_at": f"{day.isoformat()}T21:05:00+03:00",
            "updated_at": f"{day.isoformat()}T21:05:00+03:00",
        })

    # Three days sitting in the queue, covering the three review-card states:
    # a clean read, a shaky one, and a failed extraction.
    for i, (confidence, error) in enumerate(
            [(0.94, None), (0.61, "warning:sum_mismatch"), (None, "extraction_failed:quota")]):
        day = today - timedelta(days=i)
        failed = bool(error and error.startswith("extraction_failed"))
        cash = None if failed else round(random.uniform(40, 200), 2)
        mada = None if failed else round(random.uniform(60, 380), 2)
        rows.append({
            "id": f"queue-{i}", "entry_date": day.isoformat(),
            "cash_total": cash, "mada_total": mada,
            "total": round((cash or 0) + (mada or 0), 2),
            "customer_count": None if failed else random.randint(5, 25),
            "extracted_cash": cash, "extracted_mada": mada,
            "extracted_customers": None if failed else random.randint(5, 25),
            "debt_total": None if failed else (35.5 if i == 0 else 0),
            "repaid_total": None if failed else (50 if i == 0 else 0),
            "extracted_debt": None if failed else (35.5 if i == 0 else 0),
            "extracted_repaid": None if failed else (50 if i == 0 else 0),
            "extraction_confidence": confidence, "extraction_error": error,
            "photo_path": f"{day.isoformat()}_mock.jpg", "notes": None,
            "status": "needs_review", "source": "worker_upload", "revision": 1,
            "submitted_at": f"{day.isoformat()}T20:40:00+03:00", "reviewed_at": None,
            "updated_at": f"{day.isoformat()}T20:41:00+03:00",
        })

    # [4.2] One reading that never came back (a lost webhook), so the
    # "read again" path can be tried in the demo.
    stuck_day = today - timedelta(days=3)
    rows.append({
        "id": "stuck-3", "entry_date": stuck_day.isoformat(),
        "cash_total": None, "mada_total": None, "total": 0, "customer_count": None,
        "extracted_cash": None, "extracted_mada": None, "extracted_customers": None,
        "extraction_confidence": None, "extraction_error": None,
        "photo_path": f"{stuck_day.isoformat()}_mock.jpg", "notes": None,
        "status": "pending_extraction", "source": "worker_upload", "revision": 1,
        "submitted_at": f"{stuck_day.isoformat()}T20:40:00+03:00", "reviewed_at": None,
        "updated_at": f"{stuck_day.isoformat()}T20:40:00+03:00",
    })

    return rows


ENTRIES = build_entries()
SETTINGS = [
    {"key": "monthly_target", "value": "9000"},
    {"key": "shop_name", "value": "بقالة الأمانة"},
    {"key": "currency", "value": "SAR"},
    {"key": "timezone", "value": "Asia/Riyadh"},
]
PROFILES = [
    {"id": OWNER_ID, "display_name": "المالك", "role": "owner", "active": True},
    {"id": WORKER_ID, "display_name": "العامل", "role": "worker", "active": True},
]
AUDIT = [
    {"id": 1, "at": f"{riyadh_today().isoformat()}T20:40:00+03:00",
     "action": "create", "entry_date": riyadh_today().isoformat(), "detail": None},
]
LOCK = threading.RLock()


def audit(action, entry_date, detail=None):
    AUDIT.append({"id": len(AUDIT) + 1, "at": now_iso(), "action": action,
                  "entry_date": entry_date, "detail": detail})


def find(entry_date):
    return next((r for r in ENTRIES if r["entry_date"] == entry_date), None)


def simulate_extraction(entry_date, revision):
    """Stands in for the webhook + Edge Function: a reading arrives 3 s later,
    and only if the row still holds the same photo (record_extraction's rule)."""
    def run():
        time.sleep(3)
        with LOCK:
            row = find(entry_date)
            if not row or row["status"] != "pending_extraction" or row["revision"] != revision:
                return
            cash = round(random.uniform(40, 200), 2)
            mada = round(random.uniform(60, 380), 2)
            customers = random.randint(5, 25)
            row.update(cash_total=cash, mada_total=mada, total=round(cash + mada, 2),
                       customer_count=customers, extracted_cash=cash, extracted_mada=mada,
                       extracted_customers=customers, extraction_confidence=0.9,
                       debt_total=0, repaid_total=0, extracted_debt=0, extracted_repaid=0,
                       extraction_error=None, status="needs_review", updated_at=now_iso())
    threading.Thread(target=run, daemon=True).start()

# 1x1 grey JPEG, stands in for a notebook photograph.
PLACEHOLDER_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
)


# ------------------------------------------------------------- postgrest bits
def apply_filters(rows, query):
    """Handles the operators js/data/* actually uses."""
    out = rows
    for key, values in query.items():
        if key in ("select", "order", "limit", "offset"):
            continue
        expr = values[0]
        if expr.startswith("eq."):
            wanted = expr[3:]
            out = [r for r in out if str(r.get(key)) == wanted]
        elif expr.startswith("gte."):
            out = [r for r in out if str(r.get(key)) >= expr[4:]]
        elif expr.startswith("lte."):
            out = [r for r in out if str(r.get(key)) <= expr[4:]]
        elif expr.startswith("in."):
            wanted = set(expr[3:].strip("()").split(","))
            out = [r for r in out if str(r.get(key)) in wanted]
    return out


def apply_order(rows, query):
    spec = query.get("order", [None])[0]
    if not spec:
        return rows
    column, _, direction = spec.partition(".")
    return sorted(rows, key=lambda r: (r.get(column) is None, r.get(column)),
                  reverse=direction.startswith("desc"))


def month_key(iso):
    return iso[:7]


def rpc_get_monthly(body):
    year = str(body.get("p_year"))
    approved = [r for r in ENTRIES if r["status"] == "approved" and r["entry_date"][:4] == year]
    months = {}
    for row in approved:
        months.setdefault(month_key(row["entry_date"]), []).append(row)

    out = []
    for key in sorted(months):
        rows = months[key]
        total = sum(r["total"] for r in rows)
        out.append({
            "month_start": f"{key}-01",
            "days_recorded": len(rows),
            "cash_total": round(sum(r["cash_total"] or 0 for r in rows), 2),
            "mada_total": round(sum(r["mada_total"] or 0 for r in rows), 2),
            "grand_total": round(total, 2),
            "customers": sum(r["customer_count"] or 0 for r in rows),
            "avg_per_day": round(total / len(rows), 2),
            "debt_total": round(sum(r.get("debt_total") or 0 for r in rows), 2),
            "repaid_total": round(sum(r.get("repaid_total") or 0 for r in rows), 2),
        })
    return out


def rpc_get_trend(body):
    target = body.get("p_entry_date")
    approved = [r for r in ENTRIES if r["status"] == "approved" and r["entry_date"] < target]
    last7 = approved[-7:]
    weekday = date.fromisoformat(target).weekday()
    same = [r for r in approved if date.fromisoformat(r["entry_date"]).weekday() == weekday][-8:]
    avg = lambda rows: round(sum(r["total"] for r in rows) / len(rows), 2) if rows else None
    return {"avg_last_7_days": avg(last7), "avg_same_weekday_last_8": avg(same)}


def as_number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def rpc_approve_day(body):
    cash, mada = as_number(body.get("p_cash")), as_number(body.get("p_mada"))
    if cash is None or mada is None or cash < 0 or mada < 0 or cash > 999999.99 or mada > 999999.99:
        return {"ok": False, "code": "bad_amount"}
    row = find(body.get("p_entry_date"))
    if not row:
        return {"ok": False, "code": "not_found"}
    revision = body.get("p_revision")
    if revision is not None and int(revision) != row["revision"]:
        return {"ok": False, "code": "stale"}
    before = row["status"]
    row.update(
        cash_total=cash, mada_total=mada,
        customer_count=body.get("p_customer_count") or 0,
        debt_total=as_number(body.get("p_debt")) or 0,
        repaid_total=as_number(body.get("p_repaid")) or 0,
        # [4.3] A repayment counts in the day's total (DEVIATIONS.md #30).
        total=round(cash + mada + (as_number(body.get("p_repaid")) or 0), 2),
        status="approved", reviewed_at=now_iso(), updated_at=now_iso(),
    )
    audit("correct" if before == "approved" else "approve", row["entry_date"])
    return {"ok": True}


def rpc_owner_import_day(body):
    entry_date = body.get("p_entry_date")
    if not entry_date or entry_date > riyadh_today().isoformat():
        return {"ok": False, "code": "bad_date"}
    row = find(entry_date)
    if row and row["status"] == "approved":
        return {"ok": False, "code": "locked"}
    fresh = {
        "cash_total": None, "mada_total": None, "total": 0, "customer_count": None,
        "extracted_cash": None, "extracted_mada": None, "extracted_customers": None,
        "extraction_confidence": None, "extraction_error": None,
        "status": "pending_extraction", "source": "owner_import",
        "submitted_at": now_iso(), "reviewed_at": None, "updated_at": now_iso(),
    }
    if row:
        row.update(fresh, photo_path=body.get("p_photo_path") or row["photo_path"],
                   revision=row["revision"] + 1)
    else:
        row = {"id": f"import-{time.time()}", "entry_date": entry_date,
               "photo_path": body.get("p_photo_path") or "none", "notes": None,
               "revision": 1, **fresh}
        ENTRIES.append(row)
    audit("owner_import", entry_date)
    simulate_extraction(entry_date, row["revision"])
    return {"ok": True, "status": "pending_extraction"}


def rpc_submit_photo(body):
    today = riyadh_today()
    wanted = body.get("p_entry_date")
    day = min(date.fromisoformat(wanted), today) if wanted else today
    if day < today - timedelta(days=7) and day.isoformat() not in RETAKES:
        return {"ok": False, "code": "bad_date"}
    RETAKES.discard(day.isoformat())
    if not body.get("p_photo_path"):
        return {"ok": False, "code": "photo_required"}
    row = find(day.isoformat())
    if row:
        if row["status"] == "approved":
            return {"ok": False, "code": "locked"}
        if row["revision"] >= 10:
            return {"ok": False, "code": "too_many"}
        row.update(photo_path=body["p_photo_path"], status="pending_extraction",
                   cash_total=None, mada_total=None, total=0, customer_count=None,
                   extracted_cash=None, extracted_mada=None, extracted_customers=None,
                   extraction_confidence=None, extraction_error=None,
                   revision=row["revision"] + 1, submitted_at=now_iso(), updated_at=now_iso())
        audit("replace", row["entry_date"])
    else:
        row = {"id": f"sub-{time.time()}", "entry_date": day.isoformat(),
               "cash_total": None, "mada_total": None, "total": 0, "customer_count": None,
               "extracted_cash": None, "extracted_mada": None, "extracted_customers": None,
               "extraction_confidence": None, "extraction_error": None,
               "photo_path": body["p_photo_path"], "notes": None,
               "status": "pending_extraction", "source": "worker_upload", "revision": 1,
               "submitted_at": now_iso(), "reviewed_at": None, "updated_at": now_iso()}
        ENTRIES.append(row)
        audit("create", row["entry_date"])
    simulate_extraction(row["entry_date"], row["revision"])
    return {"ok": True, "code": "saved"}


def rpc_retry_extraction(body):
    row = find(body.get("p_entry_date"))
    if not row:
        return {"ok": False, "code": "not_found"}
    if row["status"] == "approved":
        return {"ok": False, "code": "locked"}
    row.update(status="pending_extraction", cash_total=None, mada_total=None, total=0,
               customer_count=None, extracted_cash=None, extracted_mada=None,
               extracted_customers=None, extraction_confidence=None,
               extraction_error=None, updated_at=now_iso())
    audit("retry_extraction", row["entry_date"])
    simulate_extraction(row["entry_date"], row["revision"])
    return {"ok": True}


def rpc_move_day(body):
    src, dst = body.get("p_from"), body.get("p_to")
    if not dst or dst > riyadh_today().isoformat():
        return {"ok": False, "code": "bad_date"}
    row = find(src)
    if not row:
        return {"ok": False, "code": "not_found"}
    if row["status"] == "approved":
        return {"ok": False, "code": "locked"}
    if find(dst):
        return {"ok": False, "code": "date_taken"}
    row.update(entry_date=dst, updated_at=now_iso())
    audit("move", dst, {"from": src, "to": dst})
    return {"ok": True}


def rpc_storage_usage(body):
    return {"ok": True, "bytes": len(ENTRIES) * 280_000, "files": len(ENTRIES)}


RETAKES = set()


def rpc_reject_day(body):
    """[4.3] Delete an unapproved day and ask the worker for a new photo."""
    entry_date = body.get("p_entry_date")
    row = find(entry_date)
    if not row:
        return {"ok": False, "code": "not_found"}
    if row["status"] == "approved":
        return {"ok": False, "code": "locked"}
    ENTRIES.remove(row)
    RETAKES.add(entry_date)
    audit("reject", entry_date)
    return {"ok": True}


def rpc_pending_retakes(body):
    return sorted(RETAKES)


RPCS = {
    "reject_day": rpc_reject_day,
    "pending_retakes": rpc_pending_retakes,
    "get_monthly": rpc_get_monthly,
    "get_trend": rpc_get_trend,
    "approve_day": rpc_approve_day,
    "owner_import_day": rpc_owner_import_day,
    "submit_photo": rpc_submit_photo,
    "retry_extraction": rpc_retry_extraction,
    "move_day": rpc_move_day,
    "storage_usage": rpc_storage_usage,
}

TABLES = {
    "daily_entries": lambda: ENTRIES,
    "settings": lambda: SETTINGS,
    "profiles": lambda: PROFILES,
    "audit_log": lambda: AUDIT,
}


def fake_jwt(user_id):
    b64 = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    header = b64({"alg": "HS256", "typ": "JWT"})
    payload = b64({"sub": user_id, "role": "authenticated",
                   "exp": int(time.time()) + 86400 * 30})
    return f"{header}.{payload}.mock-signature"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # -------------------------------------------------------------- plumbing
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS,HEAD")
        self.send_header("Access-Control-Expose-Headers", "content-range")

    def reply(self, payload, status=200, extra=None, body=True):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        # A HEAD reply must not promise bytes it will not send, or a
        # keep-alive client waits for a body that never arrives.
        self.send_header("Content-Length", str(len(raw)) if body else "0")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if body:
            self.wfile.write(raw)

    def raw_body(self):
        """Read the request body exactly once. [4.2] Every request's body is
        now consumed before replying: an unread body (the sign-URL POST) stayed
        in the kept-alive connection and corrupted the next request on it,
        which the browser reported as random CORS failures."""
        if getattr(self, "_raw", None) is None:
            length = int(self.headers.get("Content-Length") or 0)
            self._raw = self.rfile.read(length) if length else b""
        return self._raw

    def read_body(self):
        raw = self.raw_body()
        if not raw:
            return {}
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}

    def log_message(self, fmt, *args):
        print(f"  {self.command} {self.path.split('?')[0]}")

    # --------------------------------------------------------------- routing
    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.handle_request(head_only=True)

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def do_PATCH(self):
        self.handle_request()

    def do_PUT(self):
        self.handle_request()

    def handle_request(self, head_only=False):
        self._raw = None
        self.raw_body()
        url = urlparse(self.path)
        path = unquote(url.path)
        query = parse_qs(url.query)

        # --- auth: any non-empty password gets in -----------------------
        if path.startswith("/auth/v1/token"):
            body = self.read_body()
            if query.get("grant_type", [""])[0] == "password" and not body.get("password"):
                return self.reply({"error": "invalid_grant", "code": "invalid_credentials",
                                   "error_description": "Invalid login credentials"}, 400)
            owner = "owner" in str(body.get("email", ""))
            user_id = OWNER_ID if owner else WORKER_ID
            return self.reply({
                "access_token": fake_jwt(user_id),
                "refresh_token": "mock-refresh",
                "token_type": "bearer",
                "expires_in": 86400 * 30,
                "expires_at": int(time.time()) + 86400 * 30,
                "user": {"id": user_id, "email": body.get("email"), "aud": "authenticated",
                         "role": "authenticated", "app_metadata": {}, "user_metadata": {}},
            })

        if path.startswith("/auth/v1/user"):
            if self.command == "PUT":
                self.read_body()
            return self.reply({"id": OWNER_ID, "aud": "authenticated",
                               "role": "authenticated", "app_metadata": {},
                               "user_metadata": {}})

        if path.startswith("/auth/v1/logout"):
            return self.reply({}, 204)

        # --- storage ----------------------------------------------------
        if path.startswith("/storage/v1/object/sign/"):
            # storage-js prefixes this with ".../storage/v1" itself.
            return self.reply({"signedURL": "/object/mock.jpg?token=mock"})

        # Upload: swallow the bytes, answer the way storage-js expects.
        if path.startswith("/storage/v1/object/") and self.command in ("POST", "PUT"):
            key = path.replace("/storage/v1/object/", "", 1)
            return self.reply({"Key": key, "Id": "mock-object-id"}, 200)

        if path.startswith("/storage/v1/object/"):
            self.send_response(200)
            self.cors()
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(PLACEHOLDER_JPEG)))
            self.end_headers()
            if not head_only:
                self.wfile.write(PLACEHOLDER_JPEG)
            return None

        # --- edge functions ----------------------------------------------
        if path == "/functions/v1/set-worker-code":
            self.read_body()
            return self.reply({"ok": True, "sessions_ended": True})
        if path == "/functions/v1/extract-figures":
            # Like the real one: no webhook secret, no entry.
            self.read_body()
            return self.reply({"ok": False, "error": "unauthorized"}, 401)

        # --- rpc --------------------------------------------------------
        rpc = re.match(r"^/rest/v1/rpc/(\w+)$", path)
        if rpc:
            name = rpc.group(1)
            if name not in RPCS:
                return self.reply({"message": f"function {name} does not exist"}, 404)
            body = self.read_body()
            with LOCK:
                result = RPCS[name](body)
            return self.reply(result)

        # --- tables -----------------------------------------------------
        table = re.match(r"^/rest/v1/(\w+)$", path)
        if table:
            name = table.group(1)
            if name not in TABLES:
                return self.reply({"message": f"relation {name} does not exist"}, 404)

            if self.command in ("POST", "PATCH"):
                body = self.read_body()
                # [4.2] Same as the real grants: daily_entries, profiles and
                # audit_log are read-only; settings really saves.
                if name != "settings":
                    return self.reply({"code": "42501",
                                       "message": f"permission denied for table {name}"}, 403)
                for item in body if isinstance(body, list) else [body]:
                    existing = next((r for r in SETTINGS if r["key"] == item.get("key")), None)
                    if existing:
                        existing["value"] = str(item.get("value"))
                    else:
                        SETTINGS.append({"key": item.get("key"), "value": str(item.get("value"))})
                return self.reply([], 201)

            with LOCK:
                rows = apply_order(apply_filters(TABLES[name](), query), query)
            total = len(rows)
            # supabase-js sends .range() as offset + limit query params.
            offset = int(query.get("offset", ["0"])[0])
            limit = query.get("limit", [None])[0]
            rows = rows[offset:]
            if limit:
                rows = rows[:int(limit)]

            headers = {"Content-Range": f"{offset}-{max(offset + len(rows) - 1, 0)}/{total}"}
            single = "vnd.pgrst.object" in (self.headers.get("Accept") or "")
            payload = (rows[0] if rows else None) if single else rows
            return self.reply(payload, 200, headers, body=not head_only)

        return self.reply({"message": "not found", "path": path}, 404)


if __name__ == "__main__":
    print(f"mock Supabase on http://localhost:{PORT}")
    print(f"  {len(ENTRIES)} entries, 3 of them awaiting review")
    print("  open http://localhost:5173/?demo and sign in with any password")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
