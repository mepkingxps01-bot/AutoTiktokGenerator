# Dr.Trader Content Factory V1

Every day, it makes 3 Thai educational trading posts. Each post is a 5-slide carousel (1080×1920 PNG). The output is a downloadable GitHub Actions artifact. You review the posts and put them on TikTok yourself. Nothing is published automatically.

Brand: **Dr.Trader / เบิ้ลพอร์ต ลอตใหญ่** · *Survive First. Scale Later.*

## Files

| Path | Purpose |
|---|---|
| `daily_generate.py` | Makes one Claude API call for 3 posts (or reads the examples with `--offline`), checks them and renders the PNGs |
| `renderer/` | Pillow carousel renderer (black/charcoal/gold) with the Kanit Thai font (OFL) |
| `examples/posts.json` | 3 example posts for rendering offline, which also show the content format |
| `.github/workflows/daily.yml` | Manual-trigger workflow (the daily schedule is commented out) |

## Run locally

```bash
pip install -r requirements.txt     # Linux also needs libraqm (apt install libraqm0) to shape Thai text
python daily_generate.py --offline  # no API call, no cost
```

Output:

```
output/<YYYY-MM-DD>/
  captions.md            # all 3 captions + hashtags
  post_1/slide_1.png … slide_5.png, caption.txt, post.json
  post_2/…
  post_3/…
```

## GitHub setup

1. Keep the repository **private**: Settings → General → Danger Zone → Change visibility.
2. Add the API key: Settings → Secrets and variables → Actions → New repository secret. Name it `ANTHROPIC_API_KEY`. Never commit keys.
3. Optional: set a monthly spend limit for the key in the Anthropic Console.

## Running the workflow

Go to Actions → **Daily Dr.Trader carousels** → Run workflow.

- `offline` = true (the default) renders the example posts. It costs nothing and checks the pipeline.
- `offline` = false makes **one paid Claude API call** and produces 3 new posts.

When the run finishes, download the `drtrader-posts-N` artifact (zip) from the run page.

### Enable the daily 07:00 Bangkok schedule

Do this only after a manual run with `offline = false` has produced 15 good PNGs. Uncomment these lines in `.github/workflows/daily.yml`:

```yaml
  schedule:
    - cron: "0 0 * * *"   # 00:00 UTC = 07:00 Asia/Bangkok
```

GitHub's scheduled runs can start a few minutes late.

## Spending and failure safety

- One request per run. `max_tokens` = 16000, `effort` = low. The model is `claude-opus-5-5` by default. To change it, set the `CLAUDE_MODEL` env var in the workflow.
- Rough cost is about US$0.10–0.35 per run. The worst case is about US$0.70: the SDK retries once, and only on 429/5xx/network errors.
- **HTTP 400 stops the run immediately** and the error message appears in the job log. It is never retried.
- The run fails without making images if the AI output does not match the format (wrong slide count, missing caption, text over the length limits).
- The job times out after 15 minutes. Only one run can happen at a time.

## Content format

A post has exactly 5 slides. Slide 1 is the cover/hook, slides 2–4 are numbered points, and slide 5 is the summary with the tagline and disclaimer.

```json
{
  "topic": "risk-management",
  "slides": [{"heading": "...", "body": ["...", "..."]}, ...5],
  "caption": "...",
  "hashtags": ["#DrTrader", "..."]
}
```

Limits: heading ≤ 60 characters, up to 4 body lines per slide, each ≤ 110 characters.
