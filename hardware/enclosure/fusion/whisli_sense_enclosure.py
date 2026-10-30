"""whisli sense – ceiling enclosure, built from scratch in a new Fusion design.

Run through the Fusion MCP server (fusion_mcp_execute, featureType "script") or from
Utilities -> Scripts and Add-Ins. Every run creates a fresh, unsaved document.

Model space: Z = 0 is the ceiling, +Z points down into the room, so the "top" view in
Fusion is what you see standing under the sensor. -Y is the front (logo side).
All dimensions below are in mm; the Fusion API works in cm.
"""
import math

import adsk.core
import adsk.fusion

# --- outline ---
COVER_D = 85.0
WALL = 2.0
FLOOR = 2.0
HEIGHT = 22.0           # ceiling to the visible face
AIR_GAP = 1.5           # cover rim stays off the ceiling: hidden air inlet, reads as a shadow line
EDGE_R = 4.0            # visible bottom edge
RIM_R = 0.5

# --- base (screwed to the ceiling) ---
BASE_D = 79.0           # 1 mm radial clearance to the cover wall doubles as the air path
BASE_T = 3.0
RING_W = 3.0
RING_TOP = 9.0
CABLE_D = 16.0
SCREW_R = 30.0          # 60 mm spacing, standard EU flush box
SCREW_SLOT_W = 4.5
SCREW_SLOT_ARC = 12.0   # +- degrees, lets the logo be aligned after the screws are in
POST_R = 30.0
POST_ANGLES = (90.0, 210.0, 330.0)
POST_D = 7.0
INSERT_D = 3.6          # M2.5 heat-set insert
INSERT_DEPTH = 5.0

# --- bayonet: lugs on the cover, L-slots in the base ring ---
TWIST = 25.0            # clockwise seen from below closes the cover
LUG_ANGLES = (-90.0, 30.0, 150.0)
LUG_WIDTHS = (20.0, 12.0, 12.0)   # the wide front lug keys the logo to one position
LUG_Z = (4.5, 6.5)      # flat part; a 45 deg ramp above it keeps it printable face-down
LUG_DEPTH = 2.2         # from the cover inner wall
CLEAR = 0.3
DETENT = 0.3            # radial interference of the click bump

# --- mounting plate with the electronics ---
PLATE_D = 72.0
PLATE_Z = 9.0
PLATE_T = 2.0
PLATE_HOLE_D = 2.8
CHAMBER = (-15.0, -30.5, 15.0, -15.0)   # inner x0, y0, x1, y1: SCD41 + SHT30, open to the vents
CHAMBER_WALL = 1.2
CHAMBER_TOP_GAP = 0.5   # lets the cover twist over the walls

# --- cover openings and graphics ---
VENT_D = 1.6
VENT_PITCH = 3.0
LIGHT_POS = (0.0, 18.5)
LIGHT_D = 4.0
LIGHT_SKIN = 0.5        # thin white skin in front of the BH1750 instead of a hole
WAVE_CENTER = (0.0, 8.0)
WAVE_RADII = (5.0, 8.5, 12.0)
WAVE_SWEEP = 80.0
WAVE_W = 1.0
ENGRAVE = 0.6
LOGO_DEPTH = 0.5
LOGO_FONT = "Helvetica Neue"

COVER_R = COVER_D / 2
COVER_IN_R = COVER_R - WALL
BASE_R = BASE_D / 2
RING_IN_R = BASE_R - RING_W
FLOOR_Z = HEIGHT - FLOOR
SLOT_IN_R = COVER_IN_R - LUG_DEPTH - CLEAR


def cm(v):
    return v / 10.0


def P(x, y, z=0.0):
    return adsk.core.Point3D.create(cm(x), cm(y), cm(z))


def val(mm):
    return adsk.core.ValueInput.createByReal(cm(mm))


def polar(r, deg, cx=0.0, cy=0.0):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def collection(items):
    oc = adsk.core.ObjectCollection.create()
    for i in items:
        oc.add(i)
    return oc


def loop(sk, start, segs):
    """Closed loop of lines ('L', end) and three-point arcs ('A', mid, end), in model coords."""
    first = cur = None
    pos = sk.modelToSketchSpace(start)
    for i, s in enumerate(segs):
        end = sk.modelToSketchSpace(start if i == len(segs) - 1 else s[-1])
        a = cur or pos
        b = first if i == len(segs) - 1 else end
        if s[0] == "L":
            c = sk.sketchCurves.sketchLines.addByTwoPoints(a, b)
        else:
            c = sk.sketchCurves.sketchArcs.addByThreePoints(a, sk.modelToSketchSpace(s[1]), b)
        ends = (c.startSketchPoint, c.endSketchPoint)
        if first is None:
            first = min(ends, key=lambda p: p.geometry.distanceTo(pos))
        cur = min(ends, key=lambda p: p.geometry.distanceTo(end))
        pos = end


def polygon(sk, pts):
    loop(sk, P(*pts[0]), [("L", P(*p)) for p in pts[1:]] + [("L", P(*pts[0]))])


def rect(sk, cx, cy, sx, sy):
    polygon(sk, [(cx - sx / 2, cy - sy / 2), (cx + sx / 2, cy - sy / 2),
                 (cx + sx / 2, cy + sy / 2), (cx - sx / 2, cy + sy / 2)])


def arc_band(sk, cx, cy, r, a0, a1, w):
    """Arc-shaped slot with round ends: screw slots and the engraved waves."""
    ro, ri, am = r + w / 2, r - w / 2, (a0 + a1) / 2
    cap0, cap1 = polar(r, a0, cx, cy), polar(r, a1, cx, cy)
    out0 = polar(w / 2, a0 - 90, *cap0)
    out1 = polar(w / 2, a1 + 90, *cap1)
    loop(sk, P(*polar(ro, a0, cx, cy)), [
        ("A", P(*polar(ro, am, cx, cy)), P(*polar(ro, a1, cx, cy))),
        ("A", P(*out1), P(*polar(ri, a1, cx, cy))),
        ("A", P(*polar(ri, am, cx, cy)), P(*polar(ri, a0, cx, cy))),
        ("A", P(*out0), P(*polar(ro, a0, cx, cy))),
    ])


def xy_sketch(comp):
    return comp.sketches.add(comp.xYConstructionPlane)


def extrude(comp, sk, z0, z1, op, bodies=None):
    profs = collection([sk.profiles.item(i) for i in range(sk.profiles.count)])
    inp = comp.features.extrudeFeatures.createInput(profs, op)
    inp.startExtent = adsk.fusion.OffsetStartDefinition.create(val(z0))
    inp.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(val(z1 - z0)),
                         adsk.fusion.ExtentDirections.PositiveExtentDirection)
    if bodies:
        inp.participantBodies = bodies
    return comp.features.extrudeFeatures.add(inp)


def revolve(comp, pts_rz, op, sweep=360.0):
    """Revolve an (r, z) polygon around Z; partial sweeps are symmetric about +X."""
    sk = comp.sketches.add(comp.xZConstructionPlane)
    polygon_rz = [(r, 0.0, z) for r, z in pts_rz]
    loop(sk, P(*polygon_rz[0]), [("L", P(*p)) for p in polygon_rz[1:]] + [("L", P(*polygon_rz[0]))])
    inp = comp.features.revolveFeatures.createInput(sk.profiles.item(0), comp.zConstructionAxis, op)
    symmetric = sweep < 360
    # A symmetric extent takes the angle per side.
    angle = adsk.core.ValueInput.createByString("%g deg" % (sweep / 2 if symmetric else sweep))
    inp.setAngleExtent(symmetric, angle)
    return comp.features.revolveFeatures.add(inp)


def rotate(comp, body, deg):
    m = adsk.core.Matrix3D.create()
    m.setToRotation(math.radians(deg), adsk.core.Vector3D.create(0, 0, 1), adsk.core.Point3D.create(0, 0, 0))
    inp = comp.features.moveFeatures.createInput2(collection([body]))
    inp.defineAsFreeMove(m)
    comp.features.moveFeatures.add(inp)


def wedge(comp, pts_rz, center, sweep):
    """Tool body: an (r, z) profile swept over `sweep` degrees around `center`."""
    body = revolve(comp, pts_rz, adsk.fusion.FeatureOperations.NewBodyFeatureOperation, sweep).bodies.item(0)
    rotate(comp, body, center)
    return body


def combine(comp, target, tools, op):
    inp = comp.features.combineFeatures.createInput(target, collection(tools))
    inp.operation = op
    comp.features.combineFeatures.add(inp)


def circle_edges(body, r, z):
    out = []
    for e in body.edges:
        g = e.geometry
        if g.objectType == adsk.core.Circle3D.classType() and abs(g.radius - cm(r)) < 1e-4 \
                and abs(g.center.z - cm(z)) < 1e-4:
            out.append(e)
    return out


def fillet(comp, edges, r):
    inp = comp.features.filletFeatures.createInput()
    inp.edgeSetInputs.addConstantRadiusEdgeSet(collection(edges), val(r), True)
    comp.features.filletFeatures.add(inp)


def new_component(root, name):
    comp = root.occurrences.addNewComponent(adsk.core.Matrix3D.create()).component
    comp.name = name
    return comp


JOIN = adsk.fusion.FeatureOperations.JoinFeatureOperation
CUT = adsk.fusion.FeatureOperations.CutFeatureOperation
NEW = adsk.fusion.FeatureOperations.NewBodyFeatureOperation


def build_base(comp):
    body = revolve(comp, [(0, 0), (BASE_R, 0), (BASE_R, RING_TOP), (RING_IN_R, RING_TOP),
                          (RING_IN_R, BASE_T), (0, BASE_T)], NEW).bodies.item(0)
    body.name = "podstawa"
    fillet(comp, circle_edges(body, RING_IN_R, BASE_T), 1.0)

    sk = xy_sketch(comp)
    for x, y in (polar(POST_R, a) for a in POST_ANGLES):
        sk.sketchCurves.sketchCircles.addByCenterRadius(P(x, y), cm(POST_D / 2))
    extrude(comp, sk, BASE_T - 0.1, RING_TOP, JOIN, [body])
    sk = xy_sketch(comp)
    for x, y in (polar(POST_R, a) for a in POST_ANGLES):
        sk.sketchCurves.sketchCircles.addByCenterRadius(P(x, y), cm(INSERT_D / 2))
    extrude(comp, sk, RING_TOP - INSERT_DEPTH, RING_TOP + 0.1, CUT, [body])

    sk = xy_sketch(comp)
    sk.sketchCurves.sketchCircles.addByCenterRadius(P(0, 0), cm(CABLE_D / 2))
    for a in (0.0, 180.0):
        arc_band(sk, 0, 0, SCREW_R, a - SCREW_SLOT_ARC, a + SCREW_SLOT_ARC, SCREW_SLOT_W)
    extrude(comp, sk, -0.1, BASE_T + 0.1, CUT, [body])

    # Front arrow for the installer: aligns the screw slots with where the logo should face.
    sk = xy_sketch(comp)
    polygon(sk, [(-3, -RING_IN_R + 6), (3, -RING_IN_R + 6), (0, -RING_IN_R + 2)])
    extrude(comp, sk, BASE_T - 0.6, BASE_T + 0.1, CUT, [body])

    # Bayonet L-slots: the lug drops in at +TWIST and turns clockwise (seen from below) to its lock angle.
    slot_out = BASE_R + 0.1
    lo, hi = LUG_Z[0] - CLEAR, LUG_Z[1] + CLEAR
    ramp_top = hi + (slot_out - SLOT_IN_R)
    tools = []
    for center, width in zip(LUG_ANGLES, LUG_WIDTHS):
        run_from, run_to = center - width / 2 - CLEAR * 2, center + TWIST + width / 2 + 1.0
        tools.append(wedge(comp, [(SLOT_IN_R, lo), (slot_out, lo), (slot_out, ramp_top), (SLOT_IN_R, hi)],
                           (run_from + run_to) / 2, run_to - run_from))
        tools.append(wedge(comp, [(SLOT_IN_R, lo), (slot_out, lo), (slot_out, RING_TOP + 0.1),
                                  (SLOT_IN_R, RING_TOP + 0.1)], center + TWIST, width + 2.0))
    combine(comp, body, tools, CUT)

    # Click bump just behind each closed lug; the lug rides over it while turning.
    sk = xy_sketch(comp)
    for center, width in zip(LUG_ANGLES, LUG_WIDTHS):
        bump_r = CLEAR + DETENT
        x, y = polar(SLOT_IN_R, center + width / 2 + math.degrees(bump_r * 2 / SLOT_IN_R))
        sk.sketchCurves.sketchCircles.addByCenterRadius(P(x, y), cm(bump_r))
    extrude(comp, sk, lo, hi - 0.3, JOIN, [body])
    return body


def build_plate(comp):
    sk = xy_sketch(comp)
    sk.sketchCurves.sketchCircles.addByCenterRadius(P(0, 0), cm(PLATE_D / 2))
    body = extrude(comp, sk, PLATE_Z, PLATE_Z + PLATE_T, NEW).bodies.item(0)
    body.name = "plytka montazowa"

    x0, y0, x1, y1 = CHAMBER
    sk = xy_sketch(comp)
    for x, y in (polar(POST_R, a) for a in POST_ANGLES):
        sk.sketchCurves.sketchCircles.addByCenterRadius(P(x, y), cm(PLATE_HOLE_D / 2))
    rect(sk, 0, y1 + 1.5, x1 - x0 + 2 * CHAMBER_WALL, 2.0)   # thermal break, also the sensor wire pass
    rect(sk, 21, 0, 3, 8)                                     # radar wires
    rect(sk, 13, LIGHT_POS[1], 3, 6)                          # light sensor wires
    extrude(comp, sk, PLATE_Z - 0.1, PLATE_Z + PLATE_T + 0.1, CUT, [body])

    sk = xy_sketch(comp)
    w = CHAMBER_WALL
    rect(sk, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0 + 2 * w, y1 - y0 + 2 * w)
    rect(sk, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0)
    ring = [sk.profiles.item(i) for i in range(sk.profiles.count)
            if sk.profiles.item(i).profileLoops.count == 2]
    inp = comp.features.extrudeFeatures.createInput(collection(ring), JOIN)
    inp.startExtent = adsk.fusion.OffsetStartDefinition.create(val(PLATE_Z + PLATE_T - 0.1))
    inp.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(
        val(FLOOR_Z - CHAMBER_TOP_GAP - (PLATE_Z + PLATE_T - 0.1))),
        adsk.fusion.ExtentDirections.PositiveExtentDirection)
    inp.participantBodies = [body]
    comp.features.extrudeFeatures.add(inp)
    return body


def build_cover(comp):
    body = revolve(comp, [(0, FLOOR_Z), (COVER_IN_R, FLOOR_Z), (COVER_IN_R, AIR_GAP), (COVER_R, AIR_GAP),
                          (COVER_R, HEIGHT), (0, HEIGHT)], NEW).bodies.item(0)
    body.name = "pokrywa"
    fillet(comp, circle_edges(body, COVER_R, HEIGHT), EDGE_R)
    fillet(comp, circle_edges(body, COVER_R, AIR_GAP) + circle_edges(body, COVER_IN_R, AIR_GAP), RIM_R)
    fillet(comp, circle_edges(body, COVER_IN_R, FLOOR_Z), 1.0)

    lug_in = COVER_IN_R - LUG_DEPTH
    ramp_top = LUG_Z[1] + LUG_DEPTH + 0.1
    lugs = [wedge(comp, [(lug_in, LUG_Z[0]), (COVER_IN_R + 0.1, LUG_Z[0]), (COVER_IN_R + 0.1, ramp_top),
                         (lug_in, LUG_Z[1])], a, w) for a, w in zip(LUG_ANGLES, LUG_WIDTHS)]
    combine(comp, body, lugs, JOIN)

    x0, y0, x1, y1 = CHAMBER
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    sk = xy_sketch(comp)
    for k in range(7):
        x, y = (cx, cy) if k == 0 else polar(VENT_PITCH, k * 60 + 30, cx, cy)
        sk.sketchCurves.sketchCircles.addByCenterRadius(P(x, y), cm(VENT_D / 2))
    extrude(comp, sk, FLOOR_Z - 0.1, HEIGHT + 0.1, CUT, [body])

    sk = xy_sketch(comp)
    sk.sketchCurves.sketchCircles.addByCenterRadius(P(*LIGHT_POS), cm(LIGHT_D / 2))
    extrude(comp, sk, FLOOR_Z - 0.1, HEIGHT - LIGHT_SKIN, CUT, [body])

    sk = xy_sketch(comp)
    for r in WAVE_RADII:
        arc_band(sk, WAVE_CENTER[0], WAVE_CENTER[1], r, -90 - WAVE_SWEEP / 2, -90 + WAVE_SWEEP / 2, WAVE_W)
    extrude(comp, sk, HEIGHT - ENGRAVE, HEIGHT + 0.1, CUT, [body])

    engrave_logo(comp, body)
    return body


def engrave_logo(comp, body):
    side = [f for f in body.faces if f.geometry.objectType == adsk.core.Cylinder.classType()
            and abs(f.geometry.radius - cm(COVER_R)) < 1e-4]
    planes = comp.constructionPlanes
    inp = planes.createInput()
    inp.setByOffset(comp.xZConstructionPlane, val(COVER_R + 1))
    plane = planes.add(inp)
    if plane.geometry.origin.y > 0:
        plane.deleteMe()
        inp = planes.createInput()
        inp.setByOffset(comp.xZConstructionPlane, val(-COVER_R - 1))
        plane = planes.add(inp)
    plane.name = "logo"
    sk = comp.sketches.add(plane)
    y = -COVER_R - 1
    # Seen from the front the text reads along -X with "up" towards the ceiling (-Z).
    o = sk.sketchToModelSpace(adsk.core.Point3D.create(0, 0, 0))
    xd = sk.sketchToModelSpace(adsk.core.Point3D.create(1, 0, 0))
    yd = sk.sketchToModelSpace(adsk.core.Point3D.create(0, 1, 0))
    texts = []
    for text, height, z0, z1 in (("whis.li", 7.0, 3.5, 11.5), ("sense", 4.5, 12.5, 17.0)):
        ti = sk.sketchTexts.createInput2(text, cm(height))
        ti.setAsMultiLine(sk.modelToSketchSpace(P(-25, y, z0)), sk.modelToSketchSpace(P(25, y, z1)),
                          adsk.core.HorizontalAlignments.CenterHorizontalAlignment,
                          adsk.core.VerticalAlignments.MiddleVerticalAlignment, 0)
        ti.fontName = LOGO_FONT
        ti.isHorizontalFlip = xd.x - o.x > 0
        ti.isVerticalFlip = yd.z - o.z > 0
        texts.append(sk.sketchTexts.add(ti))
    emb = comp.features.embossFeatures.createInput(texts, side, val(-LOGO_DEPTH))
    comp.features.embossFeatures.add(emb)


def build_electronics(comp):
    """Placeholder blocks, sizes to be checked with calipers."""
    top = PLATE_Z + PLATE_T
    x0, y0, x1, y1 = CHAMBER
    parts = [
        ("radar HMMD", 0, 0, 35, 20, top, top + 4),
        ("SCD41", x0 + 9, (y0 + y1) / 2, 17, 13, top, top + 1.6),
        ("SCD41 czujnik", x0 + 9, (y0 + y1) / 2, 10.1, 10.1, top + 1.6, top + 8.1),
        ("SHT30", x1 - 7.5, (y0 + y1) / 2, 10, 13, top, top + 2.5),
        ("BH1750", LIGHT_POS[0], LIGHT_POS[1], 18.5, 13.9, top, top + 1.6),
        ("BH1750 czujnik", LIGHT_POS[0], LIGHT_POS[1], 3, 3, top + 1.6, top + 2.6),
        ("ESP32-C3-Zero", 0, 14, 18, 23.5, PLATE_Z - 4.5, PLATE_Z),
        ("przetwornica 5V", -18, 10, 11, 17, PLATE_Z - 4, PLATE_Z),
        ("zacisk zasilania", 18, 10, 7.5, 7, PLATE_Z - 6, PLATE_Z),
    ]
    for name, cx, cy, sx, sy, z0, z1 in parts:
        sk = xy_sketch(comp)
        rect(sk, cx, cy, sx, sy)
        b = extrude(comp, sk, z0, z1, NEW).bodies.item(0)
        b.name = name


def run(_context: str):
    app = adsk.core.Application.get()
    app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    design = adsk.fusion.Design.cast(app.activeProduct)
    design.designType = adsk.fusion.DesignTypes.ParametricDesignType
    root = design.rootComponent

    build_base(new_component(root, "podstawa"))
    build_plate(new_component(root, "plytka montazowa"))
    build_cover(new_component(root, "pokrywa"))
    build_electronics(new_component(root, "elektronika (makieta)"))
    app.activeViewport.fit()
    print("ok")
