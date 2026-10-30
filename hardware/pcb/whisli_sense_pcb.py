"""whisli sense – carrier PCB for the ceiling enclosure, built from scratch.

Run with KiCad's Python (it ships pcbnew):
    /Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 \
        hardware/pcb/whisli_sense_pcb.py

Ready-made modules are soldered flat, without headers. Front (F.Cu) faces the room: radar, light
sensor and the sensor chamber. Back (B.Cu) faces the ceiling: ESP32-C3-Zero and the 5 V regulator.

Model space matches the enclosure script: X right, +Y back, -Y front (logo side), seen from the
room. KiCad's Y grows downwards, so P() flips it. All dimensions in mm.
"""
import math
import os
import subprocess

import pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "whisli-sense.kicad_pcb")
KICAD_CLI = os.environ.get("KICAD_CLI", "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli")

# --- board (from the enclosure: PLATE_D, POST_R, POST_ANGLES) ---
BOARD_D = 72.0
ORIGIN = (100.0, 100.0)
POST_R = 30.0
POST_ANGLES = (90.0, 210.0, 330.0)
POST_HOLE_D = 2.8
POST_KEEPOUT_D = 7.5        # post on the back, M2.5 screw head on the front

# --- sensor chamber: a printed frame glued on the front, open to the vents in the cover ---
CHAMBER = (-17.3, -29.0, 17.3, -13.0)   # inner x0, y0, x1, y1
CHAMBER_WALL = 1.2
SLOT = (-10.5, -11.3, 10.5, -10.3)       # thermal break; the bridges at both ends carry the traces

# --- copper: B.Cu is a GND plane, F.Cu a +3V3 plane, everything else is a handful of tracks ---
TRACK = 0.3
POWER_TRACK = 0.6
CLEARANCE = 0.2
PAD_D, DRILL_D = 1.8, 1.0
VIA_D, VIA_DRILL = 0.8, 0.4
ANTENNA_KEEPOUT = (7.0, 16.0, 22.0, 36.0)   # no copper near the C3-Zero chip antenna, both layers

# --- silkscreen on the ceiling side: name, board version, power pads ---
FONT = "Helvetica Neue"     # same as the logo on the cover
VERSION = "v1 2026-10"
LABELS = [
    # text, (x, y), height
    ("whis.li sense", (1.0, -20.5), 3.0),
    (VERSION, (1.0, -24.5), 1.5),
    ("+", (-21.27, -2.3), 1.5),
    ("\u2212", (-18.73, -2.3), 1.5),
    ("5\u201336 V", (-20.0, -4.4), 1.2),
]

NETS = ("GND", "VIN", "+5V", "+3V3", "SDA", "SCL", "RADAR_RX", "RADAR_TX", "RADAR_OUT")


def mm(v):
    return pcbnew.FromMM(v)


def P(x, y):
    return pcbnew.VECTOR2I(mm(ORIGIN[0] + x), mm(ORIGIN[1] - y))


def polar(r, deg):
    a = math.radians(deg)
    return r * math.cos(a), r * math.sin(a)


# --- modules: pins in the module's own view (component side up, KiCad Y down), size w x h ---

def row(names, y, pitch=2.54, x0=None):
    x0 = -(len(names) - 1) * pitch / 2 if x0 is None else x0
    return [(n, x0 + i * pitch, y) for i, n in enumerate(names)]


# Waveshare HMMD: 20 x 20, pins along the bottom edge, OT2 1.62 from the right edge.
HMMD = dict(size=(20.0, 20.0), pins=row(["3V3", "GND", "TX", "RX", "OT2"], 8.7, x0=8.38 - 4 * 2.54))
# Purple 4-pin SHT3x breakout ~11 x 12.7, sensor in the upper right corner.
SHT3X = dict(size=(11.0, 12.7), pins=row(["VIN", "GND", "SCL", "SDA"], 5.15), chip=(2.7, -1.85))
# GY-302 BH1750 13.9 x 18.5, sensor centred, 7 mm from the top edge.
BH1750 = dict(size=(13.9, 18.5), pins=row(["VCC", "GND", "SCL", "SDA", "ADDR"], 7.75), chip=(0.0, -2.25))
# Common 4-pin SCD41 breakout 13.4 x 21.6, pins along a short edge (order checked on purchase).
SCD41 = dict(size=(13.4, 21.6), pins=row(["VCC", "GND", "SCL", "SDA"], 9.5))
# Pololu D36V6F5: 5.2-50 V in, 5 V 600 mA out, 0.4" x 0.5".
POLOLU = dict(size=(10.2, 12.7), pins=row(["SHDN", "VIN", "GND", "VOUT"], 5.08))
# Waveshare ESP32-C3-Zero 18 x 23.5, castellated, USB-C at the top, chip antenna at the bottom.
C3_PITCH, C3_FIRST = 2.54, -10.16
C3_LEFT = ["5V", "GND", "3V3", "IO0", "IO1", "IO2", "IO3", "IO4", "IO5"]
C3_RIGHT = ["IO21", "IO20", "IO19", "IO18", "IO10", "IO9", "IO8", "IO7", "IO6"]
C3 = dict(size=(18.0, 23.5),
          pins=[(n, -9.0, C3_FIRST + i * C3_PITCH) for i, n in enumerate(C3_LEFT)] +
               [(n, 9.0, C3_FIRST + i * C3_PITCH) for i, n in enumerate(C3_RIGHT)],
          antenna=(-9.0, 7.5, 9.0, 11.75))

# Which module pin goes to which net (pins not listed stay unconnected).
WIRING = {
    "U1": {"5V": "+5V", "GND": "GND", "3V3": "+3V3", "IO4": "SDA", "IO5": "SCL",
           "IO6": "RADAR_RX", "IO7": "RADAR_TX", "IO3": "RADAR_OUT"},   # same pins as src/board.h
    "U2": {"3V3": "+3V3", "GND": "GND", "TX": "RADAR_RX", "RX": "RADAR_TX", "OT2": "RADAR_OUT"},
    "U3": {"VIN": "+3V3", "GND": "GND", "SCL": "SCL", "SDA": "SDA"},
    "U4": {"VCC": "+3V3", "GND": "GND", "SCL": "SCL", "SDA": "SDA"},
    "U5": {"VCC": "+3V3", "GND": "GND", "SCL": "SCL", "SDA": "SDA"},
    "U6": {"VIN": "VIN", "GND": "GND", "VOUT": "+5V"},
    "J1": {"VIN": "VIN", "GND": "GND"},
}


class Board:
    def __init__(self):
        self.b = pcbnew.NewBoard(OUT)
        self.b.SetCopperLayerCount(2)
        self.nets = {}
        for name in NETS:
            net = pcbnew.NETINFO_ITEM(self.b, name)
            self.b.Add(net)
            self.nets[name] = net
        ds = self.b.GetDesignSettings()
        nc = ds.m_NetSettings.GetDefaultNetclass()
        nc.SetClearance(mm(CLEARANCE))
        nc.SetTrackWidth(mm(TRACK))
        nc.SetViaDrill(mm(0.4))
        nc.SetViaDiameter(mm(0.8))
        ds.m_TrackMinWidth = mm(0.15)
        ds.m_MinClearance = mm(0.15)

    def shape(self, parent, kind, layer, width=0.12):
        s = pcbnew.PCB_SHAPE(parent)
        s.SetShape(kind)
        s.SetLayer(layer)
        s.SetWidth(mm(width))
        parent.Add(s)
        return s

    def module(self, ref, value, spec, pos, rot=0.0, back=False, castellated=False):
        fp = pcbnew.FOOTPRINT(self.b)
        fp.SetReference(ref)
        fp.SetValue(value)
        fp.Value().SetVisible(False)
        fp.Reference().SetLayer(pcbnew.F_SilkS)
        w, h = spec["size"]
        # label inside the outline (the module covers it), outside for the tiny wire pads
        ref_y = 0.0 if castellated else -h / 2 + 1.6 if h > 6 else -h / 2 - 1.2
        fp.Reference().SetPosition(pcbnew.VECTOR2I(0, mm(ref_y)))
        silk_grow = -1.6 if castellated else 0.0   # keep the outline off the edge pads
        for layer, grow, width in ((pcbnew.F_SilkS, silk_grow, 0.12), (pcbnew.F_CrtYd, 0.25, 0.05)):
            r = self.shape(fp, pcbnew.SHAPE_T_RECT, layer, width)
            r.SetStart(pcbnew.VECTOR2I(mm(-w / 2 - grow), mm(-h / 2 - grow)))
            r.SetEnd(pcbnew.VECTOR2I(mm(w / 2 + grow), mm(h / 2 + grow)))
        wiring = WIRING.get(ref, {})
        for i, (name, x, y) in enumerate(spec["pins"]):
            pad = pcbnew.PAD(fp)
            pad.SetNumber(name)
            if castellated:
                # half hole on the module edge; the pad sticks out 1.6 mm for the iron
                pad.SetAttribute(pcbnew.PAD_ATTRIB_SMD)
                pad.SetShape(pcbnew.PAD_SHAPE_RECT)
                pad.SetSize(pcbnew.VECTOR2I(mm(2.6), mm(1.3)))
                pad.SetLayerSet(pad.SMDMask())
                x += 0.3 if x > 0 else -0.3
            else:
                pad.SetAttribute(pcbnew.PAD_ATTRIB_PTH)
                pad.SetShape(pcbnew.PAD_SHAPE_RECT if i == 0 else pcbnew.PAD_SHAPE_CIRCLE)
                pad.SetSize(pcbnew.VECTOR2I(mm(PAD_D), mm(PAD_D)))
                pad.SetDrillSize(pcbnew.VECTOR2I(mm(DRILL_D), mm(DRILL_D)))
                pad.SetLayerSet(pad.PTHMask())
            pad.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
            if name in wiring:
                pad.SetNet(self.nets[wiring[name]])
            fp.Add(pad)
        if "chip" in spec:   # mark where the sensor itself sits
            c = self.shape(fp, pcbnew.SHAPE_T_CIRCLE, pcbnew.F_SilkS)
            cx, cy = spec["chip"]
            c.SetCenter(pcbnew.VECTOR2I(mm(cx), mm(cy)))
            c.SetEnd(pcbnew.VECTOR2I(mm(cx + 1.0), mm(cy)))
        if back:
            fp.Flip(pcbnew.VECTOR2I(0, 0), pcbnew.FLIP_DIRECTION_LEFT_RIGHT)
        fp.SetOrientationDegrees(rot)
        fp.SetPosition(P(*pos))
        self.b.Add(fp)
        return fp


def outline(bd):
    c = bd.shape(bd.b, pcbnew.SHAPE_T_CIRCLE, pcbnew.Edge_Cuts, 0.1)
    c.SetCenter(P(0, 0))
    c.SetEnd(P(BOARD_D / 2, 0))
    x0, y0, x1, y1 = SLOT
    r = bd.shape(bd.b, pcbnew.SHAPE_T_RECT, pcbnew.Edge_Cuts, 0.1)
    r.SetStart(P(x0, y1))
    r.SetEnd(P(x1, y0))
    # chamber frame outline, so the printed frame lands in the right place
    x0, y0, x1, y1 = CHAMBER
    w = CHAMBER_WALL
    for g in (0.0, w):
        r = bd.shape(bd.b, pcbnew.SHAPE_T_RECT, pcbnew.F_SilkS, 0.15)
        r.SetStart(P(x0 - g, y1 + g))
        r.SetEnd(P(x1 + g, y0 - g))
    for i, a in enumerate(POST_ANGLES):
        fp = pcbnew.FOOTPRINT(bd.b)
        fp.SetReference(f"H{i + 1}")
        fp.Reference().SetVisible(False)
        fp.Value().SetVisible(False)
        pad = pcbnew.PAD(fp)
        pad.SetAttribute(pcbnew.PAD_ATTRIB_NPTH)
        pad.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
        pad.SetSize(pcbnew.VECTOR2I(mm(POST_HOLE_D), mm(POST_HOLE_D)))
        pad.SetDrillSize(pcbnew.VECTOR2I(mm(POST_HOLE_D), mm(POST_HOLE_D)))
        pad.SetLayerSet(pad.UnplatedHoleMask())
        fp.Add(pad)
        for layer in (pcbnew.F_CrtYd, pcbnew.B_CrtYd):
            k = bd.shape(fp, pcbnew.SHAPE_T_CIRCLE, layer, 0.05)
            k.SetCenter(pcbnew.VECTOR2I(0, 0))
            k.SetEnd(pcbnew.VECTOR2I(mm(POST_KEEPOUT_D / 2), 0))
        fp.SetPosition(P(*polar(POST_R, a)))
        bd.b.Add(fp)


def place(bd):
    x0, y0, x1, y1 = CHAMBER
    cy = (y0 + y1) / 2
    # front: room side
    bd.module("U2", "HMMD mmWave", HMMD, (0.0, 0.0))
    bd.module("U5", "BH1750 GY-302", BH1750, (-2.25, 18.5), rot=-90)     # sensor under the light window (0, 18.5)
    bd.module("U4", "SCD41", SCD41, (x0 + 0.4 + 10.8, cy), rot=-90)       # optional, CO2
    bd.module("U3", "SHT3x", SHT3X, (x1 - 0.3 - 5.5, cy), rot=180)        # sensor corner towards the vents
    # back: ceiling side
    bd.module("U1", "ESP32-C3-Zero", C3, (14.5, 9.0), back=True, castellated=True)
    bd.module("U6", "Pololu D36V6F5", POLOLU, (-21.0, 14.0), rot=-90, back=True)
    j1 = bd.module("J1", "zasilanie 5-36 V", dict(size=(5.6, 3.0), pins=[("VIN", -1.27, 0), ("GND", 1.27, 0)]),
              (-20.0, 0.0), back=True)    # wires come up through the cable hole in the base
    j1.Reference().SetVisible(False)   # the +/- labels say enough


def labels(bd):
    for text, pos, height in LABELS:
        t = pcbnew.PCB_TEXT(bd.b)
        t.SetText(text)
        t.SetLayer(pcbnew.B_SilkS)
        t.SetMirrored(True)     # reads correctly when looking at the back
        t.SetUnresolvedFontName(FONT)
        t.ResolveFont(None)
        t.SetTextSize(pcbnew.VECTOR2I(mm(height), mm(height)))
        t.SetTextThickness(mm(max(0.15, height * 0.12)))
        t.SetPosition(P(*pos))
        bd.b.Add(t)


# Tracks as (net, layer, width, points) and vias as (net, point), all in model coordinates.
F, B = pcbnew.F_Cu, pcbnew.B_Cu
ROUTES = [
    # power: VIN from the wires to the regulator, 5 V from the regulator to the C3-Zero
    ("VIN", F, POWER_TRACK, [(-21.27, 0.0), (-21.27, 13.0), (-19.0, 15.27), (-15.92, 15.27)]),
    ("+5V", B, POWER_TRACK, [(5.2, -1.16), (2.6, -1.16)]),
    ("+5V", F, POWER_TRACK, [(2.6, -1.16), (-8.75, 10.19), (-15.92, 10.19)]),
    ("+3V3", B, POWER_TRACK, [(5.2, 3.92), (2.6, 3.92)]),
    # radar UART: up to the front through vias next to the C3-Zero, then under the radar
    ("RADAR_RX", B, TRACK, [(23.8, 19.16), (26.0, 19.16)]),
    ("RADAR_RX", F, TRACK, [(26.0, 19.16), (26.0, -3.0), (3.30, -3.0), (3.30, -8.7)]),
    ("RADAR_TX", B, TRACK, [(23.8, 16.62), (27.8, 16.62)]),
    ("RADAR_TX", F, TRACK, [(27.8, 16.62), (27.8, -5.5), (5.84, -5.5), (5.84, -8.7)]),
    ("RADAR_OUT", B, TRACK, [(5.2, 14.08), (1.5, 14.08), (1.5, -6.5), (8.38, -6.5), (8.38, -8.7)]),
    # I2C: C3-Zero -> BH1750 -> down the left side, past the slot, to SCD41 and SHT3x
    ("SCL", B, TRACK, [(5.2, 19.16), (-7.4, 19.16), (-8.06, 18.5), (-10.0, 18.5)]),
    ("SCL", B, TRACK, [(-10.0, 18.5), (-13.4, 15.1), (-13.4, -22.27), (-15.6, -22.27)]),
    ("SCL", F, TRACK, [(-13.4, -13.0), (10.23, -13.0), (10.23, -15.85)]),
    ("SDA", B, TRACK, [(5.2, 16.62), (-8.0, 16.62), (-8.66, 15.96), (-10.0, 15.96)]),
    ("SDA", B, TRACK, [(-10.0, 15.96), (-12.0, 13.96), (-12.0, -24.81), (-15.6, -24.81)]),
    ("SDA", B, TRACK, [(-12.0, -13.6), (7.69, -13.6), (7.69, -15.85)]),
]
VIAS = [("+5V", (2.6, -1.16)), ("+3V3", (2.6, 3.92)), ("RADAR_RX", (26.0, 19.16)),
        ("RADAR_TX", (27.8, 16.62)), ("SCL", (-13.4, -13.0))]
PLANES = [("+3V3", F), ("GND", B)]


def circle_pts(r, n=72):
    return [polar(r, i * 360 / n) for i in range(n)]


def zone(bd, pts, layers, net=None):
    z = pcbnew.ZONE(bd.b)
    ls = pcbnew.LSET()
    for layer in layers:
        ls.AddLayer(layer)
    z.SetLayerSet(ls)
    if net:
        z.SetNet(bd.nets[net])
    for x, y in pts:
        z.AppendCorner(P(x, y), -1)
    bd.b.Add(z)
    return z


def route(bd):
    for net, layer, width, pts in ROUTES:
        for a, b in zip(pts, pts[1:]):
            t = pcbnew.PCB_TRACK(bd.b)
            t.SetStart(P(*a))
            t.SetEnd(P(*b))
            t.SetWidth(mm(width))
            t.SetLayer(layer)
            t.SetNet(bd.nets[net])
            bd.b.Add(t)
    for net, pos in VIAS:
        v = pcbnew.PCB_VIA(bd.b)
        v.SetViaType(pcbnew.VIATYPE_THROUGH)
        v.SetPosition(P(*pos))
        v.SetWidth(mm(VIA_D))
        v.SetDrill(mm(VIA_DRILL))
        v.SetNet(bd.nets[net])
        bd.b.Add(v)
    x0, y0, x1, y1 = ANTENNA_KEEPOUT
    k = zone(bd, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], (F, B))
    k.SetIsRuleArea(True)
    k.SetDoNotAllowTracks(True)
    k.SetDoNotAllowVias(True)
    k.SetDoNotAllowZoneFills(True)
    k.SetDoNotAllowPads(False)
    k.SetDoNotAllowFootprints(False)
    for net, layer in PLANES:
        z = zone(bd, circle_pts(BOARD_D / 2), (layer,), net)
        z.SetMinThickness(mm(0.25))
        z.SetLocalClearance(mm(0.3))
        z.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL)
        z.SetThermalReliefGap(mm(0.4))
        z.SetThermalReliefSpokeWidth(mm(0.5))
        z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)


def dump(bd):
    for fp in bd.b.GetFootprints():
        for pad in fp.Pads():
            p = pad.GetPosition()
            x = pcbnew.ToMM(p.x) - ORIGIN[0]
            y = ORIGIN[1] - pcbnew.ToMM(p.y)
            print(f"{fp.GetReference():3} {pad.GetNumber():5} {pad.GetNetname():10} {x:7.2f} {y:7.2f}")


def main():
    bd = Board()
    outline(bd)
    place(bd)
    route(bd)
    labels(bd)
    if os.environ.get("DUMP"):
        dump(bd)
    pcbnew.SaveBoard(OUT, bd.b)
    # The filler is unreliable from a bare script (it ignores holes); the CLI fills and checks.
    report = os.path.join(HERE, "drc.rpt")
    subprocess.run([KICAD_CLI, "pcb", "drc", "--refill-zones", "--save-board", "--severity-all",
                    "-o", report, OUT], check=True)


if __name__ == "__main__":
    main()
