# scripts/guandi3d-blender-look.py — renders a Tripo GLB from the front, the
# face and the back, to compare candidate models for X先知's 3D temple before
# one goes on the page (Blender, headless; free).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/guandi3d-blender-look.py -- <in.glb> <out-prefix>
#
# Tripo exports a model facing +X; Blender keeps glTF's +X, so the front is
# seen from +X and the back from -X.

import sys, math
import bpy
from mathutils import Vector

glb, out = sys.argv[sys.argv.index('--') + 1:][:2]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
center = (lo + hi) / 2
height = hi.z - lo.z

scene = bpy.context.scene
for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.film_transparent = False
world = bpy.data.worlds.new('w'); scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
world.node_tree.nodes['Background'].inputs[0].default_value = (0.85, 0.88, 0.92, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), math.radians(-20), math.radians(30))
scene.collection.objects.link(sun)

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
scene.collection.objects.link(cam)
scene.camera = cam

def shot(name, side, zoom_top=None, res=(600, 900)):
    scene.render.resolution_x, scene.render.resolution_y = res
    if zoom_top is None:
        target = center; cam.data.ortho_scale = height * 1.08
    else:
        # The top `zoom_top` of the height: the head and beard.
        target = Vector((center.x, center.y, hi.z - height * zoom_top / 2)); cam.data.ortho_scale = height * zoom_top * 1.1
    cam.location = target + Vector((side * height * 3, 0, 0))
    d = target - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f'{out}-{name}.png'
    bpy.ops.render.render(write_still=True)

shot('front', 1)
shot('face', 1, zoom_top=0.22, res=(600, 600))
shot('back', -1)
print('rendered', out, 'height', round(height, 3))
