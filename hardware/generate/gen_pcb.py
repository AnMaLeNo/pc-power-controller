#!/usr/bin/env python3
"""Génère hardware/pc-power-controller.kicad_pcb via l'API pcbnew.

À lancer avec le Python du flatpak KiCad :
  flatpak run --command=python3 org.kicad.KiCad generate/gen_pcb.py

Carte 62 x 46 mm, 2 couches, tout traversant, routée en face avant.
Le D1 Mini est vertical, USB affleurant le bord bas, antenne vers l'intérieur
avec une zone dégagée de tout cuivre (y compris en face arrière : aucun plan).
Les uuid des symboles du schéma sont recalculés ici (uuid5 déterministes) pour
lier chaque empreinte à son symbole (parité schéma/PCB).
"""
import uuid
from pathlib import Path

import pcbnew
from pcbnew import VECTOR2I, FromMM

HW = Path(__file__).resolve().parent.parent
LIB = str(HW / "pc_power.pretty")
OUT = str(HW / "pc-power-controller.kicad_pcb")


def mm(x):
    return FromMM(float(x))


def pt(x, y):
    return VECTOR2I(mm(x), mm(y))


def sym_uuid(key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "pc-power-sch/" + key))


board = pcbnew.CreateEmptyBoard()

tb = board.GetTitleBlock()
tb.SetTitle("PC Power Controller - carte optocoupleur")
tb.SetDate("2026-07-13")
tb.SetRevision("1.0")

# ---------------------------------------------------------------------- nets
# Les étiquettes locales du schéma donnent des nets préfixés par la hiérarchie
# ("/OPTO_IN"...) ; GND vient d'un symbole power, donc reste global. Chaque
# broche non connectée porte un net "unconnected-..." qui doit exister aussi.
UNCONNECTED_U1 = {
    "1": "unconnected-(U1-~{RST}-Pad1)",
    "2": "unconnected-(U1-A0-Pad2)",
    "3": "unconnected-(U1-D0-Pad3)",
    "4": "unconnected-(U1-SCK{slash}D5-Pad4)",
    "5": "unconnected-(U1-MISO{slash}D6-Pad5)",
    "6": "unconnected-(U1-MOSI{slash}D7-Pad6)",
    "7": "unconnected-(U1-CS{slash}D8-Pad7)",
    "8": "unconnected-(U1-3V3-Pad8)",
    "9": "unconnected-(U1-5V-Pad9)",
    "11": "unconnected-(U1-D4-Pad11)",
    "12": "unconnected-(U1-D3-Pad12)",
    "13": "unconnected-(U1-SDA{slash}D2-Pad13)",
    "15": "unconnected-(U1-RX-Pad15)",
    "16": "unconnected-(U1-TX-Pad16)",
}
nets = {}
for name in (["GND", "/OPTO_IN", "/OPTO_LED", "/PWR_SW_P", "/PWR_SW_N"]
             + list(UNCONNECTED_U1.values())):
    ni = pcbnew.NETINFO_ITEM(board, name)
    board.Add(ni)
    nets[name] = ni

# ---------------------------------------------------------------- empreintes
def place(fp_name, ref, value, x, y, sym_key, pad_nets, datasheet=None):
    fp = pcbnew.FootprintLoad(LIB, fp_name)
    assert fp, f"empreinte introuvable : {fp_name}"
    fp.SetFPID(pcbnew.LIB_ID("pc_power", fp_name))
    fp.SetReference(ref)
    fp.SetValue(value)
    if datasheet:
        fp.SetField("Datasheet", datasheet)
    fp.SetPosition(pt(x, y))
    if sym_key:
        fp.SetPath(pcbnew.KIID_PATH("/" + sym_uuid(sym_key)))
    for pad in fp.Pads():
        net = pad_nets.get(pad.GetNumber())
        if net:
            pad.SetNet(nets[net])
    board.Add(fp)
    return fp


# D1 Mini : ancre = pad 1 (colonne gauche, côté antenne).
# Pad 14 = D1/GPIO5 en (47.43, 45.09), pad 10 = GND en (47.43, 55.25).
u1 = place("WEMOS_D1_mini_light", "U1", "WEMOS_D1_mini", 24.57, 40.01,
           "sym/U1", {"14": "/OPTO_IN", "10": "GND", **UNCONNECTED_U1},
           datasheet="https://wiki.wemos.cc/products:d1:d1_mini")
u1.Reference().SetPosition(pt(36.0, 48.0))
u1.Value().SetPosition(pt(36.0, 51.0))

# R1 330R : pad 1 en (53.5, 45.09), pad 2 en (63.66, 45.09)
r1 = place("R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal", "R1", "330R",
           53.5, 45.09, "sym/R1", {"1": "/OPTO_IN", "2": "/OPTO_LED"})

# U2 PC817 : pads 1/2 colonne gauche (anode/cathode), 3/4 colonne droite
# (émetteur/collecteur). 1 = (68.5, 45.09), 2 = (68.5, 47.63),
# 3 = (76.12, 47.63), 4 = (76.12, 45.09)
u2 = place("DIP-4_W7.62mm", "U2", "PC817", 68.5, 45.09, "sym/U2",
           {"1": "/OPTO_LED", "2": "GND", "3": "/PWR_SW_N", "4": "/PWR_SW_P"},
           datasheet="http://www.soselectronic.cz/a_info/resource/d/pc817.pdf")

# J1 pastilles à souder : pad 1 (+, collecteur) en (79.5, 45.09),
# pad 2 (-, émetteur) en (79.5, 50.17)
j1 = place("SolderWirePad_1x02_P5.08mm", "J1", "PWR_SW", 79.5, 45.09,
           "sym/J1", {"1": "/PWR_SW_P", "2": "/PWR_SW_N"})

# Trous de fixation M3
for i, (hx, hy) in enumerate([(25, 25), (77, 25), (77, 61)], start=1):
    h = place("MountingHole_3.2mm_M3", f"H{i}", "M3", hx, hy, f"sym/H{i}", {})
    h.Reference().SetVisible(False)

# --------------------------------------------------------------------- pistes
def track(x1, y1, x2, y2, net, width=0.8):
    t = pcbnew.PCB_TRACK(board)
    t.SetStart(pt(x1, y1))
    t.SetEnd(pt(x2, y2))
    t.SetWidth(mm(width))
    t.SetLayer(pcbnew.F_Cu)
    t.SetNet(nets[net])
    board.Add(t)


track(47.43, 45.09, 53.50, 45.09, "/OPTO_IN")          # D1 -> R1
track(63.66, 45.09, 68.50, 45.09, "/OPTO_LED")         # R1 -> anode PC817
track(47.43, 55.25, 60.88, 55.25, "GND")               # GND module -> ...
track(60.88, 55.25, 68.50, 47.63, "GND")               # ... -> cathode (45°)
track(76.12, 45.09, 79.50, 45.09, "/PWR_SW_P")         # collecteur -> pad +
track(76.12, 47.63, 79.50, 50.17, "/PWR_SW_N")         # émetteur -> pad -

# ------------------------------------------------------------------- contour
# Rectangle 62 x 46.5 mm (20,20)-(82,66.5), coins arrondis r = 3 mm.
# Le bord bas laisse 0,5 mm après le corps du module (sérigraphie comprise).
EDGE_W = 0.1
K = 2.12132  # r * sin(45°)


def edge_seg(x1, y1, x2, y2):
    s = pcbnew.PCB_SHAPE(board)
    s.SetShape(pcbnew.SHAPE_T_SEGMENT)
    s.SetStart(pt(x1, y1))
    s.SetEnd(pt(x2, y2))
    s.SetLayer(pcbnew.Edge_Cuts)
    s.SetWidth(mm(EDGE_W))
    board.Add(s)


def edge_arc(sx, sy, mx, my, ex, ey):
    s = pcbnew.PCB_SHAPE(board)
    s.SetShape(pcbnew.SHAPE_T_ARC)
    s.SetArcGeometry(pt(sx, sy), pt(mx, my), pt(ex, ey))
    s.SetLayer(pcbnew.Edge_Cuts)
    s.SetWidth(mm(EDGE_W))
    board.Add(s)


edge_seg(23, 20, 79, 20)                                   # haut
edge_arc(79, 20, 82 - 0.87868, 20.87868, 82, 23)           # coin haut droit
edge_seg(82, 23, 82, 63.5)                                 # droite
edge_arc(82, 63.5, 82 - 0.87868, 65.62132, 79, 66.5)       # coin bas droit
edge_seg(79, 66.5, 23, 66.5)                               # bas
edge_arc(23, 66.5, 20.87868, 65.62132, 20, 63.5)           # coin bas gauche
edge_seg(20, 63.5, 20, 23)                                 # gauche
edge_arc(20, 23, 20.87868, 20.87868, 23, 20)               # coin haut gauche

# ------------------------------------------------------------------ sérigraphie
def silk(txt, x, y, size, thickness):
    t = pcbnew.PCB_TEXT(board)
    t.SetText(txt)
    t.SetPosition(pt(x, y))
    t.SetLayer(pcbnew.F_SilkS)
    t.SetTextSize(VECTOR2I(mm(size), mm(size)))
    t.SetTextThickness(mm(thickness))
    board.Add(t)
    return t


silk("PC POWER", 63.0, 25.5, 2.0, 0.4)
silk("CONTROLLER v1.0", 63.0, 29.0, 1.2, 0.22)
silk("PWR_SW", 70.5, 53.0, 1.0, 0.15)
silk("D1", 50.5, 43.6, 0.8, 0.13)
silk("GND", 51.2, 56.7, 0.8, 0.13)

pcbnew.SaveBoard(OUT, board)
print(f"OK -> {OUT}")
