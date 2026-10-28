import re

ROLE = {
    "abuse", "accounting", "accounts", "admin", "administrator", "billing", "careers",
    "contact", "donotreply", "enquiries", "feedback", "finance", "hello", "help", "hiring",
    "hr", "info", "inquiries", "jobs", "legal", "marketing", "media", "news", "newsletter",
    "no-reply", "noreply", "office", "ops", "orders", "partners", "postmaster", "press",
    "privacy", "recruiting", "sales", "security", "service", "support", "team", "webmaster",
}
DISPOSABLE = {
    "10minutemail.com", "burnermail.io", "dispostable.com", "emailondeck.com", "fakeinbox.com",
    "getnada.com", "guerrillamail.com", "guerrillamail.net", "maildrop.cc", "mailinator.com",
    "mintemail.com", "mohmal.com", "sharklasers.com", "spamgourmet.com", "temp-mail.org",
    "tempinbox.com", "tempmail.com", "throwawaymail.com", "trashmail.com", "yopmail.com",
}
PERSONAL = {
    "163.com", "aol.com", "att.net", "comcast.net", "gmail.com", "gmx.com", "gmx.de",
    "googlemail.com", "hotmail.com", "icloud.com", "live.com", "mac.com", "mail.com", "me.com",
    "msn.com", "outlook.com", "proton.me", "protonmail.com", "qq.com", "verizon.net", "web.de",
    "yahoo.com", "yandex.com", "yandex.ru", "ymail.com", "zoho.com",
}
FORMAT = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAILBOX_INVALID = {"invalid", "spamtrap", "abuse", "do_not_mail"}


def screen(emails):
    """Steps 1-6. Returns one (original, normalized, bucket) per entry, in order.
    bucket is None for entries that go on to the mailbox check."""
    seen, rows = set(), []
    for original in emails:
        key = str(original).strip().lower()
        if not key:
            continue
        if key in seen:
            bucket = "duplicates"
        else:
            seen.add(key)
            local, _, domain = key.rpartition("@")
            if not FORMAT.match(key):
                bucket = "invalid"            # reason: format
            elif domain in DISPOSABLE:
                bucket = "disposable"
            elif local.split("+")[0] in ROLE:
                bucket = "role_inboxes"
            elif domain in PERSONAL:
                bucket = "personal"
            else:
                bucket = None
        rows.append((original, key, bucket))
    return rows


def mailbox_bucket(result):
    """Step 7. result is the ZeroBounce Verify email output, or None on error."""
    if not result:
        return "unverified"
    status = str(result.get("status") or "").lower().replace("-", "_")
    sub = str(result.get("sub_status") or "").lower().replace("-", "_")
    if status in MAILBOX_INVALID:
        return "invalid"                      # reason: mailbox
    if status == "catch_all" or sub == "catch_all":
        return "risky_catch_all"
    if status == "valid":
        return "clean"
    return "unverified"


def headline(total, needs_cleanup, unverified):
    if needs_cleanup == 0 and unverified == 0:
        return "All %d contacts look clean" % total
    text = "%d of %d contacts need cleanup" % (needs_cleanup, total)
    if unverified > 0:
        text += "; %d could not be verified" % unverified
    return text
