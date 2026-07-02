"""
parser.py — Load and validate a recipe YAML file.

Returns a RecipeData object with clean, typed fields. Raises RecipeError
with a helpful message for any structural or missing-field problems.
"""

import yaml
from dataclasses import dataclass
from typing import Optional


SUPPORTED_VERSIONS = {1}


class RecipeError(Exception):
    """Raised when a recipe file has structural or validation problems."""
    pass


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class PrepStep:
    """A single top-level action in the prep sequence."""
    text: str

@dataclass
class VesselGroup:
    """A named or unnamed container with ordered action steps."""
    name: Optional[str]   # None = unnamed vessel
    steps: list

@dataclass
class CookPhase:
    name: str
    steps: list

@dataclass
class RecipeData:
    schema_version: int
    title: str
    subtitle: Optional[str]
    ingredients: list
    equipment: list
    prep: list
    cook: list


# ── Validation helpers ────────────────────────────────────────────────────────

def _require(d, key, context):
    if key not in d or d[key] is None:
        raise RecipeError(f"Missing required field '{key}' in {context}.")
    return d[key]

def _require_list(d, key, context):
    val = _require(d, key, context)
    if not isinstance(val, list) or len(val) == 0:
        raise RecipeError(f"'{key}' in {context} must be a non-empty list.")
    return val

def _check_no_unknown_keys(d, allowed, context):
    unknown = set(d.keys()) - allowed
    if unknown:
        raise RecipeError(
            f"Unrecognized field(s) {sorted(unknown)} in {context}. "
            f"Allowed: {sorted(allowed)}"
        )


# ── Section parsers ───────────────────────────────────────────────────────────

def _parse_version(raw):
    version = raw.get("schema_version", 1)
    if not isinstance(version, int):
        raise RecipeError("'schema_version' must be an integer.")
    if version not in SUPPORTED_VERSIONS:
        raise RecipeError(
            f"Unsupported schema_version {version}. "
            f"Supported: {sorted(SUPPORTED_VERSIONS)}"
        )
    return version

def _parse_prep(raw_prep):
    if not isinstance(raw_prep, list):
        raise RecipeError("'prep' must be a list.")
    result = []
    for i, entry in enumerate(raw_prep):
        ctx = f"prep entry {i + 1}"
        if not isinstance(entry, dict):
            raise RecipeError(f"{ctx} must be a mapping (got {type(entry).__name__}).")
        if "step" in entry and "vessel" in entry:
            raise RecipeError(f"{ctx} cannot have both 'step' and 'vessel'.")

        if "step" in entry:
            _check_no_unknown_keys(entry, {"step"}, ctx)
            text = entry["step"]
            if not isinstance(text, str) or not text.strip():
                raise RecipeError(f"{ctx}: 'step' must be a non-empty string.")
            result.append(PrepStep(text=text.strip()))

        elif "vessel" in entry:
            _check_no_unknown_keys(entry, {"vessel", "steps"}, ctx)
            vessel_name = entry["vessel"]
            if vessel_name is not None and not isinstance(vessel_name, str):
                raise RecipeError(f"{ctx}: 'vessel' must be a string or ~ (unnamed).")
            steps = _require_list(entry, "steps", ctx)
            parsed_steps = []
            for j, s in enumerate(steps):
                if not isinstance(s, str) or not s.strip():
                    raise RecipeError(f"{ctx}, step {j + 1}: must be a non-empty string.")
                parsed_steps.append(s.strip())
            result.append(VesselGroup(
                name=vessel_name.strip() if isinstance(vessel_name, str) else None,
                steps=parsed_steps,
            ))
        else:
            raise RecipeError(
                f"{ctx} must have either a 'step' key or a 'vessel' key. "
                f"Found keys: {sorted(entry.keys())}"
            )
    return result

def _parse_cook(raw_cook):
    if not isinstance(raw_cook, list) or len(raw_cook) == 0:
        raise RecipeError("'cook' must be a non-empty list.")
    result = []
    for i, entry in enumerate(raw_cook):
        ctx = f"cook phase {i + 1}"
        if not isinstance(entry, dict):
            raise RecipeError(f"{ctx} must be a mapping.")
        _check_no_unknown_keys(entry, {"phase", "steps"}, ctx)
        name = _require(entry, "phase", ctx)
        if not isinstance(name, str) or not name.strip():
            raise RecipeError(f"{ctx}: 'phase' must be a non-empty string.")
        steps = _require_list(entry, "steps", ctx)
        parsed_steps = []
        for j, s in enumerate(steps):
            step_ctx = f"{ctx}, step {j + 1}"
            if isinstance(s, str):
                if not s.strip():
                    raise RecipeError(f"{step_ctx}: must be a non-empty string.")
                parsed_steps.append(s.strip())
                continue

            if isinstance(s, dict):
                _check_no_unknown_keys(s, {"vessel", "steps"}, step_ctx)
                if "vessel" not in s:
                    raise RecipeError(
                        f"{step_ctx}: mapping step must define 'vessel'."
                    )
                vessel_name = s["vessel"]
                if vessel_name is not None and not isinstance(vessel_name, str):
                    raise RecipeError(
                        f"{step_ctx}: 'vessel' must be a string or ~ (unnamed)."
                    )
                vessel_steps = _require_list(s, "steps", step_ctx)
                parsed_vessel_steps = []
                for k, vs in enumerate(vessel_steps):
                    if not isinstance(vs, str) or not vs.strip():
                        raise RecipeError(
                            f"{step_ctx}, vessel step {k + 1}: must be a non-empty string."
                        )
                    parsed_vessel_steps.append(vs.strip())
                parsed_steps.append(VesselGroup(
                    name=vessel_name.strip() if isinstance(vessel_name, str) else None,
                    steps=parsed_vessel_steps,
                ))
                continue

            raise RecipeError(
                f"{step_ctx}: must be a non-empty string or a vessel mapping."
            )
        result.append(CookPhase(name=name.strip(), steps=parsed_steps))
    return result


# ── Public API ────────────────────────────────────────────────────────────────

def parse(path):
    """Load and validate a recipe YAML file. Returns RecipeData or raises RecipeError."""
    try:
        with open(path, "r") as f:
            raw = yaml.safe_load(f)
    except FileNotFoundError:
        raise RecipeError(f"Recipe file not found: {path}")
    except yaml.YAMLError as e:
        raise RecipeError(f"Could not parse YAML in {path}:\n  {e}")

    if not isinstance(raw, dict):
        raise RecipeError(f"{path} must be a YAML mapping at the top level.")

    _check_no_unknown_keys(
        raw,
        {"schema_version", "title", "subtitle", "ingredients", "equipment", "prep", "cook"},
        "recipe root"
    )

    version     = _parse_version(raw)
    title       = _require(raw, "title", "recipe root")
    subtitle    = raw.get("subtitle")
    ingredients = _require_list(raw, "ingredients", "recipe root")
    equipment   = raw.get("equipment") or []
    raw_prep    = raw.get("prep", [])
    prep        = _parse_prep(raw_prep if raw_prep is not None else [])
    cook        = _parse_cook(_require_list(raw, "cook", "recipe root"))

    if not isinstance(title, str) or not title.strip():
        raise RecipeError("'title' must be a non-empty string.")
    if subtitle is not None and not isinstance(subtitle, str):
        raise RecipeError("'subtitle' must be a string.")
    for i, ing in enumerate(ingredients):
        if not isinstance(ing, str) or not ing.strip():
            raise RecipeError(f"ingredients entry {i + 1} must be a non-empty string.")
    for i, eq in enumerate(equipment):
        if not isinstance(eq, str) or not eq.strip():
            raise RecipeError(f"equipment entry {i + 1} must be a non-empty string.")

    return RecipeData(
        schema_version=version,
        title=title.strip(),
        subtitle=subtitle.strip() if subtitle else None,
        ingredients=[s.strip() for s in ingredients],
        equipment=[s.strip() for s in equipment],
        prep=prep,
        cook=cook,
    )
