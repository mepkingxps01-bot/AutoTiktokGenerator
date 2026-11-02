"""Dr.Trader Content Factory V1.

Generates 3 Thai educational trading posts and renders each as a
5-slide 1080x1920 carousel.

  python daily_generate.py --offline           # render examples/posts.json, no API call
  python daily_generate.py                     # 1 Claude API call -> 3 posts -> 15 PNGs

Output: output/<YYYY-MM-DD>/post_N/slide_1..5.png + caption.txt, and output/<date>/captions.md
"""
import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from renderer import render_post, validate_post

ROOT = Path(__file__).parent
POSTS_PER_DAY = 3
TOPICS = ["ICT concepts", "XAUUSD (gold) trading", "market structure",
          "risk management", "trading psychology"]

MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
MAX_OUTPUT_TOKENS = 16000   # hard cap on spend per run (one request)
REQUEST_TIMEOUT_S = 300
SDK_MAX_RETRIES = 1         # SDK retries only 408/409/429/5xx/connection errors; never 400

SYSTEM_PROMPT = """You write educational TikTok carousel content in Thai for the brand
"Dr.Trader / เบิ้ลพอร์ต ลอตใหญ่" (tagline: "Survive First. Scale Later.").
Audience: Thai retail traders. Tone: calm, practical, premium, honest.

Rules:
- Thai language. Standard trading terms (ICT, BOS, CHoCH, Order Block, FVG, SL, TP, XAUUSD, lot) may stay in English.
- Educational only. Never promise profit, win rates, income or "easy money". No signals, no "buy now".
- Emphasise risk control and process over results.
- Put a space between Thai phrases (roughly every 2-5 words) so text can wrap cleanly.
- Each post: exactly 5 slides.
  Slide 1 = hook (heading <= 45 chars, body: 1 short line).
  Slides 2-4 = one key point each (heading <= 40 chars, body: 2 lines, each <= 70 chars).
  Slide 5 = summary (heading "สรุป" or similar, body: 2 lines, each <= 70 chars).
- caption: 1-2 Thai sentences, <= 200 chars. hashtags: 4-6 items, each starting with #, always include #DrTrader.
- topic: short english slug.
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "posts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "slides": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "heading": {"type": "string"},
                                "body": {"type": "array", "items": {"type": "string"}},
                            },
                            "required": ["heading", "body"],
                            "additionalProperties": False,
                        },
                    },
                    "caption": {"type": "string"},
                    "hashtags": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["topic", "slides", "caption", "hashtags"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["posts"],
    "additionalProperties": False,
}


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def todays_topics(today):
    # rotate through the topic list so consecutive days differ
    start = today.toordinal() % len(TOPICS)
    return [TOPICS[(start + i) % len(TOPICS)] for i in range(POSTS_PER_DAY)]


def generate_posts(today):
    import anthropic

    if not os.environ.get("ANTHROPIC_API_KEY"):
        fail("ANTHROPIC_API_KEY is not set (add it as a GitHub Actions secret).")

    topics = todays_topics(today)
    user_msg = (
        f"Write {POSTS_PER_DAY} distinct carousel posts, one per topic, in this order:\n"
        + "\n".join(f"{i}. {t}" for i, t in enumerate(topics, 1))
        + "\nEach post must teach one specific, concrete idea. No overlap between posts."
    )
    client = anthropic.Anthropic(timeout=REQUEST_TIMEOUT_S, max_retries=SDK_MAX_RETRIES)
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        )
    except anthropic.BadRequestError as e:
        fail(f"HTTP 400 from Claude API - stopping. Details: {e.message}")
    except anthropic.APIStatusError as e:
        fail(f"Claude API returned HTTP {e.status_code}: {e.message}")
    except anthropic.APIConnectionError as e:
        fail(f"Could not reach Claude API: {e}")

    u = resp.usage
    print(f"API usage: model={resp.model} input_tokens={u.input_tokens} output_tokens={u.output_tokens}")
    if resp.stop_reason != "end_turn":
        fail(f"Unexpected stop_reason '{resp.stop_reason}' - output not usable.")
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        fail("No text in API response.")
    try:
        posts = json.loads(text)["posts"]
    except (json.JSONDecodeError, KeyError) as e:
        fail(f"Could not parse API JSON: {e}")
    return posts


def write_outputs(posts, out_root):
    if len(posts) != POSTS_PER_DAY:
        fail(f"Expected {POSTS_PER_DAY} posts, got {len(posts)}")
    for i, p in enumerate(posts, 1):
        try:
            validate_post(p)
        except ValueError as e:
            fail(f"Post {i} invalid: {e}")

    out_root.mkdir(parents=True, exist_ok=True)
    summary = [f"# Dr.Trader posts - {out_root.name}\n"]
    count = 0
    for i, p in enumerate(posts, 1):
        d = out_root / f"post_{i}"
        pngs = render_post(p, d)
        count += len(pngs)
        caption = p["caption"].strip() + "\n\n" + " ".join(p["hashtags"])
        (d / "caption.txt").write_text(caption + "\n", encoding="utf-8")
        (d / "post.json").write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding="utf-8")
        summary.append(f"## Post {i}: {p['topic']}\n\n{caption}\n")
    (out_root / "captions.md").write_text("\n".join(summary), encoding="utf-8")
    print(f"Rendered {count} PNG files into {out_root}")
    return count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="render examples/posts.json, no API call")
    ap.add_argument("--out", default=str(ROOT / "output"))
    args = ap.parse_args()

    today = datetime.now(ZoneInfo("Asia/Bangkok")).date()
    if args.offline:
        posts = json.loads((ROOT / "examples" / "posts.json").read_text(encoding="utf-8"))
    else:
        posts = generate_posts(today)
    write_outputs(posts, Path(args.out) / today.isoformat())


if __name__ == "__main__":
    main()
