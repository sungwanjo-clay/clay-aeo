#!/usr/bin/env python3
"""
TF-IDF / term-frequency content analyzer (Surfer/Clearscope-style).

Input:  a JSON file shaped like:
        {
          "keyword": "apollo alternatives",
          "target_word_count": 2000,        # optional, default = median competitor length
          "pages": [ {"url": "...", "text": "full page body text"}, ... ]
        }

Output: prints a JSON term report to stdout AND writes it next to the input
        as <input>.report.json. The report contains recommended terms
        (1-3 word phrases) with document frequency, average usage, and a
        suggested usage-count range for the target word count.

Usage:  python3 tfidf_analyze.py /path/to/pages.json [--top 60]
"""
import argparse, json, re, sys, math
from collections import Counter

try:
    from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS
except Exception as e:
    sys.exit("scikit-learn is required (pre-installed in the sandbox): %s" % e)

# A few SEO/boilerplate words we never want to recommend.
EXTRA_STOP = {
    "best", "top", "guide", "review", "reviews", "vs", "list", "blog",
    "article", "read", "click", "home", "sign", "login", "free", "trial",
    "pricing", "price", "use", "using", "used", "like", "just", "get",
    "also", "one", "two", "make", "need", "want", "way", "ways", "year",
    "2023", "2024", "2025", "2026", "com", "www", "https", "http",
}
STOP = set(ENGLISH_STOP_WORDS) | EXTRA_STOP

WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9\.\-]{1,}")


def clean_text(t: str) -> str:
    t = re.sub(r"\s+", " ", t or "")
    return t.strip()


def word_count(t: str) -> int:
    return len(WORD_RE.findall(t or ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--top", type=int, default=60, help="max terms to return")
    args = ap.parse_args()

    with open(args.input) as f:
        data = json.load(f)

    keyword = data.get("keyword", "")
    pages = [p for p in data.get("pages", []) if clean_text(p.get("text", ""))]
    if len(pages) < 2:
        sys.exit("Need at least 2 pages with text to analyze; got %d" % len(pages))

    docs = [clean_text(p["text"]) for p in pages]
    counts = [word_count(d) for d in docs]
    counts_sorted = sorted(counts)
    median_wc = counts_sorted[len(counts_sorted) // 2]
    target_wc = int(data.get("target_word_count") or median_wc)

    n_docs = len(docs)

    # TF-IDF over 1-3 grams to rank term importance across the SERP corpus.
    vec = TfidfVectorizer(
        ngram_range=(1, 3),
        stop_words=list(STOP),
        token_pattern=r"(?u)\b[A-Za-z][A-Za-z0-9\-]+\b",
        min_df=2,            # term must appear in >=2 of the top pages
        max_df=0.95,
        sublinear_tf=True,
    )
    X = vec.fit_transform(docs)
    terms = vec.get_feature_names_out()

    # Document frequency: how many of the top pages use the term.
    df = (X > 0).sum(axis=0).A1
    # Mean TF-IDF importance across the corpus.
    mean_tfidf = X.mean(axis=0).A1

    # Raw per-page occurrence counts (for usage recommendations).
    raw_counts = []  # parallel to terms
    lowered = [d.lower() for d in docs]
    analyzer = vec.build_analyzer()
    doc_tokens = [Counter(analyzer(d)) for d in docs]

    rows = []
    for i, term in enumerate(terms):
        # occurrences of this exact ngram per doc
        occ = [tok.get(term, 0) for tok in doc_tokens]
        pages_with = sum(1 for o in occ if o > 0)
        if pages_with < 2:
            continue
        avg_occ_when_present = sum(o for o in occ if o > 0) / pages_with
        # Normalize usage to the target word count using avg competitor length.
        avg_len_present = (
            sum(counts[j] for j, o in enumerate(occ) if o > 0) / pages_with
        )
        density = avg_occ_when_present / max(avg_len_present, 1)
        suggested = density * target_wc
        lo = max(1, math.floor(suggested * 0.7))
        hi = max(lo, math.ceil(suggested * 1.3))

        n_words = len(term.split())
        # Relevance score: prevalence across SERP * importance, favoring phrases.
        score = (pages_with / n_docs) * float(mean_tfidf[i]) * (1 + 0.25 * (n_words - 1))

        rows.append({
            "term": term,
            "words": n_words,
            "pages_using": int(pages_with),
            "coverage_pct": round(100 * pages_with / n_docs),
            "avg_uses_when_present": round(avg_occ_when_present, 1),
            "suggested_uses": [int(lo), int(hi)],
            "score": round(float(score), 5),
        })

    rows.sort(key=lambda r: r["score"], reverse=True)
    top_rows = rows[: args.top]

    report = {
        "keyword": keyword,
        "pages_analyzed": n_docs,
        "competitor_word_counts": counts,
        "median_competitor_words": median_wc,
        "target_word_count": target_wc,
        "primary_terms": [r for r in top_rows if r["words"] == 1][:25],
        "phrases": [r for r in top_rows if r["words"] >= 2][:25],
        "all_terms": top_rows,
    }

    out_path = args.input + ".report.json"
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2)

    print(json.dumps(report, indent=2))
    print("\nReport written to: %s" % out_path, file=sys.stderr)


if __name__ == "__main__":
    main()
