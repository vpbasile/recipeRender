#!/usr/bin/env python3
"""
recipe_json.py — Export a validated recipe YAML file as JSON.
"""

import json
import sys
from dataclasses import asdict

from parser import RecipeError, parse


def main():
    if len(sys.argv) != 2:
        print("Usage: python recipe_json.py <recipe.yaml>", file=sys.stderr)
        sys.exit(1)

    recipe_path = sys.argv[1]
    try:
        recipe = parse(recipe_path)
    except RecipeError as e:
        print(f"Recipe error: {e}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(asdict(recipe)))


if __name__ == "__main__":
    main()
