#!/usr/bin/env python3
"""
render.py — Entry point for recipe PDF generation.

Usage:
    python render.py

Select a recipe from the menu when prompted.
Output is written to output/<recipe>.pdf.
Style is loaded from style.yaml in the same directory as render.py.
"""

import sys
import os
import yaml

from parser import parse, RecipeError
from renderer import render


def choose_recipe_paths(base_dir):
    recipes_dir = os.path.join(base_dir, "recipes")
    if not os.path.isdir(recipes_dir):
        raise FileNotFoundError(f"Recipes directory not found: {recipes_dir}")

    recipe_files = sorted([
        os.path.join(recipes_dir, name)
        for name in os.listdir(recipes_dir)
        if name.lower().endswith((".yaml", ".yml"))
    ])

    if not recipe_files:
        raise FileNotFoundError(f"No recipe files found in: {recipes_dir}")

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


def main():
    if len(sys.argv) > 1:
        print("Error: command-line recipe arguments are no longer supported.")
        print("Run python render.py and choose from the menu.")
        sys.exit(1)

    base_dir = os.path.dirname(os.path.abspath(__file__))

    try:
        recipe_paths = choose_recipe_paths(base_dir)
    except (FileNotFoundError, OSError) as e:
        print(f"Error: {e}")
        sys.exit(1)

    output_dir = os.path.join(base_dir, "output")
    os.makedirs(output_dir, exist_ok=True)
    style_path = os.path.join(base_dir, "style.yaml")

    try:
        with open(style_path, "r") as f:
            st = yaml.safe_load(f)
    except FileNotFoundError:
        print(f"Error: Style file not found: {style_path}")
        sys.exit(1)
    except yaml.YAMLError as e:
        print(f"Error: Could not parse style file:\n  {e}")
        sys.exit(1)

    for recipe_path in recipe_paths:
        stem = os.path.splitext(os.path.basename(recipe_path))[0]
        output_path = os.path.join(output_dir, f"{stem}.pdf")

        try:
            recipe = parse(recipe_path)
        except RecipeError as e:
            print(f"Recipe error: {e}")
            sys.exit(1)

        render(recipe, output_path, st)
        print(f"PDF written to: {output_path}")


if __name__ == "__main__":
    main()
