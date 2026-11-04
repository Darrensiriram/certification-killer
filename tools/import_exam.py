#!/usr/bin/env python3
"""Importeer een ExamTopics-PDF (versie met antwoorden) naar een oefenbank.

Voorbeeld:
  python3 tools/import_exam.py --id az-104 --name "AZ-104" \
      --pdf "/pad/AZ-104_Exam_-_Answers.pdf" [--questions-pdf "/pad/AZ-104_Exam_-_Questions.pdf"]

Resultaat:
  bank/<id>/questions.json   (zie README.md voor het formaat)
  bank/<id>/img/*.jpg        (uitsneden van vragen met afbeeldingen)
  bank/index.json            (wordt bijgewerkt met dit certificaat)

Vereist: pdftotext / pdftoppm (poppler) en Python 3.9+.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DPI = 110
TOP, BOTTOM = 40, 1155           # verwijdert browserkop en URL-voettekst (in pt)
X0, X1 = 50, 800                 # horizontale uitsnede (in pt)

HDR = re.compile(r"^Question #(\d+)\s+Topic\s+(\d+)$")
SECTION = re.compile(r"^Topic \d+ - (Question Set|Testlet) \d+$")
OPT = re.compile(r"^([A-F])\. (.*?)\s*(Most Voted)?$")
BOILER = ("Introductory Info", "Case study", "This is a case study", "To answer the questions included",
          "contain exhibits", "At the end of this case study", "the next section of the exam",
          "included on this exam", "there may be additional case", "independent of the other questions",
          "To start the case study", "To display the first question", "before you answer the questions",
          "statements. If the case study", "subsequent tabs", "When you are ready to answer")
EXHIBIT = re.compile(
    r"(following|shown|below|above|exhibit|screenshot)\s+(\w+\s+)?(table|exhibit|image|diagram|graphic|screenshot|list|map|figure|picture)"
    r"|exhibit|shown in|shown below|shown above|hot area|answer area|select and place|drag", re.I)


def is_noise(s):
    return (s.startswith("https://www.examtopics.com")
            or re.match(r"^\d{1,2}/\d{1,2}/\d{2}, \d{1,2}:\d{2} [AP]M", s)
            or re.match(r"^Viewing (page|questions) ", s)
            or s.startswith("AZ-104 Exam - Free Actual"))


def parse_text(lines):
    """Split the PDF text into question blocks."""
    blocks, cur = [], None
    for raw in lines:
        s = raw.strip()
        if not s or is_noise(s):
            continue
        m = HDR.match(s)
        if m:
            if cur:
                blocks.append(cur)
            cur = {"number": int(m.group(1)), "topic": int(m.group(2)), "lines": []}
            continue
        if SECTION.match(s):
            if cur:
                blocks.append(cur)
                cur = None
            continue
        if cur is not None:
            cur["lines"].append(s)
    if cur:
        blocks.append(cur)

    out = []
    for idx, b in enumerate(blocks, start=1):
        L = b["lines"]
        ci = next((i for i, s in enumerate(L) if s.startswith("Correct Answer:")), None)
        pre = L[:ci] if ci is not None else L
        post = L[ci:] if ci is not None else []
        correct_raw = L[ci][len("Correct Answer:"):].strip() if ci is not None else ""
        options, body = [], []
        for s in pre:
            mo = OPT.match(s)
            if mo:
                options.append({"letter": mo.group(1), "text": mo.group(2).strip()})
            else:
                body.append(s)
        text, in_boiler = [], True
        for s in body:
            if s == "Question":
                continue
            if s.startswith("Overview"):
                in_boiler = False
            if in_boiler and s.startswith(BOILER):
                continue
            text.append(s)
        vote, answer_text, vote_next = None, [], False
        for s in post[1:]:
            if s.startswith("Community vote distribution"):
                vote_next = True
                continue
            if vote_next and s:
                vote, vote_next = s, False
                continue
            answer_text.append(s)
        out.append({
            "id": idx, "number": b["number"], "topic": b["topic"],
            "question": "\n".join(text).strip(), "options": options,
            "correct_raw": correct_raw, "answer_text": "\n".join(answer_text).strip() or None,
            "community_vote": vote,
        })
    return out


def normalize(raw):
    items = []
    for x in raw:
        correct = [c for c in x["correct_raw"].replace(" ", "") if c.isalpha()] if x["correct_raw"] else []
        q = x["question"]
        if "Hot Area" in q or "HOTSPOT" in q[:40]:
            t = "hotspot"
        elif "Select and Place" in q or q.lstrip().startswith("DRAG"):
            t = "drag_drop"
        elif len(correct) > 1:
            t = "multi"
        elif correct:
            t = "single"
        elif x["answer_text"]:
            t = "hotspot"
        else:
            t = "answer_area"
        pct = None
        if x["community_vote"] and correct:
            m = re.search(re.escape("".join(correct)) + r"\s*\((\d+)%\)", x["community_vote"])
            if m:
                pct = int(m.group(1))
        items.append({
            "id": x["id"], "number": x["number"], "topic": x["topic"], "type": t,
            "question": q, "options": x["options"], "correct": correct,
            "answer_text": x["answer_text"], "community_pct": pct,
            # Image-only answer: the answer exists only as a picture in the PDF.
            "answer_as_image": (not correct) and (not x["answer_text"]),
        })
    return items


def run(cmd):
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True).stdout


def bbox_pages(pdf, tmpdir):
    out = Path(tmpdir) / "bbox.html"
    run(["pdftotext", "-bbox-layout", str(pdf), str(out)])
    html = out.read_text(encoding="utf-8")
    pages = []
    for pm in re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', html, re.S):
        words = [(float(a), float(b), float(c), float(d), w) for a, b, c, d, w in
                 re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>',
                            pm.group(3))]
        pages.append(words)
    return pages


def headers_from_pages(pages):
    hs = []
    for pno, words in enumerate(pages, start=1):
        for i, (x0, y0, _x1, _y1, w) in enumerate(words):
            if w == "Question" and i + 1 < len(words) and re.fullmatch(r"#\d+", words[i + 1][4]) and x0 < 100:
                hs.append({"page": pno, "y": y0, "number": int(words[i + 1][4][1:])})
    return hs


def box_top(pdf_path, page, y_from, y_label):
    """Find the top border of the 'Correct Answer' box: the last full-width horizontal line above the label.

    Returns a y position in pt, or None if no line is found (or Pillow is not installed).
    """
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        return None
    s = DPI / 72.0
    with tempfile.TemporaryDirectory() as t:
        out = Path(t) / "r"
        subprocess.run(["pdftoppm", "-r", str(DPI), "-f", str(page), "-l", str(page), "-gray", "-png",
                        "-singlefile", "-x", str(int(X0 * s)), "-y", str(int(y_from * s)),
                        "-W", str(int((X1 - X0) * s)), "-H", str(int((y_label - y_from) * s)),
                        str(pdf_path), str(out)], check=True, stderr=subprocess.DEVNULL)
        im = np.array(Image.open(str(out) + ".png").convert("L")).astype(int)
    h, w = im.shape
    frac = ((im > 90) & (im < 225)).sum(axis=1) / w
    rows = [r for r in range(60, h) if frac[r] > 0.6]   # skip the page's own header line
    if not rows:
        return None
    return y_from + rows[-1] / s


def crop_images(pdf_path, items, pages, outdir, tmpdir):
    """Cut the question area (exhibits, tables, answer area) out of the PDF.

    Questions whose answer is only an image get two parts: 'images' (the question)
    and 'answer_images' (everything from 'Correct Answer:' onwards), so the app can
    keep the answer hidden until the user asks for it.
    """
    hs = headers_from_pages(pages)
    if len(hs) != len(items):
        raise SystemExit(f"Kopjes in PDF ({len(hs)}) komen niet overeen met vragen ({len(items)}).")
    flat = []
    for pno, words in enumerate(pages, start=1):
        for (x0, y0, _x1, _y1, w) in words:
            flat.append((pno, y0, x0, w))
    flat.sort(key=lambda t: (t[0], t[1], t[2]))

    def find_marker(i, kind):
        """Position (page, y) of the first option 'A.' ('option') or 'Correct Answer' ('correct') after question i."""
        start = hs[i]
        end = hs[i + 1] if i + 1 < len(hs) else None
        for k, (p, y, x, w) in enumerate(flat):
            if (p, y) < (start["page"], start["y"] + 1):
                continue
            if end and (p, y) >= (end["page"], end["y"] - 1):
                break
            if kind == "option" and w == "A." and x < 110:
                return (p, y - 4)
            if kind == "correct" and w == "Correct" and k + 1 < len(flat) and flat[k + 1][3] == "Answer:":
                return (p, y - 4)
        return None

    def span(i, a, b):
        """Segments (page, y_top, y_bottom) covering the PDF between position a and position b."""
        (sp, sy), (ep, ey) = a, b
        if sp == ep:
            return [(sp, sy, ey)] if ey - sy > 15 else []
        segs = [(sp, sy, BOTTOM)] + [(p, TOP, BOTTOM) for p in range(sp + 1, ep)] + [(ep, TOP, ey)]
        return [seg for seg in segs if seg[2] - seg[1] > 15]

    def question_end(i):
        nxt = hs[i + 1] if i + 1 < len(hs) else None
        return (nxt["page"], nxt["y"] - 6) if nxt else (len(pages), BOTTOM)

    def question_start(i):
        return (hs[i]["page"], hs[i]["y"] - 6)

    def render(page, y0, y1, out):
        s = DPI / 72.0
        subprocess.run(["pdftoppm", "-r", str(DPI), "-f", str(page), "-l", str(page), "-jpeg",
                        "-jpegopt", "quality=80", "-singlefile",
                        "-x", str(int(X0 * s)), "-y", str(int(y0 * s)),
                        "-W", str(int((X1 - X0) * s)), "-H", str(int((y1 - y0) * s)),
                        str(pdf_path), str(out)[:-4]], check=True, stderr=subprocess.DEVNULL)

    def write(i, segments, prefix, counter):
        files = []
        for k, (p, y0, y1) in enumerate(segments, start=1):
            name = f"q{i + 1:03d}_{prefix}{k}.jpg"
            render(p, y0, y1, outdir / name)
            files.append(f"img/{name}")
            counter[0] += 1
        return files

    counter = [0]
    for it in items:
        i = it["id"] - 1
        it["images"], it["answer_images"] = [], []
        if it["answer_as_image"]:
            cut = find_marker(i, "correct")
            if cut is None:
                raise SystemExit(f"Vraag {it['id']}: geen 'Correct Answer' gevonden.")
            # Move the cut up to the top of the answer box so the box's content is not in the question part.
            qs_page, qs_y = question_start(i)
            if cut[0] == qs_page:
                top = box_top(pdf_path, cut[0], qs_y, cut[1])
            else:
                top = box_top(pdf_path, cut[0], TOP, cut[1])
            if top is not None and top > TOP:
                cut = (cut[0], top - 2)
            it["images"] = write(i, span(i, question_start(i), cut), "", counter)
            # answer part starts at the 'Correct Answer' line
            it["answer_images"] = write(i, span(i, (cut[0], cut[1]), question_end(i)), "a", counter)
        elif EXHIBIT.search(it["question"]):
            cut = find_marker(i, "option") or find_marker(i, "correct")
            end = cut if cut else question_end(i)
            it["images"] = write(i, span(i, question_start(i), end), "", counter)
    return counter[0]


def check_questions_pdf(pdf, expected, tmpdir):
    headers = headers_from_pages(bbox_pages(pdf, tmpdir))
    if len(headers) != expected:
        print(f"WAARSCHUWING: vragen-PDF heeft {len(headers)} vragen, antwoorden-PDF {expected}.", file=sys.stderr)
    else:
        print(f"Controle: vragen-PDF heeft evenveel vragen ({expected}).")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id", required=True, help="korte id, bv. az-104 (wordt de mapnaam)")
    ap.add_argument("--name", required=True, help="weergavenaam, bv. AZ-104")
    ap.add_argument("--pdf", required=True, type=Path, help="PDF met vragen én antwoorden")
    ap.add_argument("--questions-pdf", type=Path, help="optioneel: PDF met alleen vragen, voor controle")
    args = ap.parse_args()

    bank_dir = ROOT / "bank" / args.id
    img_dir = bank_dir / "img"
    shutil.rmtree(bank_dir, ignore_errors=True)
    img_dir.mkdir(parents=True)

    with tempfile.TemporaryDirectory() as tmp:
        text = run(["pdftotext", "-layout", str(args.pdf), "-"])
        raw = parse_text(text.splitlines())
        items = normalize(raw)
        print(f"Vragen gevonden: {len(items)}")
        pages = bbox_pages(args.pdf, tmp)
        n_img = crop_images(args.pdf, items, pages, img_dir, tmp)
        if args.questions_pdf:
            check_questions_pdf(args.questions_pdf, len(items), tmp)

    for it in items:
        it.pop("answer_as_image", None)
        if not it["answer_images"]:
            it.pop("answer_images")
    data = {
        "certificate": {"id": args.id, "name": args.name, "source": args.pdf.name},
        "questions": items,
    }
    (bank_dir / "questions.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    index_path = ROOT / "bank" / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    index = [c for c in index if c["id"] != args.id]
    index.append({"id": args.id, "name": args.name, "count": len(items)})
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    types = {}
    for it in items:
        types[it["type"]] = types.get(it["type"], 0) + 1
    print(f"Typen: {types}")
    print(f"Afbeeldingen: {n_img} in {img_dir}")
    print(f"Klaar: {bank_dir / 'questions.json'}")


if __name__ == "__main__":
    main()
