"""
renderer.py — Render a RecipeData object to a PDF using reportlab.

Knows nothing about YAML. All input comes from parser.RecipeData and
a style config dict loaded from style.yaml by the caller.
"""

# To install: pip3 install reportlab

from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    HRFlowable, Table, TableStyle
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT

from parser import RecipeData, PrepStep, VesselGroup


# ── Style helpers ─────────────────────────────────────────────────────────────

def _hex(hex_str):
    hex_str = hex_str.lstrip("#")
    r, g, b = (int(hex_str[i:i+2], 16) / 255.0 for i in (0, 2, 4))
    return colors.Color(r, g, b)

def _build_styles(st):
    c = {k: _hex(v) for k, v in st["colors"].items()}
    f = st["fonts"]
    sz = st["sizes"]

    return {
        "title": ParagraphStyle("title",
            fontName=f["title"], fontSize=sz["title"],
            textColor=c["primary"], leading=sz["title"] * 1.15, alignment=TA_LEFT),
        "subtitle": ParagraphStyle("subtitle",
            fontName=f["subtitle"], fontSize=sz["subtitle"],
            textColor=c["secondary"], leading=sz["subtitle"] * 1.4, alignment=TA_LEFT),
        "page_heading": ParagraphStyle("page_heading",
            fontName=f["heading"], fontSize=sz["page_heading"],
            textColor=c["accent"], leading=sz["page_heading"] * 1.2, alignment=TA_LEFT),
        "section_heading": ParagraphStyle("section_heading",
            fontName=f["heading"], fontSize=sz["phase_heading"],
            textColor=c["accent"], leading=sz["phase_heading"] * 1.3, alignment=TA_LEFT),
        "phase_heading": ParagraphStyle("phase_heading",
            fontName=f["heading"], fontSize=sz["phase_heading"],
            textColor=c["accent"], leading=sz["phase_heading"] * 1.3, alignment=TA_LEFT),
        "vessel_label": ParagraphStyle("vessel_label",
            fontName=f["label"], fontSize=sz["vessel_label"],
            textColor=c["muted"], leading=sz["vessel_label"] * 1.3, alignment=TA_LEFT),
        "body": ParagraphStyle("body",
            fontName=f["body"], fontSize=sz["body"],
            textColor=c["primary"], leading=sz["body"] * 1.45, alignment=TA_LEFT),
        "step": ParagraphStyle("step",
            fontName=f["body"], fontSize=sz["body"],
            textColor=c["primary"], leading=sz["body"] * 1.45,
            leftIndent=18, firstLineIndent=-18, alignment=TA_LEFT),
    }

def _rule(st, thickness=None):
    t = thickness or st["spacing"]["rule_thickness"]
    return HRFlowable(width="100%", thickness=t,
                      color=_hex(st["colors"]["accent"]), spaceAfter=6, spaceBefore=2)

def _row(text, index, st, styles):
    bg = _hex(st["colors"]["light"]) if (
        st["decorations"]["alternate_ingredient_rows"] and index % 2 == 0
    ) else colors.white
    tbl = Table([[Paragraph(text, styles["body"])]], colWidths=["100%"])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,-1), bg),
        ("TOPPADDING",    (0,0), (-1,-1), 3),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3),
        ("LEFTPADDING",   (0,0), (-1,-1), 6),
        ("RIGHTPADDING",  (0,0), (-1,-1), 6),
    ]))
    return tbl


# ── Shared page header ────────────────────────────────────────────────────────

def _page_header(heading, recipe, st, styles):
    sp = st["spacing"]
    items = [Paragraph(recipe.title, styles["title"])]
    if st["decorations"]["show_rule_under_title"]:
        items.append(_rule(st))
    if recipe.subtitle:
        items += [Spacer(1, sp["after_title"]), Paragraph(recipe.subtitle, styles["subtitle"])]
    items += [
        Spacer(1, sp["after_subtitle"]),
        Paragraph(heading, styles["page_heading"]),
    ]
    if st["decorations"]["show_rule_under_page_heading"]:
        items.append(_rule(st, thickness=0.4))
    items.append(Spacer(1, sp["after_page_heading"]))
    return items


# ── Page builders ─────────────────────────────────────────────────────────────

def _build_you_will_need(recipe, st, styles):
    sp = st["spacing"]
    story = _page_header("You Will Need", recipe, st, styles)

    story += [Paragraph("Ingredients", styles["section_heading"]),
              _rule(st, 0.4), Spacer(1, sp["after_phase"])]
    for i, item in enumerate(recipe.ingredients):
        story += [_row(item, i, st, styles), Spacer(1, sp["between_ingredients"])]

    if recipe.equipment:
        story += [Spacer(1, sp["after_vessel"]),
                  Paragraph("Equipment", styles["section_heading"]),
                  _rule(st, 0.4), Spacer(1, sp["after_phase"])]
        for i, item in enumerate(recipe.equipment):
            story += [_row(item, i, st, styles), Spacer(1, sp["between_ingredients"])]

    return story

def _build_mise_en_place(recipe, st, styles):
    sp = st["spacing"]
    bullet = st["decorations"]["step_bullet"]
    story = _page_header("Prep", recipe, st, styles)

    for entry in recipe.prep:
        if isinstance(entry, PrepStep):
            story += [
                Paragraph(f"{bullet}  {entry.text}", styles["step"]),
                Spacer(1, sp["between_steps"]),
            ]
        elif isinstance(entry, VesselGroup):
            if entry.name:
                story += [Spacer(1, 4), Paragraph(f"In a {entry.name}", styles["vessel_label"])]
            for vstep in entry.steps:
                story += [
                    Paragraph(f"{bullet}  {vstep}", styles["step"]),
                    Spacer(1, sp["between_steps"]),
                ]
            story.append(Spacer(1, sp["after_vessel"] - sp["between_steps"]))

    return story

def _build_cook(recipe, st, styles):
    sp = st["spacing"]
    story = _page_header("Cook", recipe, st, styles)

    step_num = 1
    for phase in recipe.cook:
        story += [Paragraph(phase.name, styles["phase_heading"]), Spacer(1, sp["after_phase"])]
        for step in phase.steps:
            if isinstance(step, str):
                story += [
                    Paragraph(f"<b>{step_num}.</b>  {step}", styles["step"]),
                    Spacer(1, sp["between_steps"]),
                ]
                step_num += 1
            elif isinstance(step, VesselGroup):
                if step.name:
                    story += [Spacer(1, 4), Paragraph(f"In a {step.name}", styles["vessel_label"])]
                for vstep in step.steps:
                    story += [
                        Paragraph(f"<b>{step_num}.</b>  {vstep}", styles["step"]),
                        Spacer(1, sp["between_steps"]),
                    ]
                    step_num += 1
                story.append(Spacer(1, sp["after_vessel"] - sp["between_steps"]))
        story.append(Spacer(1, sp["after_vessel"]))

    return story


# ── Public API ────────────────────────────────────────────────────────────────

def render(recipe, output_path, st):
    """Render a RecipeData object to a PDF at output_path using style config st."""
    styles = _build_styles(st)

    page_size = A4 if st["page"]["size"].lower() == "a4" else letter
    margins = [st["page"][f"margin_{s}"] * inch for s in ("top", "bottom", "left", "right")]

    doc = SimpleDocTemplate(
        output_path,
        pagesize=page_size,
        topMargin=margins[0], bottomMargin=margins[1],
        leftMargin=margins[2], rightMargin=margins[3],
        title=recipe.title,
    )

    story = _build_you_will_need(recipe, st, styles)
    story.append(PageBreak())

    if recipe.prep:
        story += _build_mise_en_place(recipe, st, styles)
        story.append(PageBreak())

    story += _build_cook(recipe, st, styles)

    doc.build(story)
