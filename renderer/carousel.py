"""Render one Dr.Trader post into 5 PNG slides (1080x1920).

Post schema (JSON):
{
  "topic": "short english slug, e.g. risk-management",
  "slides": [                      # exactly 5
    {"heading": "...", "body": ["...", "..."]},
    ...
  ],
  "caption": "TikTok caption (Thai)",
  "hashtags": ["#เทรดทอง", "#XAUUSD", ...]
}
Slide 1 is drawn as the cover, slides 2-4 as numbered points,
slide 5 as the closing slide with the tagline.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, features

WIDTH, HEIGHT = 1080, 1920
SLIDES_PER_POST = 5
MARGIN = 96

BLACK = (10, 10, 10)
CHARCOAL = (34, 34, 36)
GOLD = (212, 175, 55)
GOLD_SOFT = (176, 141, 60)
WHITE = (242, 238, 228)
GREY = (150, 146, 138)

BRAND = "Dr.Trader | เบิ้ลพอร์ต ลอตใหญ่"
TAGLINE = "Survive First. Scale Later."
DISCLAIMER = "เพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน การเทรดมีความเสี่ยง"

FONT_DIR = Path(__file__).parent / "fonts"
_FONT_FILES = {
    "regular": "Kanit-Regular.ttf",
    "bold": "Kanit-Bold.ttf",
    "black": "Kanit-ExtraBold.ttf",
}
_font_cache = {}

# Thai characters that must never start a line (combining marks / trailing vowels)
_NO_LINE_START = set(chr(c) for c in [0x0E30, 0x0E31, 0x0E32, 0x0E33, *range(0x0E34, 0x0E3B),
                                      0x0E45, *range(0x0E47, 0x0E4F)])
# Thai leading vowels that must never end a line
_NO_LINE_END = set(chr(c) for c in range(0x0E40, 0x0E45))

LIMITS = {"heading": 60, "body_item": 110, "body_items": 4}


def _font(weight, size):
    key = (weight, size)
    if key not in _font_cache:
        path = FONT_DIR / _FONT_FILES[weight]
        if not features.check("raqm"):
            # Without libraqm, Thai vowels/tone marks are placed wrongly. Fail instead.
            raise RuntimeError("Pillow has no libraqm support; install libraqm (apt: libraqm0)")
        _font_cache[key] = ImageFont.truetype(str(path), size, layout_engine=ImageFont.Layout.RAQM)
    return _font_cache[key]


def _text_w(draw, text, font):
    return draw.textlength(text, font=font)


def _split_long(draw, word, font, max_w):
    """Break a token without spaces (common in Thai) at safe character boundaries."""
    lines, cur = [], ""
    for ch in word:
        s = cur + ch
        if cur and _text_w(draw, s, font) > max_w:
            cut = len(cur)  # break before s[cut]
            while cut > 1 and (s[cut] in _NO_LINE_START or s[cut - 1] in _NO_LINE_END):
                cut -= 1
            lines.append(s[:cut])
            cur = s[cut:]
        else:
            cur = s
    if cur:
        lines.append(cur)
    return lines


def wrap(draw, text, font, max_w):
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}" if cur else word
        if _text_w(draw, trial, font) <= max_w:
            cur = trial
            continue
        if cur:
            lines.append(cur)
        if _text_w(draw, word, font) <= max_w:
            cur = word
        else:
            parts = _split_long(draw, word, font, max_w)
            lines.extend(parts[:-1])
            cur = parts[-1]
    if cur:
        lines.append(cur)
    return lines


def _fit(draw, text, weight, size, min_size, max_w, max_lines):
    """Shrink font until text fits in max_lines."""
    while True:
        font = _font(weight, size)
        lines = wrap(draw, text, font, max_w)
        too_wide = any(_text_w(draw, w, font) > max_w for w in text.split())
        if (len(lines) <= max_lines and not too_wide) or size <= min_size:
            return font, lines
        size -= 4


def _line_h(font):
    # Kanit has tall Thai stacks; give generous leading
    return int(font.size * 1.45)


def _background():
    img = Image.new("RGB", (WIDTH, HEIGHT), BLACK)
    top = Image.new("RGB", (WIDTH, HEIGHT), CHARCOAL)
    mask = Image.linear_gradient("L").resize((WIDTH, HEIGHT))  # 0 top -> 255 bottom
    img = Image.composite(img, top, mask)
    d = ImageDraw.Draw(img)
    # gold frame
    d.rectangle([40, 40, WIDTH - 40, HEIGHT - 40], outline=GOLD_SOFT, width=3)
    return img, d


def _header_footer(d, index):
    f = _font("bold", 34)
    d.text((MARGIN, 96), "DR.TRADER", font=f, fill=GOLD)
    page = f"{index}/{SLIDES_PER_POST}"
    d.text((WIDTH - MARGIN - _text_w(d, page, f), 96), page, font=f, fill=GREY)
    d.line([MARGIN, 160, WIDTH - MARGIN, 160], fill=GOLD_SOFT, width=2)

    d.line([MARGIN, HEIGHT - 190, WIDTH - MARGIN, HEIGHT - 190], fill=GOLD_SOFT, width=2)
    fb = _font("regular", 34)
    d.text((MARGIN, HEIGHT - 160), BRAND, font=fb, fill=WHITE)
    ft = _font("bold", 30)
    d.text((MARGIN, HEIGHT - 105), TAGLINE, font=ft, fill=GOLD)


# Content area between header line (y=160) and footer line (y=HEIGHT-190)
TOP, BOTTOM = 220, HEIGHT - 260
BULLET_INDENT = 60


def _block(lines, font, color, gap, bullet=False):
    return {"lines": lines, "font": font, "color": color, "gap": gap, "bullet": bullet}


def _body_blocks(d, body, size=58, bullet=True):
    font = _font("regular", size)
    max_w = WIDTH - 2 * MARGIN - (BULLET_INDENT if bullet else 0)
    return [_block(wrap(d, item, font, max_w), font, WHITE, 40, bullet) for item in body]


def _height(blocks):
    return sum(len(b["lines"]) * _line_h(b["font"]) + b["gap"] for b in blocks)


def _draw_blocks(d, blocks, y):
    for b in blocks:
        font, x = b["font"], MARGIN
        if b["bullet"]:
            top = y + int(font.size * 0.6)
            d.rectangle([MARGIN, top, MARGIN + 20, top + 20], fill=GOLD)
            x += BULLET_INDENT
        for line in b["lines"]:
            if line == "__RULE__":
                d.rectangle([MARGIN, y + 20, MARGIN + 180, y + 30], fill=GOLD)
            else:
                d.text((x, y), line, font=font, fill=b["color"])
            y += _line_h(font)
        y += b["gap"]
    return y


def _draw_centered(d, blocks, top=TOP, bottom=BOTTOM):
    h = _height(blocks)
    y = top + max(0, (bottom - top - h) // 2)
    return _draw_blocks(d, blocks, y)


def _cover(slide, index):
    img, d = _background()
    _header_footer(d, index)
    font, lines = _fit(d, slide["heading"], "black", 132, 76, WIDTH - 2 * MARGIN, 5)
    blocks = [_block(lines, font, GOLD, 10), _block(["__RULE__"], _font("regular", 40), GOLD, 30)]
    blocks += _body_blocks(d, slide.get("body", []), size=62, bullet=False)
    _draw_centered(d, blocks, bottom=BOTTOM - 120)
    d.text((MARGIN, HEIGHT - 320), "ปัดดูต่อ >>", font=_font("bold", 46), fill=GOLD)
    return img


def _point(slide, index):
    img, d = _background()
    _header_footer(d, index)
    font, lines = _fit(d, slide["heading"], "bold", 96, 60, WIDTH - 2 * MARGIN, 3)
    num = _font("black", 200)
    blocks = [_block([f"{index - 1:02d}"], num, GOLD_SOFT, -40), _block(lines, font, GOLD, 50)]
    blocks += _body_blocks(d, slide.get("body", []))
    _draw_centered(d, blocks)
    return img


def _closing(slide, index):
    img, d = _background()
    _header_footer(d, index)
    font, lines = _fit(d, slide["heading"], "bold", 96, 60, WIDTH - 2 * MARGIN, 3)
    blocks = [_block(lines, font, GOLD, 50)] + _body_blocks(d, slide.get("body", []))
    tag = _font("black", 84)
    blocks += [_block(["__RULE__"], _font("regular", 40), GOLD, 30),
               _block(["Survive First."], tag, WHITE, 0),
               _block(["Scale Later."], tag, GOLD, 0)]
    _draw_centered(d, blocks, bottom=BOTTOM - 40)
    d.text((MARGIN, HEIGHT - 245), DISCLAIMER, font=_font("regular", 30), fill=GREY)
    return img


def validate_post(post):
    """Raise ValueError if the post does not match the schema/limits."""
    if not isinstance(post, dict):
        raise ValueError("post must be an object")
    slides = post.get("slides")
    if not isinstance(slides, list) or len(slides) != SLIDES_PER_POST:
        raise ValueError(f"post must have exactly {SLIDES_PER_POST} slides")
    for i, s in enumerate(slides, 1):
        h = s.get("heading") if isinstance(s, dict) else None
        if not isinstance(h, str) or not h.strip():
            raise ValueError(f"slide {i}: missing heading")
        if len(h) > LIMITS["heading"]:
            raise ValueError(f"slide {i}: heading too long ({len(h)} > {LIMITS['heading']})")
        body = s.get("body", [])
        if not isinstance(body, list) or len(body) > LIMITS["body_items"]:
            raise ValueError(f"slide {i}: body must be a list of <= {LIMITS['body_items']} items")
        for b in body:
            if not isinstance(b, str) or len(b) > LIMITS["body_item"]:
                raise ValueError(f"slide {i}: body item invalid or longer than {LIMITS['body_item']} chars")
    if not isinstance(post.get("caption"), str) or not post["caption"].strip():
        raise ValueError("missing caption")
    tags = post.get("hashtags")
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise ValueError("hashtags must be a list of strings")


def render_post(post, out_dir):
    """Render the 5 slides of `post` into out_dir. Returns list of PNG paths."""
    validate_post(post)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, slide in enumerate(post["slides"], 1):
        if i == 1:
            img = _cover(slide, i)
        elif i == SLIDES_PER_POST:
            img = _closing(slide, i)
        else:
            img = _point(slide, i)
        p = out_dir / f"slide_{i}.png"
        img.save(p, "PNG", optimize=True)
        paths.append(p)
    return paths
