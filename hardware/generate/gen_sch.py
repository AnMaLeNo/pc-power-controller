#!/usr/bin/env python3
"""Génère hardware/pc-power-controller.kicad_sch (format KiCad 9).

Circuit : D1 (GPIO5) -> R1 330R -> LED du PC817 ; sortie du PC817 -> 2 pastilles
à souder (PWR_SW) vers le header power de la carte mère.
Toutes les coordonnées sont en mm, alignées sur la grille 1,27 mm ; la
connectivité KiCad repose sur la coïncidence exacte des extrémités.
"""
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent          # hardware/generate
HW = HERE.parent                                # hardware/
OUT = HW / "pc-power-controller.kicad_sch"
PROJECT = "pc-power-controller"


def uid(key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "pc-power-sch/" + key))


ROOT = uid("root")


def sym_lib_bare(name: str) -> str:
    return (HERE / "symbols" / f"{name}.sym").read_text().rstrip()


def sym_lib(name: str) -> str:
    # dans le schéma, les symboles embarqués portent le préfixe de la lib projet
    return sym_lib_bare(name).replace('(symbol "', '(symbol "pc_power:', 1)


def wire(x1, y1, x2, y2, key):
    return f"""\t(wire
\t\t(pts
\t\t\t(xy {x1} {y1}) (xy {x2} {y2})
\t\t)
\t\t(stroke
\t\t\t(width 0)
\t\t\t(type default)
\t\t)
\t\t(uuid "{uid('wire/' + key)}")
\t)"""


def junction(x, y, key):
    return f"""\t(junction
\t\t(at {x} {y})
\t\t(diameter 0)
\t\t(color 0 0 0 0)
\t\t(uuid "{uid('junction/' + key)}")
\t)"""


def no_connect(x, y, key):
    return f"""\t(no_connect
\t\t(at {x} {y})
\t\t(uuid "{uid('nc/' + key)}")
\t)"""


def label(txt, x, y, key):
    return f"""\t(label "{txt}"
\t\t(at {x} {y} 0)
\t\t(effects
\t\t\t(font
\t\t\t\t(size 1.27 1.27)
\t\t\t)
\t\t\t(justify left bottom)
\t\t)
\t\t(uuid "{uid('label/' + key)}")
\t)"""


def text(txt, x, y, key):
    return f"""\t(text "{txt}"
\t\t(exclude_from_sim no)
\t\t(at {x} {y} 0)
\t\t(effects
\t\t\t(font
\t\t\t\t(size 1.27 1.27)
\t\t\t)
\t\t\t(justify left bottom)
\t\t)
\t\t(uuid "{uid('text/' + key)}")
\t)"""


def prop(name, value, x, y, rot=0, hide=False):
    h = "\n\t\t\t\t(hide yes)" if hide else ""
    return f"""\t\t(property "{name}" "{value}"
\t\t\t(at {x} {y} {rot})
\t\t\t(effects
\t\t\t\t(font
\t\t\t\t\t(size 1.27 1.27)
\t\t\t\t){h}
\t\t\t)
\t\t)"""


def symbol(lib_id, ref, x, y, rot, props, pins, key, in_bom=True):
    pin_stubs = "\n".join(
        f'\t\t(pin "{n}"\n\t\t\t(uuid "{uid(key + "/pin" + n)}")\n\t\t)' for n in pins
    )
    if pin_stubs:
        pin_stubs += "\n"
    return f"""\t(symbol
\t\t(lib_id "{lib_id}")
\t\t(at {x} {y} {rot})
\t\t(unit 1)
\t\t(exclude_from_sim no)
\t\t(in_bom {"yes" if in_bom else "no"})
\t\t(on_board yes)
\t\t(dnp no)
\t\t(uuid "{uid(key)}")
{props}
{pin_stubs}\t\t(instances
\t\t\t(project "{PROJECT}"
\t\t\t\t(path "/{ROOT}"
\t\t\t\t\t(reference "{ref}")
\t\t\t\t\t(unit 1)
\t\t\t\t)
\t\t\t)
\t\t)
\t)"""


body = []

# ---------------------------------------------------------------- U1 D1 mini
# Ancré en (60.96, 88.90) rot 0. Pin D1/GPIO5 = n°14 -> (71.12, 81.28),
# GND = n°10 -> (60.96, 109.22).
body.append(symbol(
    "pc_power:WEMOS_D1_mini", "U1", 60.96, 88.90, 0,
    "\n".join([
        prop("Reference", "U1", 60.96, 64.77),
        prop("Value", "WEMOS_D1_mini", 60.96, 67.31),
        prop("Footprint", "pc_power:WEMOS_D1_mini_light", 60.96, 88.90, hide=True),
        prop("Datasheet", "https://wiki.wemos.cc/products:d1:d1_mini", 60.96, 88.90, hide=True),
    ]),
    [str(n) for n in range(1, 17)],
    "sym/U1",
))

# Broches inutilisées du module -> croix "no connect"
for px, py, k in [
    (50.80, 78.74, "u1-1-rst"), (71.12, 76.20, "u1-2-a0"), (71.12, 78.74, "u1-3-d0"),
    (71.12, 91.44, "u1-4-d5"), (71.12, 93.98, "u1-5-d6"), (71.12, 96.52, "u1-6-d7"),
    (71.12, 99.06, "u1-7-d8"), (63.50, 68.58, "u1-8-3v3"),
    (71.12, 88.90, "u1-11-d4"), (71.12, 86.36, "u1-12-d3"), (71.12, 83.82, "u1-13-d2"),
    (50.80, 86.36, "u1-15-rx"), (50.80, 88.90, "u1-16-tx"),
]:
    body.append(no_connect(px, py, k))

# ------------------------------------------------------------------- R1 330R
# Rot 90 -> horizontale : pin 1 en (76.20, 81.28), pin 2 en (83.82, 81.28)
body.append(symbol(
    "pc_power:R", "R1", 80.01, 81.28, 90,
    "\n".join([
        prop("Reference", "R1", 80.01, 77.47),
        prop("Value", "330R", 80.01, 84.455),
        prop("Footprint", "pc_power:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal", 80.01, 81.28, 90, hide=True),
        prop("Datasheet", "~", 80.01, 81.28, hide=True),
    ]),
    ["1", "2"],
    "sym/R1",
))

# -------------------------------------------------------------------- U2 PC817
# Pins : 1 anode (87.63, 81.28), 2 cathode (87.63, 86.36),
#        3 émetteur (102.87, 86.36), 4 collecteur (102.87, 81.28)
body.append(symbol(
    "pc_power:PC817", "U2", 95.25, 83.82, 0,
    "\n".join([
        prop("Reference", "U2", 95.25, 76.20),
        prop("Value", "PC817", 95.25, 78.74),
        prop("Footprint", "pc_power:DIP-4_W7.62mm", 95.25, 83.82, hide=True),
        prop("Datasheet", "http://www.soselectronic.cz/a_info/resource/d/pc817.pdf", 95.25, 83.82, hide=True),
    ]),
    ["1", "2", "3", "4"],
    "sym/U2",
))

# ------------------------------------------------- J1 pastilles à souder PWR_SW
# Pins : 1 en (109.22, 81.28), 2 en (109.22, 83.82)
body.append(symbol(
    "pc_power:Conn_01x02", "J1", 114.30, 81.28, 0,
    "\n".join([
        prop("Reference", "J1", 114.30, 78.74),
        prop("Value", "PWR_SW", 114.30, 87.63),
        prop("Footprint", "pc_power:SolderWirePad_1x02_P5.08mm", 114.30, 81.28, hide=True),
        prop("Datasheet", "~", 114.30, 81.28, hide=True),
    ]),
    ["1", "2"],
    "sym/J1",
))

# --------------------------------------------- J2 pastilles alimentation 5V/GND
# Rot 180 -> broches à droite : 1 (5V) en (48.26, 66.04), 2 (GND) en (48.26, 63.5)
body.append(symbol(
    "pc_power:Conn_01x02", "J2", 43.18, 66.04, 180,
    "\n".join([
        prop("Reference", "J2", 43.18, 62.23),
        prop("Value", "5V_IN", 43.18, 69.85),
        prop("Footprint", "pc_power:SolderWirePad_1x02_P5.08mm", 43.18, 66.04, hide=True),
        prop("Datasheet", "~", 43.18, 66.04, hide=True),
    ]),
    ["1", "2"],
    "sym/J2",
))

# ------------------------------------------------------------ GND et PWR_FLAG
body.append(symbol(
    "pc_power:GND", "#PWR01", 74.93, 109.22, 0,
    "\n".join([
        prop("Reference", "#PWR01", 74.93, 115.57, hide=True),
        prop("Value", "GND", 74.93, 113.03),
        prop("Footprint", "", 74.93, 109.22, hide=True),
        prop("Datasheet", "", 74.93, 109.22, hide=True),
    ]),
    ["1"],
    "sym/PWR01",
))
body.append(symbol(
    "pc_power:PWR_FLAG", "#FLG02", 55.88, 66.04, 0,
    "\n".join([
        prop("Reference", "#FLG02", 55.88, 62.23, hide=True),
        prop("Value", "PWR_FLAG", 55.88, 60.96),
        prop("Footprint", "", 55.88, 66.04, hide=True),
        prop("Datasheet", "", 55.88, 66.04, hide=True),
    ]),
    ["1"],
    "sym/FLG02",
))
body.append(symbol(
    "pc_power:PWR_FLAG", "#FLG01", 81.28, 109.22, 0,
    "\n".join([
        prop("Reference", "#FLG01", 81.28, 105.41, hide=True),
        prop("Value", "PWR_FLAG", 81.28, 104.14),
        prop("Footprint", "", 81.28, 109.22, hide=True),
        prop("Datasheet", "", 81.28, 109.22, hide=True),
    ]),
    ["1"],
    "sym/FLG01",
))

# ------------------------------------------------------------ trous de fixation
for i, hx in enumerate([60.96, 76.20], start=1):
    body.append(symbol(
        "pc_power:MountingHole", f"H{i}", hx, 127.00, 0,
        "\n".join([
            prop("Reference", f"H{i}", hx, 130.81),
            prop("Value", "M3", hx, 129.54, hide=True),
            prop("Footprint", "pc_power:MountingHole_3.2mm_M3", hx, 127.00, hide=True),
            prop("Datasheet", "~", hx, 127.00, hide=True),
        ]),
        [],
        f"sym/H{i}",
        in_bom=False,
    ))

# ------------------------------------------------------------------------ fils
body.append(wire(71.12, 81.28, 76.20, 81.28, "d1-r1"))
body.append(wire(83.82, 81.28, 87.63, 81.28, "r1-anode"))
body.append(wire(102.87, 81.28, 109.22, 81.28, "coll-j1"))
body.append(wire(102.87, 86.36, 106.68, 86.36, "emit-a"))
body.append(wire(106.68, 86.36, 106.68, 83.82, "emit-b"))
body.append(wire(106.68, 83.82, 109.22, 83.82, "emit-c"))
body.append(wire(87.63, 86.36, 87.63, 109.22, "gnd-a"))
body.append(wire(87.63, 109.22, 60.96, 109.22, "gnd-b"))
body.append(junction(74.93, 109.22, "gnd-sym"))
body.append(junction(81.28, 109.22, "pwr-flag"))
# alimentation par J2 : 5V vers pin 9 du module, GND vers le bus GND
body.append(wire(48.26, 66.04, 58.42, 66.04, "5v-a"))
body.append(wire(58.42, 66.04, 58.42, 68.58, "5v-b"))
body.append(wire(48.26, 63.50, 49.53, 63.50, "gnd-j2-a"))
body.append(wire(49.53, 63.50, 49.53, 109.22, "gnd-j2-b"))
body.append(wire(49.53, 109.22, 60.96, 109.22, "gnd-j2-c"))
body.append(junction(55.88, 66.04, "pwr-flag2"))
body.append(junction(60.96, 109.22, "gnd-u1"))

# ------------------------------------------------------------------- étiquettes
body.append(label("OPTO_IN", 72.39, 81.28, "opto-in"))
body.append(label("OPTO_LED", 84.455, 81.28, "opto-led"))
body.append(label("PWR_SW_P", 104.14, 81.28, "pwr-sw-p"))
body.append(label("PWR_SW_N", 103.505, 86.36, "pwr-sw-n"))
body.append(label("5V", 52.07, 66.04, "5v"))

# ------------------------------------------------------------------------ notes
body.append(text(
    "Impulsion power : D1 (GPIO5) -> R1 330R -> PC817 -> pastilles PWR_SW",
    50.80, 119.38, "note1"))
body.append(text(
    "+ (collecteur) vers la broche PWR_SW de la carte mere, - (emetteur) vers GND du header",
    50.80, 121.92, "note2"))
body.append(text(
    "Alim : USB du module OU pastilles J2 (5V/GND) - JAMAIS les deux a la fois. If(led) = 6,4 mA",
    50.80, 124.46, "note3"))

libs = "\n".join(
    "\t" + sym_lib(n).replace("\n", "\n")
    for n in ["WEMOS_D1_mini", "PC817", "R", "Conn_01x02", "GND", "PWR_FLAG", "MountingHole"]
)

sch = f"""(kicad_sch
\t(version 20250114)
\t(generator "eeschema")
\t(generator_version "9.0")
\t(uuid "{ROOT}")
\t(paper "A4")
\t(title_block
\t\t(title "PC Power Controller - carte optocoupleur")
\t\t(date "2026-07-13")
\t\t(rev "1.1")
\t\t(comment 1 "https://github.com/AnMaLeNo/pc-power-controller")
\t)
\t(lib_symbols
{libs}
\t)
{chr(10).join(body)}
\t(sheet_instances
\t\t(path "/"
\t\t\t(page "1")
\t\t)
\t)
\t(embedded_fonts no)
)
"""

OUT.write_text(sch)
print(f"OK -> {OUT} ({len(sch)} octets)")

# ------------- bibliothèque de symboles du projet (copies figées 9.0.9.1) ----
LIB_OUT = HW / "pc_power.kicad_sym"
header = (HERE / "symbols" / "_header.txt").read_text().rstrip()
blocks = "\n".join(
    "\t" + sym_lib_bare(n)
    for n in ["WEMOS_D1_mini", "PC817", "R", "Conn_01x02", "GND", "PWR_FLAG", "MountingHole"]
)
LIB_OUT.write_text(header + "\n" + blocks + "\n)\n")
print(f"OK -> {LIB_OUT}")
