#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy==2.5.4"]
# ///
"""Generate independent NumPy reference logits for the local bidding model."""

import argparse
import json
from pathlib import Path
from typing import TypedDict

import numpy as np
from numpy.typing import NDArray


class Position(TypedDict):
    """A bidder's private hand and public auction context."""

    seat: str
    dealer: str
    vulnerability: str
    hand: list[str]
    calls: list[str]
    legal: list[str]


def observation(position: Position) -> NDArray[np.float32]:
    """Encode the published PGX information-state layout independently of TypeScript."""
    seats = "NESW"
    seat = seats.index(position["seat"])
    dealer = seats.index(position["dealer"])
    vulnerability = position["vulnerability"]
    own_vul = vulnerability == "both" or vulnerability == ("NS" if seat % 2 == 0 else "EW")
    other_vul = vulnerability == "both" or vulnerability == ("EW" if seat % 2 == 0 else "NS")
    encoded = np.zeros(480, dtype=np.float32)
    encoded[int(own_vul)] = 1
    encoded[2 + int(other_vul)] = 1
    calls = ["P", "X", "XX"] + [
        f"{level}{strain}"
        for level in range(1, 8)
        for strain in ("C", "D", "H", "S", "NT")
    ]
    last = None
    for turn, call in enumerate(position["calls"]):
        relative = (dealer + turn - seat) % 4
        if call == "P":
            if last is None:
                encoded[4 + relative] = 1
        elif call in ("X", "XX"):
            if last is None:
                raise ValueError("double without a contract")
            encoded[8 + last * 12 + (4 if call == "X" else 8) + relative] = 1
        else:
            last = calls.index(call) - 3
            encoded[8 + last * 12 + relative] = 1
    for card in position["hand"]:
        encoded[428 + "23456789TJQKA".index(card[1]) * 4 + "CDHS".index(card[0])] = 1
    return encoded


def logits(
    weights: NDArray[np.float32], features: NDArray[np.float32]
) -> list[float]:
    """Use BLAS matrix products instead of the runtime's scalar accumulation loops."""
    offset = 0
    current = features
    for width in (1024, 1024, 1024, 1024, 38):
        count = current.size * width
        matrix = weights[offset:offset + count].reshape(current.size, width)
        bias = weights[offset + count:offset + count + width]
        current = (
            current.astype(np.float64) @ matrix.astype(np.float64) + bias
        ).astype(np.float32)
        if width != 38:
            current = np.maximum(current, 0)
        offset += count + width
    return current.tolist()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-i", "--inputs", type=Path, required=True)
    parser.add_argument("-m", "--models", type=Path, required=True)
    parser.add_argument("-o", "--output", type=Path, required=True)
    args = parser.parse_args()
    positions: list[Position] = json.loads(args.inputs.read_text())
    weights = {
        name: np.fromfile(args.models / f"brl-{name}.f32", dtype="<f4")
        for name in ("sl", "rl-fsp")
    }
    for model in weights.values():
        if model.size != 3_681_319 or not np.isfinite(model).all():
            raise ValueError("invalid model data")
    fixtures = []
    for position in positions:
        encoded = observation(position)
        fixtures.append({
            "position": position,
            "features": np.flatnonzero(encoded).tolist(),
            "logits": {
                name: logits(model, encoded) for name, model in weights.items()
            },
        })
    args.output.write_text(json.dumps({
        "reference": (
            "NumPy 2.5.4 float64 dot products, float32 layer outputs; PGX 1.4 layout"
        ),
        "fixtures": fixtures,
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
