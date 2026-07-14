#!/usr/bin/env python3
"""Génère hardware/pc-power-controller.kicad_pcb via l'API pcbnew.

À lancer avec le Python du flatpak KiCad :
  flatpak run --command=python3 org.kicad.KiCad generate/gen_pcb.py

Carte compacte 54.7 x 35.2 mm, 2 couches, tout traversant.
Le D1 Mini est vertical à gauche, USB affleurant le bord bas, antenne en haut
avec une zone sans cuivre. À droite, sur la ligne de D1 : R1 -> PC817 -> J1
(pastilles PWR_SW) ; en dessous : J2 (pastilles d'alimentation 5V/GND).
Le retour GND de J2 passe en face arrière (les pads traversants relient les
deux couches, aucun via nécessaire).

Les extrémités de pistes sont lues depuis les positions réelles des pads
(pad_xy) : impossible de se tromper de broche. Les uuid des symboles du
schéma sont recalculés (uuid5 déterministes) pour la parité schéma/PCB.
"""
import uuid
from pathlib import Path

import pcbnew
from pcbnew import VECTOR2I, FromMM, ToMM

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
tb.SetRevision("1.1")

# ---------------------------------------------------------------------- nets
# Étiquettes locales du schéma -> nets préfixés "/" ; GND (symbole power)
# reste global. Chaque broche non connectée porte un net "unconnected-...".
UNCONNECTED_U1 = {
    "1": "unconnected-(U1-~{RST}-Pad1)",
    "2": "unconnected-(U1-A0-Pad2)",
    "3": "unconnected-(U1-D0-Pad3)",
    "4": "unconnected-(U1-SCK{slash}D5-Pad4)",
    "5": "unconnected-(U1-MISO{slash}D6-Pad5)",
    "6": "unconnected-(U1-MOSI{slash}D7-Pad6)",
    "7": "unconnected-(U1-CS{slash}D8-Pad7)",
    "8": "unconnected-(U1-3V3-Pad8)",
    "11": "unconnected-(U1-D4-Pad11)",
    "12": "unconnected-(U1-D3-Pad12)",
    "13": "unconnected-(U1-SDA{slash}D2-Pad13)",
    "15": "unconnected-(U1-RX-Pad15)",
    "16": "unconnected-(U1-TX-Pad16)",
}
nets = {}
for name in (["GND", "/5V", "/OPTO_IN", "/OPTO_LED", "/PWR_SW_P", "/PWR_SW_N"]
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


def pad_xy(fp, num):
    for pad in fp.Pads():
        if pad.GetNumber() == num:
            pos = pad.GetPosition()
            return (round(ToMM(pos.x), 3), round(ToMM(pos.y), 3))
    raise KeyError(num)


# D1 Mini : ancre = pad 1 (colonne gauche, côté antenne). Colonne droite en
# x = 44.66 : pad 14 = D1/GPIO5 (y 33.78), pad 10 = GND (43.94), pad 9 = 5V (46.48)
u1 = place("WEMOS_D1_mini_light", "U1", "WEMOS_D1_mini", 21.8, 28.7,
           "sym/U1", {"14": "/OPTO_IN", "10": "GND", "9": "/5V", **UNCONNECTED_U1},
           datasheet="https://wiki.wemos.cc/products:d1:d1_mini")
u1.Reference().SetPosition(pt(33.0, 45.0))
u1.Value().SetPosition(pt(33.0, 48.2))

# R1 330R sur la ligne de D1
r1 = place("R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal", "R1", "330R",
           48.9, 33.78, "sym/R1", {"1": "/OPTO_IN", "2": "/OPTO_LED"})

# U2 PC817 : 1 = anode, 2 = cathode (gauche) ; 3 = émetteur, 4 = collecteur (droite)
u2 = place("DIP-4_W7.62mm", "U2", "PC817", 61.6, 33.78, "sym/U2",
           {"1": "/OPTO_LED", "2": "GND", "3": "/PWR_SW_N", "4": "/PWR_SW_P"},
           datasheet="http://www.soselectronic.cz/a_info/resource/d/pc817.pdf")

# J1 pastilles PWR_SW : pad 1 (+, collecteur), pad 2 (-, émetteur)
j1 = place("SolderWirePad_1x02_P5.08mm", "J1", "PWR_SW", 72.5, 33.78,
           "sym/J1", {"1": "/PWR_SW_P", "2": "/PWR_SW_N"})

# J2 pastilles alimentation : pad 1 (+, 5V), pad 2 (-, GND)
j2 = place("SolderWirePad_1x02_P5.08mm", "J2", "5V_IN", 72.5, 45.5,
           "sym/J2", {"1": "/5V", "2": "GND"})
j2.Reference().SetPosition(pt(68.9, 44.2))

# Trous de fixation M3 sur le bandeau haut
for i, (hx, hy) in enumerate([(52, 24.3), (70.5, 24.3)], start=1):
    h = place("MountingHole_3.2mm_M3", f"H{i}", "M3", hx, hy, f"sym/H{i}", {})
    h.Reference().SetVisible(False)

# --------------------------------------------------------------------- pistes
def track(a, b, net, layer=pcbnew.F_Cu, width=0.8):
    t = pcbnew.PCB_TRACK(board)
    t.SetStart(pt(*a))
    t.SetEnd(pt(*b))
    t.SetWidth(mm(width))
    t.SetLayer(layer)
    t.SetNet(nets[net])
    board.Add(t)


B = pcbnew.B_Cu

# D1 -> R1 -> anode PC817 (face avant, ligne y = 33.78)
track(pad_xy(u1, "14"), pad_xy(r1, "1"), "/OPTO_IN")
track(pad_xy(r1, "2"), pad_xy(u2, "1"), "/OPTO_LED")
# GND module -> cathode PC817 (face avant, horizontal puis 45°)
track(pad_xy(u1, "10"), (53.98, 43.94), "GND")
track((53.98, 43.94), pad_xy(u2, "2"), "GND")
# sorties optocoupleur -> pastilles PWR_SW
track(pad_xy(u2, "4"), pad_xy(j1, "1"), "/PWR_SW_P")
track(pad_xy(u2, "3"), pad_xy(j1, "2"), "/PWR_SW_N")
# alimentation : 5V en face avant, retour GND de J2 en face arrière
track(pad_xy(u1, "9"), (71.52, 46.48), "/5V")
track((71.52, 46.48), pad_xy(j2, "1"), "/5V")
track(pad_xy(u1, "10"), (51.30, 50.58), "GND", layer=B)
track((51.30, 50.58), pad_xy(j2, "2"), "GND", layer=B)

# ------------------------------------------------------------------- contour
# Rectangle 54.7 x 35.2 mm (20,20)-(74.7,55.2), coins arrondis r = 3 mm.
# Bord bas : 0,5 mm après le corps du module (USB affleurant).
EDGE_W = 0.1
K = 0.87868  # r - r*sin(45°)


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


L, R_, T, Bo = 20.0, 74.7, 20.0, 55.2
edge_seg(L + 3, T, R_ - 3, T)                              # haut
edge_arc(R_ - 3, T, R_ - K, T + K, R_, T + 3)              # coin haut droit
edge_seg(R_, T + 3, R_, Bo - 3)                            # droite
edge_arc(R_, Bo - 3, R_ - K, Bo - K, R_ - 3, Bo)           # coin bas droit
edge_seg(R_ - 3, Bo, L + 3, Bo)                            # bas
edge_arc(L + 3, Bo, L + K, Bo - K, L, Bo - 3)              # coin bas gauche
edge_seg(L, Bo - 3, L, T + 3)                              # gauche
edge_arc(L, T + 3, L + K, T + K, L + 3, T)                 # coin haut gauche

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


silk("PC POWER v1.1", 57.5, 29.8, 1.0, 0.15)
silk("D1", 47.3, 32.5, 0.8, 0.13)
silk("GND", 47.6, 42.6, 0.8, 0.13)
silk("5V", 47.3, 47.9, 0.8, 0.13)
silk("PWR_SW", 67.0, 41.5, 0.8, 0.13)
silk("5V IN", 66.6, 53.6, 0.8, 0.13)

pcbnew.SaveBoard(OUT, board)
print(f"OK -> {OUT}")
