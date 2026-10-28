import re

MAX_EMAILS = 25

ROLE = {
    "admin", "administrator", "info", "contact", "support", "sales", "billing", "hr",
    "press", "help", "hello", "office", "team", "marketing", "careers", "jobs", "noreply",
    "no-reply", "donotreply", "postmaster", "abuse", "webmaster", "accounts", "accounting",
    "finance", "legal", "media", "news", "newsletter", "privacy", "security", "service",
    "enquiries", "inquiries", "feedback", "partners", "orders", "recruiting", "hiring", "ops",
}
DISPOSABLE = {
    "mailinator.com", "guerrillamail.com", "guerrillamail.net", "yopmail.com", "10minutemail.com",
    "tempmail.com", "temp-mail.org", "trashmail.com", "sharklasers.com", "getnada.com",
    "maildrop.cc", "dispostable.com", "throwawaymail.com", "fakeinbox.com", "mintemail.com",
    "mohmal.com", "emailondeck.com", "tempinbox.com", "spamgourmet.com", "burnermail.io",
}
FREEMAIL = {
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com",
    "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me",
    "protonmail.com", "gmx.com", "gmx.de", "mail.com", "zoho.com", "yandex.com", "yandex.ru",
    "qq.com", "163.com", "web.de", "comcast.net", "att.net", "verizon.net",
}
SYNTAX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def handler(context):
    raw = context.get_input("emails") or []
    if isinstance(raw, str):
        raw = re.split(r"[\s,;]+", raw)
    raw = [str(e).strip() for e in raw if str(e).strip()]
    truncated = max(0, len(raw) - MAX_EMAILS)
    raw = raw[:MAX_EMAILS]

    seen = set()
    counts = {"duplicate": 0, "syntax_invalid": 0, "role": 0, "disposable": 0, "personal": 0}
    survivors = []
    for email in raw:
        key = email.lower()
        if key in seen:
            counts["duplicate"] += 1
            continue
        seen.add(key)
        if not SYNTAX.match(key):
            counts["syntax_invalid"] += 1
            continue
        local, domain = key.rsplit("@", 1)
        if domain in DISPOSABLE:
            counts["disposable"] += 1
        elif local.split("+")[0] in ROLE:
            counts["role"] += 1
        else:
            # crm-cleanup@3: personal is a label, not a bucket. Personal addresses
            # are counted here and still go on to the mailbox check.
            if domain in FREEMAIL:
                counts["personal"] += 1
            survivors.append({"email": key})

    return {
        "total_in": len(raw),
        "truncated": truncated,
        "duplicates": counts["duplicate"],
        "syntax_invalid": counts["syntax_invalid"],
        "role_inboxes": counts["role"],
        "disposable": counts["disposable"],
        "personal": counts["personal"],
        "to_verify": len(survivors),
        "survivors": survivors,
    }
