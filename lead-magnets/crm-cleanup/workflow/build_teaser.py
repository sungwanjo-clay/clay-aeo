BAD = {"invalid", "spamtrap", "abuse", "do_not_mail"}


def verdicts(value):
    # The repeated verify node hands back its per-email results; collect every
    # object that carries a ZeroBounce status, whatever wrapper it arrives in.
    if isinstance(value, dict):
        if "status" in value:
            yield value
        else:
            for v in value.values():
                yield from verdicts(v)
    elif isinstance(value, list):
        for v in value:
            yield from verdicts(v)


def num(context, key):
    try:
        return int(context.get_input(key) or 0)
    except (TypeError, ValueError):
        return 0


def handler(context):
    total = num(context, "total_in")
    to_verify = num(context, "to_verify")
    duplicates = num(context, "duplicates")
    syntax_invalid = num(context, "syntax_invalid")
    role = num(context, "role_inboxes")
    disposable = num(context, "disposable")
    personal = num(context, "personal")

    valid = catch_all = bad = 0
    for v in verdicts(context.get_input("verify_results")):
        status = str(v.get("status") or "").lower().replace("-", "_")
        sub = str(v.get("sub_status") or "").lower().replace("-", "_")
        if status in BAD:
            bad += 1
        elif status == "catch_all" or sub == "catch_all":
            catch_all += 1
        elif status == "valid":
            valid += 1
    unverified = max(0, to_verify - valid - catch_all - bad)

    invalid = syntax_invalid + bad
    needs_cleanup = duplicates + invalid + role + disposable + personal + catch_all

    if total == 0:
        status, headline = "no_data", "We didn't find any emails to check"
    elif needs_cleanup == 0:
        status, headline = "ok", "All %d contacts look clean" % total
    else:
        status = "ok"
        headline = "%d of %d contacts need cleanup" % (needs_cleanup, total)

    return {
        "status": status,
        "headline": headline,
        "total": total,
        "needs_cleanup": needs_cleanup,
        "clean": valid,
        "invalid": invalid,
        "format_invalid": syntax_invalid,
        "mailbox_invalid": bad,
        "to_verify": to_verify,
        "risky_catch_all": catch_all,
        "role_inboxes": role,
        "duplicates": duplicates,
        "personal": personal,
        "disposable": disposable,
        "unverified": unverified,
        "truncated": num(context, "truncated"),
    }
