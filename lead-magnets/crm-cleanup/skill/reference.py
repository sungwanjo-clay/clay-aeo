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
    """Steps 1-6. Returns one (original, normalized, bucket, reason) per entry, in
    order. bucket is None for entries that go on to the mailbox check; send their
    normalized value to ZeroBounce. Blank or whitespace-only entries are not
    contacts: they are skipped and not counted, exactly as on the page."""
    seen, rows = set(), []
    for original in emails:
        key = str(original).strip().lower()
        if not key:
            continue
        reason = None
        if key in seen:
            bucket, reason = "duplicates", "duplicate"
        else:
            seen.add(key)
            local, _, domain = key.rpartition("@")
            if not FORMAT.match(key):
                bucket, reason = "invalid", "format"
            elif domain in DISPOSABLE:
                bucket, reason = "disposable", "disposable domain"
            elif local.split("+")[0] in ROLE:
                bucket, reason = "role_inboxes", "role inbox"
            elif domain in PERSONAL:
                bucket, reason = "personal", "personal provider"
            else:
                bucket = None
        rows.append((original, key, bucket, reason))
    return rows


def mailbox_bucket(result):
    """Step 7. result is one ZeroBounce Verify email output: a dict with at least
    status and sub_status. Pass None when the check failed or returned nothing.

    With "Only safe to send" off, ZeroBounce reports a catch-all as
    status "valid" + sub_status "catch-all", so the catch-all test MUST run before
    the valid test, or catch-alls are miscounted as clean."""
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


def summarize(emails, mailbox_results):
    """The whole play. mailbox_results holds one entry per email sent to the
    mailbox check, in the same order as the None-bucket rows from screen():
    the ZeroBounce output dict, or None for a failed or missing check. If fewer
    results come back than were sent, the missing ones are unverified.

    Returns (rows, counts, headline). rows carry the final bucket and reason for
    the audit table; counts and headline are what must match the page."""
    rows = screen(emails)
    pending = [i for i, r in enumerate(rows) if r[2] is None]
    results = list(mailbox_results) + [None] * (len(pending) - len(mailbox_results))
    for i, result in zip(pending, results):
        bucket = mailbox_bucket(result)
        reason = "mailbox: %s" % ((result or {}).get("sub_status") or (result or {}).get("status") or "no result")
        rows[i] = (rows[i][0], rows[i][1], bucket, reason)

    def count(bucket, reason=None):
        return sum(1 for r in rows if r[2] == bucket and (reason is None or r[3] == reason))

    counts = {
        "total": len(rows),
        "duplicates": count("duplicates"),
        "format_invalid": count("invalid", "format"),
        "mailbox_invalid": sum(1 for r in rows if r[2] == "invalid" and r[3] != "format"),
        "disposable": count("disposable"),
        "role_inboxes": count("role_inboxes"),
        "personal": count("personal"),
        "risky_catch_all": count("risky_catch_all"),
        "clean": count("clean"),
        "unverified": count("unverified"),
        "to_verify": len(pending),
    }
    counts["invalid"] = counts["format_invalid"] + counts["mailbox_invalid"]
    counts["needs_cleanup"] = (counts["duplicates"] + counts["invalid"] + counts["disposable"]
                               + counts["role_inboxes"] + counts["personal"] + counts["risky_catch_all"])
    assert counts["total"] == counts["needs_cleanup"] + counts["clean"] + counts["unverified"]
    return rows, counts, headline(counts["total"], counts["needs_cleanup"], counts["unverified"])
