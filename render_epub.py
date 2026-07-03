#!/usr/bin/env python3
"""
render_epub.py - Entry point for recipe EPUB generation.

Usage:
    python render_epub.py

Select a recipe from the menu when prompted.
Output is written to output/<recipe>.epub.
"""

import os
import sys
import uuid
from html import escape
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

from parser import PrepStep, RecipeError, VesselGroup, parse


EPUB_STYLE = """body {
  font-family: Georgia, serif;
  line-height: 1.5;
  margin: 0 auto;
  max-width: 44rem;
  padding: 1.5rem 1rem 3rem;
}
h1, h2, h3 {
  font-family: Arial, sans-serif;
  line-height: 1.2;
}
h1 {
  font-size: 1.9rem;
  margin-bottom: 0.25rem;
}
h2 {
  border-bottom: 1px solid #d4d4d4;
  font-size: 1.2rem;
  margin-top: 2rem;
  padding-bottom: 0.25rem;
}
h3 {
  font-size: 1rem;
  margin-bottom: 0.35rem;
  margin-top: 1.3rem;
}
p.subtitle {
  color: #555;
  margin-top: 0;
}
ul, ol {
  padding-left: 1.3rem;
}
li {
  margin: 0.3rem 0;
}
div.vessel {
  margin: 0.9rem 0 1.1rem;
}
p.vessel-name {
  font-weight: bold;
  margin-bottom: 0.3rem;
}
"""


def choose_recipe_paths(base_dir, choose_all=False):
    recipes_dir = os.path.join(base_dir, "recipes")
    if not os.path.isdir(recipes_dir):
        raise FileNotFoundError(f"Recipes directory not found: {recipes_dir}")

    recipe_files = sorted([
        os.path.join(recipes_dir, name)
        for name in os.listdir(recipes_dir)
        if name.lower().endswith((".yaml", ".yml"))
    ])
    bundle_recipe_files = [
      path for path in recipe_files
      if os.path.basename(path).lower() != "test.yaml"
    ]

    if not recipe_files:
        raise FileNotFoundError(f"No recipe files found in: {recipes_dir}")

    if choose_all:
      return bundle_recipe_files

    print("Choose a recipe:")
    print("  0) All recipes")
    for i, path in enumerate(recipe_files, start=1):
      print(f"  {i}) {os.path.basename(path)}")

    while True:
        choice = input(f"Enter number (0-{len(recipe_files)}): ").strip()
        if choice.isdigit():
            idx = int(choice)
            if idx == 0:
                return recipe_files
            if 1 <= idx <= len(recipe_files):
                return [recipe_files[idx - 1]]
        print("Invalid selection. Try again.")


def vessel_label(name):
    if name:
        return name
    return "Vessel"


def render_prep(prep_steps):
    if not prep_steps:
        return ""

    parts = ["<section><h2>Prep</h2>"]
    for entry in prep_steps:
        if isinstance(entry, PrepStep):
            parts.append(f"<p>{escape(entry.text)}</p>")
            continue

        parts.append('<div class="vessel">')
        parts.append(f'<p class="vessel-name">{escape(vessel_label(entry.name))}</p>')
        parts.append("<ol>")
        for step in entry.steps:
            parts.append(f"<li>{escape(step)}</li>")
        parts.append("</ol></div>")
    parts.append("</section>")
    return "".join(parts)


def render_cook(cook_phases):
    parts = ["<section><h2>Cook</h2>"]
    for phase in cook_phases:
        parts.append(f"<h3>{escape(phase.name)}</h3>")
        parts.append("<ol>")
        for step in phase.steps:
            if isinstance(step, VesselGroup):
                nested_steps = "".join(f"<li>{escape(item)}</li>" for item in step.steps)
                parts.append(
                    "<li>"
                    f"<strong>{escape(vessel_label(step.name))}</strong>"
                    f"<ol>{nested_steps}</ol>"
                    "</li>"
                )
            else:
                parts.append(f"<li>{escape(step)}</li>")
        parts.append("</ol>")
    parts.append("</section>")
    return "".join(parts)


def build_recipe_xhtml(recipe):
    subtitle = ""
    if recipe.subtitle:
        subtitle = f'<p class="subtitle">{escape(recipe.subtitle)}</p>'

    equipment = ""
    if recipe.equipment:
        equipment_items = "".join(f"<li>{escape(item)}</li>" for item in recipe.equipment)
        equipment = f"<section><h2>Equipment</h2><ul>{equipment_items}</ul></section>"

    ingredients = "".join(f"<li>{escape(item)}</li>" for item in recipe.ingredients)

    return f"""<?xml version=\"1.0\" encoding=\"utf-8\"?>
<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" lang=\"en\">
  <head>
    <title>{escape(recipe.title)}</title>
    <link rel=\"stylesheet\" type=\"text/css\" href=\"styles.css\"/>
  </head>
  <body>
    <article>
      <h1>{escape(recipe.title)}</h1>
      {subtitle}
      <section>
        <h2>Ingredients</h2>
        <ul>{ingredients}</ul>
      </section>
      {equipment}
      {render_prep(recipe.prep)}
      {render_cook(recipe.cook)}
    </article>
  </body>
</html>
"""


def build_nav_xhtml(recipes):
    items = "".join(
        f'<li><a href="{escape(filename)}">{escape(recipe.title)}</a></li>'
        for filename, recipe in recipes
    )
    return f"""<?xml version=\"1.0\" encoding=\"utf-8\"?>
<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" lang=\"en\">
  <head>
    <title>Table of Contents</title>
  </head>
  <body>
    <nav epub:type=\"toc\" id=\"toc\">
      <h1>Contents</h1>
      <ol>{items}</ol>
    </nav>
  </body>
</html>
"""


def build_content_opf(book_title, recipes, book_id):
    manifest_items = [
        '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '    <item id="styles" href="styles.css" media-type="text/css"/>',
    ]
    spine_items = ['    <itemref idref="nav"/>']

    for index, (filename, _recipe) in enumerate(recipes, start=1):
        manifest_items.append(
            f'    <item id="recipe-{index}" href="{escape(filename)}" media-type="application/xhtml+xml"/>'
        )
        spine_items.append(f'    <itemref idref="recipe-{index}"/>')

    manifest = "\n".join(manifest_items)
    spine = "\n".join(spine_items)

    return f"""<?xml version=\"1.0\" encoding=\"utf-8\"?>
<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"bookid\">
  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">
    <dc:identifier id=\"bookid\">urn:uuid:{book_id}</dc:identifier>
    <dc:title>{escape(book_title)}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
{manifest}
  </manifest>
  <spine>
{spine}
  </spine>
</package>
"""


def write_epub(recipe, output_path):
    book_id = uuid.uuid4()
    recipe_filename = "recipe.xhtml"
    recipe_xhtml = build_recipe_xhtml(recipe)
    nav_xhtml = build_nav_xhtml([(recipe_filename, recipe)])
    content_opf = build_content_opf(recipe.title, [(recipe_filename, recipe)], book_id)
    container_xml = """<?xml version=\"1.0\" encoding=\"utf-8\"?>
<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">
  <rootfiles>
    <rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>
  </rootfiles>
</container>
"""

    with ZipFile(output_path, "w") as epub:
        epub.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        epub.writestr("META-INF/container.xml", container_xml, compress_type=ZIP_DEFLATED)
        epub.writestr("OEBPS/content.opf", content_opf, compress_type=ZIP_DEFLATED)
        epub.writestr("OEBPS/nav.xhtml", nav_xhtml, compress_type=ZIP_DEFLATED)
        epub.writestr(f"OEBPS/{recipe_filename}", recipe_xhtml, compress_type=ZIP_DEFLATED)
        epub.writestr("OEBPS/styles.css", EPUB_STYLE, compress_type=ZIP_DEFLATED)


def write_indexed_epub(recipes, output_path):
    book_id = uuid.uuid4()
    bundled_recipes = []
    for recipe_path, recipe in recipes:
        stem = os.path.splitext(os.path.basename(recipe_path))[0]
        bundled_recipes.append((f"recipe-{stem}.xhtml", recipe))

    nav_xhtml = build_nav_xhtml(bundled_recipes)
    content_opf = build_content_opf("Recipe Collection", bundled_recipes, book_id)
    container_xml = """<?xml version=\"1.0\" encoding=\"utf-8\"?>
<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">
  <rootfiles>
    <rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>
  </rootfiles>
</container>
"""

    with ZipFile(output_path, "w") as epub:
        epub.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        epub.writestr("META-INF/container.xml", container_xml, compress_type=ZIP_DEFLATED)
        epub.writestr("OEBPS/content.opf", content_opf, compress_type=ZIP_DEFLATED)
        epub.writestr("OEBPS/nav.xhtml", nav_xhtml, compress_type=ZIP_DEFLATED)
        epub.writestr("OEBPS/styles.css", EPUB_STYLE, compress_type=ZIP_DEFLATED)
        for filename, recipe in bundled_recipes:
            epub.writestr(f"OEBPS/{filename}", build_recipe_xhtml(recipe), compress_type=ZIP_DEFLATED)


def main():
    choose_all = False
    if len(sys.argv) == 2 and sys.argv[1] == "--all":
        choose_all = True
    elif len(sys.argv) > 1:
        print("Error: command-line recipe arguments are no longer supported.")
        print("Run python render_epub.py and choose from the menu, or use --all.")
        sys.exit(1)

    base_dir = os.path.dirname(os.path.abspath(__file__))

    try:
        recipe_paths = choose_recipe_paths(base_dir, choose_all=choose_all)
    except (FileNotFoundError, OSError) as error:
        print(f"Error: {error}")
        sys.exit(1)

    output_dir = os.path.join(base_dir, "output")
    os.makedirs(output_dir, exist_ok=True)

    parsed_recipes = []
    for recipe_path in recipe_paths:
      try:
        parsed_recipes.append((recipe_path, parse(recipe_path)))
      except RecipeError as error:
        print(f"Recipe error: {error}")
        sys.exit(1)

    if choose_all:
      output_path = os.path.join(output_dir, "recipes.epub")
      write_indexed_epub(parsed_recipes, output_path)
      print(f"EPUB written to: {output_path}")
      return

    for recipe_path, recipe in parsed_recipes:
        stem = os.path.splitext(os.path.basename(recipe_path))[0]
        output_path = os.path.join(output_dir, f"{stem}.epub")

        write_epub(recipe, output_path)
        print(f"EPUB written to: {output_path}")


if __name__ == "__main__":
    main()